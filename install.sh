#!/usr/bin/env sh
# stickforge one-step installer for macOS and Linux.
# Run from the stickforge folder:  sh install.sh
# Re-running is safe: every step skips work that is already done.
set -eu
cd "$(dirname "$0")"

step() { printf '\n==> %s\n' "$1"; }

step "Checking uv (Python package manager)"
if ! command -v uv >/dev/null 2>&1; then
    echo "uv not found, installing it from astral.sh"
    curl -LsSf https://astral.sh/uv/install.sh | sh
    PATH="$HOME/.local/bin:$PATH"
    export PATH
fi
uv --version

step "Checking FFmpeg"
if ! command -v ffmpeg >/dev/null 2>&1; then
    if command -v brew >/dev/null 2>&1; then
        brew install ffmpeg
    elif command -v apt-get >/dev/null 2>&1; then
        sudo apt-get update && sudo apt-get install -y ffmpeg
    elif command -v dnf >/dev/null 2>&1; then
        sudo dnf install -y ffmpeg
    else
        echo "Please install FFmpeg (with ffprobe) with your package manager, then run this again." >&2
        exit 1
    fi
fi

step "Installing stickforge (Python 3.11 is downloaded automatically if needed)"
uv sync --extra kokoro --extra llm --extra mcp

step "Downloading the offline voice model (~360 MB, checked by sha256)"
uv run stickforge models pull

if [ ! -f .env ]; then
    cp .env.example .env
    echo "Created .env. Add a GEMINI_API_KEY there for AI images (optional)."
fi

step "Checking everything"
uv run stickforge doctor
printf '\nDone. Make your first video:\n'
echo "  uv run stickforge new my_video --script examples/sample_script.txt"
echo "  uv run stickforge render my_video --draft"
