# stickforge one-step installer for Windows 10/11 (PowerShell 5.1+).
# Run from the stickforge folder:
#   powershell -ExecutionPolicy Bypass -File .\install.ps1
# Re-running is safe: every step skips work that is already done.
$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Refresh-Path {
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                [Environment]::GetEnvironmentVariable("Path", "User") + ";" +
                "$env:USERPROFILE\.local\bin"
}

Step "Checking uv (Python package manager)"
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    Write-Host "uv not found, installing it from astral.sh"
    powershell -ExecutionPolicy Bypass -c "irm https://astral.sh/uv/install.ps1 | iex"
    Refresh-Path
}
uv --version

Step "Checking FFmpeg"
if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        Write-Host "FFmpeg not found, installing it with winget (Gyan.FFmpeg)"
        winget install --id Gyan.FFmpeg -e --accept-source-agreements --accept-package-agreements
        Refresh-Path
    }
}
if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
    Write-Host "FFmpeg is still not on PATH. Install a 'full' build from https://www.gyan.dev/ffmpeg/builds/," -ForegroundColor Yellow
    Write-Host "add its bin folder to PATH, open a NEW terminal and run this script again." -ForegroundColor Yellow
    Write-Host "(If winget just installed it, simply opening a new terminal is usually enough.)" -ForegroundColor Yellow
    exit 1
}

Step "Installing stickforge (Python 3.11 is downloaded automatically if needed)"
uv sync --extra kokoro --extra llm --extra mcp
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Step "Downloading the offline voice model (~360 MB, checked by sha256)"
uv run stickforge models pull
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if (-not (Test-Path .env)) {
    Copy-Item .env.example .env
    Write-Host "Created .env. Add a GEMINI_API_KEY there for AI images (optional)."
}

Step "Checking everything"
uv run stickforge doctor
Write-Host "`nDone. Make your first video:" -ForegroundColor Green
Write-Host "  uv run stickforge new my_video --script examples\sample_script.txt"
Write-Host "  uv run stickforge render my_video --draft"
