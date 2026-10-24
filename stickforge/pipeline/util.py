from __future__ import annotations

import asyncio
from collections.abc import Callable, Coroutine, Iterable
from typing import Any, TypeVar

T = TypeVar("T")


async def settle(*coros: Coroutine[Any, Any, Any]) -> None:
    """Run concurrently; if any fail, let the others finish (their results get cached, so
    a rerun resumes with the most work done) and then raise the first error."""
    results = await asyncio.gather(*coros, return_exceptions=True)
    errors = [r for r in results if isinstance(r, BaseException)]
    cancelled = [e for e in errors if isinstance(e, asyncio.CancelledError)]
    if cancelled:
        raise cancelled[0]
    if errors:
        raise errors[0]


async def run_all(fn: Callable[[T], Coroutine[Any, Any, None]], items: Iterable[T]) -> None:
    """Run ``fn`` over items concurrently with :func:`settle` semantics."""
    await settle(*(fn(it) for it in items))
