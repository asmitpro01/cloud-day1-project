"""Provider interfaces.

Every external capability is a Protocol here. Adapters subclass ``Adapter`` (which
auto-registers them by ``adapter_name``) and implement one Protocol. Nothing outside
``stickforge/providers/<kind>/`` and config may name a concrete provider.

Adapters always write their output to an ``out_path`` chosen by the pipeline (a temp
file inside the cache), so the cache controls naming, atomicity and reuse.
"""

from __future__ import annotations

from enum import StrEnum
from pathlib import Path
from typing import TYPE_CHECKING, Any, ClassVar, Protocol, runtime_checkable

from pydantic import BaseModel, ConfigDict, Field

if TYPE_CHECKING:
    from stickforge.config import ProviderConfig
    from stickforge.schema import Scene, Style


class Kind(StrEnum):
    TTS = "tts"
    IMAGE = "image"
    LLM = "llm"
    VISION_QA = "vision_qa"
    ALIGN = "align"
    VIDEO = "video"


class ProviderError(Exception):
    """Base for provider failures. ``retryable`` drives retry/fallback policy."""

    retryable: bool = False

    def __init__(self, message: str, *, retryable: bool | None = None) -> None:
        super().__init__(message)
        if retryable is not None:
            self.retryable = retryable


class TransientProviderError(ProviderError):
    """429 / 5xx / timeout: retry with backoff, then fall back."""

    retryable = True


class PermanentProviderError(ProviderError):
    """Auth / validation / content errors: never retried, go straight to fallback."""

    retryable = False


class _Result(BaseModel):
    model_config = ConfigDict(frozen=True)

    path: Path
    provider: str  # configured instance name, e.g. "gemini"
    model: str | None = None
    cost_usd: float = 0.0
    meta: dict[str, Any] = Field(default_factory=dict)


class WordTiming(BaseModel):
    model_config = ConfigDict(frozen=True)

    word: str
    start_s: float
    end_s: float


class AudioResult(_Result):
    duration_s: float
    # Filled by TTS providers that return timestamps (e.g. a "with timestamps"
    # endpoint). An Aligner may then use these instead of running ASR.
    word_timings: list[WordTiming] | None = None


class ImageResult(_Result):
    width: int
    height: int
    seed: int | None = None


class QAIssue(BaseModel):
    model_config = ConfigDict(frozen=True)

    code: str  # e.g. "text_in_image", "anatomy", "off_palette", "missing_character"
    detail: str


class QAResult(BaseModel):
    model_config = ConfigDict(frozen=True)

    passed: bool
    issues: list[QAIssue] = Field(default_factory=list)
    provider: str
    cost_usd: float = 0.0


class LLMResult(BaseModel):
    model_config = ConfigDict(frozen=True)

    text: str
    provider: str
    model: str | None = None
    cost_usd: float = 0.0


class Aspect(StrEnum):
    LANDSCAPE_16_9 = "16:9"


# ---------------------------------------------------------------------------
# Protocols — what the pipeline depends on.
# ---------------------------------------------------------------------------


@runtime_checkable
class TTSProvider(Protocol):
    async def synthesize(
        self, text: str, voice: str, settings: dict[str, Any], *, out_path: Path
    ) -> AudioResult: ...


@runtime_checkable
class ImageProvider(Protocol):
    async def generate(
        self,
        prompt: str,
        refs: list[Path],
        aspect: Aspect,
        seed: int,
        settings: dict[str, Any],
        *,
        out_path: Path,
    ) -> ImageResult: ...


@runtime_checkable
class VisionQAProvider(Protocol):
    async def check(self, image: Path, scene: Scene, style_rules: Style) -> QAResult: ...


@runtime_checkable
class LLMProvider(Protocol):
    async def complete(
        self, messages: list[dict[str, Any]], settings: dict[str, Any]
    ) -> LLMResult: ...


@runtime_checkable
class Aligner(Protocol):
    """Word-level timing for one scene's narration.

    Receives the full ``AudioResult`` (not just a path) so an aligner can reuse
    timestamps the TTS provider already returned instead of running ASR.
    """

    async def align(self, audio: AudioResult, text: str) -> list[WordTiming]: ...


@runtime_checkable
class VideoProvider(Protocol):
    """Stub only — video-model generation is out of scope for this build."""

    async def generate(
        self, prompt: str, image: Path | None, duration_s: float, *, out_path: Path
    ) -> _Result: ...


# ---------------------------------------------------------------------------
# Adapter base — metadata + auto-registration.
# ---------------------------------------------------------------------------


class Adapter:
    """Base class for all adapters.

    Subclasses set the ClassVars below; setting ``adapter_name`` registers the class.
    Constructor receives the validated config entry and the resolved secret (if any).
    """

    adapter_name: ClassVar[str] = ""
    kind: ClassVar[Kind]
    capabilities: ClassVar[frozenset[str]] = frozenset()  # e.g. {"refs", "seed"}
    requires_key: ClassVar[bool] = False
    optional_dependency: ClassVar[str | None] = None  # import name, if any
    default_max_concurrency: ClassVar[int] = 4
    default_requests_per_minute: ClassVar[float | None] = None
    cost_model: ClassVar[str] = "free"  # human-readable; numbers live in config
    license_note: ClassVar[str] = ""

    _registry: ClassVar[dict[str, type[Adapter]]] = {}

    def __init_subclass__(cls, **kwargs: Any) -> None:
        super().__init_subclass__(**kwargs)
        if cls.adapter_name:
            existing = Adapter._registry.get(cls.adapter_name)
            if existing is not None and existing is not cls:
                raise RuntimeError(f"duplicate adapter name {cls.adapter_name!r}")
            Adapter._registry[cls.adapter_name] = cls

    def __init__(self, name: str, config: ProviderConfig, api_key: str | None = None) -> None:
        self.name = name
        self.config = config
        self._api_key = api_key

    @property
    def model(self) -> str | None:
        return self.config.model

    @classmethod
    def dependency_available(cls) -> bool:
        if cls.optional_dependency is None:
            return True
        import importlib.util

        return importlib.util.find_spec(cls.optional_dependency) is not None

    def __repr__(self) -> str:  # never include the key
        return f"<{type(self).__name__} name={self.name!r} model={self.model!r}>"
