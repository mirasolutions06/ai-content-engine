import crypto from 'crypto';
import fs from 'fs-extra';
import path from 'path';
import { logger } from '../utils/logger.js';
import type { VideoConfig, ReviewRecord, ReviewStatus } from '../types/index.js';

const AIRTABLE_API = 'https://api.airtable.com/v0';
const AIRTABLE_CONTENT_API = 'https://content.airtable.com/v0';

/**
 * Logs pipeline runs to an Airtable base.
 * All methods are non-fatal: errors are warned and silently ignored.
 * Configure via AIRTABLE_API_KEY, AIRTABLE_BASE_ID, AIRTABLE_TABLE_ID env vars.
 */
export class AirtableLogger {
  private readonly apiKey: string;
  private readonly baseId: string;
  private readonly tableId: string;

  constructor() {
    this.apiKey = process.env['AIRTABLE_API_KEY'] ?? '';
    this.baseId = process.env['AIRTABLE_BASE_ID'] ?? '';
    this.tableId = process.env['AIRTABLE_TABLE_ID'] ?? '';
  }

  get isConfigured(): boolean {
    return Boolean(this.apiKey && this.baseId && this.tableId);
  }

  private get authHeader(): Record<string, string> {
    return { Authorization: `Bearer ${this.apiKey}` };
  }

  /**
   * Creates an Airtable record for a new pipeline run.
   * Returns the record ID, or null if Airtable is not configured or the call fails.
   */
  async createRun(
    projectName: string,
    format: string,
    config: VideoConfig,
  ): Promise<string | null> {
    if (!this.isConfigured) return null;

    const now = new Date().toISOString();
    const name = `${projectName} — ${format} — ${now.slice(0, 19).replace('T', ' ')}`;

    try {
      const res = await fetch(`${AIRTABLE_API}/${this.baseId}/${this.tableId}`, {
        method: 'POST',
        headers: { ...this.authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: {
            Name: name,
            Project: projectName,
            Format: format,
            Status: 'Running',
            'Started At': now,
            Clips: config.clips.length,
            Script: config.script ?? '',
          },
        }),
      });

      if (!res.ok) {
        logger.warn(`Airtable createRun failed: HTTP ${res.status} — ${await res.text()}`);
        return null;
      }

      const data = await res.json() as { id: string };
      logger.info(`Airtable: run logged (record ${data.id})`);
      return data.id;
    } catch (err) {
      logger.warn(`Airtable createRun error: ${String(err)}`);
      return null;
    }
  }

  /**
   * Updates the run record to Completed and uploads the MP4 as an attachment.
   */
  async completeRun(
    recordId: string | null,
    finalPath: string,
    elapsedSeconds: number,
  ): Promise<void> {
    if (!this.isConfigured || recordId === null) return;

    try {
      // Upload MP4 as attachment to "Output Video" field.
      // We construct the multipart body manually so the Content-Type boundary is
      // explicit — Node.js native FormData can omit it when combined with custom headers.
      const videoBuffer = await fs.readFile(finalPath);
      const filename = path.basename(finalPath);
      const boundary = `----AirtableBoundary${crypto.randomBytes(8).toString('hex')}`;
      const CRLF = '\r\n';
      const partHead = Buffer.from(
        `--${boundary}${CRLF}` +
        `Content-Disposition: form-data; name="file"; filename="${filename}"${CRLF}` +
        `Content-Type: video/mp4${CRLF}` +
        CRLF,
      );
      const partTail = Buffer.from(`${CRLF}--${boundary}--${CRLF}`);
      const body = Buffer.concat([partHead, videoBuffer, partTail]);

      const uploadRes = await fetch(
        `${AIRTABLE_CONTENT_API}/${this.baseId}/${recordId}/Output%20Video/uploadAttachment`,
        {
          method: 'POST',
          headers: {
            ...this.authHeader,
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Content-Length': String(body.length),
          },
          body,
        },
      );

      if (!uploadRes.ok) {
        logger.warn(
          `Airtable video upload failed: HTTP ${uploadRes.status} — ${await uploadRes.text()}`,
        );
      }

      // Update status and timing
      const patchRes = await fetch(
        `${AIRTABLE_API}/${this.baseId}/${this.tableId}/${recordId}`,
        {
          method: 'PATCH',
          headers: { ...this.authHeader, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fields: {
              Status: 'Completed',
              'Completed At': new Date().toISOString(),
              'Render Time': Math.round(elapsedSeconds),
            },
          }),
        },
      );

      if (!patchRes.ok) {
        logger.warn(`Airtable completeRun patch failed: HTTP ${patchRes.status}`);
        return;
      }

      logger.info(`Airtable: record ${recordId} marked Completed`);
    } catch (err) {
      logger.warn(`Airtable completeRun error: ${String(err)}`);
    }
  }

  /**
   * Updates the run record to Failed with an error message.
   */
  async failRun(recordId: string | null, errorMessage: string): Promise<void> {
    if (!this.isConfigured || recordId === null) return;

    try {
      const res = await fetch(
        `${AIRTABLE_API}/${this.baseId}/${this.tableId}/${recordId}`,
        {
          method: 'PATCH',
          headers: { ...this.authHeader, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fields: {
              Status: 'Failed',
              'Completed At': new Date().toISOString(),
              Error: errorMessage.slice(0, 10000),
            },
          }),
        },
      );

      if (!res.ok) {
        logger.warn(`Airtable failRun patch failed: HTTP ${res.status}`);
        return;
      }

      logger.info(`Airtable: record ${recordId} marked Failed`);
    } catch (err) {
      logger.warn(`Airtable failRun error: ${String(err)}`);
    }
  }
}

