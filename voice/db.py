"""Read-only access to the HaqSetu scheme catalogue and location tables."""
from __future__ import annotations

import json
import os

import asyncpg

_pool: asyncpg.Pool | None = None
PUBLIC_VERIFICATION = ["verified"] if os.getenv("SHOW_UNVERIFIED") == "false" else ["verified", "pending_review", "needs_update"]


async def pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        dsn = os.environ["DATABASE_URL"]
        ssl = "require" if os.getenv("PGSSL") == "true" else None
        _pool = await asyncpg.create_pool(dsn, min_size=1, max_size=4, ssl=ssl, command_timeout=10)
    return _pool


def _row(r: asyncpg.Record) -> dict:
    d = dict(r)
    if isinstance(d.get("rules"), str):
        d["rules"] = json.loads(d["rules"])
    return d


SCHEME_COLS = ("id, slug, name, short_description, description, level, state_codes, district_ids, beneficiary_categories, "
               "eligibility_text, rules, benefits, benefit_amount, documents, application_process, official_url, apply_url, "
               "deadline_note, verification_status")


async def candidate_schemes(state_code: str | None) -> list[dict]:
    p = await pool()
    rows = await p.fetch(
        f"""SELECT {SCHEME_COLS} FROM schemes
             WHERE status = 'active' AND verification_status = ANY($1::text[])
               AND ((level = 'central' AND (cardinality(state_codes) = 0 OR $2::text = ANY(state_codes)))
                    OR ($2::text IS NOT NULL AND $2::text = ANY(state_codes)))""",
        PUBLIC_VERIFICATION, state_code)
    return [_row(r) for r in rows]


async def all_public_schemes() -> list[dict]:
    p = await pool()
    rows = await p.fetch(f"SELECT {SCHEME_COLS} FROM schemes WHERE status = 'active' AND verification_status = ANY($1::text[])", PUBLIC_VERIFICATION)
    return [_row(r) for r in rows]


async def districts(state_code: str) -> list[dict]:
    p = await pool()
    rows = await p.fetch("SELECT d.id, d.name FROM districts d JOIN states s ON s.id = d.state_id WHERE s.code = $1 AND d.active ORDER BY d.name", state_code)
    return [dict(r) for r in rows]


async def state_name(code: str) -> str | None:
    p = await pool()
    return await p.fetchval("SELECT name FROM states WHERE code = $1", code)


async def ping() -> bool:
    p = await pool()
    return (await p.fetchval("SELECT 1")) == 1
