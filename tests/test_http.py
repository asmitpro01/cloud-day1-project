from __future__ import annotations

import hashlib
from pathlib import Path

import httpx
import pytest
import respx

from stickforge.core.http import DownloadError, RateLimited, download, raise_for_status
from stickforge.providers.base import PermanentProviderError, TransientProviderError


@pytest.mark.parametrize(
    ("code", "exc"),
    [
        (429, RateLimited),
        (500, TransientProviderError),
        (503, TransientProviderError),
        (408, TransientProviderError),
        (400, PermanentProviderError),
        (401, PermanentProviderError),
        (403, PermanentProviderError),
        (404, PermanentProviderError),
        (422, PermanentProviderError),
    ],
)
def test_status_mapping(code, exc):
    resp = httpx.Response(code, text="err", request=httpx.Request("GET", "https://x"))
    with pytest.raises(exc):
        raise_for_status(resp, "p")


def test_error_body_is_redacted():
    resp = httpx.Response(
        401,
        text="bad key AIzaSyA1234567890abcdefghijklmnopqrstuv",
        request=httpx.Request("GET", "https://x"),
    )
    with pytest.raises(PermanentProviderError) as ei:
        raise_for_status(resp, "p")
    assert "AIzaSy" not in str(ei.value)


@pytest.mark.parametrize(
    "body",
    [
        '{"error": {"code": 429, "message": "Quota exceeded for metric: '
        "generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 0, "
        'model: gemini-3.1-flash-lite-image"}}',
        '{"error": {"message": "Generate content requests per day limit exceeded"}}',
        '{"error": {"code": "insufficient_quota", "message": "You exceeded your current quota"}}',
    ],
)
def test_hard_quota_429_is_not_retried(body):
    resp = httpx.Response(429, text=body, request=httpx.Request("GET", "https://x"))
    with pytest.raises(PermanentProviderError, match="quota exhausted") as ei:
        raise_for_status(resp, "p")
    assert not ei.value.retryable


def test_per_minute_429_is_still_retried():
    body = '{"error": {"message": "Quota exceeded for metric: requests_per_minute, limit: 10"}}'
    resp = httpx.Response(429, text=body, request=httpx.Request("GET", "https://x"))
    with pytest.raises(RateLimited):
        raise_for_status(resp, "p")


def test_retry_after_parsed():
    resp = httpx.Response(
        429, headers={"retry-after": "7"}, request=httpx.Request("GET", "https://x")
    )
    with pytest.raises(RateLimited) as ei:
        raise_for_status(resp, "p")
    assert ei.value.retry_after == 7.0


PNG = b"\x89PNG fake bytes"


@respx.mock
async def test_download_ok_with_redirect_and_sha(tmp_path: Path):
    respx.get("https://github.com/a/b").mock(
        return_value=httpx.Response(
            302, headers={"location": "https://release-assets.githubusercontent.com/x"}
        )
    )
    respx.get("https://release-assets.githubusercontent.com/x").mock(
        return_value=httpx.Response(200, content=PNG, headers={"content-type": "image/png"})
    )
    dest = tmp_path / "f.png"
    digest = await download(
        "https://github.com/a/b",
        dest,
        allowed_hosts=["github.com", "release-assets.githubusercontent.com"],
        max_bytes=1000,
        content_types=["image/png"],
        sha256=hashlib.sha256(PNG).hexdigest(),
    )
    assert dest.read_bytes() == PNG and digest == hashlib.sha256(PNG).hexdigest()


@pytest.mark.parametrize(
    "url",
    [
        "http://github.com/a",
        "https://evil.com/a",
        "https://github.com.evil.com/a",
        "https://user:pw@github.com/a",
        "file:///etc/passwd",
    ],
)
async def test_download_rejects_bad_urls(tmp_path: Path, url: str):
    with pytest.raises(DownloadError):
        await download(url, tmp_path / "f", allowed_hosts=["github.com"], max_bytes=10)


@respx.mock
async def test_download_blocks_redirect_to_other_host(tmp_path: Path):
    respx.get("https://github.com/a").mock(
        return_value=httpx.Response(302, headers={"location": "https://evil.com/x"})
    )
    with pytest.raises(DownloadError, match=r"evil\.com"):
        await download(
            "https://github.com/a", tmp_path / "f", allowed_hosts=["github.com"], max_bytes=10
        )
    assert not (tmp_path / "f").exists()


@respx.mock
async def test_download_size_type_and_hash_checks(tmp_path: Path):
    route = respx.get("https://github.com/a")
    route.mock(
        return_value=httpx.Response(200, content=b"x" * 100, headers={"content-type": "image/png"})
    )
    with pytest.raises(DownloadError, match=r"exceeds|too large"):
        await download(
            "https://github.com/a", tmp_path / "f", allowed_hosts=["github.com"], max_bytes=10
        )
    with pytest.raises(DownloadError, match="content-type"):
        await download(
            "https://github.com/a",
            tmp_path / "f",
            allowed_hosts=["github.com"],
            max_bytes=1000,
            content_types=["image/jpeg"],
        )
    with pytest.raises(DownloadError, match="sha256"):
        await download(
            "https://github.com/a",
            tmp_path / "f",
            allowed_hosts=["github.com"],
            max_bytes=1000,
            sha256="0" * 64,
        )
    assert not list(tmp_path.iterdir())  # no partial files left behind
