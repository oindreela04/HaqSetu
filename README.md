<div align="center">

# 🌉 HaqSetu

### Your Rights. Your Benefits. One Bridge.

**Find every government scheme you're entitled to — Central, State, UT and District — explained in plain language, in your language, with official links to apply.**

[**🚀 Try it live → haqsetu.onrender.com**](https://haqsetu.onrender.com)

[![Live](https://img.shields.io/badge/live-haqsetu.onrender.com-0e5a4b?style=for-the-badge)](https://haqsetu.onrender.com)
![States](https://img.shields.io/badge/coverage-36%20states%20%26%20UTs-e39b2d?style=for-the-badge)
![Languages](https://img.shields.io/badge/languages-English%20%7C%20हिन्दी%20%7C%20বাংলা-1d4b8f?style=for-the-badge)
![License](https://img.shields.io/badge/license-MIT-555?style=for-the-badge)

<img src="docs/screenshots/home.png" alt="HaqSetu home page" width="900">

</div>

---

## The problem

India runs **thousands** of welfare schemes — pensions, scholarships, crop insurance, housing grants, maternity benefits, business loans. Many of the people they're meant for never claim them. Not because they aren't eligible, but because:

- 📜 eligibility rules are buried in PDFs and gazette notifications,
- 🗺️ every state runs its own schemes on its own portal,
- 🔤 most information exists only in English or one state language,
- 🤷 nobody tells you about the scheme you *didn't know to search for*.

**HaqSetu** (*haq* = right, *setu* = bridge) closes that gap. Tell it a little about yourself — where you live, your age, your work, your family income — and it checks you against every active scheme that applies to your location, then tells you exactly *why* each one does or doesn't fit.

## ✨ What it does

### 🔎 Missed Benefits Detector
Most people only find schemes they already know about. HaqSetu proactively compares your profile with **every** active Central + State scheme for your location and surfaces the ones you haven't claimed. It also tells you which single unanswered question would unlock the most additional schemes.

<img src="docs/screenshots/dashboard.png" alt="Dashboard with Missed Benefits" width="900">

### ⚖️ Explainable eligibility — never a black box
Every scheme lands in one of three buckets:

| | Status | Meaning |
|---|---|---|
| 🟢 | **Potentially eligible** | Your details satisfy every known rule |
| 🟡 | **More information required** | One or two answers are missing — we tell you which |
| 🔴 | **Not currently eligible** | A required condition isn't met — we tell you which one |

Each result shows ✓ conditions met, ? conditions unknown, ✕ conditions not met, plus the documents you'll need and the official link to apply. Decisions come from a **deterministic rules engine**, never from a language model, and HaqSetu never promises approval — the government department always decides.

<img src="docs/screenshots/scheme.png" alt="Scheme detail page" width="900">

### 🎤 HaqSetu Voice — ask out loud, in your language
Not everyone is comfortable filling in forms. At [`/voice`](https://haqsetu.onrender.com/voice) citizens can simply **speak** (or type) in English, Hindi — including Hinglish — or Bengali:

> *"I am a farmer from Bihar. My family income is below two lakh rupees. What government schemes can I get?"*

The assistant pulls out what it heard (state, occupation, income), asks **one follow-up question at a time**, searches the real scheme database, runs the same eligibility engine, and reads the answer back aloud — with result cards, documents and official links on screen. You can correct the transcript before sending, stop/replay/mute audio, or switch to text-only. Nothing is saved to your profile unless you explicitly say yes.

<img src="docs/screenshots/voice.png" alt="Voice assistant conversation" width="900">

### 📍 Truly pan-India
- All **28 states and 8 Union Territories**, with **778 districts** in the database
- A West Bengal citizen sees Central + West Bengal schemes; a Maharashtra citizen sees Central + Maharashtra schemes. A state-only scheme is **never** shown to residents of another state.
- District-level schemes are supported, and admins can add districts and sub-divisions from the dashboard — no code changes needed.

### 🧭 And everything else a real public service needs
- **2-minute quick check** — no account required, nothing stored
- **Secure accounts** — bcrypt hashing, server-side sessions, CSRF protection, rate limiting, lockout after repeated failures, email verification and password reset
- **Privacy by design** — never asks for Aadhaar, bank details or OTPs; download-my-data and one-click account deletion; consent controls for matching and emails
- **Admin & reviewer console** — visual rule builder, verification queue, revision history, JSON import/export, citizen error reports, location management, roles and a full audit log
- **Trilingual interface** — English, हिन्दी, বাংলা
- **Mobile-first** — built for low-end Android phones on patchy connections

<p align="center"><img src="docs/screenshots/mobile-check.png" alt="Quick check on mobile" width="300"></p>

## 🛡️ Trust & data integrity

Welfare information that's wrong is worse than none. HaqSetu is built around that:

- **Every scheme shows its source** and a *last verified* date. Records awaiting human review are clearly labelled.
- **Imports can never arrive "verified"**; editing a verified record automatically sends it back to the review queue.
- **Citizens can report outdated information** from any scheme page.
- **Official links only** — HaqSetu never processes applications and never asks for money.
- **Kept current** — schemes live in [`data/schemes.js`](data/schemes.js). New and updated schemes ship with each deploy; records that a reviewer has edited are never overwritten. A weekly research job checks official sources (PIB, myScheme, ministry and state portals) for launches, changes and closures.

## 🏗️ System architecture

```mermaid
flowchart LR
    subgraph Client["📱 Citizen's device"]
        B["Browser<br/>EJS pages + React voice UI"]
        WS["Web Speech API"]
    end
    subgraph Server["☁️ HaqSetu server"]
        N["Node.js + Express<br/>web · auth · admin"]
        JE["Eligibility engine (JS)"]
        V["FastAPI voice service"]
        PE["Eligibility engine (Python)"]
        DB[("PostgreSQL")]
    end
    subgraph Ext["🌐 Optional services"]
        AI4B["AI4Bharat<br/>ASR · translation · TTS"]
        LLM["LLM provider"]
        GOV["Official government portals"]
    end
    B <-->|HTTPS| N
    B --- WS
    N --> JE
    N <-->|"/voice-api"| V
    V --> PE
    N <--> DB
    V -->|read-only| DB
    V -.-> AI4B
    V -.-> LLM
    B -->|apply links| GOV
```

```mermaid
flowchart LR
    P["Citizen profile"] --> L{"Scheme applies to<br/>their state / district?"}
    L -->|No| H["Never shown"]
    L -->|Yes| R["Check every rule:<br/>true · false · unknown"]
    R --> E["🟢 Potentially eligible"]
    R --> M["🟡 More information required"]
    R --> X["🔴 Not currently eligible"]
    M --> Q["Ask the one question that<br/>unlocks the most schemes"]
```

📐 **Full architecture** — components, request and voice sequence diagrams, data model, catalogue lifecycle, security layers, deployment and design decisions — in **[ARCHITECTURE.md](ARCHITECTURE.md)**.

| Layer | Tech |
|---|---|
| Web app | Node.js 22, Express, EJS, vanilla JS |
| Voice UI | React 18, Vite, Web Speech API |
| Voice service | Python, FastAPI, asyncpg, httpx |
| Database | PostgreSQL (full-text search, JSONB rules, GIN indexes) |
| Security | bcrypt, helmet CSP, express-rate-limit, server-side sessions |
| Hosting | Render |

The JavaScript and Python eligibility engines are **parity-tested** against each other on hundreds of random profiles across every scheme, so web and voice always give the same answer.

Optional upgrades are wired in and switch on with environment variables: **AI4Bharat** IndicConformer (speech recognition), IndicTrans2 (translation for 10 more Indian languages) and Indic Parler-TTS (natural Indic voices) via a GPU inference server, plus an LLM for free-form understanding. See [VOICE.md](VOICE.md) for architecture, costs and rollout steps.

## 🚀 Run it locally

```bash
git clone https://github.com/oindreela04/HaqSetu.git
cd HaqSetu
npm install                 # also builds the voice UI and installs the Python voice deps
npm start                   # http://localhost:3000
```

No database? No problem — without `DATABASE_URL` HaqSetu starts its own private PostgreSQL automatically (data resets on restart). For anything permanent, point it at a real one:

```bash
export DATABASE_URL=postgres://user:pass@localhost:5432/haqsetu
npm start
```

Run the tests:

```bash
npm test               # web app: auth, matching, location rules, admin, privacy
npm run test:voice     # voice service: engine parity, language extraction, conversations
```

### Configuration

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (recommended for production) |
| `SESSION_SECRET` | Long random string — **required** in production |
| `ADMIN_EMAILS` | Comma-separated emails that get admin access when they sign up |
| `SITE_URL` | Public URL, used in email links |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | Email delivery for verification and password reset |
| `SHOW_UNVERIFIED` | Set `false` to show only reviewer-verified schemes |
| `AI4B_ASR_URL`, `AI4B_TRANSLATE_URL`, `AI4B_TTS_URL` | Optional AI4Bharat model endpoints for the voice assistant |
| `ANTHROPIC_API_KEY` | Optional LLM for free-form voice understanding and plain-language explanations |

## 🗂️ Project structure

```
src/            Express app, routes, eligibility engine, security, seeding
views/          EJS templates (citizen pages + admin console)
public/         CSS and browser scripts
voice/          FastAPI voice service (providers, dialogue, Python engine, tests)
voice-ui/       React voice interface
data/           Scheme catalogue and all-India location data
test/           Web app integration tests
```

## 🛣️ Roadmap

- [ ] Reviewer verification of the full catalogue
- [ ] More state and district schemes — every state and UT
- [ ] AI4Bharat models live for Tamil, Telugu, Marathi, Gujarati, Kannada, Malayalam, Punjabi, Odia, Assamese and Urdu
- [ ] SMS / WhatsApp deadline reminders for saved schemes
- [ ] Offline-friendly PWA for low-connectivity areas
- [ ] Assisted mode for CSC operators and community volunteers

## 🤝 Contributing

Spotted an outdated scheme, a missing district, or a wrong rule? Use **"Report incorrect information"** on the scheme page, or open an issue with a link to the official notification. Pull requests that add schemes must cite an official government source.

## ⚠️ Disclaimer

HaqSetu is an independent public-interest information service. It is **not** a government website and is not affiliated with any government body. Eligibility results are indicative; the relevant government department makes every final decision. Always apply through official portals — government schemes are free to apply for.

## 📄 License

[MIT](LICENSE) © 2026 Oindreela Saha

<div align="center">

**If HaqSetu helped you or someone you know, share it — every share is someone who might finally claim what's theirs.** 🌉

</div>