// ─── Airtable Review Hub ────────────────────────────────────────────────────

const DEFAULT_POLL_INTERVAL_MS = 15_000;
const DEFAULT_POLL_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 hours

/**
 * Manages visual review/approve/reject workflows via Airtable.
 * Pushes storyboard frames and clips as attachments, then polls for user decisions.
 *
 * Requires a separate Airtable table with fields:
 *   Name (text), Project (text), Scene Index (number), Status (single select),
 *   Type (single select), Prompt (long text), Frame (attachment), Clip (attachment),
 *   Variation (number), Notes (long text)
 *
 * Configure via AIRTABLE_API_KEY, AIRTABLE_BASE_ID, AIRTABLE_REVIEW_TABLE_ID env vars.
 * All methods are non-fatal: errors are warned and silently ignored.
 */
export class AirtableReviewer {
  private readonly apiKey: string;
  private readonly baseId: string;
  private readonly reviewTableId: string;
  private readonly pollInterval: number;
  private readonly pollTimeout: number;

  constructor() {
    this.apiKey = process.env['AIRTABLE_API_KEY'] ?? '';
    this.baseId = process.env['AIRTABLE_BASE_ID'] ?? '';
    this.reviewTableId = process.env['AIRTABLE_REVIEW_TABLE_ID'] ?? '';
    this.pollInterval = DEFAULT_POLL_INTERVAL_MS;
    this.pollTimeout = DEFAULT_POLL_TIMEOUT_MS;
  }

  get isConfigured(): boolean {
    return Boolean(this.apiKey && this.baseId && this.reviewTableId);
  }

  private get authHeader(): Record<string, string> {
    return { Authorization: `Bearer ${this.apiKey}` };
  }

