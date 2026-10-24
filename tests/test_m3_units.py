from __future__ import annotations

import itertools
import json
import sys
import types
from pathlib import Path

import pytest
from PIL import Image

from stickforge.core.ffmpeg import (
    DuckParams,
    EncoderParams,
    LoudnessTarget,
    Overlay,
    build_loudnorm_apply,
    build_music_mix,
    build_scene_audio_mix,
    build_segment,
    parse_loudnorm,
)
from stickforge.pipeline.camera import CameraSettings, motion_for, render_frame, zoompan_filter
from stickforge.pipeline.captions_stage import Cue, build_cues, to_srt
from stickforge.pipeline.overlays import TextStyle, clean_text, render_caption, render_title
from stickforge.providers.align.scene_level import estimate_words
from stickforge.providers.align.tts_timestamps import TTSTimestampsAligner
from stickforge.providers.base import AudioResult, PermanentProviderError, WordTiming
from stickforge.schema import Camera

ENC = EncoderParams(codec="libx264", preset="veryfast", crf=23, fps=30)
S = CameraSettings(zoom_amount=0.12, pan_zoom=1.12, oversample=4)


# --- camera -------------------------------------------------------------------


def test_zoompan_expressions():
    zin = zoompan_filter(motion_for(Camera.SLOW_ZOOM_IN, S), 91, 1280, 720, 30)
    assert zin == (
        "scale=5120:2880:force_original_aspect_ratio=increase:flags=lanczos,crop=5120:2880,"
        "zoompan=z='1.000000+0.120000*(1-cos(PI*on/90))/2':x='(iw-iw/zoom)*0.500000'"
        ":y='(ih-ih/zoom)/2':d=91:s=1280x720:fps=30,setsar=1,format=yuv420p"
    )
    pan = zoompan_filter(motion_for(Camera.PAN_LEFT, S), 60, 1920, 1080, 30)
    assert (
        "z='1.120000'" in pan and "x='(iw-iw/zoom)*(1.000000+-1.000000*(1-cos(PI*on/59))/2)'" in pan
    )
    static = zoompan_filter(motion_for(Camera.STATIC, S), 30, 1920, 1080, 30)
    assert static.startswith("scale=1920:1080:") and "z='1.000000'" in static  # no oversample


@pytest.mark.parametrize("camera", list(Camera))
def test_motion_end_states(camera):
    m = motion_for(camera, S)
    z0, _ = m.state(0.0)
    z1, p1 = m.state(1.0)
    assert min(z0, z1) >= 1.0 and max(z0, z1) <= 1.12 + 1e-9
    assert 0.0 <= p1 <= 1.0


def test_render_frame_matches_camera_end(tmp_path: Path):
    src = tmp_path / "s.png"
    im = Image.new("RGB", (1600, 900), "white")
    im.paste((255, 0, 0), (0, 0, 100, 900))  # red stripe on the far left (< pan travel)
    im.save(src)
    out = tmp_path / "f.png"
    render_frame(src, motion_for(Camera.PAN_RIGHT, S), 1.0, 320, 180, out)  # ends at the right
    with Image.open(out) as f:
        assert f.size == (320, 180) and f.getpixel((2, 90)) == (255, 255, 255)
    render_frame(src, motion_for(Camera.PAN_LEFT, S), 1.0, 320, 180, out)  # ends at the left
    with Image.open(out) as f:
        assert f.getpixel((2, 90))[0] > 200 and f.getpixel((2, 90))[1] < 60


# --- overlays -------------------------------------------------------------------


def test_clean_text_strips_controls_and_bidi():
    assert clean_text("Hi‮ there\x00\n  you\t!") == "Hi there you !"


@pytest.mark.parametrize("fn", [render_title, render_caption])
def test_text_pngs_are_transparent_overlays(tmp_path: Path, fn):
    out = tmp_path / "t.png"
    fn(
        "A fairly long piece of on-screen text that should wrap onto two lines nicely",
        1280,
        720,
        out,
        TextStyle(),
    )
    with Image.open(out) as im:
        assert im.mode == "RGBA" and im.size == (1280, 720)
        alpha = im.getchannel("A")
        assert alpha.getpixel((5, 5)) == 0 and alpha.getbbox() is not None
        top = alpha.getbbox()[1]
        assert (top < 200) if fn is render_title else (top > 500)


# --- captions -------------------------------------------------------------------


