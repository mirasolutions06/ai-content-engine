# Airtable Integration + VS Code Log Panel — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Log every pipeline run to Airtable (status, timing, MP4 attachment for inline video preview) and add a VS Code tasks.json for a dedicated terminal panel.

**Architecture:** `AirtableLogger` class in `src/pipeline/airtable.ts` creates a record at run start and updates it on completion/failure. All Airtable calls are non-fatal — missing env vars or API errors log a warning and continue. The MP4 is uploaded via Airtable's Content API as a direct binary attachment.

**Tech Stack:** Airtable REST API + Content API (plain `fetch`, no extra npm packages), `.vscode/tasks.json`

---

## Pre-work: Set up the Airtable table

Before coding, manually create this table in your Airtable base. **The field names must match exactly** (case-sensitive):

| Field Name | Airtable Type | Notes |
|------------|--------------|-------|
| Name | Single line text | Primary field |
| Project | Single line text | |
| Format | Single select | Options: youtube-short, tiktok, ad-16x9, ad-1x1, web-hero |
| Status | Single select | Options: Running, Completed, Failed |
| Started At | Date | Enable "include time" |
| Completed At | Date | Enable "include time" |
| Render Time | Number | Integer, label "seconds" |
| Clips | Number | Integer |
| Script | Long text | |
| Output Video | Attachments | |
| Error | Long text | |

Then add to `.env`:
```
AIRTABLE_API_KEY=your_personal_access_token
AIRTABLE_BASE_ID=appXXXXXXXXXXXXXX
AIRTABLE_TABLE_ID=tblXXXXXXXXXXXXXX   # or just use the table name: "Video Runs"
```

Get these from: Airtable → Help → API docs for your base.

---

## Task 1: Create `src/pipeline/airtable.ts`

**Files:**
- Create: `src/pipeline/airtable.ts`

**Step 1: Create the file with this exact content**

```typescript
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
   * Updates the run record to Completed, uploads the MP4 as an attachment.
   */
  async completeRun(
    recordId: string | null,
    finalPath: string,
    elapsedSeconds: number,
  ): Promise<void> {
    if (!this.isConfigured || recordId === null) return;

    try {
      // Upload MP4 as attachment to "Output Video" field
      const videoBuffer = await fs.readFile(finalPath);
      const filename = path.basename(finalPath);

      const formData = new FormData();
      formData.append('file', new Blob([videoBuffer], { type: 'video/mp4' }), filename);
      formData.append('filename', filename);
      formData.append('contentType', 'video/mp4');

      const uploadRes = await fetch(
        `${AIRTABLE_CONTENT_API}/${this.baseId}/${recordId}/Output%20Video/uploadAttachment`,
        { method: 'POST', headers: this.authHeader, body: formData },
      );

      if (!uploadRes.ok) {
        logger.warn(`Airtable video upload failed: HTTP ${uploadRes.status} — ${await uploadRes.text()}`);
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
```

**Step 2: TypeScript check**

Run: `npm run build`
Expected: No errors.

**Step 3: Commit**

```bash
git add src/pipeline/airtable.ts
git commit -m "feat: add AirtableLogger for pipeline run tracking"
```

---

## Task 2: Wire `AirtableLogger` into `src/pipeline/index.ts`

**Files:**
- Modify: `src/pipeline/index.ts`

**Step 1: Add import at the top of the file (after existing imports)**

Add this line after the existing imports:
```typescript
import { AirtableLogger } from './airtable.js';
```

**Step 2: Add Airtable initialization and `createRun` call**

Inside `runPipeline()`, after `validateEnv(...)` and before the config loading block, add:

```typescript
  // ── Airtable run tracking ───────────────────────────────────────────────
  const airtable = new AirtableLogger();
  let airtableRecordId: string | null = null;
```

Then, after `validateConfig(config)` and `const formatMeta = ...`, add:

```typescript
  airtableRecordId = await airtable.createRun(projectName, config.format, config);
```

**Step 3: Add `completeRun` call**

Find the line `return finalPath;` at the very end of `runPipeline()`.

Replace it with:
```typescript
  const elapsedSeconds = (Date.now() - startTime) / 1000;
  await airtable.completeRun(airtableRecordId, finalPath, elapsedSeconds);

  return finalPath;
```

