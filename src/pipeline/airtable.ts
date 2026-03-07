import crypto from 'crypto';
import fs from 'fs-extra';
import path from 'path';
import { logger } from '../utils/logger.js';
import type { VideoConfig } from '../types/index.js';

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
