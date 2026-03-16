// ─── Format & Style Enums ──────────────────────────────────────────────────

export type VideoFormat =
  | 'youtube-short'
  | 'tiktok'
  | 'ad-16x9'
  | 'ad-1x1'
  | 'web-hero';

export type CaptionStyle = 'word-by-word' | 'line-by-line';
export type CaptionTheme = 'bold' | 'editorial' | 'minimal';
export type TransitionType = 'crossfade' | 'cut' | 'wipe';
export type AspectRatio = '9:16' | '16:9' | '1:1';
export type KlingVersion = 'v2.1' | 'v3';
export type VideoProvider = 'kling-v2.1' | 'kling-v3' | 'veo-3.1' | 'veo-3.1-fast';
export type ImageProvider = 'gemini' | 'gpt-image';
export type ClipOutputType = 'image' | 'video' | 'animation';
export type ImageSource = 'generate' | 'original' | 'edit';
export type MoodBoardEntry = string | { url: string; type?: 'style' | 'location' | 'product' | 'model' };

// ─── Brand Shot Types (for brand-images mode) ───────────────────────────────

export type BrandShotType =
  | 'product-hero'
  | 'application-closeup'
  | 'lifestyle'
  | 'flat-lay'
  | 'texture-detail'
  | 'portrait';

// ─── Brand Image Types (from brand-pack merge) ───────────────────────────────

export type ImageFormat = 'story' | 'square' | 'landscape';

export const FORMAT_ASPECT: Record<ImageFormat, { hint: string; ratio: '9:16' | '1:1' | '16:9' }> = {
  story:     { hint: 'vertical 9:16 portrait format',    ratio: '9:16' },
  square:    { hint: 'square 1:1 format',                ratio: '1:1'  },
  landscape: { hint: 'horizontal 16:9 landscape format', ratio: '16:9' },
};

export type PipelineMode = 'video' | 'brand-images' | 'full';

// ─── Config Interfaces ─────────────────────────────────────────────────────

export interface BrandColors {
  primary: string;
  secondary?: string;
  accent?: string;
}

export interface CTAConfig {
  text: string;
  subtext?: string;
  /** Duration of CTA overlay in seconds. Default: 3 */
  durationSeconds?: number;
}

export interface ImageOverlay {
  text: string;
  position?: 'top' | 'center' | 'bottom';
  fontSize?: number;
  color?: string;
  /** Background color for the text bar (ffmpeg format, e.g. 'black@0.6'). Default: 'black@0.6' */
  background?: string;
}

export interface VideoClip {
  /** Text prompt describing what should happen in this clip */
  prompt?: string;
  /** Shot type for brand-images mode — Director expands into full prompt using brand brief. Alternative to writing detailed prompts. */
  shotType?: BrandShotType;
  /** Absolute or project-relative path to storyboard image (enables image-to-video mode) */
  imageReference?: string;
  /** Pre-generated clip URL — skip generation entirely */
  url?: string;
  /** Clip duration in seconds (1-15). Default: 5 */
  duration?: number;
  /** What this clip produces. Default: inferred from pipeline mode */
  outputType?: ClipOutputType;
  /** Per-clip image provider override. Falls back to config.imageProvider then 'gemini'. */
  imageProvider?: ImageProvider;
  /** Per-clip image format override. Falls back to config.imageFormats. */
  imageFormat?: ImageFormat;
  /** How this clip's image is sourced. Default: 'generate' (AI creates from prompt). */
  imageSource?: ImageSource;
  /** For 'edit' mode: describes what to change in the source image. */
  editPrompt?: string;
  /** For 'original'/'edit' modes: path to the source image (project-relative or absolute). */
  sourceImage?: string;
  /** Text overlay to composite on the final image output. Only applies to image-type clips. */
  overlay?: ImageOverlay;
  /** Per-clip reference image filenames (e.g. ["product-1.jpg"]). Only these refs are sent to Gemini for this clip. If omitted, all project refs are sent. */
  refs?: string[];
}

