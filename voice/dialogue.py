"""
Conversation manager for HaqSetu Voice AI.

One question at a time; keeps context per session; every scheme statement comes from
the database and the deterministic engine (engine.py). Nothing is saved to a profile
without an explicit "yes" from the citizen, and the save itself is performed by the
main app only after that confirmation.
"""
from __future__ import annotations

import re
import time
import uuid
from dataclasses import dataclass, field

from . import db, engine, i18n, nlu
from .providers import llm, translate
from .providers.base import ProviderError

SESSION_TTL = 60 * 60
MAX_QUESTIONS = 9
# Core questions first, in this order; then whatever unlocks the most schemes.
CORE = ["state", "age", "occupation", "annual_income"]
SKIP_RE = re.compile(r"\b(skip|pass|next|don'?t want|rather not)\b|छोड़|छोड़ो|আগে যান|বাদ দিন|এড়িয়ে")


@dataclass
class Session:
    id: str
    lang: str = "en"
    facts: dict = field(default_factory=lambda: {"flags": {}})
    profile: dict = field(default_factory=lambda: {"flags": {}})  # what the citizen's saved profile already has
    state_code: str | None = None
    district_id: int | None = None
    district_name: str | None = None
    asked: list = field(default_factory=list)
    expecting: str | None = None
    pending_save: dict | None = None
    offered_save: bool = False
    user_id: str | None = None
    saved_state_code: str | None = None
    saved_district_id: int | None = None
    history: list = field(default_factory=list)
    updated: float = field(default_factory=time.time)


SESSIONS: dict[str, Session] = {}


def _gc() -> None:
    now = time.time()
    for k in [k for k, s in SESSIONS.items() if now - s.updated > SESSION_TTL]:
        SESSIONS.pop(k, None)


def get_session(sid: str | None, user_id: str | None, lang: str, profile: dict | None) -> Session:
    _gc()
    s = SESSIONS.get(sid or "")
    if s and s.user_id != user_id:  # never share context across users
        s = None
    if not s:
        s = Session(id=uuid.uuid4().hex, user_id=user_id)
        if profile:
            data = profile.get("data") or {}
            s.profile = {**data, "flags": dict(data.get("flags") or {})}
            s.facts = {**data, "flags": dict(data.get("flags") or {})}
            s.state_code = s.saved_state_code = profile.get("state_code")
            s.district_id = s.saved_district_id = profile.get("district_id")
            s.district_name = profile.get("district_name")
        SESSIONS[s.id] = s
    s.lang = lang
    s.updated = time.time()
    return s


def delete_session(sid: str) -> None:
    SESSIONS.pop(sid, None)


def _known(s: Session, f: str) -> bool:
    if f == "state":
        return bool(s.state_code)
    if f.startswith("flag:"):
        return f[5:] in (s.facts.get("flags") or {})
    if f == "age":
        return s.facts.get("age") is not None or bool(s.facts.get("dob"))
    if f == "occupation":
        return bool(s.facts.get("occupation") or s.facts.get("employment"))
    return s.facts.get(f) is not None


def _qkey(field_name: str) -> str:
    return field_name if field_name in i18n.QUESTIONS or field_name == "state" else f"flag:{field_name}" if f"flag:{field_name}" in i18n.QUESTIONS else field_name


def _validate(cands: dict) -> dict:
    """Keep only catalogue-valid values (protects against bad LLM output)."""
    out: dict = {"flags": {}}
    for k, v in cands.items():
        if k in ("state_code", "district_id", "district_name"):
            out[k] = v
            continue
        if k == "flags":
            for fk, fv in (v or {}).items():
                if engine.FIELDS.get(fk, {}).get("type") == "bool" and isinstance(fv, bool):
                    out["flags"][fk] = fv
            continue
        d = engine.FIELDS.get(k)
        if not d:
            continue
        if d["type"] == "number":
            try:
                n = float(v)
                if n >= 0:
                    out[k] = n
            except (TypeError, ValueError):
                pass
        elif d["type"] == "enum" and v in [o[0] for o in d.get("options", [])]:
            out[k] = v
        elif d["type"] == "bool" and isinstance(v, bool):
            out["flags"][k] = v
    return out


