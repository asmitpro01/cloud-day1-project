"""Offline end-to-end render of the sample project (silent TTS + placeholder images)."""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from stickforge.config import load_config
from stickforge.pipeline.orchestrator import render

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed"),
]


def _probe(p: Path) -> dict:
    out = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            str(p),
        ],
        capture_output=True,
        check=True,
        timeout=60,
    )
    return json.loads(out.stdout)


async def test_sample_renders_offline_and_caches(sample_project: Path, monkeypatch):
    monkeypatch.chdir(sample_project)
    cfg = load_config()
    res = await render(sample_project, cfg, mode="draft")
    assert res.output.is_file()
    assert res.duration_s < 30
    probe = _probe(res.output)
    v = next(s for s in probe["streams"] if s["codec_type"] == "video")
    a = next(s for s in probe["streams"] if s["codec_type"] == "audio")
    assert (v["width"], v["height"], v["avg_frame_rate"], v["pix_fmt"]) == (
        1280,
        720,
        "30/1",
        "yuv420p",
    )
    assert (a["codec_name"], a["sample_rate"], a["channels"]) == ("aac", "48000", 2)
    assert abs(float(probe["format"]["duration"]) - res.duration_s) <= 0.2
    # faststart: moov before mdat
    head = res.output.read_bytes()[:4096]
    assert head.find(b"moov") != -1 and head.find(b"moov") < max(head.find(b"mdat"), 4096)

    # Rerun: everything from cache.
    again = await render(sample_project, cfg, mode="draft")
    assert again.cache_hits == {"tts": 3, "image": 3, "segment": 3}

    # Change one scene's narration: only that scene regenerates.
    scenes_file = sample_project / "scenes.json"
    scenes = json.loads(scenes_file.read_text())
    scenes[1]["narration"] += " Isn't that neat?"
    scenes_file.write_text(json.dumps(scenes))
    changed = await render(sample_project, cfg, mode="draft")
    assert changed.cache_hits == {"tts": 2, "image": 3, "segment": 2}
