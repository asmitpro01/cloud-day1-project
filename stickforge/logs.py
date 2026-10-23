"""structlog setup: JSON lines, every event passed through the redactor."""

from __future__ import annotations

import logging
import sys
from pathlib import Path
from typing import Any, TextIO

import structlog

from stickforge.core.security import REDACTOR

_file: TextIO | None = None


class _Tee:
    """Writes JSON log lines to the run log file and, optionally, stderr."""

    def __init__(self, stderr: bool) -> None:
        self.stderr = stderr

    def msg(self, message: str) -> None:
        if _file is not None:
            _file.write(message + "\n")
            _file.flush()
        if self.stderr:
            sys.stderr.write(message + "\n")

    log = debug = info = warning = warn = error = critical = exception = msg


def configure(log_file: Path | None = None, *, verbose: bool = False) -> None:
    global _file
    if _file is not None:
        _file.close()
        _file = None
    if log_file is not None:
        log_file.parent.mkdir(parents=True, exist_ok=True)
        _file = log_file.open("a", encoding="utf-8")
    structlog.configure(
        processors=[
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            REDACTOR,  # must run before rendering
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(
            logging.DEBUG if verbose else logging.INFO
        ),
        logger_factory=lambda *_: _Tee(stderr=verbose),
        cache_logger_on_first_use=False,
    )


def get_logger(**bind: Any) -> Any:
    return structlog.get_logger().bind(**bind)