async def _extract(s: Session, text: str) -> dict:
    districts = await db.districts(s.state_code) if s.state_code else None
    work_text = text
    if s.lang not in i18n.TEMPLATED_LANGS and translate.available():
        try:
            work_text = text + " \n " + await translate.translate(text, s.lang, "en")
        except ProviderError:
            pass
    cands = nlu.extract(work_text, districts=districts, expecting=s.expecting)
    # If the state changed in this turn, re-run district matching for the new state.
    if cands.get("state_code") and cands["state_code"] != s.state_code:
        d2 = await db.districts(cands["state_code"])
        c2 = nlu.extract(work_text, districts=d2)
        if c2.get("district_id"):
            cands["district_id"], cands["district_name"] = c2["district_id"], c2["district_name"]
    if llm.available():
        try:
            extra = await llm.extract(text, engine.FIELDS, s.lang)
            st = extra.pop("state", None)
            dist = extra.pop("district", None)
            if st and not cands.get("state_code"):
                code = nlu._find_state(nlu.normalize(st))
                if code:
                    cands["state_code"] = code
            if dist and not cands.get("district_id") and (cands.get("state_code") or s.state_code):
                for d in await db.districts(cands.get("state_code") or s.state_code):
                    if d["name"].lower() == str(dist).lower():
                        cands["district_id"], cands["district_name"] = d["id"], d["name"]
            for k, v in extra.items():
                if engine.FIELDS.get(k, {}).get("type") == "bool":
                    cands.setdefault("flags", {}).setdefault(k, v)
                else:
                    cands.setdefault(k, v)
        except ProviderError:
            pass
    return _validate(cands)


def _merge(s: Session, c: dict) -> list[str]:
    changed: list[str] = []
    if c.get("state_code") and c["state_code"] != s.state_code:
        s.state_code = c["state_code"]
        s.district_id, s.district_name = None, None
        changed.append("state")
    if c.get("district_id") and c["district_id"] != s.district_id:
        s.district_id, s.district_name = c["district_id"], c.get("district_name")
        changed.append("district")
    for k, v in c.items():
        if k in ("flags", "state_code", "district_id", "district_name"):
            continue
        if s.facts.get(k) != v:
            s.facts[k] = v
            if k == "age":
                s.facts.pop("dob", None)
            changed.append(k)
    for k, v in (c.get("flags") or {}).items():
        if s.facts["flags"].get(k) != v:
            s.facts["flags"][k] = v
            changed.append(f"flag:{k}")
    return changed


def _summary(s: Session, changed: list[str], state_nm: str | None, lang: str | None = None) -> str:
    parts = []
    L = lang or (s.lang if s.lang in i18n.TEMPLATED_LANGS else "en")
    for k in changed:
        if k == "state" and state_nm:
            parts.append(i18n.FACT_LABELS["state"][L].format(v=state_nm))
        elif k == "district" and s.district_name:
            parts.append(i18n.FACT_LABELS["district"][L].format(v=s.district_name))
        elif k == "age":
            parts.append(i18n.FACT_LABELS["age"][L].format(v=int(s.facts["age"])))
        elif k in ("annual_income", "monthly_income"):
            parts.append(i18n.FACT_LABELS[k][L].format(v=i18n.inr(s.facts[k])))
        elif k in ("occupation", "employment", "gender"):
            parts.append(i18n.FACT_LABELS[k][L].format(v=i18n.value_name(s.facts[k], L)))
    return ", ".join(parts)


def _new_profile_updates(s: Session) -> dict:
    """Facts learnt in this conversation that differ from the saved profile."""
    upd: dict = {"flags": {}}
    for k, v in s.facts.items():
        if k in engine.FIELDS and s.profile.get(k) != v:
            upd[k] = v
    for k, v in (s.facts.get("flags") or {}).items():
        if (s.profile.get("flags") or {}).get(k) != v:
            upd["flags"][k] = v
    if not upd["flags"]:
        upd.pop("flags")
    return upd


def _next_question(s: Session, groups: dict) -> str | None:
    if len(s.asked) >= MAX_QUESTIONS:
        return None
    for f in CORE:
        if not _known(s, f) and f not in s.asked:
            return f
    if s.facts.get("occupation") == "farmer" and not _known(s, "flag:is_farmer_landholder") and "flag:is_farmer_landholder" not in s.asked:
        return "flag:is_farmer_landholder"
    for fld, count in engine.unlock_suggestions(groups[engine.MORE_INFO]):
        key = "state" if fld == "state" else _qkey(fld)
        if key in s.asked or _known(s, key) or not i18n.question(key, "en"):
            continue
        if count >= 1:
            return key
    return None


