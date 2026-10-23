# stickforge

Local, provider-agnostic engine that turns a scene plan (`scenes.json` + `project.yaml`)
into a finished, YouTube-ready 16:9 stickman explainer: narration, one image per scene
with a consistent cast, eased camera moves, on-screen text, crossfades, music ducked
under the voice, loudness-normalized audio and captions. Rendering is FFmpeg only.

Runs on Linux, macOS and Windows 10/11 (no WSL needed). Output: 1920x1080 (final) or
1280x720 (draft), 30 fps, H.264 yuv420p + AAC 48 kHz, -14 LUFS / -1 dBTP, faststart.

## Install

1. **Python 3.11+ and uv** — <https://docs.astral.sh/uv/getting-started/installation/>
2. **FFmpeg (with ffprobe and libx264)** on `PATH`:
   - **Windows 10/11:** `winget install Gyan.FFmpeg` (or a "full" build from
     <https://www.gyan.dev/ffmpeg/builds/>: unzip, add its `bin` folder to `PATH`, open a
     new terminal).
   - **macOS:** `brew install ffmpeg`
   - **Ubuntu/Debian:** `sudo apt install ffmpeg`
   - Or set `render.ffmpeg_path` / `render.ffprobe_path` in `config.yaml`.
3. **stickforge** with the local voice and LLM extras:
   ```
   uv sync --extra kokoro --extra llm
   uv run stickforge models pull        # Kokoro model files (~360 MB), sha256-verified
   uv run stickforge doctor
   ```
4. **API keys** (optional): copy `.env.example` to `.env` and fill in what you use
   (e.g. `GEMINI_API_KEY` from Google AI Studio). Without keys, images fall back to
   offline placeholders and every run says so.

Hardware encoders (NVENC / VideoToolbox / QuickSync) are picked automatically when a
test encode succeeds; otherwise libx264.

## Quick start

```
uv run stickforge validate examples/sample_project
uv run stickforge render examples/sample_project --draft     # fast preview, 720p
uv run stickforge render examples/sample_project --final     # 1080p, best models, QA
uv run stickforge report examples/sample_project
```
Outputs land in `<project>/renders/<mode>/`: the MP4, an `.srt`, `report.json`,
`costs.jsonl` and a JSON-lines run log.

## Commands

| Command | Purpose |
|---|---|
| `stickforge doctor` | Environment, encoders, provider readiness (never prints secrets) |
| `stickforge providers` | Adapters, capabilities, configured status, mode chains |
| `stickforge models list` / `pull [keys]` | Local model files, pinned by sha256 |
| `stickforge validate <project>` | Schema validation (errors name the scene id) + style lint |
| `stickforge render <project> --draft\|--final [--only-scenes 4,12] [--force] [--qa/--no-qa]` | Render |
| `stickforge report <project> [--mode final] [--json]` | Per-scene status, cost, QA issues |

## Project format

`project.yaml`:
```yaml
title: "Why the Sky Is Blue"
style:
  palette: ["#F4F1EA", "#1D1D1D", "#E63946"]   # first = background, second = ink
  line_style: "thick clean black outlines, flat colors"
  background: "plain warm off-white background"
  font: ""                       # optional .ttf/.otf inside the project
cast:
  - name: Max
    description: "a classic stickman with a round head and a red scarf"
    reference_images: [cast/max.png]           # sent to providers that accept refs
voice: {id: af_heart, speed: 1.0, by_adapter: {elevenlabs: "<voice id>"}}
music: {file: audio/bed.mp3, volume_db: -18}   # optional; looped, ducked, faded
output: {filename: video.mp4, transition: crossfade, crossfade_s: 0.4,
         scene_padding_s: 0.35, burn_in_captions: false}
```
`scenes.json` — an array of:
```json
{"id": 1, "narration": "…", "visual": "…", "characters": ["Max"],
 "shot": "wide|medium|close-up|split-screen|diagram|map|chart",
 "camera": "static|slow_zoom_in|slow_zoom_out|pan_left|pan_right",
 "on_screen_text": "", "sfx": "", "seed": null}
```
All file paths must stay inside the project folder. Narration length sets each scene's
duration (voice + padding); `seed` re-rolls one scene's image.

Kokoro voices: American `af_heart`, `af_bella`, `am_michael`, `am_adam`, …; British
`bf_emma`, `bf_isabella`, `bm_george`, `bm_lewis`, … (`stickforge providers` / Kokoro docs).

## How a render works

1. Validate + lint (warnings: repeated camera move, >3 same shots in a row, >40 words).
2. TTS per scene (one voice provider for the whole video); duration measured with
   ffprobe and rounded to whole frames — this, not captions, defines visual timing.
3. Images per scene in parallel, 16:9, style prefix + scene + cast descriptions;
   fallback chain per scene.