export interface VideoConfig {
  /** Required for video/full modes. Not needed for brand-images mode. */
  format?: VideoFormat;
  title: string;
  client?: string;
  /** Voiceover script. If provided, ElevenLabs generates audio. */
  script?: string;
  /** ElevenLabs voice ID. Run `npm run pipeline -- --project X --list-voices` to see options. */
  voiceId?: string;
  /** At least one clip required. Use prompt, imageReference, or url per clip. */
  clips: VideoClip[];
  /** Default: crossfade */
  transition?: TransitionType;
  /** Default: true for shorts/tiktok, false for web-hero */
  captions?: boolean;
  /** Default: word-by-word */
  captionStyle?: CaptionStyle;
  captionPosition?: 'bottom' | 'center' | 'top';
  /** Caption visual theme. 'bold' = TikTok pill style, 'editorial' = clean luxury, 'minimal' = subtle. Default: 'bold' */
  captionTheme?: CaptionTheme;
  /** Text shown at top of frame for first 2 seconds (hook) */
  hookText?: string;
  cta?: CTAConfig;
  /** Use music.mp3 from assets/audio/ if true */
  music?: boolean;
  /** Background music volume 0-1. Default: 0.15 */
  musicVolume?: number;
  /** Pipeline mode. Default: 'video' for backward compatibility. */
  mode?: PipelineMode;
  /** Brand name (used in brand-images mode for Gemini prompts). */
  brand?: string;
  /** Overall brand brief/context passed to Gemini. */
  brief?: string;
  /** Image formats to generate in brand-images/full mode. Default: all three. */
  imageFormats?: ImageFormat[];
  /** Kling model version. 'v2.1' (default, cheaper ~$0.49/5s) or 'v3' (better quality, multi-shot, ~$1.12/5s). Deprecated: use videoProvider instead. */
  klingVersion?: KlingVersion;
  /** Video generation provider. Default: 'kling-v2.1' for backward compatibility. Overrides klingVersion when set. */
  videoProvider?: VideoProvider;
  /** Apply a subtle brand-colored overlay on clips to unify color temperature. Default: false */
  colorUnify?: boolean;
  /** Opacity of the color unity overlay (0-1). Default: 0.06 */
  colorUnifyOpacity?: number;
  /** Apply global CSS color grade filter to clips. Default: true. Set false to disable. */
  colorGrade?: boolean;
  /** Image generation provider. Default: 'gemini'. */
  imageProvider?: ImageProvider;
  /** Director model override. Default: 'claude-opus-4-6'. */
  directorModel?: 'claude-opus-4-6' | 'claude-sonnet-4-6';
  /** Explicit product list. Only these products should appear in generated images. Prevents Gemini from inventing products mentioned in the brief but not in references. */
  products?: string[];
  /** Skip auto-sourcing style and/or location references. Use when auto-generated refs add noise (e.g. studio skincare campaigns). */
  skipAutoRefs?: ('style' | 'location')[];
  /** Additional output formats to render. Clips generated once, Remotion renders each format. */
  outputFormats?: VideoFormat[];
  /** Mood board image URLs. Downloads as style/location/product/model references before generation.
   *  Strings default to 'style' type. Objects allow explicit categorization.
   *  Supports direct image URLs and web pages with og:image meta tags (Pinterest pins, etc.). */
  moodBoard?: MoodBoardEntry[];
  /** Reference video URL or local path. Analyzed for style/pacing/mood; key frames extracted as style refs.
   *  Supports direct .mp4/.mov URLs, local paths, and social media URLs (TikTok/IG/YouTube) via yt-dlp. */
  videoRef?: string;
}

// ─── Video Generation ───────────────────────────────────────────────────────

export interface VideoGenOptions {
  aspectRatio: AspectRatio;
  duration: number;
  projectName: string;
  sceneIndex: number;
}

export interface ClipCacheEntry {
  hash: string;
  clipPath: string;
  createdAt: string;
}

export interface ClipCacheManifest {
  [hash: string]: ClipCacheEntry;
}

// ─── ElevenLabs ────────────────────────────────────────────────────────────

