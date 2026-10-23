from __future__ import annotations

import asyncio
from collections.abc import Callable, Coroutine, Iterable
from typing import Any, TypeVar

T = TypeVar("T")


async def run_all(fn: Callable[[T], Coroutine[Any, Any, None]], items: Iterable[T]) -> None:
    """Run ``fn`` over items concurrently; first failure cancels the rest."""
    try:
        async with asyncio.TaskGroup() as tg:
            for it in items:
                tg.create_task(fn(it))
    except* Exception as eg:
        raise eg.exceptions[0] from None
