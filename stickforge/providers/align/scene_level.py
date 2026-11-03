"""Fallback aligner: spreads words over the clip, weighted by length and punctuation.

No model, no network. Good enough for readable sentence-sized caption cues.
"""

from __future__ import annotations

from typing import ClassVar

from stickforge.providers.base import Adapter, AudioResult, Kind, WordTiming

LEAD_S = 0.05


def _weight(word: str) -> float:
    w = len(word) + 1.0
    if word.endswith((".", "!", "?")):
        w += 4.0  # sentence pause
    elif word.endswith((",", ";", ":")):
        w += 2.0
    return w


def estimate_words(text: str, duration_s: float) -> list[WordTiming]:
    words = text.split()
    if not words or duration_s <= 0:
        return []
    span = max(0.0, duration_s - LEAD_S)
    weights = [_weight(w) for w in words]
    total = sum(weights)
    out, t = [], LEAD_S
    for word, w in zip(words, weights, strict=True):
        d = span * w / total
        out.append(WordTiming(word=word, start_s=round(t, 3), end_s=round(t + d, 3)))
        t += d
    return out


class SceneLevelAligner(Adapter):
    adapter_name: ClassVar[str] = "scene_level"
    kind: ClassVar[Kind] = Kind.ALIGN
    capabilities: ClassVar[frozenset[str]] = frozenset({"estimate"})
    default_max_concurrency: ClassVar[int] = 64
    license_note: ClassVar[str] = "stickforge (MIT)"

    async def align(self, audio: AudioResult, text: str) -> list[WordTiming]:
        return estimate_words(text, audio.duration_s)
