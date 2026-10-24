"""Retries with exponential backoff + full jitter, and fallback chains.

Only ``ProviderError.retryable`` errors (429/5xx/timeouts) are retried; auth and
validation errors fail fast and move on to the next provider in the chain.
"""

from __future__ import annotations

import asyncio
import random
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass, field
from typing import Generic, TypeVar

from stickforge.providers.base import ProviderError

T = TypeVar("T")
A = TypeVar("A")


@dataclass(frozen=True)
class RetryPolicy:
    max_attempts: int = 4
    base_delay_s: float = 1.0
    max_delay_s: float = 30.0

    def delay(self, attempt: int, rng: random.Random, retry_after: float | None = None) -> float:
        """Full jitter: uniform(0, min(cap, base * 2**attempt)); honour Retry-After floor."""
        cap = min(self.max_delay_s, self.base_delay_s * (2**attempt))
        d = rng.uniform(0, cap)
        return max(d, retry_after) if retry_after is not None else d


@dataclass
class Outcome(Generic[T]):
    value: T
    attempts: int
    provider: str
    errors: list[str] = field(default_factory=list)


class ChainExhausted(Exception):
    def __init__(self, errors: list[str]) -> None:
        self.errors = errors
        super().__init__("; ".join(errors) or "no providers")


Sleep = Callable[[float], Awaitable[None]]


async def with_retry(
    fn: Callable[[], Awaitable[T]],
    policy: RetryPolicy,
    *,
    sleep: Sleep = asyncio.sleep,
    rng: random.Random | None = None,
) -> tuple[T, int]:
    """Run ``fn`` until success, a non-retryable error, or attempts run out."""
    rng = rng or random.Random()  # noqa: S311 - jitter, not crypto
    for attempt in range(policy.max_attempts):
        try:
            return await fn(), attempt + 1
        except ProviderError as e:
            if not e.retryable or attempt + 1 >= policy.max_attempts:
                raise
            await sleep(policy.delay(attempt, rng, getattr(e, "retry_after", None)))
    raise AssertionError("unreachable")


async def run_chain(
    providers: Sequence[A],
    call: Callable[[A], Awaitable[T]],
    *,
    name: Callable[[A], str],
    policy: RetryPolicy,
    sleep: Sleep = asyncio.sleep,
    rng: random.Random | None = None,
) -> Outcome[T]:
    """Try each provider in order (each with retries); first success wins."""
    errors: list[str] = []
    total = 0
    for p in providers:

        def attempt(p: A = p) -> Awaitable[T]:
            return call(p)

        try:
            value, attempts = await with_retry(attempt, policy, sleep=sleep, rng=rng)
        except ProviderError as e:
            total += policy.max_attempts if e.retryable else 1
            errors.append(f"{name(p)}: {e}")
            continue
        return Outcome(value=value, attempts=total + attempts, provider=name(p), errors=errors)
    raise ChainExhausted(errors)
