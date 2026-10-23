"""Offline end-to-end renders of the sample project (tone TTS + placeholder images)."""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import httpx
import pytest
import respx
import yaml
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


def _loudness(p: Path) -> tuple[float, float]:
    """(integrated LUFS, true peak dBTP) of a file, via ffmpeg's ebur128 meter."""
    err = subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-nostats",
            "-i",
            str(p),
            "-af",
            "ebur128=peak=true",
            "-f",
            "null",
            "-",
        ],
        capture_output=True,
        text=True,
        timeout=120,
    ).stderr
    summary = err[err.rindex("Summary:") :]
    i = float(re.search(r"I:\s+(-?[\d.]+) LUFS", summary).group(1))
    tp = float(re.search(r"Peak:\s+(-?[\d.]+) dBFS", summary).group(1))
    return i, tp


def _gen(args: list[str]) -> None:
    subprocess.run(["ffmpeg", "-v", "error", "-y", *args], check=True, timeout=60)


@pytest.fixture
def full_project(sample_project: Path) -> Path:
    """Sample project + generated music bed + SFX (media is never committed)."""
    (sample_project / "audio").mkdir()
    _gen(
        [
            "-f",
            "lavfi",
            "-i",
            "sine=f=220:d=6",
            "-f",
            "lavfi",
            "-i",
            "sine=f=330:d=6",
            "-filter_complex",
            "amix=inputs=2,volume=0.5",
            str(sample_project / "audio/bed.wav"),
        ]
    )
    _gen(["-f", "lavfi", "-i", "anoisesrc=d=0.4:a=0.3", str(sample_project / "audio/whoosh.wav")])
    proj = yaml.safe_load((sample_project / "project.yaml").read_text())
    proj["music"] = {"file": "audio/bed.wav", "volume_db": -20}
    (sample_project / "project.yaml").write_text(yaml.safe_dump(proj))
    scenes = json.loads((sample_project / "scenes.json").read_text())
    scenes[1]["sfx"] = "audio/whoosh.wav"
    (sample_project / "scenes.json").write_text(json.dumps(scenes))
    return sample_project


async def test_full_render_offline(full_project: Path, monkeypatch):
    monkeypatch.chdir(full_project)
    cfg = load_config()
    res = await render(full_project, cfg, mode="draft")
    assert res.output.is_file() and res.duration_s < 30
    probe = _probe(res.output)
    v = next(s for s in probe["streams"] if s["codec_type"] == "video")
    a = next(s for s in probe["streams"] if s["codec_type"] == "audio")
    assert (v["codec_name"], v["width"], v["height"], v["avg_frame_rate"], v["pix_fmt"]) == (
        "h264",
        1280,
        720,
        "30/1",
        "yuv420p",
    )
    assert (a["codec_name"], a["sample_rate"], a["channels"]) == ("aac", "48000", 2)
    assert abs(float(probe["format"]["duration"]) - res.duration_s) <= 0.2
    assert abs(float(v["duration"]) - float(a["duration"])) <= 0.05
    head = res.output.read_bytes()[:4096]
    assert b"moov" in head  # faststart

    integrated, peak = _loudness(res.output)
    assert abs(integrated - cfg.audio.loudness_i) <= 1.0, integrated
    assert peak <= cfg.audio.true_peak + 0.05, peak  # ceiling holds after AAC encoding

    srt = (full_project / "renders" / "draft" / "sample.srt").read_text()
    assert srt.startswith("1\n00:00:00,050 --> ") and "Rayleigh" not in srt
    assert srt.count(" --> ") >= 3

    again = await render(full_project, cfg, mode="draft")
    assert again.cache_hits == {"tts": 3, "image": 3, "segment": 3, "scene_audio": 3}

    # Change one scene's narration: its audio/segment regenerate; neighbours stay cached
    # (the next scene's crossfade source depends on image+camera+title, not narration).
    scenes_file = full_project / "scenes.json"
    scenes = json.loads(scenes_file.read_text())
    scenes[1]["narration"] += " Isn't that neat?"
    scenes_file.write_text(json.dumps(scenes))
    changed = await render(full_project, cfg, mode="draft")
    assert changed.cache_hits == {"tts": 2, "image": 3, "segment": 2, "scene_audio": 2}


GEMINI = "https://generativelanguage.googleapis.com/v1beta/models/gemini-test-image:generateContent"
FALLBACK_CONFIG = """
retry: {max_attempts: 2, base_delay_s: 0.0, max_delay_s: 0.0}
providers:
  gem: {adapter: gemini, model: gemini-test-image, api_key_env: SF_TEST_GEMINI_KEY,
        cost: {per_image_usd: 0.04}}
modes:
  draft: {chains: {tts: [silent], image: [gem, placeholder], vision_qa: [], align: [scene_level]}}
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


async def test_silent_voice_skips_loudnorm(sample_project: Path, monkeypatch):
    """All-silent narration (no music) must not break two-pass loudnorm."""
    monkeypatch.chdir(sample_project)
    (sample_project / "config.yaml").write_text(
        "modes: {draft: {chains: {tts: [silent], image: [placeholder], vision_qa: [], "
        "align: [scene_level]}}}\n"
    )
    res = await render(sample_project, load_config(), mode="draft")
    assert res.output.is_file()
    log = (sample_project / "renders" / "draft" / "stickforge.log.jsonl").read_text()
    assert "loudnorm.skipped_silence" in log
