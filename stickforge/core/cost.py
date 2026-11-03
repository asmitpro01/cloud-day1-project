"""Per-call cost ledger: every provider call that ran this render, with its cost."""

from __future__ import annotations

import json
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path

from stickforge.core.cache import atomic_write_text


@dataclass(frozen=True)
class CostEntry:
    stage: str  # tts | image | qa | align | llm
    scene_id: int | None
    provider: str
    model: str | None
    cost_usd: float
    attempts: int = 1
    ok: bool = True
    ts: float = field(default_factory=time.time)


@dataclass
class CostLedger:
    entries: list[CostEntry] = field(default_factory=list)

    def record(
        self,
        stage: str,
        scene_id: int | None,
        provider: str,
        model: str | None,
        cost_usd: float,
        *,
        attempts: int = 1,
        ok: bool = True,
    ) -> None:
        self.entries.append(
            CostEntry(stage, scene_id, provider, model, float(cost_usd), attempts, ok)
        )

    @property
    def total_usd(self) -> float:
        return round(sum(e.cost_usd for e in self.entries), 6)

    def by(self, attr: str) -> dict[str, float]:
        out: dict[str, float] = {}
        for e in self.entries:
            k = str(getattr(e, attr))
            out[k] = round(out.get(k, 0.0) + e.cost_usd, 6)
        return out

    def calls(self) -> int:
        return sum(e.attempts for e in self.entries)

    def write_jsonl(self, path: Path) -> None:
        atomic_write_text(path, "".join(json.dumps(asdict(e)) + "\n" for e in self.entries))
