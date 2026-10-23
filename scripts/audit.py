"""Dependency vulnerability audit of the locked dependency set (cross-platform).

Usage: uv run python scripts/audit.py
"""

from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


def main() -> int:
    uv = shutil.which("uv")
    if uv is None:
        print("uv not found on PATH", file=sys.stderr)
        return 2
    with tempfile.TemporaryDirectory() as d:
        req = Path(d) / "requirements.txt"
        subprocess.run(
            [
                uv,
                "export",
                "--quiet",
                "--frozen",
                "--no-hashes",
                "--no-emit-project",
                "--all-extras",
                "--format",
                "requirements-txt",
                "-o",
                str(req),
            ],
            check=True,
            timeout=120,
        )
        return subprocess.run(
            [
                sys.executable,
                "-m",
                "pip_audit",
                "--strict",
                "--progress-spinner",
                "off",
                "-r",
                str(req),
            ],
            timeout=600,
            check=False,
        ).returncode


if __name__ == "__main__":
    raise SystemExit(main())
