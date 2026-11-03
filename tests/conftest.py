from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest

SAMPLE = Path(__file__).resolve().parent.parent / "examples" / "sample_project"


@pytest.fixture
def sample_project(tmp_path: Path) -> Path:
    dst = tmp_path / "proj"
    shutil.copytree(SAMPLE, dst, ignore=shutil.ignore_patterns(".cache", "renders"))
    return dst


@pytest.fixture
def make_project(tmp_path: Path):
    def _make(project: dict | str, scenes: list | str) -> Path:
        import yaml

        root = tmp_path / "p"
        root.mkdir(exist_ok=True)
        (root / "project.yaml").write_text(
            project if isinstance(project, str) else yaml.safe_dump(project), encoding="utf-8"
        )
        (root / "scenes.json").write_text(
            scenes if isinstance(scenes, str) else json.dumps(scenes), encoding="utf-8"
        )
        return root

    return _make


BASE_PROJECT = {
    "title": "t",
    "style": {"palette": ["#FFFFFF", "#000000"]},
    "cast": [{"name": "Max", "description": "stickman"}],
}


def scene(i: int, **kw) -> dict:
    return {"id": i, "narration": "hello world", "visual": "a hill", **kw}
