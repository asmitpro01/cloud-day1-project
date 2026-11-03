# stickforge

Local, provider-agnostic engine that turns a scene plan (`scenes.json` + `project.yaml`)
into a finished, YouTube-ready 16:9 stickman explainer video: narration, one image per
scene, camera moves, on-screen text, music, captions. Rendering is FFmpeg only.

Runs on Linux, macOS and Windows 10/11 (no WSL needed).

> Status: **M1 skeleton** — schema, config, registry, offline adapters (silent TTS +
> placeholder images), static-camera render, frame-exact audio, cache. Real providers,
> camera moves, music, loudness and captions arrive in M2–M3.

## Install

1. **Python 3.11+ and uv** — <https://docs.astral.sh/uv/getting-started/installation/>
2. **FFmpeg (with ffprobe, libx264)** — must be on `PATH`:
   - **Windows 10/11:** `winget install Gyan.FFmpeg` (or download a "full" build from
     <https://www.gyan.dev/ffmpeg/builds/>, unzip, add its `bin` folder to `PATH`).
     Open a new terminal afterwards.
   - **macOS:** `brew install ffmpeg`
   - **Ubuntu/Debian:** `sudo apt install ffmpeg`
   - Or point `render.ffmpeg_path` / `render.ffprobe_path` in `config.yaml` at the binaries.
3. **stickforge:**
   ```
   uv sync
   uv run stickforge doctor
   ```

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
