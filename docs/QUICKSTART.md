# Stickforge quick start

This guide takes you from a fresh computer to your first finished video in about
15 minutes. No programming is needed: you only type a few commands.

## 1. Install (one command)

Unzip stickforge into a folder whose path has no special characters, for example
`D:\stickforge` or `~/stickforge`, and open a terminal in that folder.

**Windows 10/11** (PowerShell):
```
powershell -ExecutionPolicy Bypass -File .\install.ps1
```
**macOS / Linux**:
```
sh install.sh
```

The installer sets up everything stickforge needs (uv, Python 3.11, FFmpeg, the
offline voice model of about 360 MB) and finishes with a health check
(`stickforge doctor`). It is safe to run again if something was interrupted.

If FFmpeg was just installed, Windows may need a **new terminal window** before it is
found. Close the terminal, open a new one in the same folder and run the installer
again.

## 2. Make your first video

Write your narration in a plain text file, one idea per paragraph. A sample is
included:
```
uv run stickforge new my_video --script examples/sample_script.txt
uv run stickforge render my_video --draft
```
The video is in `my_video/renders/draft/video.mp4`, with `.srt` and `.vtt` captions
next to it.

`--draft` is a fast 720p preview. When you like it, make the full-quality 1080p
version:
```
uv run stickforge render my_video --final
```

## 3. Turn on AI images (recommended)

Without an API key every scene gets a clean placeholder card, so you can test for free.
For real stick-figure illustrations:

1. Get a free key at <https://aistudio.google.com/apikey>.
2. Open the `.env` file in the stickforge folder and fill in the line
   `GEMINI_API_KEY=your-key-here`.
3. Run `uv run stickforge doctor`: the Gemini providers should say **ready**.

With a key, `stickforge new` also uses Gemini to split your script into well-chosen
scenes (shots, camera moves, on-screen text). Image costs are tracked per run in
`renders/<mode>/costs.jsonl` and in `stickforge report my_video`.

## 4. Change the look and the voice

Open `my_video/project.yaml`:

- `style`: colours, line style and background used in every image.
- `cast`: your recurring characters. A short description keeps them consistent.
- `voice.id`: the narrator. American `af_heart`, `af_bella`, `am_michael`, `am_adam`;
  British `bf_emma`, `bm_george`, and more. `voice.speed` from 0.8 to 1.2.
- `music.file`: an MP3 inside the project folder. It is looped and ducked under the voice.

Edit a single scene's text or picture description in `my_video/scenes.json` and render
again: only the changed scenes are redone. To get a different picture for a scene, give
it a `"seed": 2` (or any other number).

## 5. Use it from Claude (optional)

Stickforge includes an MCP server, so Claude Desktop or Claude Code can make videos
for you from a chat. See "MCP server" in the README for the one-line setup.

## Troubleshooting

| Problem | Fix |
|---|---|
| `uv` or `ffmpeg` is "not recognized" | Open a new terminal window so it picks up the new PATH, then retry. |
| `doctor` shows FAIL for ffmpeg | Install FFmpeg (see README "Install") or set `render.ffmpeg_path` in a `config.yaml`. |
| Images are plain placeholder cards | No image provider is ready: add `GEMINI_API_KEY` to `.env` and check `stickforge doctor`. |
| The voice is silent | The voice model is missing: run `uv run stickforge models pull`. |
| A render stopped halfway | Run the same command again. Finished scenes are cached and are not redone. |
| One scene looks wrong | Change its `visual` text or `seed` in `scenes.json` and run `render --only-scenes <id>`. |
| Something else | Run `uv run stickforge report my_video` and send the `renders/<mode>/stickforge.log.jsonl` file to support. It never contains your API keys. |
