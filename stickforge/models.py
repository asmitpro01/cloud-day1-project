"""Local model files (e.g. Kokoro): resolve, verify and download, pinned by sha256."""

from __future__ import annotations

from pathlib import Path

from stickforge.config import EngineConfig, ModelFile
from stickforge.core.cache import file_sha256
from stickforge.core.http import download

MODEL_HOSTS = (
    "github.com",
    "release-assets.githubusercontent.com",
    "objects.githubusercontent.com",
)


class ModelMissingError(RuntimeError):
    pass


def model_file(config: EngineConfig, key: str) -> ModelFile:
    if key not in config.models:
        raise ModelMissingError(f"unknown model {key!r} (known: {', '.join(config.models)})")
    return config.models[key]


def model_path(config: EngineConfig, key: str) -> Path:
    """Path of an installed model file, or ModelMissingError with the fix."""
    path = config.models_path() / model_file(config, key).file
    if not path.is_file():
        raise ModelMissingError(
            f"model {key!r} not installed at {path} — run: stickforge models pull {key}"
        )
    return path


def is_installed(config: EngineConfig, key: str) -> bool:
    try:
        model_path(config, key)
    except ModelMissingError:
        return False
    return True


async def pull(config: EngineConfig, key: str, *, verify_existing: bool = True) -> Path:
    mf = model_file(config, key)
    dest = config.models_path() / mf.file
    if dest.is_file() and (not verify_existing or file_sha256(dest) == mf.sha256):
        return dest
    await download(
        mf.url,
        dest,
        allowed_hosts=MODEL_HOSTS,
        max_bytes=mf.max_bytes,
        sha256=mf.sha256,
        total_timeout_s=1800,
    )
    return dest
