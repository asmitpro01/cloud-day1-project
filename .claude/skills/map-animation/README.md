# Map Animation Skill for Claude Code

Make viral map animation videos (1080p MP4) with Claude Code — states or countries lighting up over time, with a year counter, labels and era colors.

Example: **How the USA Grew, 1787–1959** (all 50 states in 52 seconds).

## What you need (all free)
- [Claude Code](https://claude.com/claude-code)
- Google Chrome
- FFmpeg (`brew install ffmpeg` on Mac)
- Python 3

## How to use
1. Download this repo (green **Code** button → **Download ZIP**) and unzip it.
2. Copy the `map-animation-skill` folder into `~/.claude/skills/` (or `.claude/skills/` inside your project).
3. Open Claude Code and ask: *"Make a map animation of how the USA grew, state by state."*
4. Claude fills in `template.html`, previews it, and renders the MP4 with `render.py`.

Want to do it by hand? See `prompts.txt` for the exact prompts used in the video.

## Files
| File | What it does |
|---|---|
| `SKILL.md` | Instructions Claude follows |
| `template.html` | The map animation (D3 + U.S. states map) |
| `render.py` | Captures every frame in headless Chrome and pipes it into FFmpeg |
| `prompts.txt` | The 4 prompts from the video |
| `lib/` | D3.js and the U.S. states map data (licenses in `lib/LICENSES.txt`) |

## Credits
Map data: U.S. Census Bureau cartographic boundary files via [us-atlas](https://github.com/topojson/us-atlas) (ISC). Drawing: [D3.js](https://d3js.org) (ISC).