def _words(text: str, step: float = 0.3) -> list[WordTiming]:
    return [
        WordTiming(word=w, start_s=i * step, end_s=i * step + step * 0.9)
        for i, w in enumerate(text.split())
    ]


def test_cues_break_on_sentence_and_clause():
    text = (
        "First sentence is right here. Sunlight looks white, but it is really a mix of every "
        "color of the rainbow, all travelling together through the air."
    )
    cues = build_cues(_words(text, 0.2), scene_end_s=20.0)
    assert cues[0].text == "First sentence is right here."
    assert cues[1].text.endswith("rainbow,") and cues[2].text.startswith("all travelling")
    assert all(len(c.text) <= 84 for c in cues)
    assert all(a.end_s <= b.start_s for a, b in itertools.pairwise(cues))


def test_cues_respect_max_duration_and_scene_end():
    cues = build_cues(_words("one two three four five six seven eight", 1.0), scene_end_s=7.5)
    assert all(c.end_s - c.start_s <= 5.2 for c in cues)
    assert cues[-1].end_s <= 7.5


def test_srt_format_and_arrow_escape():
    srt = to_srt([Cue(0.05, 1.5, "a --> b\n\nfake cue"), Cue(3661.2, 3662.0, "late")])
    assert srt == (
        "1\n00:00:00,050 --> 00:00:01,500\na → b fake cue\n\n"
        "2\n01:01:01,200 --> 01:01:02,000\nlate\n\n"
    )


def test_build_cues_escapes_arrow():
    cues = build_cues(_words("x --> y"), 5)
    assert "-->" not in to_srt(cues).split("\n", 2)[2]


def test_scene_level_estimate_covers_clip():
    words = estimate_words("Hello there. How are you, friend?", 3.0)
    assert words[0].start_s == 0.05 and abs(words[-1].end_s - 3.0) < 0.01
    assert all(a.end_s <= b.start_s + 1e-6 for a, b in itertools.pairwise(words))
    assert estimate_words("", 3.0) == [] and estimate_words("x", 0) == []


async def test_tts_timestamps_aligner(tmp_path: Path):
    from conftest import BASE_PROJECT  # noqa: F401  (ensures tests dir on path)

    from stickforge.config import ProviderConfig

    a = TTSTimestampsAligner("t", ProviderConfig(adapter="tts_timestamps"))
    no = AudioResult(path=tmp_path / "x.wav", provider="kokoro", duration_s=1.0)
    with pytest.raises(PermanentProviderError):
        await a.align(no, "hi")
    yes = no.model_copy(update={"word_timings": [WordTiming(word="hi", start_s=0, end_s=0.4)]})
    assert [w.word for w in await a.align(yes, "hi")] == ["hi"]


async def test_whisperx_aligner_glue(monkeypatch, tmp_path: Path):
    from stickforge.config import ProviderConfig
    from stickforge.providers.align.whisperx_aligner import WhisperXAligner

    fake = types.ModuleType("whisperx")
    calls = {}
    fake.load_align_model = lambda language_code, device: ("model", {"lang": language_code})
    fake.load_audio = lambda path: "samples"

    def align(segments, model, metadata, audio, device, return_char_alignments):
        calls["segments"] = segments
        return {
            "segments": [{"words": [{"word": "Hi", "start": 0.1, "end": 0.4}, {"word": "there"}]}]
        }

    fake.align = align
    monkeypatch.setitem(sys.modules, "whisperx", fake)
    a = WhisperXAligner("whisperx", ProviderConfig(adapter="whisperx"))
    res = await a.align(
        AudioResult(path=tmp_path / "a.wav", provider="k", duration_s=2.0), "Hi there"
    )
    assert [(w.word, w.start_s) for w in res] == [("Hi", 0.1)]  # unaligned words dropped
    assert calls["segments"] == [{"text": "Hi there", "start": 0.0, "end": 2.0}]


# --- ffmpeg builders ----------------------------------------------------------------


