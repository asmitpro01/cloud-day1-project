"""Engine configuration: config.yaml (deep-merged over packaged defaults) + .env secrets."""

from __future__ import annotations

import os
from importlib import resources
from pathlib import Path
from typing import Any

import yaml
from dotenv import load_dotenv
from pydantic import BaseModel, ConfigDict, Field, model_validator

from stickforge.core.security import REDACTOR


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class ProviderConfig(_Strict):
    adapter: str
    model: str | None = None
    endpoint: str | None = None
    api_key_env: str | None = None  # NAME of the env var, never the value
    max_concurrency: int | None = Field(default=None, ge=1, le=64)
    requests_per_minute: float | None = Field(default=None, gt=0)
    timeout_s: float = Field(default=120.0, gt=0, le=3600)
    cost: dict[str, float] = Field(default_factory=dict)  # e.g. {"per_image_usd": 0.04}
    license_note: str | None = None
    settings: dict[str, Any] = Field(default_factory=dict)


class Chains(_Strict):
    tts: list[str] = Field(min_length=1)
    image: list[str] = Field(min_length=1)
    vision_qa: list[str] = Field(default_factory=list)
    align: list[str] = Field(default_factory=list)


class ModeConfig(_Strict):
    width: int = Field(ge=320, le=3840)
    height: int = Field(ge=180, le=2160)
    fps: int = Field(default=30, ge=1, le=60)
    x264_preset: str = Field(default="medium", pattern=r"^[a-z]+$")
    crf: int = Field(default=20, ge=0, le=51)
    qa: bool = False
    camera_oversample: int | None = Field(default=None, ge=1, le=8)  # overrides render.camera
    chains: Chains

    @model_validator(mode="after")
    def _even_dims(self) -> ModeConfig:
        if self.width % 2 or self.height % 2:
            raise ValueError("width and height must be even (yuv420p)")
        if self.width * 9 != self.height * 16:
            raise ValueError("resolution must be 16:9")
        return self


class CameraConfig(_Strict):
    zoom_amount: float = Field(default=0.12, ge=0.0, le=0.5)
    pan_zoom: float = Field(default=1.12, ge=1.02, le=1.5)
    oversample: int = Field(default=4, ge=1, le=8)


