from __future__ import annotations

from pathlib import Path

import pytest

from stickforge.core.cache import Cache, canonical_key
from stickforge.core.ffmpeg import (
    EncoderParams,
    build_concat_copy,
    build_mux,
    concat_list_text,
)
from stickforge.pipeline.audio_stage import scene_samples
from stickforge.pipeline.context import frames_for


def test_canonical_key_order_independent_and_sensitive():
    a = canonical_key({"x": 1, "y": {"b": 2, "a": 1}})
    b = canonical_key({"y": {"a": 1, "b": 2}, "x": 1})
    assert a == b and len(a) == 64
    assert canonical_key({"x": 1, "y": {"a": 1, "b": 3}}) != a


def test_cache_commit_and_crash_safety(tmp_path: Path):
    c = Cache(tmp_path / "c")
    k = canonical_key({"t": 1})
    assert c.get(k) is None
    tmp = c.tmp_path(k, ".bin")
    tmp.write_bytes(b"data")
    assert c.get(k) is None  # not committed yet: no sidecar
    e = c.commit(k, tmp, ".bin", {"a": 1})
    assert c.get(k) == e and e.path.read_bytes() == b"data" and not tmp.exists()
    e.path.unlink()  # media lost -> treated as miss
    assert c.get(k) is None
    with pytest.raises(ValueError):
        c.get("../../etc")


def test_cache_json_media_does_not_collide_with_sidecar(tmp_path: Path):
    c = Cache(tmp_path / "c")
    k = canonical_key({"t": "json"})
    tmp = c.tmp_path(k, ".json")
    tmp.write_text('[{"word": "hi"}]')
    e = c.commit(k, tmp, ".json", {"aligner": "x"})
    assert c.get(k).path.read_text() == '[{"word": "hi"}]' and e.meta == {"aligner": "x"}


ENC = EncoderParams(codec="libx264", preset="veryfast", crf=23, fps=30)


def test_encoder_args():
    assert ENC.to_args() == [
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-profile:v",
        "high",
        "-pix_fmt",
        "yuv420p",
        "-g",
        "60",
    ]


def test_concat_and_mux_args():
    assert build_concat_copy("ffmpeg", Path("l.txt"), Path("o.mp4"))[-7:] == [
        "-f",
        "concat",
        "-i",
        "l.txt",
        "-c",
        "copy",
        "o.mp4",
    ]
    mux = build_mux(
        "ffmpeg", Path("v.mp4"), Path("a.wav"), Path("o.mp4"), aac_bitrate="192k", sample_rate=48000
    )
    assert mux[6:] == [
        "-i",
        "v.mp4",
        "-i",
        "a.wav",
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-ar",
        "48000",
        "-ac",
        "2",
        "-movflags",
        "+faststart",
        "o.mp4",
    ]


def test_mux_gain_trim():
    plain = build_mux(
        "ffmpeg", Path("v.mp4"), Path("a.wav"), Path("o.mp4"), aac_bitrate="192k", sample_rate=48000
    )
    assert "-af" not in plain
    trimmed = build_mux(
        "ffmpeg",
        Path("v.mp4"),
        Path("a.wav"),
        Path("o.mp4"),
        aac_bitrate="192k",
        sample_rate=48000,
        gain_db=-0.6,
    )
    assert trimmed[trimmed.index("-af") + 1] == "volume=-0.6dB"


def test_concat_list_rejects_unsafe_entries():
    assert concat_list_text(["ab/x.mp4"]) == "ffconcat version 1.0\nfile 'ab/x.mp4'\n"
    for bad in ["a'b.mp4", "../x.mp4", "/abs.mp4", "a b.mp4", "x\nfile '/etc/passwd'"]:
        with pytest.raises(ValueError):
            concat_list_text([bad])


def test_frame_and_sample_math():
    assert frames_for(2.0, 0.35, 30) == 72  # 70.5 -> 71 -> quantum of 3 -> 72
    assert frames_for(1.0, 0.0, 30) == 30  # exact stays exact
    assert frames_for(1.0, 0.0, 25) == 25 and frames_for(1.01, 0.0, 25) == 26  # quantum 1
    assert frames_for(0.0, 0.0, 30) == 3
    assert scene_samples(72, 30, 48000) == 115200
    with pytest.raises(ValueError):
        scene_samples(1, 24, 44100)  # 1837.5 samples per frame
