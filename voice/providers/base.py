"""Shared HTTP helper: timeouts, bounded retries with backoff, no secrets in logs."""
from __future__ import annotations

import asyncio
import logging
import os

import httpx

log = logging.getLogger("haqsetu.voice")
TIMEOUT = float(os.getenv("VOICE_PROVIDER_TIMEOUT", "25"))
RETRIES = int(os.getenv("VOICE_PROVIDER_RETRIES", "2"))


class ProviderError(Exception):
    """Raised when an external model service fails; callers fall back to text."""


async def post_with_retry(url: str, *, json=None, files=None, data=None, headers=None, timeout: float | None = None) -> httpx.Response:
    last: Exception | None = None
    for attempt in range(RETRIES + 1):
        try:
            async with httpx.AsyncClient(timeout=timeout or TIMEOUT) as client:
                r = await client.post(url, json=json, files=files, data=data, headers=headers)
            if r.status_code >= 500 or r.status_code == 429:
                raise ProviderError(f"upstream {r.status_code}")
            if r.status_code >= 400:
                raise ProviderError(f"rejected {r.status_code}")  # do not retry client errors
            return r
        except (httpx.TimeoutException, httpx.TransportError, ProviderError) as e:
            last = e
            if isinstance(e, ProviderError) and str(e).startswith("rejected"):
                break
            if attempt < RETRIES:
                await asyncio.sleep(0.6 * (2 ** attempt))
    log.warning("provider call failed: %s", type(last).__name__ if last else "unknown")
    raise ProviderError(str(last) if last else "failed")


def auth_headers(env_key: str) -> dict:
    tok = os.getenv(env_key) or os.getenv("HF_TOKEN")
    return {"Authorization": f"Bearer {tok}"} if tok else {}
