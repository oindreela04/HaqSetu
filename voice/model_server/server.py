"""
Reference AI4Bharat inference server for HaqSetu Voice AI (runs on a GPU machine).

Implements the three HTTP contracts the voice service expects:
  POST /asr        multipart {audio, language}      -> {"text"}           (IndicConformer)
  POST /translate  {"text","src","tgt"}             -> {"translation"}    (IndicTrans2)
  POST /tts        {"text","lang"}                  -> audio/wav          (Indic Parler-TTS)

Status: reference implementation. It needs a CUDA GPU (T4/L4 class or better) and
approved access to the gated AI4Bharat models on Hugging Face (HF_TOKEN). It was NOT
run in HaqSetu's CI because no GPU or gated access was available there — load-test it
and evaluate every language with native speakers before pointing production at it.
Point the main app at it with AI4B_ASR_URL=<host>/asr, AI4B_TRANSLATE_URL=<host>/translate,
AI4B_TTS_URL=<host>/tts and protect it with MODEL_SERVER_TOKEN.
"""
import io
import os

import numpy as np
import soundfile as sf
import torch
import torchaudio
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel

TOKEN = os.getenv("MODEL_SERVER_TOKEN", "")
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
app = FastAPI(title="HaqSetu AI4Bharat model server")

FLORES = {"as": "asm_Beng", "bn": "ben_Beng", "gu": "guj_Gujr", "hi": "hin_Deva", "kn": "kan_Knda", "ml": "mal_Mlym", "mr": "mar_Deva",
          "or": "ory_Orya", "pa": "pan_Guru", "ta": "tam_Taml", "te": "tel_Telu", "ur": "urd_Arab", "en": "eng_Latn"}
TTS_SPEAKER = {"hi": "Divya", "bn": "Arjun", "ta": "Jaya", "te": "Prakash", "mr": "Sanjay", "gu": "Yash", "kn": "Suresh", "ml": "Anjali",
               "pa": "Divjot", "or": "Manas", "as": "Amit", "en": "Thoma"}


def auth(authorization: str = Header(default="")):
    if TOKEN and authorization != f"Bearer {TOKEN}":
        raise HTTPException(401, "unauthorized")


_asr = None
_mt = {}
_tts = None


def asr_model():
    global _asr
    if _asr is None:
        from transformers import AutoModel
        _asr = AutoModel.from_pretrained("ai4bharat/indic-conformer-600m-multilingual", trust_remote_code=True)
    return _asr


def mt_model(direction: str):
    if direction not in _mt:
        from IndicTransToolkit.processor import IndicProcessor
        from transformers import AutoModelForSeq2SeqLM, AutoTokenizer
        name = {"indic-en": "ai4bharat/indictrans2-indic-en-1B", "en-indic": "ai4bharat/indictrans2-en-indic-1B", "indic-indic": "ai4bharat/indictrans2-indic-indic-1B"}[direction]
        tok = AutoTokenizer.from_pretrained(name, trust_remote_code=True)
        model = AutoModelForSeq2SeqLM.from_pretrained(name, trust_remote_code=True, torch_dtype=torch.float16 if DEVICE == "cuda" else torch.float32).to(DEVICE).eval()
        _mt[direction] = (tok, model, IndicProcessor(inference=True))
    return _mt[direction]


def tts_model():
    global _tts
    if _tts is None:
        from parler_tts import ParlerTTSForConditionalGeneration
        from transformers import AutoTokenizer
        model = ParlerTTSForConditionalGeneration.from_pretrained("ai4bharat/indic-parler-tts").to(DEVICE).eval()
        tok = AutoTokenizer.from_pretrained("ai4bharat/indic-parler-tts")
        desc_tok = AutoTokenizer.from_pretrained(model.config.text_encoder._name_or_path)
        _tts = (model, tok, desc_tok)
    return _tts


@app.post("/asr", dependencies=[Depends(auth)])
async def asr(audio: UploadFile = File(...), language: str = Form("hi")):
    raw = await audio.read()
    wav, sr = torchaudio.load(io.BytesIO(raw))
    wav = torch.mean(wav, dim=0, keepdim=True)
    if sr != 16000:
        wav = torchaudio.functional.resample(wav, sr, 16000)
    with torch.inference_mode():
        text = asr_model()(wav, language, "ctc")
    return {"text": text if isinstance(text, str) else str(text)}


class MTIn(BaseModel):
    text: str
    src: str
    tgt: str


@app.post("/translate", dependencies=[Depends(auth)])
def translate(body: MTIn):
    direction = "indic-en" if body.tgt == "en" else "en-indic" if body.src == "en" else "indic-indic"
    tok, model, ip = mt_model(direction)
    batch = ip.preprocess_batch([body.text], src_lang=FLORES[body.src], tgt_lang=FLORES[body.tgt])
    enc = tok(batch, truncation=True, padding="longest", return_tensors="pt").to(DEVICE)
    with torch.inference_mode():
        out = model.generate(**enc, num_beams=5, max_length=512)
    dec = tok.batch_decode(out, skip_special_tokens=True, clean_up_tokenization_spaces=True)
    return {"translation": ip.postprocess_batch(dec, lang=FLORES[body.tgt])[0]}


class TTSIn(BaseModel):
    text: str
    lang: str = "hi"


@app.post("/tts", dependencies=[Depends(auth)])
def tts(body: TTSIn):
    model, tok, desc_tok = tts_model()
    speaker = TTS_SPEAKER.get(body.lang, "Divya")
    desc = f"{speaker} speaks at a moderate pace with a clear, warm voice. The recording is very high quality with no background noise."
    d = desc_tok(desc, return_tensors="pt").to(DEVICE)
    p = tok(body.text, return_tensors="pt").to(DEVICE)
    with torch.inference_mode():
        gen = model.generate(input_ids=d.input_ids, attention_mask=d.attention_mask, prompt_input_ids=p.input_ids, prompt_attention_mask=p.attention_mask)
    buf = io.BytesIO()
    sf.write(buf, np.asarray(gen.cpu().numpy().squeeze(), dtype=np.float32), model.config.sampling_rate, format="WAV")
    return Response(buf.getvalue(), media_type="audio/wav")
