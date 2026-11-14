# HaqSetu — System Architecture

This document describes how HaqSetu is put together: the components, how a request flows through them, how the voice assistant works, the data model, and how it is deployed.

- [1. High-level overview](#1-high-level-overview)
- [2. Components](#2-components)
- [3. Eligibility engine](#3-eligibility-engine)
- [4. Request flow: finding schemes](#4-request-flow-finding-schemes)
- [5. Voice assistant flow](#5-voice-assistant-flow)
- [6. Data model](#6-data-model)
- [7. Scheme catalogue lifecycle](#7-scheme-catalogue-lifecycle)
- [8. Security architecture](#8-security-architecture)
- [9. Deployment](#9-deployment)
- [10. Design decisions](#10-design-decisions)

---

## 1. High-level overview

```mermaid
flowchart LR
    subgraph Client["📱 Citizen's device"]
        B["Browser<br/>EJS pages + React voice UI"]
        WS["Web Speech API<br/>(speech ↔ text)"]
    end

    subgraph Server["☁️ HaqSetu server (single container)"]
        N["Node.js + Express<br/>web app · auth · admin · API"]
        JE["Eligibility engine<br/>(JavaScript)"]
        V["FastAPI voice service<br/>127.0.0.1 only"]
        PE["Eligibility engine<br/>(Python, parity-tested)"]
        DB[("PostgreSQL<br/>schemes · locations<br/>users · sessions · audit")]
    end

    subgraph External["🌐 External (optional)"]
        AI4B["AI4Bharat models<br/>IndicConformer · IndicTrans2<br/>Indic Parler-TTS"]
        LLM["LLM provider"]
        SMTP["SMTP email"]
        GOV["Official government portals"]
    end

    B <-->|HTTPS| N
    B --- WS
    N --> JE
    N <-->|"/voice-api/* + internal secret"| V
    V --> PE
    N <--> DB
    V -->|read-only| DB
    V -.->|if configured| AI4B
    V -.->|if configured| LLM
    N -.->|if configured| SMTP
    B -->|"Apply / Official site links"| GOV
```

HaqSetu is a server-rendered web application with one interactive React island (the voice assistant). A Python service handles voice conversations beside it. Both read the same PostgreSQL database and use the same eligibility rules.

## 2. Components

| Component | Tech | Responsibility |
|---|---|---|
| **Web app** | Node.js 22, Express, EJS | Public pages, scheme search, quick check, accounts, dashboard, admin console, proxy for the voice service |
| **Eligibility engine (JS)** | `src/eligibility.js` | Deterministic, explainable matching of a profile against scheme rules |
| **Voice UI** | React 18, Vite | Language picker, mic/recording states, editable transcript, audio controls, result cards, consent buttons |
| **Voice service** | Python, FastAPI, asyncpg, httpx | Conversation management, information extraction, provider adapters |
| **Eligibility engine (Py)** | `voice/engine.py` | Port of the JS engine; parity-tested on every build |
| **Provider adapters** | `voice/providers/*` | Separate modules for speech recognition, translation, LLM and speech synthesis — each with timeouts, retries and a text fallback |
| **Database** | PostgreSQL | Schemes (JSONB rules, full-text search), states/districts/sub-divisions, users, profiles, consents, sessions, revisions, audit log |
| **Catalogue updater** | Scheduled weekly job | Researches official sources and ships scheme additions/changes as commits |

```mermaid
flowchart TB
    subgraph Express["Node.js / Express"]
        direction TB
        MW["Middleware<br/>helmet CSP · compression · rate limit<br/>session · flash · i18n · CSRF · loadUser"]
        R1["routes/public<br/>home · schemes · quick check · static pages"]
        R2["routes/auth<br/>register · login · verify · reset"]
        R3["routes/account<br/>onboarding · dashboard · profile · privacy"]
        R4["routes/admin<br/>schemes · verification · import/export<br/>locations · users · audit"]
        R5["routes/voice<br/>/voice page · /voice-api proxy · consented save"]
        SV["services.js<br/>queries · profile parsing · matching"]
        EL["eligibility.js"]
        MW --> R1 & R2 & R3 & R4 & R5
        R1 & R3 --> SV --> EL
    end

    subgraph Voice["FastAPI voice service"]
        direction TB
        API["app.py<br/>/v1/chat · /v1/asr · /v1/tts · /v1/capabilities"]
        DLG["dialogue.py<br/>session context · next question · results"]
        NLU["nlu.py<br/>English · Hindi/Hinglish · Bengali extraction"]
        I18N["i18n.py<br/>reviewed templates"]
        ENG["engine.py"]
        P["providers/<br/>asr · translate · llm · tts"]
        API --> DLG --> NLU & I18N & ENG & P
    end

    R5 <--> API
```

## 3. Eligibility engine

Every scheme stores its eligibility conditions as a JSON rule tree. The engine evaluates each condition to **true**, **false** or **unknown** (when the citizen hasn't provided that detail) and combines them:

```mermaid
flowchart TD
    S["Scheme + citizen profile"] --> L{"Location applies?<br/>central · state · district"}
    L -->|No| X["Hidden — never shown<br/>to other states"]
    L -->|Unknown| U
    L -->|Yes| T["Evaluate rule tree<br/>all / any groups · leaf conditions"]
    T --> M{"Any mandatory<br/>condition false?"}
    M -->|Yes| NE["🔴 Not currently eligible<br/>+ which condition failed"]
    M -->|No| K{"Any condition<br/>unknown?"}
    K -->|Yes| U["🟡 More information required<br/>+ which details are missing"]
    K -->|No| E["🟢 Potentially eligible<br/>+ conditions matched"]
    U --> UN["Unlock suggestions:<br/>rank missing fields by how many<br/>schemes they would resolve"]
```

Rule example (Atal Pension Yojana):

```json
{ "all": [
  { "field": "age", "op": "between", "value": [18, 40] },
  { "field": "has_bank_account", "op": "is", "value": true },
  { "field": "is_income_tax_payer", "op": "is", "value": false }
] }
```

Supported operators: `gte gt lte lt between eq neq in nin level_gte level_lte is manual`. Two extra modifiers keep results honest:

- **`manual`** — a condition that can't be checked online (e.g. "above 80th percentile in your board") always shows as *needs verification*.
- **`falseIsUnknown`** — for proxy conditions (e.g. a BPL card as a stand-in for the SECC list), a "no" means "check officially", not "rejected".

No language model participates in eligibility decisions.

## 4. Request flow: finding schemes

```mermaid
sequenceDiagram
    autonumber
    actor C as Citizen
    participant B as Browser
    participant E as Express
    participant S as services.js
    participant DB as PostgreSQL
    participant EN as Eligibility engine

    C->>B: Fill profile (state, age, income, situation)
    B->>E: POST /onboarding (CSRF token, session cookie)
    E->>E: Validate & whitelist fields
    E->>DB: Save profile (JSONB) + state/district
    B->>E: GET /dashboard
    E->>DB: Load profile + consent
    E->>S: matchProfile(profile)
    S->>DB: Active schemes where<br/>central OR state = citizen's state
    DB-->>S: Candidate schemes
    S->>EN: Evaluate each scheme
    EN-->>S: eligible / more_info / not_eligible + explanations
    S->>DB: Saved / applied / dismissed statuses
    S-->>E: Groups, Missed Benefits, unlock suggestions
    E-->>B: Rendered dashboard
```

## 5. Voice assistant flow

```mermaid
sequenceDiagram
    autonumber
    actor C as Citizen
    participant UI as React voice UI
    participant SR as Speech recognition<br/>(browser or IndicConformer)
    participant N as Express proxy
    participant V as Voice service
    participant DB as PostgreSQL
    participant TTS as Speech synthesis<br/>(device or Indic Parler-TTS)

    C->>UI: 🎤 "I'm a farmer from Bihar, income below 2 lakh"
    UI->>SR: Audio (processed in memory, never stored)
    SR-->>UI: Transcript
    UI->>C: Editable text — correct if needed
    C->>UI: Send
    UI->>N: POST /voice-api/chat {text, lang}
    N->>N: Check session · rate limit · consent
    N->>V: text + user's profile (only if consented)
    V->>V: Extract facts (state=BR, occupation=farmer, income=200000)
    V->>DB: Central + Bihar schemes
    V->>V: Run eligibility engine
    alt Important detail missing
        V-->>N: One follow-up question
    else Enough information
        V-->>N: Results + explanation + documents + official links
    end
    N-->>UI: Reply (text + structured results)
    UI->>TTS: Speak reply in selected language
    UI->>C: Text + audio, with stop / replay / mute
    opt Logged in and new details learnt
        V-->>UI: "Save these details?"
        C->>UI: Yes
        UI->>N: POST /voice-api/save-profile
        N->>N: Apply only the server-side confirmed update
    end
```

**Fallback chain for every step:**

```mermaid
flowchart LR
    A["Speech in"] --> A1{"AI4Bharat ASR<br/>configured?"}
    A1 -->|Yes| A2["Server transcription"]
    A1 -->|No| A3{"Browser supports<br/>the language?"}
    A3 -->|Yes| A4["Web Speech API"]
    A3 -->|No| A5["Text input"]

    C["Speech out"] --> C1{"AI4Bharat TTS<br/>configured?"}
    C1 -->|Yes| C2["Server audio"]
    C1 -->|No| C3{"Device voice<br/>for language?"}
    C3 -->|Yes| C4["Device speech"]
    C3 -->|No| C5["Text only + notice"]

    L["Language"] --> L1{"Hand-written<br/>templates?"}
    L1 -->|"en · hi · bn"| L2["Enabled"]
    L1 -->|Other| L3{"IndicTrans2 or<br/>LLM configured?"}
    L3 -->|Yes| L2
    L3 -->|No| L4["Not offered"]
```

## 6. Data model

```mermaid
erDiagram
    STATES ||--o{ DISTRICTS : contains
    DISTRICTS ||--o{ SUBDIVISIONS : contains
    USERS ||--|| PROFILES : has
    USERS ||--|| CONSENTS : has
    USERS ||--o{ AUTH_TOKENS : has
    USERS ||--o{ USER_SCHEMES : tracks
    SCHEMES ||--o{ USER_SCHEMES : "saved / applied"
    SCHEMES ||--o{ SCHEME_REVISIONS : history
    SCHEMES ||--o{ SCHEME_REPORTS : "citizen reports"
    STATES ||--o{ PROFILES : "lives in"
    DISTRICTS ||--o{ PROFILES : "lives in"
    USERS ||--o{ AUDIT_LOG : performs

    STATES {
        int id PK
        text code UK
        text name
        text type
        bool active
    }
    DISTRICTS {
        int id PK
        int state_id FK
        text name
        bool active
    }
    SUBDIVISIONS {
        int id PK
        int district_id FK
        text name
        text kind
    }
    USERS {
        uuid id PK
        citext email UK
        text password_hash
        text role
        timestamptz email_verified_at
    }
    PROFILES {
        uuid user_id PK
        jsonb data
        int state_id FK
        int district_id FK
        bool onboarding_complete
    }
    CONSENTS {
        uuid user_id PK
        bool use_profile_for_matching
        bool email_updates
    }
    AUTH_TOKENS {
        int id PK
        uuid user_id FK
        text kind
        text token_hash
        timestamptz expires_at
    }
    SCHEMES {
        int id PK
        text slug UK
        text level
        text_array state_codes
        int_array district_ids
        jsonb rules
        text verification_status
        text status
        date last_verified_at
        tsvector search
    }
    USER_SCHEMES {
        uuid user_id PK
        int scheme_id PK
        text status
    }
    SCHEME_REVISIONS {
        int id PK
        int scheme_id FK
        text action
        jsonb snapshot
    }
    SCHEME_REPORTS {
        int id PK
        int scheme_id FK
        text message
        bool resolved
    }
    AUDIT_LOG {
        bigint id PK
        uuid actor_id FK
        text action
        jsonb details
    }
```

Notes:
- Profile details live in a whitelisted **JSONB** document, so new eligibility fields can be added without migrations.
- Scheme rules are **JSONB**; geography is `state_codes[]` + `district_ids[]` with GIN indexes; search uses a weighted **tsvector**.
- Passwords are bcrypt hashes; reset/verification tokens are stored only as SHA-256 hashes.

## 7. Scheme catalogue lifecycle

```mermaid
stateDiagram-v2
    [*] --> draft: Admin creates
    [*] --> pending_review: Seed file / import / weekly update
    draft --> pending_review: Submit for review
    pending_review --> verified: Reviewer checks official source<br/>(note + source URL required)
    verified --> pending_review: Any edit
    verified --> needs_update: Citizen report / stale > 180 days
    needs_update --> pending_review: Corrected
    pending_review --> draft: Unpublish
    note right of verified
        Shown publicly with
        "Verified on" date
    end note
    note right of pending_review
        Shown publicly with
        "Awaiting verification"
    end note
```

```mermaid
flowchart LR
    W["Weekly job<br/>(Mon 02:47 IST)"] --> R["Research PIB · myScheme ·<br/>ministry & state portals"]
    R --> F["Edit data/schemes.js<br/>(pending_review only)"]
    F --> T{"Tests pass?"}
    T -->|No| STOP["No push"]
    T -->|Yes| G["Commit & push"]
    G --> D["Auto-deploy"]
    D --> SY["Seed sync on boot:<br/>insert new · refresh untouched ·<br/>never overwrite admin edits"]
```

## 8. Security architecture

```mermaid
flowchart TB
    REQ["Incoming request"] --> H["helmet — strict CSP,<br/>no inline scripts, HSTS"]
    H --> RL["Rate limits<br/>global · auth · sensitive · voice"]
    RL --> SE["Server-side session<br/>(httpOnly, secure, sameSite=lax)"]
    SE --> CS["CSRF token check<br/>(all non-GET)"]
    CS --> AU["Load user · role check<br/>citizen / reviewer / admin"]
    AU --> V["Input whitelisting &<br/>parameterised SQL"]
    V --> APP["Route handler"]
    APP --> AL["Audit log"]
```

| Concern | Measure |
|---|---|
| Passwords | bcrypt (12 rounds), policy check, lockout after 8 failures |
| Sessions | Stored in PostgreSQL, regenerated on login, all sessions revoked on password reset |
| Tokens | Random 256-bit, stored hashed, single-use, short expiry |
| Enumeration | Identical responses for unknown emails; constant-time login path |
| Personal data | Never collects Aadhaar, bank details or OTPs; export + hard delete; consent gates matching |
| Voice | No audio stored; voice service bound to localhost with a per-boot secret; profile saves need a server-side confirmation |
| Secrets | Model/API keys only in server environment, never sent to the browser |

## 9. Deployment

```mermaid
flowchart TB
    DEV["Developer"] -->|git push| GH["GitHub<br/>oindreela04/HaqSetu"]
    UPD["Weekly catalogue job"] -->|git push| GH
    GH -->|auto-deploy| BUILD

    subgraph Render["Render — web service (Singapore)"]
        BUILD["Build: npm ci<br/>→ vite build (voice UI)<br/>→ pip install (voice deps)"]
        subgraph Container["Running instance"]
            NODE["Node.js :10000<br/>(public)"]
            PY["uvicorn FastAPI :8001<br/>(localhost)"]
            PG[("PostgreSQL :5433<br/>bundled, localhost")]
            KA["Keep-awake<br/>07:00–23:00 IST"]
        end
        BUILD --> Container
    end

    USERS["Citizens"] -->|HTTPS| NODE
    NODE --> PY
    NODE --> PG
    PY --> PG
    KA -.-> NODE
    EXTDB[("External PostgreSQL<br/>(set DATABASE_URL)")] -.->|recommended for<br/>permanent accounts| NODE
```

| Mode | When | Persistence |
|---|---|---|
| **Bundled PostgreSQL** | `DATABASE_URL` not set | Private to the instance; resets on restart (a site banner says so) |
| **External PostgreSQL** | `DATABASE_URL` set | Permanent; bundled database is not started |

Startup sequence: start bundled PostgreSQL (if needed) → run migrations → seed locations and sync schemes → start the voice service → start Express → begin keep-awake.

## 10. Design decisions

| Decision | Why |
|---|---|
| **Deterministic rules, not an LLM, for eligibility** | Welfare decisions must be explainable and reproducible; every result lists exactly which conditions matched or failed. |
| **Server-rendered pages + one React island** | Fast first load on low-end phones and slow networks; React only where real-time interactivity is needed (voice). |
| **Two engines with parity tests** | Keeps the voice service independent while guaranteeing web and voice always agree. |
| **Pluggable provider adapters** | AI4Bharat models need GPUs and gated access; the assistant works today with browser speech and switches to Indic models by configuration, with no code changes. |
| **Three-state logic (true/false/unknown)** | Missing information should prompt a question, not a rejection. |
| **Scheme catalogue in code + database** | Seed data is versioned and reviewable in Git; admin edits in the database are protected from being overwritten. |
| **Location as data, not code** | States, districts and sub-divisions are database rows, so administrative changes need no deploy. |
