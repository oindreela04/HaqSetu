"""End-to-end conversation tests against the real HaqSetu database (seeded)."""
import asyncio
import os

import pytest

os.environ.setdefault("DATABASE_URL", "postgres://haq:haq@localhost:5432/haqsetu")
from voice import dialogue  # noqa: E402


def run(coro):
    return asyncio.get_event_loop().run_until_complete(coro) if False else asyncio.run(coro)


async def converse(lines, lang="en", user_id=None, profile=None):
    from voice import db
    db._pool = None
    s = dialogue.get_session(None, user_id, lang, profile)
    outs = []
    for line in lines:
        o = await dialogue.turn(s, line)
        s = dialogue.SESSIONS.get(o["session_id"], s)
        outs.append(o)
    return outs


def test_spec_example_bihar_farmer():
    outs = run(converse([
        "I am a farmer from Bihar. My family income is below two lakh rupees. What government schemes can I get?",
    ]))
    first = outs[0]
    assert first["question_field"] in ("age", "flag:is_farmer_landholder")
    outs = run(converse([
        "I am a 40 year old farmer from Bihar. My family income is below two lakh rupees. What government schemes can I get?",
    ]))
    assert outs[0]["question_field"] == "flag:is_farmer_landholder"
    assert "agricultural land" in outs[0]["reply"]


def test_full_flow_reaches_results_with_bihar_and_central_only():
    outs = run(converse([
        "I am a 40 year old farmer from Bihar, family income 1.5 lakh",
        "yes I own land", "show results",
    ]))
    res = outs[-1]["results"]
    assert res is not None
    slugs = [r["slug"] for g in ("eligible", "more_info", "not_eligible") for r in res[g]]
    assert "pm-kisan" in slugs
    assert not any(s.startswith(("wb-", "mh-", "mp-", "jh-", "od-", "ka-", "up-")) for s in slugs)
    pk = next(r for r in res["eligible"] + res["more_info"] if r["slug"] == "pm-kisan")
    assert pk["official_url"].startswith("https://")
    assert "guarantee" not in outs[-1]["reply"].lower()


def test_one_question_at_a_time_and_hindi_reply():
    outs = run(converse(["नमस्ते, मैं महाराष्ट्र से हूँ"], lang="hi"))
    o = outs[0]
    assert o["question_field"] == "age"
    assert o["reply"].count("?") == 1
    assert "उम्र" in o["reply"]


def test_save_requires_explicit_yes():
    prof = {"data": {"flags": {}}, "state_code": None, "district_id": None}
    outs = run(converse(["I am a 30 year old street vendor from Goa, income 1 lakh", "show results"], user_id="u1", profile=prof))
    assert outs[-1]["action"] == "ask_save"
    assert outs[-1]["updates"]["occupation"] == "street_vendor"
    outs2 = run(converse(["I am a 30 year old street vendor from Goa, income 1 lakh", "show results", "no"], user_id="u2", profile=prof))
    assert outs2[-1]["action"] is None
    outs3 = run(converse(["I am a 30 year old street vendor from Goa, income 1 lakh", "show results", "yes"], user_id="u3", profile=prof))
    assert outs3[-1]["action"] == "save_confirmed"


def test_scheme_question_answers_from_database():
    outs = run(converse(["What is PM-KISAN?"]))
    assert outs[0]["results"]["focus"]["slug"] == "pm-kisan"
    assert "6,000" in outs[0]["reply"]
