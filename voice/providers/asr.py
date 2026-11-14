"""
Speech recognition service adapter.

Server-side ASR uses AI4Bharat IndicConformer ("Indic-Transcribe") when an
inference endpoint is configured:
    AI4B_ASR_URL    POST multipart {audio: <file>, language: <iso>} → {"text": "..."}
    AI4B_ASR_TOKEN  optional bearer token (or HF_TOKEN)
Without it, the web app uses the browser's built-in speech recognition (Web Speech
API) on the citizen's device, and always offers text input. Raw audio is processed
in memory and never written to disk or database.
"""
from __future__ import annotations

import os

from .base import ProviderError, auth_headers, post_with_retry

URL = os.getenv("AI4B_ASR_URL", "").strip()
SUPPORTED = ("as", "bn", "gu", "hi", "kn", "ml", "mr", "or", "pa", "ta", "te", "ur", "en")
MAX_BYTES = int(os.getenv("VOICE_MAX_AUDIO_BYTES", str(6 * 1024 * 1024)))


def available() -> bool:
    return bool(URL)


async def transcribe(audio: bytes, mime: str, lang: str) -> str:
    if not URL:
        raise ProviderError("server ASR not configured")
    if not audio or len(audio) < 800:
        raise ProviderError("recording too short or empty")
    if len(audio) > MAX_BYTES:
        raise ProviderError("recording too long")
    if lang not in SUPPORTED:
        raise ProviderError("language not supported by ASR")
    r = await post_with_retry(URL, files={"audio": ("speech", audio, mime or "audio/webm")}, data={"language": lang},
                              headers=auth_headers("AI4B_ASR_TOKEN"), timeout=45)
    text = (r.json().get("text") or "").strip()
    if not text:
        raise ProviderError("no speech recognised")
    return text
