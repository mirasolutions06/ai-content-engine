// ─── Format & Style Enums ──────────────────────────────────────────────────

export type VideoFormat =
  | 'youtube-short'
  | 'tiktok'
  | 'ad-16x9'
  | 'ad-1x1'
  | 'web-hero';

export type CaptionStyle = 'word-by-word' | 'line-by-line';
export type TransitionType = 'crossfade' | 'cut' | 'wipe';
export type AspectRatio = '9:16' | '16:9' | '1:1';

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

export interface VideoClip {
  /** Text prompt describing what should happen in this clip */
  prompt?: string;
  /** Absolute or project-relative path to Gemini storyboard image (enables image-to-video mode) */
  imageReference?: string;
  /** Pre-generated clip URL — skip generation entirely */
  url?: string;
  /** Clip duration in seconds. Default: 5 */
  duration?: 5 | 10;
}

export interface VideoConfig {
  format: VideoFormat;
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
}

// ─── Video Generation ───────────────────────────────────────────────────────

export interface VideoGenOptions {
  aspectRatio: AspectRatio;
  duration: 5 | 10;
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
  /** Original prompt + " — " + cinematography notes. Max 400 chars. */
  enrichedPrompt: string;
  continuityNote: string;
  cameraMove: string;
  lighting: string;
  colorGrade: string;
  pace: string;
}

export interface DirectorPlan {
  generatedAt: string;
  configHash: string;
  visualStyleSummary: string;
  clips: DirectorClipPlan[];
  voice: DirectorVoiceSettings;
  /** Only set when config.hookText was absent */
  suggestedHookText?: string;
  /** Only set when config.cta was absent */
  suggestedCta?: { text: string; subtext?: string };
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
  /** scene-(N-1)-lastframe.png if it exists */
  previousLastFramePath?: string;
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
}

// ─── Brand Context (generated by Director for downstream skills) ─────────────

export interface BrandContext {
  brandName: string;
  tone: string;
  visualStyle: string;
  hookText: string;
  cta: string;
  targetAudience: string;
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