class RenderConfig(_Strict):
    camera: CameraConfig = CameraConfig()
    title_fade_in_s: float = Field(default=0.35, ge=0.0, le=3.0)
    title_delay_s: float = Field(default=0.25, ge=0.0, le=5.0)
    encoder: str = Field(default="auto", pattern=r"^[a-z0-9_]+$")
    max_parallel: int = Field(default=0, ge=0, le=64)
    ffmpeg_path: str = "ffmpeg"
    ffprobe_path: str = "ffprobe"
    timeout_base_s: float = Field(default=60.0, gt=0)
    timeout_per_media_s: float = Field(default=10.0, gt=0)

    def parallelism(self) -> int:
        return self.max_parallel or max(1, (os.cpu_count() or 2) // 2)


class AudioConfig(_Strict):
    sample_rate: int = 48000
    aac_bitrate: str = Field(default="192k", pattern=r"^[0-9]{2,3}k$")
    fade_ms: int = Field(default=8, ge=0, le=100)
    loudness_i: float = Field(default=-14.0, ge=-40.0, le=-5.0)  # LUFS (YouTube reference)
    true_peak: float = Field(default=-1.0, ge=-9.0, le=0.0)  # dBTP ceiling of the final file
    codec_headroom_db: float = Field(default=1.0, ge=0.0, le=3.0)  # AAC overshoot allowance
    lra: float = Field(default=11.0, ge=1.0, le=20.0)
    sfx_volume_db: float = Field(default=-6.0, ge=-40.0, le=6.0)
    duck_threshold: float = Field(default=0.02, gt=0.0, le=1.0)
    duck_ratio: float = Field(default=8.0, ge=1.0, le=20.0)
    duck_attack_ms: float = Field(default=20.0, ge=0.01, le=2000.0)
    duck_release_ms: float = Field(default=400.0, ge=0.01, le=9000.0)
    music_fade_in_s: float = Field(default=1.0, ge=0.0, le=10.0)
    music_fade_out_s: float = Field(default=2.5, ge=0.0, le=10.0)


class RetryConfig(_Strict):
    max_attempts: int = Field(default=4, ge=1, le=10)
    base_delay_s: float = Field(default=1.0, ge=0.0, le=60.0)
    max_delay_s: float = Field(default=30.0, ge=0.0, le=600.0)


class ModelFile(_Strict):
    """A downloadable local model file, pinned by sha256."""

    url: str = Field(pattern=r"^https://")
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    file: str = Field(pattern=r"^[A-Za-z0-9._/-]+$")  # relative to models_dir
    max_bytes: int = Field(default=1_000_000_000, gt=0)
    license_note: str = ""


class QAConfig(_Strict):
    max_retries: int = Field(default=2, ge=0, le=10)  # re-rolls per scene before flagging


class EngineConfig(_Strict):
    seed: int = 1234
    qa: QAConfig = QAConfig()
    models_dir: str = ""  # "" = per-user default; env STICKFORGE_MODELS_DIR overrides
    retry: RetryConfig = RetryConfig()
    models: dict[str, ModelFile] = Field(default_factory=dict)
    cache_dir: str = ".cache"
    output_dir: str = "renders"
    providers: dict[str, ProviderConfig]
    modes: dict[str, ModeConfig]
    render: RenderConfig = RenderConfig()
    audio: AudioConfig = AudioConfig()

    @model_validator(mode="after")
    def _chains_reference_providers(self) -> EngineConfig:
        for mode_name, mode in self.modes.items():
            for cap, names in mode.chains.model_dump().items():
                for n in names:
                    if n not in self.providers:
                        raise ValueError(f"modes.{mode_name}.chains.{cap}: unknown provider {n!r}")
        for required in ("draft", "final"):
            if required not in self.modes:
                raise ValueError(f"modes.{required} is required")
        return self

    def models_path(self) -> Path:
        env = os.environ.get("STICKFORGE_MODELS_DIR")
        if env:
            return Path(env).expanduser()
        if self.models_dir:
            return Path(self.models_dir).expanduser()
        if os.name == "nt":
            base = Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local")
            return base / "stickforge" / "models"
        return Path.home() / ".cache" / "stickforge" / "models"

    def secret_for(self, provider_name: str) -> str | None:
        """Resolve a provider's key from the environment. Never logged or stored."""
        env = self.providers[provider_name].api_key_env
        if not env:
            return None
        return os.environ.get(env) or None

    def __repr_args__(self) -> Any:  # keep reprs short; there are no secrets in here anyway
        return [("providers", list(self.providers)), ("modes", list(self.modes))]


def _deep_merge(base: dict[str, Any], over: dict[str, Any]) -> dict[str, Any]:
    out = dict(base)
    for k, v in over.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = v
    return out


def _read_yaml(path: Path) -> dict[str, Any]:
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    if not isinstance(data, dict):
        raise ValueError(f"{path}: top level must be a mapping")
    return data


def find_config_file(explicit: Path | None = None) -> Path | None:
    if explicit is not None:
        return explicit
    env = os.environ.get("STICKFORGE_CONFIG")
    if env:
        return Path(env)
    local = Path.cwd() / "config.yaml"
    return local if local.is_file() else None


def load_config(explicit: Path | None = None, *, env_file: Path | None = None) -> EngineConfig:
    load_dotenv(env_file or Path.cwd() / ".env", override=False)
    default_text = resources.files("stickforge").joinpath("default_config.yaml").read_text("utf-8")
    data: dict[str, Any] = yaml.safe_load(default_text)
    path = find_config_file(explicit)
    if path is not None:
        data = _deep_merge(data, _read_yaml(path))
    cfg = EngineConfig.model_validate(data)
    # Register every configured secret value so logs can never contain it.
    REDACTOR.add_secrets(s for n in cfg.providers if (s := cfg.secret_for(n)))
    return cfg
