# TODO

## Next Up

- [ ] **Brand Pack CLI** (`npm run image-pack`) — multi-format image + clip generation from a brand brief. Generates images in story/square/landscape formats via Gemini, animates with Kling, assembles brand reel via ffmpeg. Plan written and approved.

## Pipeline Features

- [ ] **`--skip-fal` flag** — skip video generation and use existing clips in `output/clips/`. Useful when iterating on captions or audio without re-generating clips.

- [ ] **`--dry-run` flag** — validate config and assets, report what would happen, make zero API calls.

- [ ] **Wipe transition** — `TransitionType` includes `'wipe'` but only `crossfade` and `cut` are implemented. Add `@remotion/transitions/wipe`.

- [ ] **Scene duration auto-calculation** — if a script is provided, distribute clip durations proportionally to voiceover length rather than requiring manual per-clip `duration`.

- [ ] **Ad 1x1 composition** — `ad-1x1` format currently maps to the `Ad` (16:9) Remotion composition. Needs its own square (1:1) layout.

## Quality of Life

- [ ] **ElevenLabs voice listing cache** — `--list-voices` hits the API every time. Cache to a local file and only refresh if >24h old.

- [ ] **Config validation for `imageReference` paths** — validate that `imageReference` paths exist on disk before starting the pipeline.

- [ ] **Subtitle file export** — after Whisper transcription, export an `.srt` file to `output/audio/captions.srt`.

- [ ] **Music looping/trimming** — if the music track is shorter than the video, it cuts out. Add ffmpeg-based loop-and-trim before passing to Remotion.

## Ideas / Future

- [ ] **OmniHuman talking head** — `fal-ai/bytedance/omnihuman` for lip-synced AI personas. Takes a face image + voiceover → generates a full talking head video. Clip segments can be intercut with cinematic Kling clips.

- [ ] **Multi-format output** — produce `youtube-short` and `ad-1x1` from the same project in one run.

- [ ] **Preview mode** — render a low-res proxy (540p) first for quick review before committing to a full render.

- [ ] **Project templates** — pre-configured `config.json` templates for common use cases (product launch, event promo, fashion lifestyle) scaffoldable via `npm run new-project -- --template <name>`.

- [ ] **Web UI** — minimal Next.js dashboard to browse projects, preview clips, and trigger pipeline runs without the CLI.

- [ ] **SFX support** — `assets/audio/sfx/` exists but nothing reads it. Add SFX trigger points to `VideoClip` (e.g. `sfx: 'swoosh'`) and play them at scene transitions.
