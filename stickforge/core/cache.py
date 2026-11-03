"""Content-addressed cache with crash-safe commits.

Layout: ``<root>/<key[:2]>/<key><suffix>`` plus a ``<key>.meta.json`` sidecar. An entry exists
only once its sidecar is written (after the media file is atomically moved into place),
so a crash mid-write leaves at most an orphaned temp file, never a half-valid entry.
"""

from __future__ import annotations

import contextlib
import hashlib
import json
import os
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

KEY_VERSION = 1
SIDECAR_SUFFIX = ".meta.json"


def canonical_key(parts: dict[str, Any]) -> str:
    """sha256 over canonical JSON of ``parts`` (sorted keys, no whitespace)."""
    blob = json.dumps(
        {"_v": KEY_VERSION, **parts}, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    )
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


_file_hash_memo: dict[tuple[str, int, int], str] = {}


def file_sha256(path: Path) -> str:
    st = path.stat()
    memo_key = (str(path.resolve()), st.st_size, st.st_mtime_ns)
    if memo_key not in _file_hash_memo:
        h = hashlib.sha256()
        with path.open("rb") as f:
            for chunk in iter(lambda: f.read(1 << 20), b""):
                h.update(chunk)
        _file_hash_memo[memo_key] = h.hexdigest()
    return _file_hash_memo[memo_key]


def atomic_write_bytes(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        with tmp.open("wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        tmp.replace(path)
    finally:
        with contextlib.suppress(FileNotFoundError):
            tmp.unlink()


def atomic_write_text(path: Path, text: str) -> None:
    atomic_write_bytes(path, text.encode("utf-8"))


@dataclass(frozen=True)
class CacheEntry:
    key: str
    path: Path
    meta: dict[str, Any]
    sha256: str  # content hash of the media file — what downstream keys are built from


class Cache:
    def __init__(self, root: Path) -> None:
        self.root = root
        root.mkdir(parents=True, exist_ok=True)

    def _dir(self, key: str) -> Path:
        if len(key) != 64 or not all(c in "0123456789abcdef" for c in key):
            raise ValueError("invalid cache key")
        return self.root / key[:2]

    def media_path(self, key: str, suffix: str) -> Path:
        return self._dir(key) / f"{key}{suffix}"

    def get(self, key: str) -> CacheEntry | None:
        sidecar = self._sidecar(key)
        try:
            doc = json.loads(sidecar.read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError):
            return None
        media = self._dir(key) / str(doc.get("file", ""))
        if not doc.get("file") or not media.is_file():
            return None
        digest = doc.get("sha256") or file_sha256(media)
        return CacheEntry(key=key, path=media, meta=doc.get("meta", {}), sha256=digest)

    def _sidecar(self, key: str) -> Path:
        return self._dir(key) / f"{key}{SIDECAR_SUFFIX}"

    def tmp_path(self, key: str, suffix: str) -> Path:
        d = self._dir(key)
        d.mkdir(parents=True, exist_ok=True)
        # Keep the real suffix last so tools (ffmpeg, Pillow) infer the format.
        return d / f"tmp-{key[:12]}-{uuid.uuid4().hex[:8]}{suffix}"

    def commit(self, key: str, tmp: Path, suffix: str, meta: dict[str, Any]) -> CacheEntry:
        if suffix == SIDECAR_SUFFIX:
            raise ValueError("media suffix collides with the cache sidecar")
        digest = file_sha256(tmp)
        final = self.media_path(key, suffix)
        tmp.replace(final)
        doc = {"file": final.name, "sha256": digest, "meta": meta}
        atomic_write_text(self._sidecar(key), json.dumps(doc, indent=1, default=str))
        return CacheEntry(key=key, path=final, meta=meta, sha256=digest)

    @staticmethod
    def discard(tmp: Path) -> None:
        with contextlib.suppress(FileNotFoundError):
            tmp.unlink()

    def relpath(self, entry_path: Path) -> str:
        """Portable relative path (``ab/<key>.mp4``) for concat lists written in ``root``."""
        return entry_path.relative_to(self.root).as_posix()
