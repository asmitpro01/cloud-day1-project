"""Security helpers: path guards, secret redaction, media validation."""

from __future__ import annotations

import re
from collections.abc import Iterable, MutableMapping
from pathlib import Path, PurePosixPath, PureWindowsPath
from typing import Any

# ---------------------------------------------------------------------------
# Path guards
# ---------------------------------------------------------------------------


class PathEscapeError(ValueError):
    pass


def safe_project_path(root: Path, rel: str) -> Path:
    """Resolve ``rel`` inside ``root``; reject absolute paths, traversal, and symlink escapes.

    Checks both POSIX and Windows syntax so a project file is judged the same on every OS.
    """
    if not rel or "\x00" in rel:
        raise PathEscapeError("empty or invalid path")
    win, posix = PureWindowsPath(rel), PurePosixPath(rel)
    if posix.is_absolute() or win.is_absolute() or win.drive or win.root:
        raise PathEscapeError(f"absolute paths are not allowed: {rel!r}")
    if ".." in win.parts or ".." in posix.parts:
        raise PathEscapeError(f"'..' is not allowed in paths: {rel!r}")
    root_resolved = root.resolve()
    candidate = (root_resolved / Path(*win.parts)).resolve()  # follows symlinks
    if not candidate.is_relative_to(root_resolved):
        raise PathEscapeError(f"path escapes the project folder: {rel!r}")
    return candidate


# ---------------------------------------------------------------------------
# Redaction
# ---------------------------------------------------------------------------

REDACTED = "***REDACTED***"

_SENSITIVE_KEY = re.compile(
    r"(api[_-]?key|token|secret|password|passwd|authorization|auth|credential|cookie|signature)",
    re.I,
)
_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"\bsk-[A-Za-z0-9_\-]{16,}"),  # OpenAI-style
    re.compile(r"\bsk_[A-Za-z0-9]{20,}"),  # ElevenLabs-style
    re.compile(r"\bAIza[0-9A-Za-z_\-]{30,}"),  # Google API keys
    re.compile(r"\b(?:ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{20,}"),
    re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._\-+/=]{8,}"),
    re.compile(r"(?i)\b(?:key|api_key|apikey|token|access_token)=([^&\s\"']{6,})"),
    re.compile(r"(?i)\b(?:x-goog-api-key|xi-api-key|authorization)\s*[:=]\s*\S+"),
]


class Redactor:
    """Redacts known secret values and anything that looks like a credential."""

    def __init__(self, known_secrets: Iterable[str] = ()) -> None:
        self._known: list[str] = []
        self.add_secrets(known_secrets)

    def add_secrets(self, secrets: Iterable[str]) -> None:
        for s in secrets:
            if s and len(s) >= 6 and s not in self._known:
                self._known.append(s)
        self._known.sort(key=len, reverse=True)

    def text(self, value: str) -> str:
        for s in self._known:
            value = value.replace(s, REDACTED)
        for pat in _PATTERNS:
            value = pat.sub(REDACTED, value)
        return value

    def value(self, value: Any, key: str | None = None) -> Any:
        if key is not None and _SENSITIVE_KEY.search(key) and value not in (None, "", False):
            return REDACTED
        if isinstance(value, str):
            return self.text(value)
        if isinstance(value, dict):
            return {k: self.value(v, str(k)) for k, v in value.items()}
        if isinstance(value, list | tuple):
            return type(value)(self.value(v) for v in value)
        if isinstance(value, BaseException):
            return self.text(f"{type(value).__name__}: {value}")
        return value

    def __call__(
        self, _logger: Any, _method: str, event_dict: MutableMapping[str, Any]
    ) -> MutableMapping[str, Any]:
        """structlog processor."""
        for k in list(event_dict):
            event_dict[k] = self.value(event_dict[k], None if k == "event" else k)
        return event_dict


# Process-wide redactor; config loading registers secret values with it.
REDACTOR = Redactor()


# ---------------------------------------------------------------------------
# Media validation
# ---------------------------------------------------------------------------


class MediaValidationError(ValueError):
    pass


MAX_IMAGE_BYTES = 40 * 1024 * 1024
MAX_IMAGE_PIXELS = 8192 * 8192


def validate_image(path: Path, *, max_bytes: int = MAX_IMAGE_BYTES) -> tuple[int, int]:
    """Verify an image file is a sane PNG/JPEG/WEBP. Returns (width, height)."""
    from PIL import Image

    size = path.stat().st_size
    if size == 0 or size > max_bytes:
        raise MediaValidationError(f"image size {size} bytes out of bounds")
    try:
        with Image.open(path) as im:
            if im.format not in {"PNG", "JPEG", "WEBP"}:
                raise MediaValidationError(f"unsupported image format {im.format}")
            w, h = im.size
            if w * h > MAX_IMAGE_PIXELS or w < 16 or h < 16:
                raise MediaValidationError(f"image dimensions {w}x{h} out of bounds")
            im.verify()
        with Image.open(path) as im:  # verify() invalidates; full decode catches truncation
            im.load()
    except MediaValidationError:
        raise
    except Exception as e:
        raise MediaValidationError(f"invalid image: {e}") from None
    return w, h
