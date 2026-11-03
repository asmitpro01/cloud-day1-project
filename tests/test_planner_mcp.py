"""Script -> project planner and the MCP service layer."""

from __future__ import annotations

import asyncio
import importlib.util
import json
import shutil
from pathlib import Path
from typing import Any, ClassVar

import pytest
from conftest import OFFLINE_CONFIG

from stickforge.config import load_config
from stickforge.lint import lint_scenes
from stickforge.mcp_server import StickforgeService, ToolError
from stickforge.planner import (
    PlanError,
    parse_llm_plan,
    plan_script,
    rule_based_scenes,
    split_script,
    write_project,
)
from stickforge.providers.base import Adapter, Kind, LLMResult
from stickforge.schema import load_project

SCRIPT = (
    "Plants make their own food. They use sunlight, water and carbon dioxide. "
    "Inside each leaf, chlorophyll captures light energy.\n\n"
    "That energy splits water molecules apart. Oxygen escapes into the air, "
    "and the plant keeps the hydrogen to build sugar."
)
LLM_REPLY: list[str] = []


class FakeLLM(Adapter):
    adapter_name: ClassVar[str] = "test_fake_llm"
    kind: ClassVar[Kind] = Kind.LLM
    license_note: ClassVar[str] = "test"

    async def complete(self, messages: list[dict[str, Any]], settings: dict[str, Any]) -> LLMResult:
        return LLMResult(text=LLM_REPLY[0], provider=self.name, cost_usd=0.002)


def _config(tmp_path: Path, extra: str = "") -> Any:
    p = tmp_path / "config.yaml"
    p.write_text(OFFLINE_CONFIG + extra, encoding="utf-8")
    return load_config(p)


LLM_CONFIG = """
providers:
  fake_llm: {adapter: test_fake_llm}
planner: {chain: [fake_llm]}
"""


# -- splitting / rule-based plan -------------------------------------------------


def test_split_keeps_every_word_and_respects_limits():
    chunks = split_script(SCRIPT, 12)
    assert " ".join(chunks).split() == SCRIPT.split()
    assert all(len(c.split()) <= 12 for c in chunks)
    # the paragraph break starts a new chunk
    assert any(c.startswith("That energy") for c in chunks)


def test_split_wraps_a_very_long_sentence():
    long = " ".join(f"w{i}," for i in range(90)) + " end."
    chunks = split_script(long, 20)
    assert all(len(c.split()) <= 20 for c in chunks)
    assert " ".join(chunks).split() == long.split()


def test_rule_based_plan_is_lint_clean():
    chunks = [f"Sentence number {i} explains a thing." for i in range(25)]
    scenes = rule_based_scenes(chunks, "Max", "A title")
    assert lint_scenes(scenes) == []
    assert scenes[0].on_screen_text == "A title"


# -- LLM plan parsing ------------------------------------------------------------


def _llm_doc(narrations: list[str], **over: Any) -> str:
    scenes = [
        {
            "narration": n,
            "visual": "Max points at a leaf",
            "characters": ["Max", "Stranger"],
            "shot": "medium",
            "camera": "static",
            "on_screen_text": "",
            **over,
        }
        for n in narrations
    ]
    return "Sure!\n" + json.dumps({"title": "Photosynthesis", "scenes": scenes})


def test_parse_llm_plan_filters_unknown_cast():
    chunks = split_script(SCRIPT, 20)
    title, scenes = parse_llm_plan(_llm_doc(chunks), {"Max"}, len(SCRIPT.split()))
    assert title == "Photosynthesis"
    assert [s.id for s in scenes] == list(range(1, len(chunks) + 1))
    assert all(s.characters == ["Max"] for s in scenes)


def test_parse_llm_plan_rejects_dropped_content():
    with pytest.raises(PlanError, match="kept"):
        parse_llm_plan(_llm_doc(["Plants make food."]), {"Max"}, len(SCRIPT.split()))


def test_parse_llm_plan_rejects_bad_enum():
    with pytest.raises(PlanError, match="scene #1"):
        parse_llm_plan(_llm_doc([SCRIPT], shot="drone"), {"Max"}, len(SCRIPT.split()))


# -- plan_script -----------------------------------------------------------------


def test_plan_without_llm_uses_rules(tmp_path: Path):
    res = asyncio.run(plan_script(SCRIPT, _config(tmp_path), use_llm=False))
    assert res.source == "rules"
    assert res.title == "Plants make their own food"


def test_plan_falls_back_when_llm_unready(tmp_path: Path):
    # default planner chain is gemini_llm, which has no key in tests
    cfg = _config(tmp_path, "planner: {chain: [gemini_llm]}\n")
    res = asyncio.run(plan_script(SCRIPT, cfg))
    assert res.source == "rules"
    assert any("no LLM available" in n for n in res.notes)


