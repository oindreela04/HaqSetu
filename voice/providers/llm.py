"""
LLM service adapter (conversation understanding and translation fallback).
    ANTHROPIC_API_KEY  enables the provider (server-side only, never sent to browsers)
    VOICE_LLM_MODEL    default claude-haiku-5-5
The LLM never decides eligibility and never writes scheme facts: it only turns the
citizen's words into candidate profile fields (validated against the field catalogue)
and translates text. Scheme answers come from the database + deterministic engine.
"""
from __future__ import annotations

import json
import os
import re

from .base import ProviderError, post_with_retry

KEY = os.getenv("ANTHROPIC_API_KEY", "").strip()
MODEL = os.getenv("VOICE_LLM_MODEL", "claude-haiku-5-5")
API = "https://api.anthropic.com/v1/messages"


def available() -> bool:
    return bool(KEY)


async def _complete(system: str, user: str, max_tokens: int = 500) -> str:
    if not KEY:
        raise ProviderError("LLM not configured")
    r = await post_with_retry(API, json={"model": MODEL, "max_tokens": max_tokens, "system": system,
                                         "messages": [{"role": "user", "content": user}]},
                              headers={"x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json"})
    data = r.json()
    return "".join(c.get("text", "") for c in data.get("content", []) if c.get("type") == "text").strip()


async def extract(text: str, fields: dict, lang: str) -> dict:
    """Return candidate facts; caller validates every key/value against the catalogue."""
    catalog = {k: ({"type": v["type"], "options": [o[0] for o in v.get("options", [])]} if v["type"] == "enum" else {"type": v["type"]}) for k, v in fields.items()}
    system = ("Extract facts a citizen states about themselves for Indian welfare-scheme matching. "
              "Return ONLY a JSON object. Allowed keys: the catalogue keys plus 'state' (Indian state/UT name in English) "
              "and 'district' (English name). Use numbers for number fields (rupees, years), true/false for bool fields, "
              "and only the listed option codes for enum fields. Omit anything not clearly stated. Never guess.")
    out = await _complete(system, f"Catalogue: {json.dumps(catalog)}\nLanguage: {lang}\nCitizen said: {text}", 400)
    m = re.search(r"\{.*\}", out, re.S)
    if not m:
        return {}
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError:
        return {}


async def translate(text: str, src: str, tgt: str) -> str:
    system = ("Translate the user's text faithfully. Keep scheme names, numbers, ₹ amounts and URLs unchanged. "
              "Do not add, remove or soften any information. Output only the translation.")
    return await _complete(system, f"From {src} to {tgt}:\n{text}", 900)
