"""QA loop, --only-scenes, resume, report.json, cost ledger, secret hygiene (offline)."""

from __future__ import annotations

import hashlib
import json
import shutil
from pathlib import Path

import fake_adapters
import pytest

from stickforge.config import load_config
from stickforge.core.cost import CostLedger
from stickforge.pipeline.orchestrator import render
from stickforge.providers.registry import discover
from stickforge.schema import ProjectError

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed"),
]

SECRET = "AIzaSy-m4-secret-value-0123456789abcdef"
CONFIG = """
retry: {max_attempts: 2, base_delay_s: 0.0, max_delay_s: 0.0}
qa: {max_retries: 2}
providers:
  fake_img: {adapter: test_fake_image, cost: {per_image_usd: 0.01}}
  fake_qa: {adapter: test_fake_qa, api_key_env: SF_M4_KEY}
modes:
  draft:
    camera_oversample: 1
    chains: {tts: [tone], image: [fake_img, placeholder], vision_qa: [fake_qa],
             align: [scene_level]}
"""


@pytest.fixture
def project(tmp_path: Path, monkeypatch) -> Path:
    discover.cache_clear()  # pick up the test adapters
    root = tmp_path / "p"
    root.mkdir()
    (root / "project.yaml").write_text(
        "title: M4\nstyle: {palette: ['#FFFFFF', '#000000']}\n"
        "output: {filename: m4.mp4, transition: crossfade, crossfade_s: 0.2}\n"
    )
    scenes = [
        {"id": i, "narration": "a few words here", "visual": f"visual {i}", "camera": "static"}
        for i in (1, 2, 3)
    ]
    (root / "scenes.json").write_text(json.dumps(scenes))
    (root / "config.yaml").write_text(CONFIG)
    monkeypatch.chdir(root)
    monkeypatch.setenv("SF_M4_KEY", SECRET)
    fake_adapters.QA_SCRIPT.clear()
    fake_adapters.QA_CALLS.clear()
    fake_adapters.FAIL_IMAGE_SCENES.clear()
    yield root
    discover.cache_clear()


def _sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def _report(root: Path) -> dict:
    return json.loads((root / "renders" / "draft" / "report.json").read_text())


def test_cost_ledger():
    led = CostLedger()
    led.record("image", 1, "gemini", "m", 0.04, attempts=2)
    led.record("image", 2, "fal", "f", 0.003)
    led.record("qa", 1, "gemini_qa", "q", 0.001, ok=False)
    assert led.total_usd == 0.044 and led.calls() == 4
    assert led.by("provider") == {"gemini": 0.04, "fal": 0.003, "gemini_qa": 0.001}


async def test_qa_loop_retries_then_flags_and_replays_from_cache(project: Path):
    fake_adapters.QA_SCRIPT.update({"visual 2": [False, True], "visual 3": [False]})
    res = await render(project, load_config(), mode="draft", qa=True)
    rep = _report(project)
    by_id = {s["id"]: s for s in rep["scenes"]}
    assert by_id[1]["qa"] == {"status": "passed", "attempts": 1, "issues": []}
    assert by_id[2]["qa"]["status"] == "passed" and by_id[2]["seed_attempt"] == 1
    assert by_id[3]["status"] == "qa_flagged" and by_id[3]["qa"]["attempts"] == 3
    assert by_id[3]["qa"]["issues"][0]["code"] == "anatomy"
    assert rep["summary"] == {"scenes": 3, "fallback": 0, "qa_flagged": 1, "qa_passed": 2}
    assert len(fake_adapters.QA_CALLS) == 1 + 2 + 3
    # images: 3 initial + 1 re-roll (scene 2) + 2 re-rolls (scene 3) at $0.01; QA 6 x $0.001
    assert rep["cost"]["by_stage"] == {"tts": 0.0, "image": 0.06, "qa": 0.006}
    assert res.cost_usd == pytest.approx(0.066)
    assert any("scene 3: QA still failing" in w for w in rep["warnings"])
    costs = (project / "renders" / "draft" / "costs.jsonl").read_text().splitlines()
    assert len(costs) == 3 + 6 + 6  # every call is in the ledger, free ones too

    # Rerun: every QA verdict and every re-rolled image is cached -> no calls, no spend.
    fake_adapters.QA_CALLS.clear()
    again = await render(project, load_config(), mode="draft", qa=True)
    assert fake_adapters.QA_CALLS == [] and again.cost_usd == 0.0
    assert {s["id"]: s["seed_attempt"] for s in _report(project)["scenes"]} == {1: 0, 2: 1, 3: 0}


async def test_only_scenes_regenerates_just_those_and_updates_output(project: Path):
    cfg = load_config()
    first = await render(project, cfg, mode="draft", qa=False)
    before = _sha(first.output)
    # Same inputs, but the provider is non-deterministic: forcing scene 2 must produce a
    # new image AND a new final video (downstream keys are content-addressed).
    res = await render(project, cfg, mode="draft", qa=False, only_scenes={2})
    # Scene 3 re-renders too: its crossfade starts from scene 2's (new) final frame.
    assert res.cache_hits == {"tts": 2, "image": 2, "segment": 1, "scene_audio": 2}
    assert _sha(res.output) != before
    assert _report(project)["only_scenes"] == [2]
    # Plain rerun afterwards keeps the regenerated scene (no flip-flop).
    after = await render(project, cfg, mode="draft", qa=False)
    assert _sha(after.output) == _sha(res.output)
    with pytest.raises(ProjectError, match="unknown scene ids"):
        await render(project, cfg, mode="draft", only_scenes={99})


async def test_crash_writes_report_and_rerun_resumes(project: Path):
    cfg = load_config()
    fake_adapters.FAIL_IMAGE_SCENES.add(3)
    with pytest.raises(RuntimeError, match="simulated crash"):
        await render(project, cfg, mode="draft", qa=False)
    rep = _report(project)
    assert rep["status"] == "failed" and "simulated crash" in rep["error"]
    fake_adapters.FAIL_IMAGE_SCENES.clear()
    res = await render(project, cfg, mode="draft", qa=False)
    assert res.cache_hits["tts"] == 3  # voice from the crashed run is reused
    assert res.output.is_file() and _report(project)["status"] == "ok"


async def test_no_secret_anywhere_in_outputs(project: Path):
    fake_adapters.QA_SCRIPT.update({"visual 1": [False, True]})
    await render(project, load_config(), mode="draft", qa=True)
    leaked = [
        p
        for p in project.rglob("*")
        if p.is_file()
        and p.suffix in {".json", ".jsonl", ".srt", ".txt", ".yaml"}
        and SECRET in p.read_text("utf-8")
    ]
    assert leaked == []
    rep = _report(project)
    assert {lic["component"] for lic in rep["licenses"]} >= {"tts", "image", "font"}
    assert rep["output"]["loudness_lufs"] == pytest.approx(-14.0, abs=1.0)
