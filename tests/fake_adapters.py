"""Test-only adapters. Importing this module registers them."""

from __future__ import annotations

import itertools
import random
from pathlib import Path
from typing import Any, ClassVar

from PIL import Image

from stickforge.providers.base import (
    Adapter,
    Aspect,
    ImageResult,
    Kind,
    QAIssue,
    QAResult,
)

_counter = itertools.count()
FAIL_IMAGE_SCENES: set[int] = set()  # scenes whose "visual" contains these ids crash
QA_SCRIPT: dict[str, list[bool]] = {}  # visual -> verdicts in order of checks
QA_CALLS: list[str] = []


class FakeImage(Adapter):
    """Non-stub, non-deterministic image provider (a fresh random colour every call)."""

    adapter_name: ClassVar[str] = "test_fake_image"
    kind: ClassVar[Kind] = Kind.IMAGE
    capabilities: ClassVar[frozenset[str]] = frozenset({"seed"})
    license_note: ClassVar[str] = "test"

    async def generate(
        self,
        prompt: str,
        refs: list[Path],
        aspect: Aspect,
        seed: int,
        settings: dict[str, Any],
        *,
        out_path: Path,
    ) -> ImageResult:
        for sid in FAIL_IMAGE_SCENES:
            if f"visual {sid}" in prompt:
                raise RuntimeError(f"simulated crash in scene {sid}")
        rng = random.Random(next(_counter) * 7919 + seed)
        color = tuple(rng.randrange(256) for _ in range(3))
        Image.new("RGB", (640, 360), color).save(out_path, format="PNG")
        return ImageResult(
            path=out_path,
            provider=self.name,
            model="fake",
            width=640,
            height=360,
            seed=seed,
            cost_usd=0.01,
        )


class FakeQA(Adapter):
    adapter_name: ClassVar[str] = "test_fake_qa"
    kind: ClassVar[Kind] = Kind.VISION_QA
    license_note: ClassVar[str] = "test"

    async def check(self, image: Path, scene: Any, style_rules: Any) -> QAResult:
        QA_CALLS.append(scene.visual)
        script = QA_SCRIPT.get(scene.visual, [True])
        verdict = script.pop(0) if len(script) > 1 else script[0]
        issues = [] if verdict else [QAIssue(code="anatomy", detail="extra arm")]
        return QAResult(passed=verdict, issues=issues, provider=self.name, cost_usd=0.001)
