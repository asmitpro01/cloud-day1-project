from __future__ import annotations

import asyncio
import random
import time

import pytest

from stickforge.core.http import RateLimited
from stickforge.core.ratelimit import Limiter, TokenBucket
from stickforge.core.retry import ChainExhausted, RetryPolicy, run_chain, with_retry
from stickforge.providers.base import PermanentProviderError, TransientProviderError

POLICY = RetryPolicy(max_attempts=4, base_delay_s=1.0, max_delay_s=8.0)


class Flaky:
    def __init__(self, failures: list[Exception]) -> None:
        self.failures = list(failures)
        self.calls = 0

    async def __call__(self) -> str:
        self.calls += 1
        if self.failures:
            raise self.failures.pop(0)
        return "ok"


async def test_retries_transient_then_succeeds():
    sleeps: list[float] = []

    async def sleep(d: float) -> None:
        sleeps.append(d)

    fn = Flaky([TransientProviderError("503"), TransientProviderError("timeout")])
    value, attempts = await with_retry(fn, POLICY, sleep=sleep, rng=random.Random(1))
    assert (value, attempts, fn.calls) == ("ok", 3, 3)
    assert len(sleeps) == 2 and 0 <= sleeps[0] <= 1.0 and 0 <= sleeps[1] <= 2.0


async def test_never_retries_permanent():
    fn = Flaky([PermanentProviderError("401 unauthorized")])
    with pytest.raises(PermanentProviderError):
        await with_retry(fn, POLICY, sleep=lambda d: asyncio.sleep(0))
    assert fn.calls == 1


async def test_gives_up_after_max_attempts():
    fn = Flaky([TransientProviderError("x")] * 10)
    with pytest.raises(TransientProviderError):
        await with_retry(fn, POLICY, sleep=lambda d: asyncio.sleep(0))
    assert fn.calls == 4


async def test_retry_after_is_a_floor():
    sleeps: list[float] = []

    async def sleep(d: float) -> None:
        sleeps.append(d)

    fn = Flaky([RateLimited("429", retry_after=5.0)])
    await with_retry(fn, POLICY, sleep=sleep, rng=random.Random(0))
    assert sleeps == [5.0] or sleeps[0] >= 5.0


def test_backoff_is_capped_full_jitter():
    rng = random.Random(42)
    for attempt in range(10):
        d = POLICY.delay(attempt, rng)
        assert 0 <= d <= min(8.0, 2**attempt)


async def test_chain_falls_back_and_reports_errors():
    async def call(name: str) -> str:
        if name == "a":
            raise PermanentProviderError("auth")
        if name == "b":
            raise TransientProviderError("503")
        return f"from {name}"

    out = await run_chain(
        ["a", "b", "c"], call, name=str, policy=POLICY, sleep=lambda d: asyncio.sleep(0)
    )
    assert out.value == "from c" and out.provider == "c"
    assert out.attempts == 1 + 4 + 1
    assert [e.split(":")[0] for e in out.errors] == ["a", "b"]

    async def always_fail(name: str) -> str:
        raise PermanentProviderError("nope")

    with pytest.raises(ChainExhausted):
        await run_chain(["a"], always_fail, name=str, policy=POLICY)


async def test_token_bucket_paces_requests():
    bucket = TokenBucket(rate_per_s=50.0, burst=1)
    t0 = time.monotonic()
    for _ in range(6):
        await bucket.acquire()
    assert time.monotonic() - t0 >= 0.09  # 5 refills at 20 ms each


async def test_limiter_bounds_concurrency():
    lim = Limiter(max_concurrency=2)
    active = peak = 0

    async def job() -> None:
        nonlocal active, peak
        async with lim.slot():
            active += 1
            peak = max(peak, active)
            await asyncio.sleep(0.01)
            active -= 1

    await asyncio.gather(*(job() for _ in range(8)))
    assert peak == 2
