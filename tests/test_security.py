from __future__ import annotations

import os
from pathlib import Path

import pytest
import structlog

from stickforge.core.security import (
    REDACTED,
    MediaValidationError,
    PathEscapeError,
    Redactor,
    safe_project_path,
    validate_image,
)


@pytest.mark.parametrize(
    "bad",
    [
        "../x.png",
        "a/../../x.png",
        "/etc/passwd",
        "C:\\Windows\\x.png",
        "C:x.png",
        "\\\\server\\share\\x.png",
        "..\\x.png",
        "",
        "a\x00b",
    ],
)
def test_path_guard_rejects(tmp_path: Path, bad: str):
    with pytest.raises(PathEscapeError):
        safe_project_path(tmp_path, bad)


def test_path_guard_allows_inside(tmp_path: Path):
    (tmp_path / "cast").mkdir()
    assert safe_project_path(tmp_path, "cast/max.png") == (tmp_path / "cast/max.png").resolve()
    assert safe_project_path(tmp_path, "cast\\max.png") == (tmp_path / "cast/max.png").resolve()


@pytest.mark.skipif(os.name == "nt", reason="symlinks need privileges on Windows")
def test_path_guard_blocks_symlink_escape(tmp_path: Path):
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "secret.png").write_bytes(b"x")
    proj = tmp_path / "proj"
    proj.mkdir()
    (proj / "link").symlink_to(outside)
    with pytest.raises(PathEscapeError, match="escapes"):
        safe_project_path(proj, "link/secret.png")


def test_redactor_patterns_and_known_values():
    r = Redactor(["my-custom-secret-value"])
    text = (
        "key AIzaSyA1234567890abcdefghijklmnopqrstuv and sk-abcdefghijklmnopqrstuvwx "
        "Authorization: Bearer abc.def.ghi https://x?key=supersecret123&y=1 "
        "and my-custom-secret-value"
    )
    out = r.text(text)
    for leaked in ("AIzaSy", "sk-abc", "abc.def.ghi", "supersecret123", "my-custom-secret"):
        assert leaked not in out
    assert out.count(REDACTED) >= 5


def test_redactor_sensitive_keys_nested():
    r = Redactor()
    out = r.value({"api_key": "plain", "nested": {"token": "t0ken"}, "ok": "fine"})
    assert out == {"api_key": REDACTED, "nested": {"token": REDACTED}, "ok": "fine"}


def test_structlog_never_emits_secret(capsys, tmp_path, monkeypatch):
    from stickforge import logs
    from stickforge.core.security import REDACTOR

    REDACTOR.add_secrets(["zz-env-secret-123456"])
    log_file = tmp_path / "log.jsonl"
    logs.configure(log_file)
    structlog.get_logger().info(
        "calling zz-env-secret-123456",
        headers={"x-goog-api-key": "v"},
        url="https://h/?key=zz-env-secret-123456",
    )
    logs.configure(None)
    content = log_file.read_text()
    assert "zz-env-secret" not in content
    assert REDACTED in content


def test_validate_image(tmp_path: Path):
    from PIL import Image

    good = tmp_path / "g.png"
    Image.new("RGB", (64, 36)).save(good)
    assert validate_image(good) == (64, 36)
    bad = tmp_path / "b.png"
    bad.write_bytes(good.read_bytes()[:40])
    with pytest.raises(MediaValidationError):
        validate_image(bad)
    gif = tmp_path / "x.gif"
    Image.new("RGB", (64, 36)).save(gif)
    with pytest.raises(MediaValidationError, match="unsupported"):
        validate_image(gif)
