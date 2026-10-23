"""Style lint: warnings only, never failures."""

from __future__ import annotations

from dataclasses import dataclass

from stickforge.schema import Camera, Scene

MAX_SAME_SHOT_RUN = 3
MAX_NARRATION_WORDS = 40


@dataclass(frozen=True)
class LintWarning:
    scene_id: int
    message: str

    def __str__(self) -> str:
        return f"scene {self.scene_id}: {self.message}"


def lint_scenes(scenes: list[Scene]) -> list[LintWarning]:
    out: list[LintWarning] = []
    run = 1
    for i, s in enumerate(scenes):
        if s.word_count > MAX_NARRATION_WORDS:
            out.append(
                LintWarning(s.id, f"narration has {s.word_count} words (> {MAX_NARRATION_WORDS})")
            )
        if i == 0:
            continue
        prev = scenes[i - 1]
        if s.camera == prev.camera and s.camera != Camera.STATIC:
            out.append(LintWarning(s.id, f"same camera move '{s.camera}' as previous scene"))
        run = run + 1 if s.shot == prev.shot else 1
        if run == MAX_SAME_SHOT_RUN + 1:  # warn once per run, at the 4th scene
            out.append(
                LintWarning(s.id, f"more than {MAX_SAME_SHOT_RUN} consecutive '{s.shot}' shots")
            )
    return out