def _public_result(ev: dict) -> dict:
    sc = ev["scheme"]
    return {
        "slug": sc["slug"], "name": sc["name"], "level": sc["level"], "state_codes": list(sc.get("state_codes") or []),
        "benefit": sc.get("benefit_amount") or "", "summary": sc.get("short_description") or "",
        "status": ev["status"], "met": ev["met"], "unknown": ev["unknown"], "unmet": ev["unmet"],
        "documents": list(sc.get("documents") or []), "apply_url": sc.get("apply_url") or "", "official_url": sc.get("official_url") or "",
        "verified": sc.get("verification_status") == "verified", "deadline_note": sc.get("deadline_note") or "",
    }


async def _render(s: Session, english: str, templated: str | None) -> str:
    """Return reply text in the session language."""
    if s.lang in i18n.TEMPLATED_LANGS:
        return templated if templated is not None else english
    try:
        return await translate.translate(english, "en", s.lang)
    except ProviderError:
        return english


def _find_scheme_mention(text: str, schemes: list[dict]) -> dict | None:
    t = nlu.normalize(text)
    if not re.search(r"what is|tell me about|about|explain|kya hai|क्या है|बताइए|बताओ|সম্পর্কে|কী|কি", t):
        return None
    best = None
    for sc in schemes:
        name = sc["name"].lower()
        acr = re.findall(r"\(([^)]+)\)", name)
        keys = [k.strip() for k in acr] + [sc["slug"].replace("-", " ")]
        for k in keys:
            if len(k) >= 4 and k in t:
                if not best or len(k) > best[0]:
                    best = (len(k), sc)
    return best[1] if best else None


