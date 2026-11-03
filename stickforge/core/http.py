"""HTTP helpers for adapters: status -> error mapping and a hardened downloader."""

from __future__ import annotations

import contextlib
import hashlib
from collections.abc import Iterable
from pathlib import Path
from urllib.parse import urlsplit

import httpx

from stickforge.core.security import REDACTOR
from stickforge.providers.base import PermanentProviderError, TransientProviderError

TRANSIENT_STATUS = frozenset({408, 409, 425, 429, 500, 502, 503, 504})
MAX_ERROR_BODY = 500


class RateLimited(TransientProviderError):
    """429 with an optional server-provided Retry-After (seconds)."""

    def __init__(self, message: str, retry_after: float | None) -> None:
        super().__init__(message)
        self.retry_after = retry_after


def timeout(total_s: float) -> httpx.Timeout:
    """Hard timeout on every phase of a request."""
    return httpx.Timeout(total_s, connect=min(15.0, total_s))


def client(total_s: float) -> httpx.AsyncClient:
    # trust_env keeps corporate/agent proxies working; redirects are never followed blindly.
    return httpx.AsyncClient(timeout=timeout(total_s), follow_redirects=False, trust_env=True)


def _retry_after(resp: httpx.Response) -> float | None:
    raw = resp.headers.get("retry-after")
    try:
        return max(0.0, min(float(raw), 300.0)) if raw else None
    except ValueError:
        return None


def raise_for_status(resp: httpx.Response, provider: str) -> None:
    """Map an HTTP error to Transient/Permanent provider errors (bodies redacted, truncated)."""
    if resp.is_success:
        return
    body = REDACTOR.text(resp.text[:MAX_ERROR_BODY]) if resp.content else ""
    msg = f"{provider}: HTTP {resp.status_code}: {body}".strip()
    if resp.status_code == 429:
        raise RateLimited(msg, _retry_after(resp))
    if resp.status_code in TRANSIENT_STATUS:
        raise TransientProviderError(msg)
    raise PermanentProviderError(msg)


def map_transport_error(e: httpx.HTTPError, provider: str) -> TransientProviderError:
    """Timeouts / connection failures are transient. Never echo the URL (may hold tokens)."""
    return TransientProviderError(f"{provider}: {type(e).__name__}")


# ---------------------------------------------------------------------------
# Downloader
# ---------------------------------------------------------------------------


class DownloadError(PermanentProviderError):
    pass


def _host_allowed(url: str, allowed_hosts: Iterable[str]) -> bool:
    parts = urlsplit(url)
    if parts.scheme != "https" or not parts.hostname or parts.username or parts.password:
        return False
    host = parts.hostname.lower()
    return any(host == h or host.endswith("." + h) for h in allowed_hosts)


async def download(
    url: str,
    dest: Path,
    *,
    allowed_hosts: Iterable[str],
    max_bytes: int,
    content_types: Iterable[str] | None = None,
    sha256: str | None = None,
    total_timeout_s: float = 120.0,
    http: httpx.AsyncClient | None = None,
    max_redirects: int = 5,
) -> str:
    """HTTPS-only download with host allowlist (checked on every redirect hop), size cap,
    content-type check and optional sha256 pin. Writes ``dest`` atomically; returns sha256.
    """
    hosts = tuple(h.lower() for h in allowed_hosts)
    types = tuple(content_types or ())
    owns = http is None
    http = http or client(total_timeout_s)
    tmp = dest.with_name(f".{dest.name}.part")
    try:
        current = url
        for _ in range(max_redirects + 1):
            if not _host_allowed(current, hosts):
                raise DownloadError(f"refusing to download from {urlsplit(current).hostname!r}")
            async with http.stream("GET", current) as resp:
                if resp.is_redirect:
                    loc = resp.headers.get("location", "")
                    current = str(resp.url.join(loc))
                    continue
                raise_for_status(resp, "download")
                ctype = resp.headers.get("content-type", "").split(";")[0].strip().lower()
                if types and ctype not in types:
                    raise DownloadError(f"unexpected content-type {ctype!r}")
                declared = int(resp.headers.get("content-length") or 0)
                if declared > max_bytes:
                    raise DownloadError(f"file too large ({declared} > {max_bytes} bytes)")
                h = hashlib.sha256()
                size = 0
                dest.parent.mkdir(parents=True, exist_ok=True)
                with tmp.open("wb") as f:
                    async for chunk in resp.aiter_bytes(1 << 16):
                        size += len(chunk)
                        if size > max_bytes:
                            raise DownloadError(f"file exceeds {max_bytes} bytes")
                        h.update(chunk)
                        f.write(chunk)
                digest = h.hexdigest()
                if sha256 and digest != sha256.lower():
                    raise DownloadError(f"sha256 mismatch for {dest.name}")
                tmp.replace(dest)
                return digest
        raise DownloadError("too many redirects")
    except httpx.HTTPError as e:
        raise map_transport_error(e, "download") from None
    finally:
        with contextlib.suppress(FileNotFoundError):
            tmp.unlink()
        if owns:
            await http.aclose()
