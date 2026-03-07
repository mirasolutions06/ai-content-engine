import path from 'path';
import fs from 'fs-extra';
import type { ProjectAssets, StoryboardFrame, BrandColors } from '../types/index.js';
import { logger } from '../utils/logger.js';

/**
 * AssetLoader discovers and validates all project assets before the pipeline starts.
 * Optional assets fall back gracefully with warnings.
 * Storyboard frames are auto-discovered by scanning for scene-N.png files.
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
      locationReference,
      backgroundMusic,
    ] = await Promise.all([
      this.loadStoryboardFrames(),
      this.loadOptional('assets/brand/logo.png', 'logo'),
      this.loadOptional('assets/brand/font-bold.ttf', 'bold font'),
      this.loadOptional('assets/brand/font-regular.ttf', 'regular font'),
      this.loadBrandColors(),
      this.loadOptional('assets/reference/style.png', 'style reference'),
      this.loadOptional('assets/reference/subject.jpg', 'subject reference'),
      this.loadOptional('assets/reference/location.png', 'location reference'),
      this.loadOptional('assets/audio/music.mp3', 'background music'),
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
    if (locationReference !== undefined) assets.locationReference = locationReference;
    if (backgroundMusic !== undefined) assets.backgroundMusic = backgroundMusic;

    return assets;
  }

  /**
   * Auto-discovers scene-N.png files in the storyboard folder in ascending order.
   * Also checks for scene-N-lastframe.png companion files.
   */
  private async loadStoryboardFrames(): Promise<StoryboardFrame[]> {
    const storyboardDir = path.join(this.projectDir, 'assets/storyboard');

    if (!(await fs.pathExists(storyboardDir))) {
      logger.warn('Storyboard folder does not exist yet — no image-to-video mode available.');
      return [];
    }

    const files = await fs.readdir(storyboardDir);
    const frames: StoryboardFrame[] = [];

    const sceneRegex = /^scene-(\d+)\.png$/;
    for (const file of files) {
      const match = sceneRegex.exec(file);
      if (!match || !match[1]) continue;

      const sceneIndex = parseInt(match[1], 10);
      const imagePath = path.join(storyboardDir, file);
      const lastFrameName = `scene-${sceneIndex}-lastframe.png`;
      const lastFrameFullPath = path.join(storyboardDir, lastFrameName);
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
    } else {
      logger.warn(
        'No storyboard frames found in assets/storyboard/ — running in text-to-video mode only.',
      );
    }

    return frames;
  }

  /**
   * Loads brand.json if it exists, returning parsed BrandColors.
   * Returns undefined with a warning if missing or invalid.
   */
  private async loadBrandColors(): Promise<BrandColors | undefined> {
    const brandPath = path.join(this.projectDir, 'assets/brand/brand.json');
    if (!(await fs.pathExists(brandPath))) {
      logger.warn('No brand.json found — using default colors.');
      return undefined;
    }
    try {
      return await fs.readJson(brandPath) as BrandColors;
    } catch {
      logger.warn('brand.json is invalid JSON — using default colors.');
      return undefined;
    }
  }

  /**
   * Returns the absolute path to an optional asset, or undefined with a warning.
   */
  private async loadOptional(relativePath: string, label: string): Promise<string | undefined> {
    const fullPath = path.join(this.projectDir, relativePath);
    if (await fs.pathExists(fullPath)) {
      return fullPath;
    }
    logger.warn(`Optional asset not found: ${label} (${relativePath})`);
    return undefined;
  }
}