export interface ElevenLabsOptions {
  voiceId: string;
  /** Maps to SDK request field: model_id */
  modelId?: string;
  stability?: number;
  /** Maps to SDK VoiceSettings field: similarity_boost */
  similarityBoost?: number;
  style?: number;
}

// ─── Whisper / Captions ────────────────────────────────────────────────────

export interface CaptionWord {
  word: string;
  start: number;
  end: number;
}

export interface WhisperResult {
  words: CaptionWord[];
  fullText: string;
  language: string;
}

// ─── Assets ────────────────────────────────────────────────────────────────

export interface StoryboardFrame {
  sceneIndex: number;
  imagePath: string;
  lastFramePath?: string;
}

export interface ProjectAssets {
  logo?: string;
  fontBold?: string;
  fontRegular?: string;
  brandColors?: BrandColors;
  styleReference?: string;
  subjectReference?: string;
  modelReference?: string;
  locationReference?: string;
  storyboardFrames: StoryboardFrame[];
  backgroundMusic?: string;
}

// ─── Remotion Props ────────────────────────────────────────────────────────

export interface CompositionProps {
  config: VideoConfig;
  assets: ProjectAssets;
  captions: CaptionWord[];
  clipPaths: string[];
  /** Absolute path to the ElevenLabs-generated voiceover MP3. Undefined if no script. */
  voiceoverPath?: string;
}

// ─── Director / AI Planning ─────────────────────────────────────────────────

export interface DirectorVoiceSettings {
  stability: number;
  similarityBoost: number;
  style: number;
  /** Original script text with optional ElevenLabs SSML pause tags added */
  enrichedScript: string;
}

export interface DirectorClipPlan {
  sceneIndex: number;
  /** Shot framing type for progressive reveal structure */
  shotType?: string;
  /** Original prompt + " — " + cinematography notes. Max 400 chars. */
  enrichedPrompt: string;
  continuityNote: string;
  cameraMove: string;
  lighting: string;
  colorGrade: string;
  pace: string;
  /** Director-suggested variation angles for batch storyboard generation */
  variationAngles?: string[];
  /** Photography composition guidance (brand-images mode) */
  composition?: string;
}

export interface DirectorPlan {
  generatedAt: string;
  configHash: string;
  visualStyleSummary: string;
  /** Global lighting setup — same for ALL scenes to ensure one-shoot consistency */
  lightingSetup?: string;
  /** Global background/environment — same for ALL scenes */
  backgroundDescription?: string;
  /** Global color palette — same for ALL scenes (descriptive words only, never hex codes) */
  colorPalette?: string;
  clips: DirectorClipPlan[];
  voice: DirectorVoiceSettings;
  /** Only set when config.hookText was absent */
  suggestedHookText?: string;
  /** Only set when config.cta was absent */
  suggestedCta?: { text: string; subtext?: string };
  /** Only set when config.captionTheme was absent */
  suggestedCaptionTheme?: CaptionTheme;
}

export interface DirectorCacheEntry {
  configHash: string;
  plan: DirectorPlan;
  cachedAt: string;
}

export interface StoryboardGenOptions {
  sceneIndex: number;
  /** Director-enriched prompt for this clip */
  prompt: string;
  /** For aspect ratio guidance ('9:16' vs '16:9') */
  format: VideoFormat;
  /** From DirectorPlan, for cross-scene consistency */
  visualStyleSummary?: string;
  /** Director's global lighting setup for consistency across all scenes */
  lightingSetup?: string;
  /** Director's global background description for consistency across all scenes */
  backgroundDescription?: string;
  /** Director's global color palette for consistency across all scenes */
  colorPalette?: string;
  /** Director's lighting direction for this scene (e.g. "golden hour rim light") */
  lighting?: string;
  /** Director's color grade for this scene (e.g. "warm amber tones, lifted blacks") */
  colorGrade?: string;
  /** Director's camera move for this scene (e.g. "slow push-in on subject") */
  cameraMove?: string;
  /** scene-(N-1)-lastframe.png if it exists */
  previousLastFramePath?: string;
  /** Product/subject reference photo — gives Gemini visual context for the product appearance */
  subjectReferencePath?: string;
  /** Scene 1 storyboard frame — used as style anchor for ALL subsequent frames */
  scene1AnchorPath?: string;
  /** Variation index (1-based). When > 1, applies the variation angle to the prompt. */
  variationIndex?: number;
  /** Director-suggested variation modifier for this specific variation */
  variationAngle?: string;
  projectsRoot: string;
  projectName: string;
}

