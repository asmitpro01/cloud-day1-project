"""stickforge command line."""

from __future__ import annotations

import asyncio
import importlib.util
import json
import platform
import shutil
import sys
from pathlib import Path
from typing import Annotated, Any

import typer
from rich.console import Console
from rich.progress import BarColumn, MofNCompleteColumn, Progress, TaskID, TextColumn
from rich.table import Table

from stickforge.config import EngineConfig, load_config
from stickforge.lint import lint_scenes
from stickforge.providers.registry import Registry
from stickforge.schema import ProjectError, load_project

app = typer.Typer(add_completion=False, no_args_is_help=True, help=__doc__)
console = Console()

ConfigOpt = Annotated[
    Path | None, typer.Option("--config", "-c", help="Engine config.yaml (merged over defaults)")
]
ProjectArg = Annotated[Path, typer.Argument(help="Project folder", exists=True, file_okay=False)]


def _config(path: Path | None) -> EngineConfig:
    try:
        return load_config(path)
    except Exception as e:  # pydantic/yaml errors carry no secrets (values come from env)
        console.print(f"[red]config error:[/red] {e}")
        raise typer.Exit(2) from None


@app.command()
def doctor(config: ConfigOpt = None) -> None:
    """Check the environment and provider keys (never prints secret values)."""
    from stickforge.pipeline.orchestrator import make_ffmpeg

    cfg = _config(config)
    t = Table(title="stickforge doctor", show_header=True)
    t.add_column("check")
    t.add_column("status")
    ok = True

    def row(name: str, good: bool, detail: str) -> None:
        nonlocal ok
        ok &= good
        t.add_row(name, f"[green]ok[/green]  {detail}" if good else f"[red]FAIL[/red] {detail}")

    py_ok = sys.version_info >= (3, 11)
    row("python", py_ok, platform.python_version())
    row("os", True, f"{platform.system()} {platform.release()} ({platform.machine()})")
    ff = make_ffmpeg(cfg)
    if ff.available():
        encs = asyncio.run(ff.encoders())
        row("ffmpeg", True, ff.ffmpeg)
        row("h264 encoders", "libx264" in encs or bool(encs), ", ".join(encs) or "none")
    else:
        row("ffmpeg", False, "ffmpeg/ffprobe not found on PATH — see README 'Install FFmpeg'")
    free = shutil.disk_usage(Path.cwd()).free / 1e9
    row("disk free", free > 5, f"{free:.1f} GB")
    for mod in ("kokoro_onnx", "whisperx", "litellm"):
        found = importlib.util.find_spec(mod) is not None
        t.add_row(
            f"optional: {mod}", "[green]installed[/green]" if found else "[dim]not installed[/dim]"
        )
    reg = Registry(cfg)
    for name in cfg.providers:
        st = reg.status(name)
        t.add_row(
            f"provider: {name}",
            "[green]ready[/green]" if st.ready else f"[yellow]{st.reason}[/yellow]",
        )
    console.print(t)
    if not ok:
        raise typer.Exit(1)


models_app = typer.Typer(no_args_is_help=True, help="Local model files (pinned by sha256).")
app.add_typer(models_app, name="models")


@models_app.command("list")
def models_list(config: ConfigOpt = None) -> None:
    """Show configured model files and whether they are installed."""
    from stickforge.models import is_installed

    cfg = _config(config)
    t = Table(title=f"models ({cfg.models_path()})")
    for col in ("key", "file", "installed", "license"):
        t.add_column(col)
    for key, mf in cfg.models.items():
        ok = is_installed(cfg, key)
        t.add_row(
            key, mf.file, "[green]yes[/green]" if ok else "[yellow]no[/yellow]", mf.license_note
        )
    console.print(t)


@models_app.command("pull")
def models_pull(
    keys: Annotated[list[str] | None, typer.Argument(help="Model keys (default: all)")] = None,
    config: ConfigOpt = None,
) -> None:
    """Download model files over HTTPS and verify their sha256."""
    from stickforge.models import pull

    cfg = _config(config)
    for key in keys or list(cfg.models):
        if key not in cfg.models:
            console.print(f"[red]unknown model {key!r}[/red]")
            raise typer.Exit(2)
        with console.status(f"pulling {key} …"):
            try:
                path = asyncio.run(pull(cfg, key))
            except Exception as e:
                console.print(f"[red]{key}: {e}[/red]", markup=False)
                raise typer.Exit(1) from None
        console.print(f"[green]ok[/green] {key} -> {path}")


