import path from 'path';
import fs from 'fs-extra';
import type { ProjectAssets, StoryboardFrame, BrandColors } from '../types/index.js';
import { logger } from '../utils/logger.js';

/**
 * AssetLoader discovers and validates all project assets before the pipeline starts.
 * Optional assets fall back gracefully with warnings.
 *
 * Clean project structure (preferred):
 *   projects/{name}/
 *   ├── config.json
 *   ├── product.jpg        ← subject/product (supports product-1.jpg, product-2.jpg for multiple angles)
 *   ├── model.jpg           ← person/face reference (supports model-1.jpg, model-2.jpg)
 *   ├── style.jpg           ← visual style/mood reference
 *   ├── location.jpg        ← background/environment reference
 *   ├── music.mp3           ← background music
 *   ├── brand/
 *   │   ├── brand.json      ← brand colors
 *   │   ├── logo.png
 *   │   ├── font-bold.ttf
 *   │   └── font-regular.ttf
 *   ├── storyboard/         ← auto-generated frames
 *   ├── cache/
 *   └── output/
 *
 * Legacy paths (assets/brand/, assets/reference/, etc.) still work.
 */
export class AssetLoader {
  private projectDir: string;

  constructor(projectsRoot: string, projectName: string) {
    this.projectDir = path.join(projectsRoot, projectName);
  }

  /**
   * Loads all project assets. Call before starting the pipeline.
   * Returns a fully populated ProjectAssets object.
   */
  async load(): Promise<ProjectAssets> {
    const [
      storyboardFrames,
      logo,
      fontBold,
      fontRegular,
      brandColors,
      styleReference,
      subjectReference,
      modelReference,
      locationReference,
      backgroundMusic,
    ] = await Promise.all([
      this.loadStoryboardFrames(),
      this.loadOptionalMulti(['brand/logo.png', 'assets/brand/logo.png'], 'logo'),
      this.loadOptionalMulti(['brand/font-bold.ttf', 'assets/brand/font-bold.ttf'], 'bold font'),
      this.loadOptionalMulti(['brand/font-regular.ttf', 'assets/brand/font-regular.ttf'], 'regular font'),
      this.loadBrandColors(),
      this.loadOptionalMulti(['style.jpg', 'style.png', 'assets/reference/style.jpg', 'assets/reference/style.png'], 'style reference'),
      this.loadOptionalMulti(['product.jpg', 'product.png', 'assets/reference/subject.jpg', 'assets/reference/subject.png'], 'subject reference'),
      this.loadOptionalMulti(['model.jpg', 'model.png'], 'model reference'),
      this.loadOptionalMulti(['location.jpg', 'location.png', 'assets/reference/location.jpg', 'assets/reference/location.png'], 'location reference'),
      this.loadOptionalMulti(['music.mp3', 'assets/audio/music.mp3'], 'background music'),
    ]);

    const assets: ProjectAssets = { storyboardFrames };

    // Only set optional properties when they have a concrete value,
    // as required by exactOptionalPropertyTypes.
    if (logo !== undefined) assets.logo = logo;
    if (fontBold !== undefined) assets.fontBold = fontBold;
    if (fontRegular !== undefined) assets.fontRegular = fontRegular;
    if (brandColors !== undefined) assets.brandColors = brandColors;
    if (styleReference !== undefined) assets.styleReference = styleReference;
    if (subjectReference !== undefined) assets.subjectReference = subjectReference;
    if (modelReference !== undefined) assets.modelReference = modelReference;
    if (locationReference !== undefined) assets.locationReference = locationReference;
    if (backgroundMusic !== undefined) assets.backgroundMusic = backgroundMusic;

    return assets;
  }

  /**
   * Auto-discovers scene-N.png files in the storyboard folder in ascending order.
   * Checks storyboard/ first, falls back to assets/storyboard/.
   * Also checks for scene-N-lastframe.png companion files.
   */
  private async loadStoryboardFrames(): Promise<StoryboardFrame[]> {
    // Check clean path first, then legacy
    let storyboardDir = path.join(this.projectDir, 'storyboard');
    if (!(await fs.pathExists(storyboardDir))) {
      storyboardDir = path.join(this.projectDir, 'assets/storyboard');
    }

    if (!(await fs.pathExists(storyboardDir))) {
      return [];
    }

    const files = await fs.readdir(storyboardDir);
    const frames: StoryboardFrame[] = [];

    const sceneRegex = /^scene-(\d+)\.(png|jpg)$/;
    for (const file of files) {
      const match = sceneRegex.exec(file);
      if (!match || !match[1]) continue;

      const sceneIndex = parseInt(match[1], 10);
      const imagePath = path.join(storyboardDir, file);
      // Check for lastframe in either format
      const lastFramePng = path.join(storyboardDir, `scene-${sceneIndex}-lastframe.png`);
      const lastFrameJpg = path.join(storyboardDir, `scene-${sceneIndex}-lastframe.jpg`);
      const lastFrameFullPath = (await fs.pathExists(lastFramePng)) ? lastFramePng : lastFrameJpg;
      const hasLastFrame = await fs.pathExists(lastFrameFullPath);

      frames.push(
        hasLastFrame
          ? { sceneIndex, imagePath, lastFramePath: lastFrameFullPath }
          : { sceneIndex, imagePath },
      );
    }

    frames.sort((a, b) => a.sceneIndex - b.sceneIndex);

    if (frames.length > 0) {
      logger.info(
        `Found ${frames.length} storyboard frame(s): ${frames.map((f) => `scene-${f.sceneIndex}`).join(', ')}`,
      );
    }

    return frames;
  }

  /**
   * Loads brand.json if it exists, returning parsed BrandColors.
   * Checks brand/brand.json first, falls back to assets/brand/brand.json.
   */
  private async loadBrandColors(): Promise<BrandColors | undefined> {
    const candidates = [
      path.join(this.projectDir, 'brand/brand.json'),
      path.join(this.projectDir, 'assets/brand/brand.json'),
    ];
    for (const brandPath of candidates) {
      if (!(await fs.pathExists(brandPath))) continue;
      try {
        return await fs.readJson(brandPath) as BrandColors;
      } catch {
        logger.warn('brand.json is invalid JSON — using default colors.');
        return undefined;
      }
    }
    return undefined;
  }

  /**
   * Tries multiple candidate paths for an asset, returning the first that exists.
   */
  private async loadOptionalMulti(relativePaths: string[], label: string): Promise<string | undefined> {
    for (const rel of relativePaths) {
      const fullPath = path.join(this.projectDir, rel);
      if (await fs.pathExists(fullPath)) return fullPath;
    }
    return undefined;
  }
}
