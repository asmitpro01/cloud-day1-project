"""Stage 8 (run before render): word timings -> caption cues -> .srt (+ burn-in PNGs).

Visual timing comes from the voice (frames), never from the aligner: the aligner only
places words inside each scene's own voice clip.
"""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass

from stickforge.core.cache import atomic_write_text, canonical_key
from stickforge.pipeline.context import RunContext, SceneState
from stickforge.pipeline.overlays import TextStyle, clean_text, render_caption
from stickforge.pipeline.util import run_all
from stickforge.providers.base import Aligner, Kind, ProviderError, WordTiming

MAX_CHARS = 84  # two lines of ~42, the common broadcast guideline
MAX_CUE_S = 5.0
HOLD_S = 0.15


@dataclass(frozen=True)
class Cue:
    start_s: float
    end_s: float
    text: str


def _clause_cut(words: list[WordTiming]) -> int:
    """Split a full cue after its last clause punctuation (if it is past the halfway point)."""
    for i in range(len(words) - 1, len(words) // 2 - 1, -1):
        if words[i].word.endswith((",", ";", ":")):
            return i + 1
    return len(words)


def build_cues(words: list[WordTiming], scene_end_s: float) -> list[Cue]:
    groups: list[list[WordTiming]] = []
    cur: list[WordTiming] = []
    for w in words:
        if cur:
            text = " ".join(x.word for x in [*cur, w])
            too_long = len(text) > MAX_CHARS or w.end_s - cur[0].start_s > MAX_CUE_S
            sentence_break = (
                cur[-1].word.endswith((".", "!", "?")) and len(" ".join(x.word for x in cur)) >= 20
            )
            if too_long or sentence_break:
                cut = _clause_cut(cur) if too_long else len(cur)
                groups.append(cur[:cut])
                cur = cur[cut:]
        cur.append(w)
    if cur:
        groups.append(cur)
    cues: list[Cue] = []
    for i, g in enumerate(groups):
        nxt = groups[i + 1][0].start_s if i + 1 < len(groups) else scene_end_s
        end = min(g[-1].end_s + HOLD_S, nxt, scene_end_s)
        text = clean_text(" ".join(w.word for w in g)).replace("-->", "→")
        if text:
            cues.append(Cue(round(g[0].start_s, 3), round(max(end, g[0].start_s + 0.2), 3), text))
    return cues


def _ts(t: float) -> str:
    ms = round(max(0.0, t) * 1000)
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def _srt_text(text: str) -> str:
    """One line of plain text; no blank lines or arrows that could forge extra cues."""
    return clean_text(text).replace("-->", "→")


def to_srt(cues: list[Cue]) -> str:
    return "".join(
        f"{i}\n{_ts(c.start_s)} --> {_ts(c.end_s)}\n{_srt_text(c.text)}\n\n"
        for i, c in enumerate(cues, 1)
    )


def global_cues(ctx: RunContext) -> list[Cue]:
    out: list[Cue] = []
    offset = 0
    for st in ctx.scenes:
        base = offset / ctx.fps
        out += [Cue(c.start_s + base, c.end_s + base, c.text) for c in st.cues]
        offset += st.frames
    return out


async def run(ctx: RunContext) -> None:
    """Align + build cues per scene. Requires the TTS stage (audio, frames)."""
    names = ctx.mode.chains.align or []
    chain = ctx.registry.chain(names, Kind.ALIGN) if names else []
    burn = ctx.project.project.output.burn_in_captions
    style = caption_style(ctx)
    ctx.reporter.stage("captions", len(ctx.scenes))

    async def one(st: SceneState) -> None:
        assert st.audio is not None and st.audio_id is not None
        words: list[WordTiming] | None = None
        for adapter in chain:
            assert isinstance(adapter, Aligner)
            key = canonical_key(
                {
                    "stage": "align",
                    **adapter.cache_identity(),
                    "audio": st.audio_id,
                    "text": st.scene.narration,
                }
            )
            hit = None if ctx.forced(st) else ctx.cache.get(key)
            if hit is not None:
                words = [
                    WordTiming.model_validate(w)
                    for w in json.loads(hit.path.read_text(encoding="utf-8"))
                ]
            else:
                try:
                    async with ctx.registry.limiter(adapter.name).slot():
                        words = await adapter.align(st.audio, st.scene.narration)
                except ProviderError as e:
                    ctx.log.info(
                        "align.fallback", scene=st.scene.id, aligner=adapter.name, reason=str(e)
                    )
                    continue
                tmp = ctx.cache.tmp_path(key, ".json")
                tmp.write_text(json.dumps([w.model_dump() for w in words]), encoding="utf-8")
                ctx.cache.commit(key, tmp, ".json", {"aligner": adapter.name})
            st.providers["align"] = adapter.name
            break
        voice_end = st.audio.duration_s
        st.cues = build_cues(words or [], voice_end) if words else []
        if burn:
            st.caption_pngs = []
            for cue in st.cues:
                ckey = canonical_key(
                    {
                        "stage": "caption_png",
                        "v": 1,
                        "text": cue.text,
                        "w": ctx.mode.width,
                        "h": ctx.mode.height,
                        "style": repr(style),
                    }
                )
                hit = ctx.cache.get(ckey)
                if hit is None:
                    tmp = ctx.cache.tmp_path(ckey, ".png")
                    await asyncio.to_thread(
                        render_caption, cue.text, ctx.mode.width, ctx.mode.height, tmp, style
                    )
                    hit = ctx.cache.commit(ckey, tmp, ".png", {})
                st.caption_pngs.append((hit.path, cue.start_s, cue.end_s, ckey))
        ctx.reporter.advance("captions")

    await run_all(one, ctx.scenes)

    srt = ctx.out_dir / (ctx.project.project.output.filename.removesuffix(".mp4") + ".srt")
    atomic_write_text(srt, to_srt(global_cues(ctx)))
    ctx.artifacts["srt"] = srt


def caption_style(ctx: RunContext) -> TextStyle:
    style = ctx.project.project.style
    font = ctx.project.resolve(style.font) if style.font else None
    return TextStyle(fg="#FFFFFF", bg="#000000", bg_alpha=170, font_file=font)
