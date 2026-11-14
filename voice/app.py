"""
HaqSetu Voice AI — FastAPI service.

Runs beside the main HaqSetu app (which proxies /voice-api/* to it after checking the
user's session). Endpoints are only reachable with the shared internal secret, so model
credentials and the database never touch the browser.
"""
from __future__ import annotations

import asyncio
import logging
import os

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

from . import db, dialogue, i18n
from .providers import asr, llm, translate, tts
from .providers.base import ProviderError

logging.basicConfig(level=logging.INFO, format="%(asctime)s voice %(levelname)s %(message)s")
log = logging.getLogger("haqsetu.voice")
SECRET = os.getenv("VOICE_INTERNAL_SECRET", "")
app = FastAPI(title="HaqSetu Voice AI", docs_url=None, redoc_url=None, openapi_url=None)


def internal(x_internal_secret: str = Header(default="")) -> None:
    if not SECRET or x_internal_secret != SECRET:
        raise HTTPException(status_code=403, detail="forbidden")


def enabled_languages() -> list[str]:
    """Languages we can genuinely converse in right now."""
    langs = list(i18n.TEMPLATED_LANGS)
    if translate.available():
        langs += [l for l in i18n.LANG_NAMES if l not in langs]
    return langs


class ChatIn(BaseModel):
    session_id: str | None = None
    lang: str = "en"
    text: str = Field(default="", max_length=1000)
    user_id: str | None = None
    profile: dict | None = None


@app.get("/healthz")
async def healthz():
    try:
        ok = await db.ping()
    except Exception:  # noqa: BLE001
        ok = False
    return {"ok": ok}


@app.get("/v1/capabilities", dependencies=[Depends(internal)])
async def capabilities():
    return {
        "languages": [{"code": c, "name": i18n.LANG_NAMES[c], "speech_tag": i18n.SPEECH_TAGS.get(c)} for c in enabled_languages()],
        "providers": {
            "asr_server": asr.available(), "tts_server": tts.available(),
            "translation": translate.available(), "llm": llm.available(),
        },
        "asr_server_languages": list(asr.SUPPORTED) if asr.available() else [],
        "tts_server_languages": list(tts.SUPPORTED) if tts.available() else [],
    }


@app.post("/v1/chat", dependencies=[Depends(internal)])
async def chat(body: ChatIn):
    lang = body.lang if body.lang in enabled_languages() else "en"
    s = dialogue.get_session(body.session_id, body.user_id, lang, body.profile)
    try:
        return await asyncio.wait_for(dialogue.turn(s, body.text), timeout=40)
    except asyncio.TimeoutError:
        return JSONResponse({"error": "timeout", "reply": "Sorry, that took too long. Please try again or type your question."}, status_code=504)


@app.delete("/v1/session/{sid}", dependencies=[Depends(internal)])
async def end_session(sid: str):
    dialogue.delete_session(sid)
    return {"ok": True}


@app.post("/v1/asr", dependencies=[Depends(internal)])
async def transcribe(audio: UploadFile = File(...), lang: str = Form("hi")):
    data = await audio.read()  # held in memory only; never persisted
    try:
        text = await asr.transcribe(data, audio.content_type or "audio/webm", lang)
        return {"text": text}
    except ProviderError as e:
        return JSONResponse({"error": str(e), "fallback": "text"}, status_code=422)
    finally:
        del data


class TTSIn(BaseModel):
    text: str = Field(max_length=2000)
    lang: str = "en"


@app.post("/v1/tts", dependencies=[Depends(internal)])
async def speak(body: TTSIn):
    try:
        audio, ctype = await tts.synthesize(body.text, body.lang)
        return Response(content=audio, media_type=ctype, headers={"Cache-Control": "no-store"})
    except ProviderError as e:
        return JSONResponse({"error": str(e), "fallback": "device_or_text"}, status_code=422)