def test_plan_uses_llm_when_good(tmp_path: Path):
    LLM_REPLY[:] = [_llm_doc(split_script(SCRIPT, 20))]
    res = asyncio.run(plan_script(SCRIPT, _config(tmp_path, LLM_CONFIG)))
    assert res.source == "llm:fake_llm"
    assert res.title == "Photosynthesis"
    assert res.cost_usd == pytest.approx(0.002)


def test_plan_falls_back_on_bad_llm_reply(tmp_path: Path):
    LLM_REPLY[:] = ["I cannot help with that."]
    res = asyncio.run(plan_script(SCRIPT, _config(tmp_path, LLM_CONFIG)))
    assert res.source == "rules"
    assert any("unusable" in n for n in res.notes)


def test_plan_limits(tmp_path: Path):
    cfg = _config(tmp_path)
    with pytest.raises(PlanError, match="empty"):
        asyncio.run(plan_script("   ", cfg, use_llm=False))
    with pytest.raises(PlanError, match="characters"):
        asyncio.run(plan_script("word " * 20_000, cfg, use_llm=False))


def test_write_project_is_valid_and_guarded(tmp_path: Path):
    res = asyncio.run(plan_script(SCRIPT, _config(tmp_path), use_llm=False))
    dest = write_project(tmp_path / "proj", res)
    loaded = load_project(dest)
    assert len(loaded.scenes) == len(res.scenes)
    with pytest.raises(PlanError, match="already has a project"):
        write_project(dest, res)
    write_project(dest, res, overwrite=True)


# -- MCP service -----------------------------------------------------------------


def test_service_rejects_paths(tmp_path: Path):
    svc = StickforgeService(tmp_path / "ws", _config(tmp_path))
    for bad in ("../x", "a/b", "", "/abs", ".hidden", "C:x"):
        with pytest.raises(ToolError):
            asyncio.run(svc.create_project(bad, SCRIPT, use_llm=False))


def test_service_create_edit_and_list(tmp_path: Path):
    svc = StickforgeService(tmp_path / "ws", _config(tmp_path))

    async def go() -> None:
        made = await svc.create_project("photo", SCRIPT, use_llm=False)
        assert made["planner"] == "rules" and made["scenes"] >= 1
        assert [p["name"] for p in await svc.list_projects()] == ["photo"]
        upd = await svc.update_scene("photo", 1, on_screen_text="Photosynthesis")
        assert upd["scene"]["on_screen_text"] == "Photosynthesis"
        before = (tmp_path / "ws" / "photo" / "scenes.json").read_text()
        with pytest.raises(ToolError, match="rejected"):
            await svc.update_scene("photo", 1, shot="drone")
        assert (tmp_path / "ws" / "photo" / "scenes.json").read_text() == before
        with pytest.raises(ToolError, match="no scene"):
            await svc.update_scene("photo", 99, visual="x")
        with pytest.raises(ToolError, match="no report"):
            await svc.get_report("photo")
        names = {p["name"] for p in await svc.providers()}
        assert {"placeholder", "tone"} <= names

    asyncio.run(go())


@pytest.mark.integration
@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")
def test_service_script_to_video_renders(tmp_path: Path):
    svc = StickforgeService(tmp_path / "ws", _config(tmp_path))

    async def go() -> dict[str, Any]:
        started = await svc.script_to_video("photo", SCRIPT, use_llm=False)
        job_id = started["job"]["job_id"]
        for _ in range(20):
            st = await svc.job_status(job_id, wait_s=30)
            if st["status"] in ("done", "failed"):
                return st
        raise AssertionError("render did not finish")

    st = asyncio.run(go())
    assert st["status"] == "done", st["error"]
    res = st["result"]
    assert Path(res["video"]).is_file()
    assert Path(res["srt"]).is_file() and Path(res["vtt"]).is_file()
    assert Path(res["vtt"]).read_text(encoding="utf-8").startswith("WEBVTT\n")
    assert st["stages"]["images"]["done"] == st["stages"]["images"]["total"]
    report = asyncio.run(svc.get_report("photo"))
    assert report["mode"] == "draft"


@pytest.mark.skipif(importlib.util.find_spec("mcp") is None, reason="mcp extra not installed")
def test_mcp_server_registers_tools(tmp_path: Path):
    from stickforge.mcp_server import build_server

    server = build_server(StickforgeService(tmp_path / "ws", _config(tmp_path)))
    tools = {t.name for t in asyncio.run(server.list_tools())}
    assert tools == {
        "list_projects",
        "create_project",
        "get_project",
        "update_scene",
        "render",
        "script_to_video",
        "job_status",
        "get_report",
        "providers",
    }