def test_build_segment_with_overlays_and_crossfade():
    args = build_segment(
        "ffmpeg",
        Path("img.png"),
        Path("o.mp4"),
        frames=90,
        width=1280,
        height=720,
        enc=ENC,
        motion_filter="MOTION",
        overlays=[
            Overlay(Path("t.png"), start_s=0.25, fade_in_s=0.35),
            Overlay(Path("c.png"), start_s=1.0, end_s=2.5),
        ],
        prev_frame=Path("prev.png"),
        crossfade_s=0.4,
    )
    graph = args[args.index("-filter_complex") + 1]
    assert graph == (
        "[0:v]MOTION[v0];"
        "[1:v]format=rgba,fade=t=in:st=0.25:d=0.35:alpha=1[o0];"
        "[v0][o0]overlay=0:0:format=auto:enable='gte(t,0.25)'[v1];"
        "[2:v]format=rgba[o1];"
        "[v1][o1]overlay=0:0:format=auto:enable='between(t,1,2.5)'[v2];"
        "[3:v]scale=1280:720,setsar=1,format=yuv420p,fps=30[pf];"
        "[pf][v2]xfade=transition=fade:duration=0.4:offset=0,format=yuv420p[vx]"
    )
    assert args[args.index("-map") + 1] == "[vx]"
    assert args[args.index("-frames:v") + 1] == "90"
    i = args.index("prev.png")
    assert args[i - 5 : i] == ["-framerate", "30", "-t", "0.4", "-i"]


def test_scene_audio_with_sfx():
    args = build_scene_audio_mix(
        "ffmpeg",
        Path("v.wav"),
        Path("o.wav"),
        voice_s=2.0,
        samples=96000,
        sample_rate=48000,
        fade_ms=8,
        sfx=Path("s.wav"),
        sfx_s=5.0,
        sfx_volume_db=-6,
    )
    graph = args[args.index("-filter_complex") + 1]
    assert "atrim=0:2,afade=t=out:st=1.97:d=0.03,volume=-6dB[s]" in graph
    assert graph.endswith("amix=inputs=2:normalize=0:duration=first,atrim=end_sample=96000[a]")
    assert args[-7:] == ["-c:a", "pcm_f32le", "-ar", "48000", "-ac", "2", "o.wav"]


def test_music_mix_ducks_under_voice():
    args = build_music_mix(
        "ffmpeg",
        Path("v.wav"),
        Path("m.mp3"),
        Path("o.wav"),
        total_samples=480000,
        sample_rate=48000,
        music_db=-18,
        duck=DuckParams(),
    )
    assert args[args.index("m.mp3") - 3 : args.index("m.mp3")] == ["-stream_loop", "-1", "-i"]
    graph = args[args.index("-filter_complex") + 1]
    assert "volume=-18dB" in graph and "afade=t=out:st=7.5:d=2.5" in graph
    assert "[m][sc]sidechaincompress=threshold=0.02:ratio=8:attack=20:release=400[md]" in graph


def test_loudnorm_parse_and_apply():
    stderr = (
        'junk\n[Parsed_loudnorm_0 @ 0x1]\n{\n "input_i" : "-23.10",\n "input_tp" : "-5.2",'
        '\n "input_lra" : "4.0",\n "input_thresh" : "-33.4",\n "target_offset" : "0.3"\n}\n'
    )
    m = parse_loudnorm(stderr)
    assert m["input_i"] == -23.1
    args = build_loudnorm_apply("ffmpeg", Path("a.wav"), Path("b.wav"), LoudnessTarget(), m, 48000)
    af = args[args.index("-af") + 1]
    assert af.startswith("loudnorm=I=-14:TP=-1:LRA=11:measured_I=-23.1:measured_TP=-5.2")
    assert af.endswith(":linear=true:print_format=summary,aresample=48000")
    silent = parse_loudnorm(
        '{"input_i":"-inf","input_tp":"-inf","input_lra":"0",'
        '"input_thresh":"-inf","target_offset":"inf"}'
    )
    assert silent["input_i"] == float("-inf")
    with pytest.raises(ValueError):
        build_loudnorm_apply("ffmpeg", Path("a"), Path("b"), LoudnessTarget(), silent, 48000)


def test_filter_numbers_reject_nan():
    with pytest.raises(ValueError):
        build_scene_audio_mix(
            "ffmpeg",
            Path("v"),
            Path("o"),
            voice_s=float("nan"),
            samples=10,
            sample_rate=48000,
            fade_ms=8,
        )
    with pytest.raises(ValueError):
        build_scene_audio_mix(
            "ffmpeg",
            Path("v"),
            Path("o"),
            voice_s=1.0,
            samples=10,
            sample_rate=48000,
            fade_ms=8,
            sfx=Path("s"),
            sfx_s=1.0,
            sfx_volume_db=float("inf"),
        )


def test_json_dump_roundtrip_of_cues():
    assert json.loads(json.dumps([WordTiming(word="a", start_s=0, end_s=1).model_dump()]))
