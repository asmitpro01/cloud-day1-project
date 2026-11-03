"""Per-provider concurrency limit + token bucket (requests per minute)."""

from __future__ import annotations

import asyncio
import time
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager


class TokenBucket:
    """Classic token bucket. ``rate_per_s`` tokens refill per second up to ``burst``."""

    def __init__(
        self, rate_per_s: float, burst: float, *, clock: Callable[[], float] = time.monotonic
    ) -> None:
        if rate_per_s <= 0 or burst < 1:
            raise ValueError("rate must be > 0 and burst >= 1")
        self.rate, self.burst, self._clock = rate_per_s, burst, clock
        self._tokens = burst
        self._last = clock()
        self._lock = asyncio.Lock()

    def _refill(self) -> None:
        now = self._clock()
        self._tokens = min(self.burst, self._tokens + (now - self._last) * self.rate)
        self._last = now

    async def acquire(self) -> None:
        async with self._lock:  # FIFO-ish: waiters queue on the lock
            while True:
                self._refill()
                if self._tokens >= 1:
                    self._tokens -= 1
                    return
                await asyncio.sleep((1 - self._tokens) / self.rate)


class Limiter:
    """Bounded concurrency, optionally paced by a token bucket."""

    def __init__(self, max_concurrency: int, requests_per_minute: float | None = None) -> None:
        self.max_concurrency = max_concurrency
        self._sem = asyncio.Semaphore(max_concurrency)
        self._bucket = (
            TokenBucket(requests_per_minute / 60.0, burst=max(1.0, min(max_concurrency, 5)))
            if requests_per_minute
            else None
        )

    @asynccontextmanager
    async def slot(self) -> AsyncIterator[None]:
        async with self._sem:
            if self._bucket is not None:
                await self._bucket.acquire()
            yield