@app.command()
def providers(config: ConfigOpt = None) -> None:
    """List adapters, capabilities and configured status."""
    cfg = _config(config)
    reg = Registry(cfg)
    t = Table(title="adapters")
    for col in ("adapter", "kind", "capabilities", "needs key", "cost model", "license"):
        t.add_column(col)
    for name, cls in sorted(reg.adapters.items()):
        t.add_row(
            name,
            cls.kind.value,
            ", ".join(sorted(cls.capabilities)) or "-",
            "yes" if cls.requires_key else "no",
            cls.cost_model,
            cls.license_note,
        )
    console.print(t)
    t2 = Table(title="configured providers")
    for col in ("name", "adapter", "model", "status"):
        t2.add_column(col)
    for name in cfg.providers:
        st = reg.status(name)
        t2.add_row(
            name,
            st.adapter,
            st.model or "-",
            "[green]ready[/green]" if st.ready else f"[yellow]{st.reason}[/yellow]",
        )
    console.print(t2)
    for mname, m in cfg.modes.items():
        console.print(
            f"[bold]{mname}[/bold]: {m.width}x{m.height}@{m.fps} "
            f"tts={m.chains.tts} image={m.chains.image}"
        )


@app.command()
def validate(project: ProjectArg) -> None:
    """Validate project.yaml + scenes.json and lint the scene plan."""
    try:
        loaded = load_project(project)
    except ProjectError as e:
        console.print(f"[red]{len(e.problems)} problem(s):[/red]")
        for p in e.problems:
            console.print(f"  • {p}", markup=False)
        raise typer.Exit(1) from None
    warnings = lint_scenes(loaded.scenes)
    for w in warnings:
        console.print(f"[yellow]warning[/yellow] {w}", highlight=False)
    words = sum(s.word_count for s in loaded.scenes)
    console.print(
        f"[green]valid[/green]: {len(loaded.scenes)} scenes, {words} words "
        f"(~{words / 150:.1f} min at 150 wpm), {len(warnings)} warning(s)"
    )


class _RichReporter:
    def __init__(self, progress: Progress) -> None:
        self.p = progress
        self.tasks: dict[str, TaskID] = {}
        self.cached: dict[str, int] = {}

    def stage(self, name: str, total: int) -> None:
        self.tasks[name] = self.p.add_task(name, total=total)
        self.cached[name] = 0

    def advance(self, name: str, *, cached: bool = False) -> None:
        self.cached[name] += int(cached)
        self.p.update(
            self.tasks[name],
            advance=1,
            description=f"{name} [dim]({self.cached[name]} cached)[/dim]",
        )

    def note(self, message: str) -> None:
        self.p.console.print(message)


def _parse_scene_ids(value: str | None) -> set[int] | None:
    if not value:
        return None
    try:
        ids = {int(x) for x in value.replace(" ", "").split(",") if x}
    except ValueError:
        raise typer.BadParameter("use comma-separated scene ids, e.g. 4,12") from None
    if not ids:
        raise typer.BadParameter("no scene ids given")
    return ids


@app.command()
def render(
    project: ProjectArg,
    draft: Annotated[bool, typer.Option("--draft", help="Cheap/fast models, 720p, no QA")] = False,
    final: Annotated[bool, typer.Option("--final", help="Best models, 1080p, QA on")] = False,
    only_scenes: Annotated[
        str | None,
        typer.Option(
            "--only-scenes",
            help="Regenerate just these scenes, e.g. 4,12 (cache "
            "bypassed for them); the rest come from cache",
        ),
    ] = None,
    force: Annotated[
        bool, typer.Option("--force", help="Ignore the cache for every scene")
    ] = False,
    qa: Annotated[
        bool | None, typer.Option("--qa/--no-qa", help="Override the mode's vision-QA setting")
    ] = None,
    config: ConfigOpt = None,
) -> None:
    """Render a project to a finished MP4 (+ .srt, report.json)."""
    from stickforge.pipeline.orchestrator import render as do_render

    if draft == final:
        console.print("[red]choose exactly one of --draft / --final[/red]")
        raise typer.Exit(2)
    ids = _parse_scene_ids(only_scenes)
    cfg = _config(config)
    mode = "draft" if draft else "final"
    with Progress(
        TextColumn("{task.description}"),
        BarColumn(),
        MofNCompleteColumn(),
        console=console,
        transient=False,
    ) as progress:
        try:
            res = asyncio.run(
                do_render(
                    project,
                    cfg,
                    mode=mode,
                    force=force,
                    only_scenes=ids,
                    qa=qa,
                    reporter=_RichReporter(progress),
                )
            )
        except ProjectError as e:
            for p in e.problems:
                console.print(f"  • {p}", markup=False)
            raise typer.Exit(1) from None
        except Exception as e:  # one clear, redacted line; full trace goes to the run log
            from stickforge.core.security import REDACTOR

            console.print(
                f"render failed: {REDACTOR.text(f'{type(e).__name__}: {e}')}",
                style="red",
                markup=False,
            )
            console.print(
                f"details: {project / cfg.output_dir / mode / 'report.json'}", markup=False
            )
            raise typer.Exit(1) from None
    for w in res.lint:
        console.print(f"[yellow]warning[/yellow] {w}", highlight=False)
    summary = (res.report or {}).get("summary", {})
    console.print(
        f"[green]done[/green] {res.output}  ({res.duration_s:.1f}s video, {res.scenes} scenes, "
        f"{res.wall_s:.1f}s wall, ${res.cost_usd:.4f} spent, cache hits {res.cache_hits})"
    )
    attention = [s for s in (res.report or {}).get("scenes", []) if s["status"] != "ok"]
    for s in attention:
        codes = ", ".join(i["code"] for i in s["qa"]["issues"]) or s["providers"].get("image")
        console.print(f"[yellow]scene {s['id']}: {s['status']}[/yellow] ({codes})", highlight=False)
    _print_provider_errors((res.report or {}).get("scenes", []))
    if summary.get("qa_flagged") or attention:
        console.print("see report: stickforge report " + str(project), highlight=False)