// ─── Format Metadata (derived) ─────────────────────────────────────────────

export interface FormatMeta {
  width: number;
  height: number;
  fps: number;
  aspectRatio: AspectRatio;
  defaultCaptions: boolean;
}

// ─── Pipeline Run Options ────────────────────────────────────────────────────

export interface RunOptions {
  storyboardOnly?: boolean;
  dryRun?: boolean;
  jsonOutput?: boolean;
  /** Number of storyboard variations per scene (1-4). Used with --storyboard-only. */
  variations?: number;
  /** Enable Airtable review workflow between storyboard and video generation. */
  airtableReview?: boolean;
  /** Image numbers to regenerate — deletes existing files so they get re-generated. */
  regenerateImages?: number[];
  /** Draft mode: cheap preview with Kling v2.1, skip voiceover and Remotion. */
  draft?: boolean;
  /** Resume from last checkpoint instead of starting fresh. */
  resume?: boolean;
  /** Run Director only — plan and cache, then exit for user review before generation. */
  directorOnly?: boolean;
}

// ─── Brand Context (generated by Director for downstream skills) ─────────────

export interface BrandContext {
  brandName: string;
  tone: string;
  visualStyle: string;
  hookText: string;
  cta: string;
  targetAudience: string;
  /** Director's global lighting setup for cross-scene consistency */
  lightingSetup?: string;
  /** Director's global background/environment description */
  backgroundDescription?: string;
  /** Director's global color palette (descriptive words, no hex codes) */
  colorPalette?: string;
  scenes: Array<{
    index: number;
    prompt: string;
    enrichedPrompt: string;
    mood: string;
  }>;
  voiceSettings: {
    stability: number;
    style: number;
    similarityBoost: number;
    toneDescription: string;
  };
}

// ─── Asset Sourcing Result ───────────────────────────────────────────────────

export interface AssetSourcingResult {
  colorsExtracted: boolean;
  colorSource: 'website' | 'image' | 'generated' | 'existing' | 'skipped';
  styleReferenceSourced: boolean;
  styleSource: 'gemini' | 'pexels' | 'unsplash' | 'existing' | 'skipped';
  locationReferenceSourced: boolean;
  locationSource: 'gemini' | 'pexels' | 'unsplash' | 'existing' | 'skipped';
  musicSourced: boolean;
  musicSource: 'pixabay' | 'existing' | 'skipped';
  estimatedCost: number;
}

// ─── Video Reference Analysis ─────────────────────────────────────────────────

export interface VideoAnalysis {
  visualStyle: string;
  pacing: string;
  transitions: string;
  colorGrading: string;
  composition: string;
  textOverlayPatterns: string;
  mood: string;
  /** SHA-256 hash of the source video file (first 16 chars) */
  sourceHash: string;
  analyzedAt: string;
}

// ─── Airtable Review Hub ─────────────────────────────────────────────────────

export type ReviewStatus = 'Pending Review' | 'Approved' | 'Rejected';

export interface ReviewRecord {
  recordId: string;
  sceneIndex: number;
  status: ReviewStatus;
  notes?: string;
  variationIndex?: number;
}

// ─── Pipeline Result (for --json-output) ─────────────────────────────────────

export interface PipelineResult {
  success: boolean;
  outputPath: string;
  projectDir: string;
  mode: PipelineMode;
  assets: {
    images: string[];
    clips: string[];
    voiceover?: string;
    video?: string;
  };
  estimatedCost: number;
  cachedSteps: string[];
}

// ─── Image QA ────────────────────────────────────────────────────────────────

export interface ImageQAResult {
  scene: string;
  score: number;
  modelAccuracy: number;
  productAccuracy: number;
  composition: number;
  artifacts: number;
  editorialImpact?: number;
  issues: string[];
  pass: boolean;
}