async def turn(s: Session, text: str) -> dict:
    text = (text or "").strip()[:1000]
    L = s.lang
    LT = L if L in i18n.TEMPLATED_LANGS else "en"
    if text:
        s.history.append({"role": "user", "text": text})
        s.history = s.history[-20:]
    out: dict = {"session_id": s.id, "lang": L, "results": None, "question_field": None, "action": None, "updates": None}

    if not text:
        out["reply"] = await _render(s, i18n.t("greeting", "en"), i18n.t("greeting", LT))
        return _done(s, out)

    if nlu.INTENT_RESET.search(nlu.normalize(text)):
        uid, lang, prof = s.user_id, s.lang, s.profile
        SESSIONS.pop(s.id, None)
        ns = get_session(None, uid, lang, {"data": prof, "state_code": s.saved_state_code, "district_id": s.saved_district_id} if s.user_id else None)
        out["session_id"] = ns.id
        out["reply"] = await _render(ns, i18n.t("reset", "en") + " " + i18n.t("greeting", "en"), i18n.t("reset", LT) + " " + i18n.t("greeting", LT))
        return _done(ns, out)

    # Answer to "may I save these details?"
    if s.pending_save is not None:
        yn = nlu.yes_no(text)
        if yn is True:
            out["action"] = "save_confirmed"
            out["updates"] = s.pending_save
            out["state_code"], out["district_id"] = s.state_code, s.district_id
            s.pending_save = None
            out["reply"] = await _render(s, i18n.t("saved", "en"), i18n.t("saved", LT))
            return _done(s, out)
        if yn is False:
            s.pending_save = None
            out["reply"] = await _render(s, i18n.t("not_saved", "en"), i18n.t("not_saved", LT))
            return _done(s, out)
        s.pending_save = None  # moved on to something else

    # Questions about a specific scheme
    all_schemes = await db.candidate_schemes(s.state_code)
    mention = _find_scheme_mention(text, all_schemes)
    if mention:
        ev = engine.evaluate_scheme(mention, engine.build_facts(s.facts, s.state_code, s.district_id))
        eng = i18n.t("scheme_info", "en", name=mention["name"], desc=mention.get("short_description", ""), benefit=mention.get("benefit_amount") or "—", elig=mention.get("eligibility_text") or "")
        tmpl = i18n.t("scheme_info", LT, name=mention["name"], desc=mention.get("short_description", ""), benefit=mention.get("benefit_amount") or "—", elig=mention.get("eligibility_text") or "")
        out["results"] = {"eligible": [], "more_info": [], "not_eligible": [], "focus": _public_result(ev)}
        out["reply"] = await _render(s, eng + " " + i18n.t("disclaimer", "en"), tmpl + " " + i18n.t("disclaimer", LT))
        return _done(s, out)

    skipped = bool(SKIP_RE.search(nlu.normalize(text)))
    cands = await _extract(s, text)
    changed = _merge(s, cands)
    if s.expecting and (skipped or nlu.UNSURE.search(nlu.normalize(text)) or s.expecting not in changed):
        if s.expecting not in s.asked:
            s.asked.append(s.expecting)
    if not changed and not skipped and s.expecting and not nlu.INTENT_RESULTS.search(nlu.normalize(text)) and nlu.yes_no(text) is None and not nlu.UNSURE.search(nlu.normalize(text)):
        out["reply"] = await _render(s, i18n.t("didnt_get", "en") + " " + (i18n.question(s.expecting, "en") or ""), i18n.t("didnt_get", LT) + " " + (i18n.question(s.expecting, LT) or ""))
        out["question_field"] = s.expecting
        return _done(s, out)

    state_nm = await db.state_name(s.state_code) if s.state_code else None
    schemes = await db.candidate_schemes(s.state_code)
    facts = engine.build_facts(s.facts, s.state_code, s.district_id)
    groups = engine.match_all(schemes, facts)

    summary = _summary(s, changed, state_nm)
    pre_en = (i18n.t("understood", "en", facts=_summary(s, changed, state_nm, "en")) + " ") if summary else ""
    pre_t = (i18n.t("understood", LT, facts=summary) + " ") if summary else ""
    if sum(1 for h in s.history if h["role"] == "user") == 1 and summary:
        pre_en, pre_t = i18n.t("intro_help", "en") + " " + pre_en, i18n.t("intro_help", LT) + " " + pre_t

    want_results = bool(nlu.INTENT_RESULTS.search(nlu.normalize(text)))
    q = None if want_results else _next_question(s, groups)
    if q:
        s.expecting = q
        if q not in s.asked:
            s.asked.append(q)
        out["question_field"] = q
        out["reply"] = await _render(s, pre_en + i18n.question(q, "en"), pre_t + i18n.question(q, LT))
        out["progress"] = {"eligible_so_far": len(groups[engine.ELIGIBLE]), "checked": len(schemes)}
        return _done(s, out)

    # Present results
    s.expecting = None
    place = (f"{s.district_name}, {state_nm}" if s.district_name else state_nm) if state_nm else None
    el = groups[engine.ELIGIBLE]
    res = {k: [_public_result(e) for e in v] for k, v in groups.items()}
    out["results"] = res
    if el:
        lines_en = [i18n.t("scheme_line", "en", name=e["scheme"]["name"], benefit=e["scheme"].get("benefit_amount") or e["scheme"].get("short_description", "")) for e in el[:3]]
        lines_t = [i18n.t("scheme_line", LT, name=e["scheme"]["name"], benefit=e["scheme"].get("benefit_amount") or e["scheme"].get("short_description", "")) for e in el[:3]]
        head_en = i18n.t("results_head", "en", total=len(schemes), place=place or i18n.t("whole_india", "en"), n=len(el))
        head_t = i18n.t("results_head", LT, total=len(schemes), place=place or i18n.t("whole_india", LT), n=len(el))
    else:
        lines_en, lines_t = [], []
        head_en = i18n.t("results_none", "en", total=len(schemes), place=place or i18n.t("whole_india", "en"))
        head_t = i18n.t("results_none", LT, total=len(schemes), place=place or i18n.t("whole_india", LT))
    more_en = (" " + i18n.t("results_more", "en", n=len(groups[engine.MORE_INFO]))) if groups[engine.MORE_INFO] else ""
    more_t = (" " + i18n.t("results_more", LT, n=len(groups[engine.MORE_INFO]))) if groups[engine.MORE_INFO] else ""
    eng = pre_en + head_en + " " + " ".join(lines_en) + more_en + " " + i18n.t("disclaimer", "en")
    tmpl = pre_t + head_t + " " + " ".join(lines_t) + more_t + " " + i18n.t("disclaimer", LT)

    if s.user_id and not s.offered_save:
        upd = _new_profile_updates(s)
        if (s.state_code and s.state_code != s.saved_state_code) or (s.district_id and s.district_id != s.saved_district_id):
            upd["_location"] = {"state_code": s.state_code, "district_id": s.district_id}
        if upd:
            s.pending_save = upd
            s.offered_save = True
            out["action"] = "ask_save"
            out["updates"] = upd
            eng += " " + i18n.t("ask_save", "en")
            tmpl += " " + i18n.t("ask_save", LT)
    out["reply"] = await _render(s, eng, tmpl)
    return _done(s, out)


def _done(s: Session, out: dict) -> dict:
    s.history.append({"role": "assistant", "text": out.get("reply", "")})
    s.history = s.history[-20:]
    out["context"] = {
        "state_code": s.state_code, "district_id": s.district_id, "district_name": s.district_name,
        "facts": {k: v for k, v in s.facts.items() if k != "flags"}, "flags": s.facts.get("flags", {}),
    }
    return out