def _print_provider_errors(scenes: list[dict[str, Any]]) -> None:
    """Why providers were skipped — each distinct reason once, with the scenes it hit."""
    reasons: dict[str, list[int]] = {}
    for s in scenes:
        for err in s.get("provider_errors", []):
            line = " ".join(str(err).split())
            reasons.setdefault(line[:220] + ("…" if len(line) > 220 else ""), []).append(s["id"])
    for reason, ids in reasons.items():
        shown = ", ".join(map(str, ids[:8])) + (" …" if len(ids) > 8 else "")
        console.print("provider error ", style="yellow", end="")
        console.print(f"(scenes {shown}): {reason}", markup=False, highlight=False)


@app.command()
def report(
    project: ProjectArg,
    mode: Annotated[str | None, typer.Option(help="draft or final (default: newest)")] = None,
    json_out: Annotated[bool, typer.Option("--json", help="Print raw JSON")] = False,
    config: ConfigOpt = None,
) -> None:
    """Pretty-print the last report.json."""
    cfg = _config(config)
    found = sorted(
        (project / cfg.output_dir).glob("*/report.json"), key=lambda p: p.stat().st_mtime
    )
    if mode:
        found = [f for f in found if f.parent.name == mode]
    if not found:
        console.print("no report.json yet — run `stickforge render` first")
        raise typer.Exit(1)
    doc = json.loads(found[-1].read_text(encoding="utf-8"))
    if json_out:
        console.print_json(json.dumps(doc))
        return
    out = doc.get("output") or {}
    console.print(
        f"[bold]{doc['project']}[/bold] — {doc['mode']} — status "
        f"[{'green' if doc['status'] == 'ok' else 'red'}]{doc['status']}[/]",
        highlight=False,
    )
    if doc.get("error"):
        console.print(f"[red]{doc['error']}[/red]", markup=False)
    if out:
        console.print(
            f"{out['video']}  {out['duration_s']}s  {out['width']}x{out['height']}@"
            f"{out['fps']}  loudness {out.get('loudness_lufs')} LUFS "
            f"(peak {out.get('true_peak_dbtp')})",
            highlight=False,
        )
    cost = doc["cost"]
    console.print(
        f"cost ${cost['total_usd']:.4f} in {cost['provider_calls']} calls "
        f"{cost['by_provider']}  wall {doc['wall_s']}s {doc['stages_s']}",
        highlight=False,
    )
    t = Table(show_lines=False)
    for col in ("scene", "status", "voice", "image", "attempts", "qa", "cost $", "issues"):
        t.add_column(col)
    for sc in doc["scenes"]:
        style = {"ok": "green", "fallback": "yellow", "qa_flagged": "red"}.get(sc["status"], "")
        t.add_row(
            str(sc["id"]),
            f"[{style}]{sc['status']}[/]" if style else sc["status"],
            sc["providers"].get("tts", "-"),
            sc["providers"].get("image", "-"),
            str(sum(sc["attempts"].values()) if sc["attempts"] else 0),
            sc["qa"]["status"],
            f"{sc['cost_usd']:.4f}",
            ", ".join(i["code"] for i in sc["qa"]["issues"]),
        )
    console.print(t)
    _print_provider_errors(doc["scenes"])
    for w in doc.get("warnings", []):
        console.print("warning ", style="yellow", end="")
        console.print(w, markup=False, highlight=False)


if __name__ == "__main__":
    app()
