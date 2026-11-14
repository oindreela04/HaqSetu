# HaqSetu — Your Rights. Your Benefits. One Bridge.

A pan-India government scheme discovery platform. Citizens build a simple profile (no Aadhaar, no bank details) and a deterministic, explainable rules engine matches them against Central, State, UT and District schemes, grouped as **Potentially eligible**, **More information required** and **Not currently eligible**, with reasons for each.

## Features
- All 28 states + 8 UTs with 778 districts (admin-editable, plus sub-divisions)
- Secure accounts: bcrypt hashing, server-side Postgres sessions, CSRF tokens, rate limiting, account lockout, email verification, password reset, data export, account deletion, consent settings
- Guided onboarding & editable profile; anonymous quick check (nothing stored)
- **Missed Benefits Detector**: compares the profile against every active scheme for the user's state + Centre, and ranks which missing answers would unlock the most schemes
- Scheme catalogue with source, verification status and last-verified date on every record
- Admin / reviewer console: create & edit schemes with a visual rule builder, verification queue (verify with note, needs-update, draft, close, archive), revision history, JSON import/export, citizen error reports, location management, user roles, audit log
- English / हिन्दी / বাংলা interface
- Optional AI "explain in simple language" (only rephrases the stored record; it never decides eligibility)

## Run locally
```bash
npm install
export DATABASE_URL=postgres://user:pass@localhost:5432/haqsetu
npm start            # runs migrations + seeds on boot, serves :3000
npm test             # needs a Postgres database at TEST_DATABASE_URL
```

## Database modes
- **Permanent (recommended for production):** set `DATABASE_URL` to any PostgreSQL 14+.
- **Bundled (zero-cost preview):** if `DATABASE_URL` is not set, the app starts its own private PostgreSQL inside the server (via `embedded-postgres`). It is fully isolated, but **all accounts and edits reset when the server restarts**, and a banner tells visitors so. Seed schemes reload automatically on every boot.

## Environment variables
| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (required) |
| `SESSION_SECRET` | Long random string (required in production) |
| `NODE_ENV` | `production` for secure cookies |
| `ADMIN_EMAILS` | Comma-separated emails that become admins when they register/start |
| `SITE_URL` | Public URL used in email links |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | Email delivery (verification & password reset) |
| `ANTHROPIC_API_KEY` | Optional: enables the simple-language explainer |
| `SHOW_UNVERIFIED` | `false` to show only reviewer-verified schemes publicly |

## Data integrity
Seed schemes were compiled on 14 Nov 2026 from official portals and recent reporting and are marked **awaiting verification** until a reviewer confirms each one against the official notification. Imports can never arrive as verified, and editing a verified record sends it back to the review queue.

HaqSetu is an independent information service, not a government website.
