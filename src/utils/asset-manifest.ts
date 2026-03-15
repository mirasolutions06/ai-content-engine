import path from 'path';
import fs from 'fs-extra';

interface AssetRecord {
  path: string;
  type: 'image' | 'video' | 'voiceover' | 'render';
  prompt?: string;
  provider: string;
  model: string;
  references: string[];
  qaScore?: number;
  format?: string;
  createdAt: string;
}

interface AssetManifestData {
  projectName: string;
  generatedAt: string;
  assets: AssetRecord[];
}

/**
 * Tracks provenance for every generated asset.
 * Enables: "how was this image made?" → full trace of prompts, models, refs, scores.
 */
export class AssetManifest {
  private assets: AssetRecord[] = [];
  private manifestPath: string;
  private projectName: string;

  constructor(projectsRoot: string, projectName: string) {
    this.projectName = projectName;
    this.manifestPath = path.join(projectsRoot, projectName, 'cache', 'asset-manifest.json');
  }

  /** Record an asset with its full provenance. */
  record(entry: {
    path: string;
    type: AssetRecord['type'];
    prompt?: string;
    provider: string;
    model: string;
    references?: string[];
    qaScore?: number;
    format?: string;
  }): void {
    const record: AssetRecord = {
      path: entry.path,
      type: entry.type,
      createdAt: new Date().toISOString(),
      provider: entry.provider,
      model: entry.model,
      references: entry.references ?? [],
    };
    if (entry.prompt !== undefined) record.prompt = entry.prompt;
    if (entry.qaScore !== undefined) record.qaScore = entry.qaScore;
    if (entry.format !== undefined) record.format = entry.format;

    this.assets.push(record);
  }

  /** Save manifest to disk. Merges with existing manifest if present. */
  async save(): Promise<void> {
    if (this.assets.length === 0) return;

    let existing: AssetManifestData | null = null;
    try {
      if (await fs.pathExists(this.manifestPath)) {
        existing = (await fs.readJson(this.manifestPath)) as AssetManifestData;
      }
    } catch {
      // ignore corrupt manifest
    }

    // Merge: overwrite entries with matching paths, append new ones
    const merged = existing?.assets ?? [];
    for (const newAsset of this.assets) {
      const idx = merged.findIndex((a) => a.path === newAsset.path);
      if (idx >= 0) {
        merged[idx] = newAsset;
      } else {
        merged.push(newAsset);
      }
    }

    const manifest: AssetManifestData = {
      projectName: this.projectName,
      generatedAt: new Date().toISOString(),
      assets: merged,
    };

    await fs.ensureDir(path.dirname(this.manifestPath));
    await fs.outputJson(this.manifestPath, manifest, { spaces: 2 });
  }
}
