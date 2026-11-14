# HaqSetu Voice AI

A multilingual voice and text assistant built into HaqSetu at `/voice`. Citizens speak or type, the assistant asks one question at a time, searches the real HaqSetu scheme database, runs the deterministic eligibility engine and replies in text and audio.

## Architecture

```
Browser (React, /voice)
  │  speech in:  browser Web Speech API  ──or──  MediaRecorder → /voice-api/asr
  │  speech out: device speech voices    ──or──  /voice-api/tts audio
  ▼
Node/Express (session, CSRF, rate limits, consent-gated profile saves)
  │  proxies /voice-api/* with a per-boot internal secret, adds the user's profile only if they consented
  ▼
FastAPI voice service  (voice/app.py, 127.0.0.1 only)
  ├── providers/asr.py        AI4Bharat IndicConformer endpoint (optional)
  ├── providers/translate.py  AI4Bharat IndicTrans2 endpoint (optional) → LLM fallback
  ├── providers/llm.py        LLM for understanding free-form speech (optional)
  ├── providers/tts.py        AI4Bharat Indic Parler-TTS endpoint (optional)
  ├── nlu.py                  deterministic extraction (English, Hindi/Hinglish, Bengali)
  ├── dialogue.py             one-question-at-a-time conversation, context per session
  ├── engine.py               Python port of the eligibility engine (parity-tested against JS)
  └── db.py                   read-only scheme/location queries (PostgreSQL)
```

Each service is a separate module with its own timeouts, retries and fallback to text. Provider calls are async (`httpx`). The Python engine and the JavaScript engine are checked against each other on 251 random profiles × every seeded scheme in `voice/tests/test_engine_parity.py`.

## What works today (no paid services)

| Capability | How | Languages enabled |
|---|---|---|
| Conversation, extraction, follow-up questions | `nlu.py` + `dialogue.py` (deterministic) | English, Hindi (incl. Hinglish), Bengali — hand-written templates, tested |
| Speech → text | Browser Web Speech API on the citizen's device (Chrome, Edge, Android) | Whatever the browser supports for the selected language; otherwise text input |
| Text → speech | Device speech-synthesis voices | Whatever voices the device has; otherwise text only, with a notice |
| Eligibility | `engine.py` against the live database | All |

No simulated audio is ever produced. If neither a server model nor a device voice exists for a language, the reply is shown as text and the user is told why.

**Privacy note shown to users:** browser speech recognition is processed by the browser vendor's speech service (for example Google for Chrome). HaqSetu never stores recordings; server-side audio, when enabled, is processed in memory only.

## Enabling AI4Bharat models and an LLM

Set these on the HaqSetu web service. Keys stay server-side and never reach the browser.

| Variable | Enables |
|---|---|
| `AI4B_ASR_URL`, `AI4B_ASR_TOKEN` | Server speech recognition with IndicConformer (13 languages) |
| `AI4B_TRANSLATE_URL`, `AI4B_TRANSLATE_TOKEN` | IndicTrans2 — turns on Tamil, Telugu, Marathi, Gujarati, Kannada, Malayalam, Punjabi, Odia, Assamese, Urdu |
| `AI4B_TTS_URL`, `AI4B_TTS_TOKEN` | Indic Parler-TTS audio replies |
| `ANTHROPIC_API_KEY` (+ `VOICE_LLM_MODEL`) | LLM understanding of free-form speech, and a translation fallback |

`voice/model_server/server.py` is a reference GPU server that implements all three AI4Bharat endpoints. It **has not been run** in this project's CI (no GPU and no gated-model access were available). Before enabling a language publicly:

1. Request access to the gated models on Hugging Face (`ai4bharat/indic-parler-tts`, IndicTrans2 and IndicConformer checkpoints) and review their licence terms for your use.
2. Deploy the model server on a GPU, set `MODEL_SERVER_TOKEN`, and point the `AI4B_*` URLs at it.
3. For each language, run at least 30 real recordings and conversations with native speakers (quiet and noisy), and check the recognition, translation and voice quality.
4. Only then leave that language enabled. The `/v1/capabilities` endpoint lists exactly what is live.

## Costs

| Item | Cost |
|---|---|
| Current setup (Render free web service, bundled database, browser speech) | ₹0 |
| GPU for AI4Bharat models — Hugging Face Inference Endpoint, 1× NVIDIA T4 (14 GB) | about $0.50/hour, or about $365/month if always on; billed per minute, can scale to zero |
| 1× NVIDIA L4 (24 GB, more headroom for running all three models together) | about $0.80/hour |
| LLM provider | Per-token pricing; see the provider's current price list. Only short extraction prompts are sent. |
| Permanent PostgreSQL (recommended before real users) | Free tiers exist (e.g. Neon); Render paid Postgres from about $6/month |

GPU prices are from Hugging Face's published Inference Endpoints pricing (November 2026) and change over time.

## Safety rules enforced in code

- Scheme facts, amounts, deadlines and links come only from the database; the assistant never invents them.
- Replies always say the government department decides; no approval is guaranteed.
- Profile changes need an explicit "yes". The browser cannot push changes: the voice service records the confirmation and Node applies it from the server-side session (`/voice-api/save-profile` returns 409 otherwise).
- No applications are submitted and no personal data is shared with third parties. The LLM, if enabled, receives only the citizen's message text.
- Sessions expire after one hour and are never shared across users. "Start again" deletes the session.