4. Optional vision QA: failed images are regenerated with a new seed up to
   `qa.max_retries`, then the least-bad one is kept and the scene is flagged.
5. Per-scene segments in parallel (camera, title, captions, crossfade).
6. Concat with stream copy. 7. Audio: voice + SFX, music ducking, two-pass loudnorm.
8. Captions: `.srt` always, burn-in optional. 9. Mux + ffprobe verification.
10. `report.json` (also written when a render fails).

### Caching, re-runs and `--only-scenes`

Everything is content-addressed in `<project>/.cache/`: change one scene's narration
and only that scene's audio, segment and the final assembly are redone. A crashed or
interrupted run resumes where it stopped (finished work is kept even when another
scene fails). `--only-scenes 4,12` regenerates just those scenes' assets, bypassing the
cache for them; `--force` bypasses it for all. To get a *different* image for a scene,
set its `seed`.

### Providers

| Capability | draft chain | final chain |
|---|---|---|
| Voice | Kokoro (local) → silent stub | same |
| Images | Gemini `gemini-3.1-flash-lite-image` → fal FLUX schnell → placeholder | Gemini `gemini-3.1-flash-image` (2K) → flash-lite → fal → placeholder |
| Vision QA | (off) | Gemini `gemini-3.8-flash` via litellm |
| Caption timing | TTS timestamps → WhisperX (if installed) → estimate | same |

Also available: ElevenLabs voice (with word timestamps) and any OpenAI-compatible
image endpoint (`openai_image`). Unready providers (no key / extra / model file) are
skipped; `stickforge providers` shows why. Model ids, endpoints, voices and prices live
in config (`stickforge/default_config.yaml`), deep-merged with your `./config.yaml`.

WhisperX is not in the lockfile (its releases pin torch/transformers versions with
published advisories). To use it anyway: `uv pip install whisperx` (>1 GB).

## Add a new provider in one file

A provider is one adapter file plus one config entry. Worked example — the real
`stickforge/providers/image/openai_compat.py`:

1. **Create the file** in the folder for its kind (`providers/tts/`, `image/`, `llm/`,
   `align/`). Subclass `Adapter`, set the class metadata, implement the protocol from
   `providers/base.py`:
   ```python
   class OpenAICompatImage(Adapter):
       adapter_name = "openai_compat"      # registers the class — no registry edits
       kind = Kind.IMAGE
       capabilities = frozenset()          # e.g. {"refs", "seed"} if supported
       requires_key = True                 # key comes from env via api_key_env
       default_max_concurrency = 4
       default_requests_per_minute = 20
       cost_model = "per image (cost.per_image_usd)"
       license_note = "output terms of the configured provider/model"

       async def generate(self, prompt, refs, aspect, seed, settings, *, out_path):
           ...  # call the API with core.http.client(self.config.timeout_s)
           http.raise_for_status(resp, self.name)   # 429/5xx -> retried, 4xx -> fallback
           w, h = save_image_as_png(data, out_path) # validates + re-encodes untrusted bytes
           return ImageResult(path=out_path, provider=self.name, model=self.config.model,
                              width=w, height=h, cost_usd=self.cost_rate("per_image_usd"))
   ```
   Rules: write only to `out_path`; read model/endpoint/settings from `self.config`;
   raise `TransientProviderError` (retry) or `PermanentProviderError` (next provider);
   send the key only in headers; fetch remote media with `core.http.download` (HTTPS,
   host allowlist, size cap); keep optional imports inside methods.
2. **Add a config entry** (your `config.yaml`) and put it in a chain:
   ```yaml
   providers:
     openai_image:
       adapter: openai_compat
       model: gpt-image-2
       endpoint: https://api.openai.com/v1
       api_key_env: OPENAI_API_KEY
       cost: {per_image_usd: 0.04}
       settings: {size: 1536x864}
   modes:
     final: {chains: {image: [openai_image, gemini_flash, placeholder]}}
   ```
3. **Test it** with mocked HTTP (see `tests/test_adapter_openai_compat.py`, respx), then
   `stickforge providers` to see it ready.

## Security

Secrets only from the environment/`.env` (never in config or logs; a log processor
redacts key-like strings). FFmpeg is always called with argument lists; no user or
LLM text ever enters a filter graph (text is rendered with Pillow). Project paths are
confined to the project folder (no `..`, absolute paths or symlink escapes). Downloads
are HTTPS-only with host allowlists, size caps and content checks; images are
re-encoded, audio is ffprobe-validated. YAML via `safe_load`, no pickle/eval.
`report.json` lists the license notes of everything used.

## Development

```
uv run ruff check . && uv run ruff format --check . && uv run mypy && uv run pytest -q
uv run python scripts/audit.py      # pip-audit over the locked deps incl. extras
```
(`make check` / `make audit` where `make` exists.) Design choices and measurements:
`DECISIONS.md`.
