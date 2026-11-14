"""
Speech synthesis service adapter — AI4Bharat Indic Parler-TTS ("Indic-Speak").
    AI4B_TTS_URL    POST {"text","lang"} → audio bytes (audio/wav or audio/mpeg)
    AI4B_TTS_TOKEN  optional bearer token (or HF_TOKEN)
Without it, the web app uses the device's own speech synthesis voices where the
selected language is installed, and otherwise shows text only (never fake audio).
"""
from __future__ import annotations

import os

from .base import ProviderError, auth_headers, post_with_retry

URL = os.getenv("AI4B_TTS_URL", "").strip()
SUPPORTED = ("as", "bn", "gu", "hi", "kn", "ml", "mr", "or", "pa", "ta", "te", "en")
MAX_CHARS = 1200


def available() -> bool:
    return bool(URL)


async def synthesize(text: str, lang: str) -> tuple[bytes, str]:
    if not URL:
        raise ProviderError("server TTS not configured")
    if lang not in SUPPORTED:
        raise ProviderError("language not supported by TTS")
    r = await post_with_retry(URL, json={"text": text[:MAX_CHARS], "lang": lang}, headers=auth_headers("AI4B_TTS_TOKEN"), timeout=60)
    ctype = r.headers.get("content-type", "audio/wav").split(";")[0]
    if not ctype.startswith("audio/") or not r.content:
        raise ProviderError("TTS returned no audio")
    return r.content, ctype
