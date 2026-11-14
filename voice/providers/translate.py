"""
Translation service adapter — AI4Bharat IndicTrans2.
    AI4B_TRANSLATE_URL   POST {"text","src","tgt"} (ISO 639-1 codes) → {"translation": "..."}
    AI4B_TRANSLATE_TOKEN optional bearer token (or HF_TOKEN)
Used to (a) bring citizen input into English for extraction and (b) render replies
in languages that do not have hand-written templates. Falls back to the LLM
provider if configured; otherwise those languages stay disabled.
"""
from __future__ import annotations

import os

from . import llm
from .base import ProviderError, auth_headers, post_with_retry

URL = os.getenv("AI4B_TRANSLATE_URL", "").strip()


def available() -> bool:
    return bool(URL) or llm.available()


async def translate(text: str, src: str, tgt: str) -> str:
    if not text or src == tgt:
        return text
    if URL:
        r = await post_with_retry(URL, json={"text": text, "src": src, "tgt": tgt}, headers=auth_headers("AI4B_TRANSLATE_TOKEN"))
        out = (r.json().get("translation") or "").strip()
        if out:
            return out
        raise ProviderError("empty translation")
    if llm.available():
        return await llm.translate(text, src, tgt)
    raise ProviderError("no translation provider")
