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

## M3 — polish
- **Camera smoothness, measured**: zoompan snaps its crop window to whole input
  pixels. Phase-correlation jitter on a 5 s pan (RMS deviation from the ideal eased
  path): 1x input 0.75 px, 2x 0.44 px, 3x 0.34 px, 4x 0.21–0.27 px; a Pillow
  sub-pixel reference measures 0.19 px (the method's noise floor). Default 4x for
  final, 2x for draft (`modes.<m>.camera_oversample`). zoompan writes straight to
  the output size: an extra same-size lanczos pass cost ~10 s per scene for nothing.
- **Easing**: cosine ease-in-out per scene, so motion starts and stops softly at cuts.
- **Crossfade without breaking sync**: instead of overlapping segments (which shortens
  the video and breaks stream-copy concat), each segment starts by fading from the
  previous scene's *final camera view*. That frame is computed with Pillow from the
  image + camera end state + title, so segments still render in parallel; the
  boundary frames measured SSIM 0.993 / PSNR 36 dB against ffmpeg's last frame.
- **Text**: all titles and burned-in captions are Pillow PNGs (control and bidi
  characters stripped), composited with `overlay` + numeric `enable` windows. The
  default font is Pillow's bundled FreeType font, identical on every OS.
- **Captions**: <= 84 chars (2 x 42) and <= 5 s per cue, break after sentences,
  long cues split at the last clause comma, two-line captions balanced. SRT text is
  sanitised (no newlines, `-->` replaced) so narration cannot forge cues.
- **Audio**: float32 throughout until the final AAC encode, so voice + SFX + music
  never clip before normalization. Ducking is a sidechain compressor keyed by the
  voice. Loudness: two-pass `loudnorm` (linear mode) to -14 LUFS / -1 dBTP / LRA 11;
  measured on the offline test render within 1 LU. All-silent tracks skip loudnorm.
- **SFX** are mixed into each scene's own audio (trimmed to the scene, faded out),
  keeping audio per-scene cacheable.
- **Cache fix**: sidecars are `<key>.meta.json`; a `.json` media file previously
  collided with its own sidecar.
- **WhisperX** stays out of the lock (3.8.6 still pins torch 2.8 / transformers
  4.57 with advisories); the adapter is used automatically if the user installs it.
- **`tone` test TTS**: a speech-like tone so offline tests can verify loudness and
  ducking; never used by default chains.

## M4 — reliability
- **Content-addressed downstream keys**: every cache entry records its media sha256 at
  commit; scene ids and all downstream keys (segment, scene audio, concat, mux,
  loudnorm) use content hashes, not upstream input keys. Needed for `--only-scenes`
  with non-deterministic providers (a regenerated image under the same input key
  would otherwise reuse stale video) — covered by a test with a deliberately random
  image provider.
- **`--only-scenes`** bypasses the cache for the listed scenes' own assets; the rest
  come from cache (generated if missing). With crossfades the *next* scene re-renders
  too when an image changes, because its first frames fade from that image.
- **Re-rolls are declarative**: QA retries use seed attempt N (deterministic), and a
  user wanting a different image sets `seed` on the scene. No hidden state file.
- **QA**: up to `qa.max_retries` re-rolls; then the attempt with the fewest issues is
  kept and the scene flagged (never loops). Verdicts are cached by image content and
  QA input, so reruns replay decisions for free. QA is skipped for stub images and,
  with a warning, when no QA provider is ready.
- **Failures**: sibling work finishes (and is cached) before an error propagates, so
  a rerun after a crash resumes with the most work done. `report.json` is written in
  a `finally`, including on failure.
- **Cost ledger**: every provider call that ran (free and failed ones included) goes to
  `costs.jsonl`; report totals by provider and stage. Cache hits cost nothing.
- **Report** includes measured output loudness/true peak (ebur128 on the final file)
  and license notes for providers, local model files, music and font.
- `openai_compat` image adapter (OpenAI images API shape from the official SDK's
  types) doubles as the worked example in the README's provider guide.
- **True peak after AAC**: loudnorm hitting -1.0 dBTP exactly still produced -0.3 dBTP
  in a 10-minute AAC file (encoder overshoot ~0.7 dB). Normalization now targets
  `true_peak - codec_headroom_db` (-2 dBTP); the encoded file is measured and, if it
  still exceeds the ceiling, the audio is trimmed once and a warning recorded.
  100-scene draft: -14.1 LUFS / -1.8 dBTP.
- **Incremental re-render cost** for a 10-minute video is dominated by whole-track
  audio work (two-pass loudnorm ~45 s, AAC mux + loudness check ~35 s on 4 vCPU);
  per-scene work is seconds. Acceptable for now; a later optimisation could normalize
  per scene with a fixed gain to make edits O(scene).
- **fal removed from the default image chains** (user request): it was only a
  fallback behind Gemini. The adapter and its `fal_schnell` config entry stay so it
  can be re-enabled by adding it to a chain in `config.yaml`.
