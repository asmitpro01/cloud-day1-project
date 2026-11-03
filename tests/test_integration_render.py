"""Offline end-to-end render of the sample project (silent TTS + placeholder images)."""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import httpx
import pytest
import respx
from adapter_helpers import b64png

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
    assert again.cache_hits == {"tts": 3, "image": 3, "segment": 3, "scene_audio": 3}

    # Change one scene's narration: only that scene regenerates.
    scenes_file = sample_project / "scenes.json"
    scenes = json.loads(scenes_file.read_text())
    scenes[1]["narration"] += " Isn't that neat?"
    scenes_file.write_text(json.dumps(scenes))
    changed = await render(sample_project, cfg, mode="draft")
    assert changed.cache_hits == {"tts": 2, "image": 3, "segment": 2, "scene_audio": 2}


GEMINI = "https://generativelanguage.googleapis.com/v1beta/models/gemini-test-image:generateContent"
FALLBACK_CONFIG = """
retry: {max_attempts: 2, base_delay_s: 0.0, max_delay_s: 0.0}
providers:
  gem: {adapter: gemini, model: gemini-test-image, api_key_env: SF_TEST_GEMINI_KEY,
        cost: {per_image_usd: 0.04}}
modes:
  draft: {chains: {tts: [silent], image: [gem, placeholder], vision_qa: []}}
"""


async def test_image_fallback_then_upgrade(sample_project: Path, monkeypatch):
    """Gemini down -> every scene falls back to placeholder; Gemini back -> scenes upgrade."""
    monkeypatch.chdir(sample_project)
    monkeypatch.setenv("SF_TEST_GEMINI_KEY", "AIzaSy-integration-test-key-000000000")
    (sample_project / "config.yaml").write_text(FALLBACK_CONFIG)
    cfg = load_config()
    with respx.mock(assert_all_called=False) as mock:
        route = mock.post(GEMINI).mock(return_value=httpx.Response(503, text="overloaded"))
        res = await render(sample_project, cfg, mode="draft")
        assert route.call_count == 3 * 2  # 3 scenes x max_attempts, then fallback
    assert res.output.is_file()
    log = (sample_project / "renders" / "draft" / "stickforge.log.jsonl").read_text()
    assert "image.provider_failed" in log and "AIzaSy-integration" not in log

    ok = {
        "candidates": [
            {
                "content": {
                    "parts": [
                        {
                            "inlineData": {
                                "mimeType": "image/png",
                                "data": b64png(1344, 768, "orange"),
                            }
                        }
                    ]
                }
            }
        ]
    }
    with respx.mock(assert_all_called=False) as mock:
        route = mock.post(GEMINI).mock(return_value=httpx.Response(200, json=ok))
        again = await render(sample_project, cfg, mode="draft")
        assert route.call_count == 3
    assert again.cache_hits["image"] == 0 and again.cache_hits["tts"] == 3