  /**
   * Creates a review record and uploads the storyboard frame as an attachment.
   */
  async pushFrameForReview(
    projectName: string,
    sceneIndex: number,
    framePath: string,
    prompt: string,
    variationIndex?: number,
  ): Promise<string | null> {
    if (!this.isConfigured) return null;

    try {
      const name = variationIndex !== undefined
        ? `${projectName} — Scene ${sceneIndex} — Variation ${variationIndex}`
        : `${projectName} — Scene ${sceneIndex}`;

      // 1. Create the record
      const res = await fetch(`${AIRTABLE_API}/${this.baseId}/${this.reviewTableId}`, {
        method: 'POST',
        headers: { ...this.authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: {
            Name: name,
            Project: projectName,
            'Scene Index': sceneIndex,
            Status: 'Pending Review',
            Type: 'Storyboard Frame',
            Prompt: prompt.slice(0, 10000),
            ...(variationIndex !== undefined && { Variation: variationIndex }),
          },
        }),
      });

      if (!res.ok) {
        logger.warn(`Airtable review: create failed: HTTP ${res.status} — ${await res.text()}`);
        return null;
      }

      const data = await res.json() as { id: string };

      // 2. Upload the frame as an attachment
      await this.uploadAttachment(data.id, 'Frame', framePath);

      logger.info(`Airtable review: pushed ${name}`);
      return data.id;
    } catch (err) {
      logger.warn(`Airtable review: push failed: ${String(err)}`);
      return null;
    }
  }

  /**
   * Creates a review record and uploads a video clip as an attachment.
   */
  async pushClipForReview(
    projectName: string,
    sceneIndex: number,
    clipPath: string,
  ): Promise<string | null> {
    if (!this.isConfigured) return null;

    try {
      const name = `${projectName} — Scene ${sceneIndex} — Clip`;

      const res = await fetch(`${AIRTABLE_API}/${this.baseId}/${this.reviewTableId}`, {
        method: 'POST',
        headers: { ...this.authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: {
            Name: name,
            Project: projectName,
            'Scene Index': sceneIndex,
            Status: 'Pending Review',
            Type: 'Video Clip',
          },
        }),
      });

      if (!res.ok) {
        logger.warn(`Airtable review: create clip record failed: HTTP ${res.status}`);
        return null;
      }

      const data = await res.json() as { id: string };
      await this.uploadAttachment(data.id, 'Clip', clipPath);

      logger.info(`Airtable review: pushed clip for scene ${sceneIndex}`);
      return data.id;
    } catch (err) {
      logger.warn(`Airtable review: push clip failed: ${String(err)}`);
      return null;
    }
  }

  /**
   * Polls Airtable until all records for the given project and type have been reviewed.
   * Returns the list of review records with their final statuses.
   */
  async pollForApprovals(
    projectName: string,
    type: 'Storyboard Frame' | 'Video Clip',
  ): Promise<ReviewRecord[]> {
    if (!this.isConfigured) {
      logger.warn('Airtable review not configured — skipping approval gate.');
      return [];
    }

    const startTime = Date.now();
    const timeoutMinutes = Math.round(this.pollTimeout / 60000);
    logger.step(`Waiting for ${type} approvals in Airtable (timeout: ${timeoutMinutes}min)...`);

    while (Date.now() - startTime < this.pollTimeout) {
      try {
        const formula = encodeURIComponent(
          `AND({Project}="${projectName}", {Type}="${type}")`,
        );
        const res = await fetch(
          `${AIRTABLE_API}/${this.baseId}/${this.reviewTableId}?filterByFormula=${formula}`,
          { headers: this.authHeader },
        );

        if (!res.ok) {
          logger.warn(`Airtable poll failed: HTTP ${res.status}`);
          await new Promise((r) => setTimeout(r, this.pollInterval));
          continue;
        }

        const data = await res.json() as {
          records: Array<{ id: string; fields: Record<string, unknown> }>;
        };

        const records: ReviewRecord[] = data.records.map((r) => {
          const rec: ReviewRecord = {
            recordId: r.id,
            sceneIndex: (r.fields['Scene Index'] as number) ?? 0,
            status: (r.fields['Status'] as ReviewStatus) ?? 'Pending Review',
          };
          const notes = r.fields['Notes'] as string | undefined;
          if (notes !== undefined) rec.notes = notes;
          const variation = r.fields['Variation'] as number | undefined;
          if (variation !== undefined) rec.variationIndex = variation;
          return rec;
        });

        const pending = records.filter((r) => r.status === 'Pending Review');
        const approved = records.filter((r) => r.status === 'Approved');
        const rejected = records.filter((r) => r.status === 'Rejected');

        if (pending.length === 0 && records.length > 0) {
          logger.success(
            `All ${type}s reviewed: ${approved.length} approved, ${rejected.length} rejected.`,
          );
          return records;
        }

        const elapsed = Math.round((Date.now() - startTime) / 60000);
        logger.info(
          `  ${approved.length} approved, ${rejected.length} rejected, ${pending.length} pending... (${elapsed}min elapsed)`,
        );
      } catch (err) {
        logger.warn(`Airtable poll error: ${String(err)}`);
      }

      await new Promise((r) => setTimeout(r, this.pollInterval));
    }

    throw new Error(`Airtable review timed out after ${timeoutMinutes} minutes.`);
  }

  /**
   * Uploads a file as an Airtable attachment using the Content Upload API.
   * Uses the same multipart pattern as AirtableLogger.completeRun().
   */
  private async uploadAttachment(
    recordId: string,
    fieldName: string,
    filePath: string,
  ): Promise<void> {
    const fileBuffer = await fs.readFile(filePath);
    const filename = path.basename(filePath);
    const ext = path.extname(filePath).toLowerCase();

    let mimeType = 'application/octet-stream';
    if (ext === '.png') mimeType = 'image/png';
    else if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
    else if (ext === '.mp4') mimeType = 'video/mp4';

    const boundary = `----AirtableBoundary${crypto.randomBytes(8).toString('hex')}`;
    const CRLF = '\r\n';
    const partHead = Buffer.from(
      `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"${CRLF}` +
      `Content-Type: ${mimeType}${CRLF}` +
      CRLF,
    );
    const partTail = Buffer.from(`${CRLF}--${boundary}--${CRLF}`);
    const body = Buffer.concat([partHead, fileBuffer, partTail]);

    const encodedField = encodeURIComponent(fieldName);
    const uploadRes = await fetch(
      `${AIRTABLE_CONTENT_API}/${this.baseId}/${recordId}/${encodedField}/uploadAttachment`,
      {
        method: 'POST',
        headers: {
          ...this.authHeader,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': String(body.length),
        },
        body,
      },
    );

    if (!uploadRes.ok) {
      logger.warn(
        `Airtable attachment upload failed for ${fieldName}: HTTP ${uploadRes.status} — ${await uploadRes.text()}`,
      );
    }
  }
}
