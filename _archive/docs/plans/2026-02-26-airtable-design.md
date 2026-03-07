# Airtable Integration + VS Code Log Panel — Design

**Date:** 2026-02-26
**Status:** Approved

---

## Problem

After a pipeline run completes, there's no central place to track what was produced, monitor status across projects, or review the final video without navigating the file system. There's also no dedicated VS Code panel for pipeline log output.

## Solution

Integrate Airtable as a production tracker: every pipeline run creates a record in Airtable with status, timing, and the final MP4 uploaded directly as an attachment (playable inline in Airtable). A `.vscode/tasks.json` provides a dedicated VS Code terminal panel for pipeline output.

---

## Airtable Table Structure

Table name: **`Video Runs`** (user creates this manually in their Airtable base)

| Field | Airtable Type | Notes |
|-------|--------------|-------|
| Name | Single line text (primary) | `{project} — {format} — {timestamp}` |
| Project | Single line text | e.g. `test-project` |
| Format | Single select | youtube-short, tiktok, ad-16x9, ad-1x1, web-hero |
| Status | Single select | 🔵 Running, ✅ Completed, ❌ Failed |
| Started At | Date (include time) | |
| Completed At | Date (include time) | |
| Render Time | Number (seconds) | |
| Clips | Number | |
| Script | Long text | |
| Output Video | Attachments | MP4 uploaded at run end — plays inline |
| Error | Long text | Only set on failure |

---

## Architecture

### New file: `src/pipeline/airtable.ts`

`AirtableLogger` class with three methods:

- `createRun(projectName, format, config)` → creates record with status Running, returns `recordId`
- `completeRun(recordId, finalPath, elapsedSeconds)` → uploads MP4 as attachment, updates status to Completed
- `failRun(recordId, errorMessage)` → updates status to Failed, writes error text

Uses plain `fetch` against Airtable REST API — no extra npm dependency.

### Integration point: `src/pipeline/index.ts`

```
runPipeline() starts
  → airtable.createRun(...)     ← status: Running
  → [all pipeline steps]
  → airtable.completeRun(...)   ← uploads MP4, status: Completed
  → return finalPath

On error:
  → airtable.failRun(...)       ← status: Failed
  → re-throw
```

Airtable logging is **non-fatal**: if Airtable API calls fail (missing keys, network error), they log a warning and the pipeline continues normally.

### Airtable API calls

1. `POST https://api.airtable.com/v0/{baseId}/{tableId}` — create record
2. `POST https://content.airtable.com/v0/{baseId}/{recordId}/{fieldId}/uploadAttachment` — upload MP4 binary
3. `PATCH https://api.airtable.com/v0/{baseId}/{tableId}/{recordId}` — update record

### New file: `.vscode/tasks.json`

Defines a "Run Pipeline" VS Code task. Run via:
`Command Palette → Tasks: Run Task → Run Pipeline`

Prompts for project name (via `args` input), shows pipeline output in a dedicated VS Code terminal panel.

---

## Environment Variables

Add to `.env`:

```
AIRTABLE_API_KEY=
AIRTABLE_BASE_ID=
AIRTABLE_TABLE_ID=
```

These are **optional** — if unset, Airtable logging is silently skipped.

---

## Error Handling

- Missing env vars → skip Airtable silently (warn in logs)
- Airtable API error on `createRun` → skip logging for this run, don't block pipeline
- Airtable API error on `completeRun`/`failRun` → log warning, don't throw
- Oversized video (Airtable attachment limit: 1GB) → log warning, skip attachment upload but still update status

---

## Verification

1. Set `AIRTABLE_API_KEY`, `AIRTABLE_BASE_ID`, `AIRTABLE_TABLE_ID` in `.env`
2. Run pipeline with pre-built clip URLs (no fal.ai needed for testing)
3. Confirm record appears in Airtable with status → Running during run, → Completed after
4. Confirm MP4 attachment is playable inline in Airtable
5. Kill the pipeline mid-run, confirm status → Failed with error message
6. Unset Airtable env vars, confirm pipeline still runs without error
