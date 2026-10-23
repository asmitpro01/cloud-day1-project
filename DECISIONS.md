# Decisions

Short log of choices made where the spec left room. Newest at the bottom.

## Environment / install
- **Kokoro via `kokoro-onnx`**, not the PyTorch package: same voices, ~15 MB runtime +
  ~90 MB (int8) / ~330 MB (fp32) model instead of 2+ GB of torch/CUDA. (M2)
- **WhisperX is an optional extra**, not installed in the dev container. Captions fall
  back to scene-level timing. The `Aligner` protocol receives the full `AudioResult`, so
  an aligner can also use TTS-provided word timestamps (e.g. ElevenLabs with-timestamps).
- Python pinned to 3.11 (`.python-version`); lockfile `uv.lock` committed.

## Architecture
- **Adapters write to an `out_path` chosen by the pipeline** (a cache temp file) instead
  of picking their own paths. Keeps naming, atomicity and caching out of adapters.
- **Adapter discovery**: subclassing `Adapter` with an `adapter_name` registers it;
  the registry imports every module in `providers/<kind>/`. New provider = one file +
  one `providers:` config entry. Adapter modules keep heavy imports lazy.
- **Engine config vs project**: `config.yaml` (providers, modes, chains, render/audio
  params) is engine-level; `project.yaml` is creative (style, cast, voice, music, output).
- **Modes** (`draft` / `final`) each hold resolution, encoder quality, QA flag and full
  provider chains. Cache keys contain no mode, only real inputs, so identical work is
  shared across modes (e.g. TTS and placeholder images are reused by `--final`).
- **One TTS provider per project**: the first ready provider in the TTS chain voices
  every scene. Falling back per scene would mix voices mid-video. (Image chains do fall
  back per scene.)

## Timing / A-V sync
- Scene length = voice + padding, **rounded up to whole frames, then to a multiple of
  `fps / gcd(fps, 1e6)` frames** (3 at 30 fps = 0.1 s). The concat demuxer accumulates
  segment offsets in microseconds; 1/30 s is not a whole microsecond, which produced
  1-tick timestamp jitter over 100 segments (found by a 100-scene test). Quantized
  segments concat to exact CFR. Cost: <= 66 ms extra padding per scene. Each scene's audio is
  padded/trimmed to exactly `frames * 48000 / fps` samples, so audio and video lengths
  are identical by construction (no cumulative drift on 100+ scenes).
- Segments are video-only; audio is assembled separately and muxed once at the end.
- Every voice clip gets an 8 ms fade in/out (configurable) to avoid clicks at joins.

## Cache
- Key = sha256 of canonical JSON of all inputs (adapter, model, endpoint, settings,
  prompt/text, seed, reference-file hashes, upstream keys, encoder args). The configured
  provider *instance name* is not in the key, so renaming a provider entry is free.
- An entry is valid only once its JSON sidecar exists; the media is moved into place
  first (`os.replace`), so crashes never leave half-valid entries.
- Concat lists are written inside the cache root with relative hex-named paths, so the
  concat demuxer runs in its default *safe* mode and no user string reaches the list.
- Stage versions (`SEGMENT_VERSION`, …) are part of keys; bump when rendering changes.

## Lint
- "Same camera move twice in a row" ignores `static` (not a move).
- ">3 consecutive scenes with the same shot" warns once per run, on the 4th scene.

## Security
- `safe_project_path` judges paths by both POSIX and Windows rules on every OS (rejects
  `..`, absolute, drive-relative `C:x`, UNC) and resolves symlinks before the
  containment check. `cache_dir` / `output_dir` from config pass the same guard.
- Redaction runs as a structlog processor: registered secret values (every configured
  key) + patterns (Google/OpenAI/ElevenLabs/GitHub keys, bearer tokens, `key=` query
  params, auth headers) + any field whose name looks sensitive.
- Dependency audit is `scripts/audit.py` (Python, works on Windows) rather than a
  shell script; the Makefile is only a convenience wrapper.

## M2 — providers and resilience
- **Where model ids/API shapes came from**: provider doc sites (ai.google.dev, fal.ai,
  elevenlabs.io, huggingface.co) are blocked from the build container, so ids and
  request/response shapes were taken from the providers' official SDK sources and
  cookbooks on GitHub (google-genai types/models, gemini cookbook, elevenlabs-python,
  fal-client) on 2026-10-23. Prices come from litellm's cost map (v1.106.2) and are
  labelled as such in config. **fal model input fields** (`image_size:
  landscape_16_9`, …) could not be verified and live in config so they can be fixed
  without code changes.
- **Kokoro fp32 for both modes**: measured on this 4-vCPU x86 box, int8 ran at RTF
  1.11 vs 0.26 for fp32 (int8 kernels are slow without VNNI). fp32 is faster *and*
  better, and identical TTS in draft/final means final reuses draft's audio and
  timing. The int8 entry stays in config for low-RAM machines.
- **Model files** are pinned by sha256 in config and fetched from the kokoro-onnx
  GitHub release (HuggingFace is blocked here; same files). Stored per user, outside
  the repo (`~/.cache/stickforge/models`, `%LOCALAPPDATA%\stickforge\models`).
- **Gemini**: thought (draft) images are ignored; the last non-thought image wins.
  Safety refusals are permanent (next provider); a text-only reply is transient
  (retried). Images are re-encoded to PNG, which also strips metadata.
- **fal**: the API key is only ever sent to allowlisted API hosts — `status_url` /
  `response_url` come from the server and are checked before use. Result images are
  fetched without credentials, from allowlisted media hosts, through the downloader.
- **Retries**: full-jitter exponential backoff, Retry-After as a floor, only for
  429/5xx/408/409/425/timeouts. Each provider gets a shared limiter (concurrency +
  requests/minute token bucket) for the run.
- **TTS + images run concurrently** (CPU-bound local voice vs network-bound images).
- **litellm** debug output and telemetry are disabled; its own retries are off
  (`num_retries=0`) so our policy is the only one.
- **WhisperX extra removed from the lockfile** for now: it pins torch/transformers
  versions with published advisories (pip-audit). It returns with the aligner in M3
  only if it resolves to patched versions; otherwise it is documented as a manual
  install.
- The audit script now includes all extras.
