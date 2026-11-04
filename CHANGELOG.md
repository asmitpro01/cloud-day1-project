# Changelog

## 1.0.0 (2026-11-04)

First release.

- Script to video: `stickforge new --script` plans scenes with an LLM (Gemini by
  default) or offline rules, then `stickforge render` makes the video.
- Offline narration with Kokoro (American and British English voices); optional ElevenLabs.
- Images from Gemini, Pollinations, fal or any OpenAI-compatible endpoint, with a
  per-scene fallback chain and an offline placeholder.
- Camera moves, on-screen text, crossfades, music ducking, -14 LUFS loudness,
  SRT and WebVTT captions (optional burn-in).
- Draft (720p) and final (1080p) modes, vision QA with automatic re-rolls in final.
- Content-addressed cache: re-renders only redo what changed; interrupted runs resume.
- `report.json` with per-scene status, cost ledger and license notes.
- MCP server (`stickforge mcp`) for Claude Desktop, Claude Code and other MCP clients.
- One-step installers for Windows (`install.ps1`) and macOS/Linux (`install.sh`),
  `stickforge --version`, a sample script and a quick-start guide.
