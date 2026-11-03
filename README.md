# stickforge

Local, provider-agnostic engine that turns a scene plan (`scenes.json` + `project.yaml`)
into a finished, YouTube-ready 16:9 stickman explainer video: narration, one image per
scene, camera moves, on-screen text, music, captions. Rendering is FFmpeg only.

Runs on Linux, macOS and Windows 10/11 (no WSL needed).

> Status: **M2** — real providers (Kokoro local TTS, Gemini + fal images, ElevenLabs,
> litellm), cache, parallel stages, per-provider rate limits, retries and fallback
> chains. Camera moves, music, loudness and captions arrive in M3.

## Install

1. **Python 3.11+ and uv** — <https://docs.astral.sh/uv/getting-started/installation/>
2. **FFmpeg (with ffprobe, libx264)** — must be on `PATH`:
   - **Windows 10/11:** `winget install Gyan.FFmpeg` (or download a "full" build from
     <https://www.gyan.dev/ffmpeg/builds/>, unzip, add its `bin` folder to `PATH`).
     Open a new terminal afterwards.
   - **macOS:** `brew install ffmpeg`
   - **Ubuntu/Debian:** `sudo apt install ffmpeg`
   - Or point `render.ffmpeg_path` / `render.ffprobe_path` in `config.yaml` at the binaries.
3. **stickforge** (with the local voice and LLM extras):
   ```
   uv sync --extra kokoro --extra llm
   uv run stickforge models pull        # Kokoro model files (~360 MB), sha256-verified
   uv run stickforge doctor
   ```
4. **API keys** (optional): copy `.env.example` to `.env` and fill in what you use,
   e.g. `GEMINI_API_KEY` from Google AI Studio. Without keys, images fall back to
   offline placeholders and the run prints a warning.

Hardware encoders (NVENC / VideoToolbox / QuickSync) are used automatically when a test
encode succeeds; otherwise libx264.

## Quick start (offline, no keys)

```
uv run stickforge validate examples/sample_project
uv run stickforge render examples/sample_project --draft
```
Output: `examples/sample_project/renders/draft/sample.mp4`. Rerunning reuses the cache
(`<project>/.cache/`); changing one scene regenerates only that scene's pieces.

## Commands

| Command | Purpose |
|---|---|
| `stickforge doctor` | Environment, encoders, provider readiness (never prints secrets) |
| `stickforge providers` | Adapters, capabilities, configured status, mode chains |
| `stickforge validate <project>` | Schema validation + style lint warnings |
| `stickforge render <project> --draft\|--final [--force]` | Render |
| `stickforge report <project>` | Pretty-print report.json (M4) |

## Providers

| Capability | Default chain (draft) | Default chain (final) |
|---|---|---|
| Voice | Kokoro (local, fp32) → silent stub | same |
| Images | Gemini `gemini-3.1-flash-lite-image` → fal FLUX schnell → placeholder | Gemini `gemini-3.1-flash-image` (2K) → flash-lite → fal → placeholder |
| Vision QA | Gemini via litellm | same |

Unready providers (no key, extra not installed, model file missing) are skipped;
`stickforge providers` shows why. Image fallback is per scene, and a scene that fell
back is regenerated with the preferred provider on the next run once it works again.
Voices: set `voice.id` (Kokoro: e.g. `af_heart`, `am_michael`, British `bf_emma`,
`bm_george`) and `voice.by_adapter: {elevenlabs: <voice id>}` for other providers.

## Configuration

Engine config is `stickforge/default_config.yaml`, deep-merged with `./config.yaml`
(or `--config`, or `STICKFORGE_CONFIG`). Model IDs, endpoints, voices, prices and
fallback chains live there. Secrets go in `.env` (copy `.env.example`) and are referenced
by env var **name** via `api_key_env`.

## Development

```
uv run ruff check . && uv run ruff format --check . && uv run mypy && uv run pytest -q
uv run python scripts/audit.py      # dependency vulnerability audit (pip-audit)
```
(`make check` / `make audit` do the same where `make` exists.)

See `DECISIONS.md` for design choices.
