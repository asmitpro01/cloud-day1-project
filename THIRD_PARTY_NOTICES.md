# Third-party notices

Stickforge's own code is covered by `LICENSE`. It is installed together with, or calls,
the third-party software, models and services below, each under its own terms. This
file is a summary for convenience, not legal advice; the license files shipped with each
package are authoritative.

## Runtime libraries (always installed)

| Package | License |
|---|---|
| httpx, httpcore, click, python-dotenv, idna | BSD-3-Clause |
| pydantic, typer, rich, pyyaml, h11, anyio | MIT |
| structlog | MIT or Apache-2.0 |
| pillow | MIT-CMU (HPND) |
| certifi | MPL-2.0 |

## Optional extras

| Extra | Main packages | License |
|---|---|---|
| `llm` | litellm (MIT), openai (Apache-2.0), tiktoken (MIT), tokenizers and huggingface-hub (Apache-2.0), aiohttp (Apache-2.0 and MIT) | permissive |
| `mcp` | mcp (MIT), starlette, uvicorn, sse-starlette (BSD-3-Clause) | permissive |
| `kokoro` | kokoro-onnx (MIT), onnxruntime (MIT), numpy (BSD-3-Clause) | permissive |
| `kokoro` | **phonemizer (GPL-3.0)** and **espeakng-loader, which bundles the espeak-ng library (GPL-3.0)** | **copyleft** |

The full locked list is in `uv.lock`; `uv run python scripts/audit.py` checks it for
known vulnerabilities.

**Note on GPL components.** The offline voice (`kokoro` extra) depends on phonemizer and
espeak-ng, which are GPL-3.0. They are downloaded from PyPI onto the user's own machine
by `uv sync` and are not part of the stickforge source. If you redistribute stickforge
*bundled together with* these packages (for example a pre-built installer that contains
them), the GPL-3.0 obligations for those components apply to that bundle. Running them on
your own server (a hosted service) is not a distribution under GPL-3.0. Without the
`kokoro` extra, stickforge uses no GPL code.

## Models

| Model | Source | License |
|---|---|---|
| Kokoro-82M (ONNX export) and voice pack | downloaded by `stickforge models pull`, sha256-pinned | Apache-2.0 |
| WhisperX + wav2vec2 alignment (optional, not installed by default) | user-installed | BSD-2-Clause; alignment model license varies |

## Hosted services

Stickforge calls these only when you add their API key. Their terms, prices and rules
for commercial use of the output are set by each provider and your plan with them:

- Google Gemini (images, scene planning, vision QA): Gemini API Additional Terms of Service.
- Pollinations (images), fal.ai (images), any OpenAI-compatible endpoint you configure.
- ElevenLabs (voice): commercial use of generated audio depends on your ElevenLabs plan.

Every `report.json` lists the license note of each provider used for that video.

## Tools

FFmpeg is installed separately by the user (or by the installer through winget, Homebrew
or apt) and is not distributed with stickforge. Its license (LGPL-2.1+ or GPL-2+ depending
on the build) applies to the FFmpeg binary.