Also add `const startTime = Date.now();` right after the `let airtableRecordId: string | null = null;` line you added above.

**Step 4: Wrap the whole pipeline body in try/catch for `failRun`**

The current `runPipeline` body runs without a try/catch. Wrap the section from config loading to `return finalPath` in a try/catch:

Find the comment `// ── Config loading ──────────────────────────────────────────────────────` and wrap everything from there down to and including the new `return finalPath` in:

```typescript
  try {
    // [all existing pipeline code from config loading to return finalPath]
  } catch (err) {
    await airtable.failRun(airtableRecordId, err instanceof Error ? err.message : String(err));
    throw err;
  }
```

**Step 5: TypeScript check**

Run: `npm run build`
Expected: No errors.

**Step 6: Commit**

```bash
git add src/pipeline/index.ts
git commit -m "feat: wire AirtableLogger into runPipeline"
```

---

## Task 3: Add `.vscode/tasks.json`

**Files:**
- Create: `.vscode/tasks.json`

**Step 1: Create the file**

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "Run Pipeline",
      "type": "shell",
      "command": "npm run pipeline -- --project ${input:projectName}",
      "group": "build",
      "presentation": {
        "reveal": "always",
        "panel": "dedicated",
        "showReuseMessage": false,
        "clear": true
      },
      "problemMatcher": []
    }
  ],
  "inputs": [
    {
      "id": "projectName",
      "type": "promptString",
      "description": "Project name (folder under projects/)",
      "default": "test-project"
    }
  ]
}
```

**Step 2: Verify it works**

In VS Code: `Cmd+Shift+P` → `Tasks: Run Task` → `Run Pipeline` → enter a project name.

A dedicated "Run Pipeline" terminal panel should open and show pipeline output.

**Step 3: Commit**

```bash
git add .vscode/tasks.json
git commit -m "feat: add VS Code Run Pipeline task"
```

---

## Task 4: Update `.env` with Airtable keys

**Step 1: Update `.env`**

The `.env` file currently has:
```
FAL_KEY=
ELEVENLABS_API_KEY=
OPENAI_API_KEY=
```

Add the Airtable vars:
```
FAL_KEY=
ELEVENLABS_API_KEY=
OPENAI_API_KEY=

# Airtable (optional — pipeline runs without these)
AIRTABLE_API_KEY=
AIRTABLE_BASE_ID=
AIRTABLE_TABLE_ID=
```

**Step 2: Commit**

```bash
git add .env
git commit -m "chore: add Airtable env var placeholders to .env"
```

---

## Verification

### 1. Without Airtable keys (should still work)

- Clear `AIRTABLE_API_KEY` from `.env` (or leave blank)
- Run the pipeline: `npm run pipeline -- --project test-project`
- Expected: pipeline runs normally, no Airtable errors

### 2. With Airtable keys (full integration test)

- Fill in all three Airtable vars in `.env`
- Run the pipeline with at least one pre-built clip (`clip.url` in config.json)
- Expected:
  - Airtable record appears with Status = "Running" within seconds of pipeline start
  - After completion, Status = "Completed", Render Time populated, MP4 plays inline in the "Output Video" attachment field
- Kill the pipeline mid-run (Ctrl+C):
  - Status should update to "Failed" (note: Ctrl+C sends SIGINT, the catch block may not fire — see note below)

### 3. VS Code task panel

- `Cmd+Shift+P` → `Tasks: Run Task` → `Run Pipeline` → enter project name
- A dedicated "Run Pipeline" terminal panel opens, shows all step/success/info log output

---

## Notes

- **SIGINT (Ctrl+C):** Node.js exits immediately on SIGINT without running the catch block. If you want `failRun` to fire on interruption, add a `process.on('SIGINT', ...)` handler in `src/cli/run-pipeline.ts`. This is optional — leave for a future iteration.

- **Large videos:** Airtable has a 1GB per-attachment limit. For videos under this size (typical for shorts), direct upload works fine.

- **Airtable single-select options:** The Status field options ("Running", "Completed", "Failed") must exist in Airtable before the first run, or Airtable will reject the create/patch calls with a 422 error.
