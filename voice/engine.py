"""
HaqSetu deterministic eligibility engine (Python port of src/eligibility.js).

Same rule format and the same three-valued logic (True / False / None=unknown).
voice/tests/test_engine_parity.py runs both engines over every seeded scheme and
many profiles and fails if they ever disagree. No language model is involved.
"""
from __future__ import annotations

import json
import os
from datetime import date
from typing import Any

_HERE = os.path.dirname(__file__)
with open(os.path.join(_HERE, "fields.json"), encoding="utf-8") as fh:
    _CAT = json.load(fh)
FIELDS: dict[str, dict] = _CAT["FIELDS"]
EDU_ORDER: list[str] = _CAT["EDU_ORDER"]

ELIGIBLE, MORE_INFO, NOT_ELIGIBLE, OUT_OF_AREA = "eligible", "more_info", "not_eligible", "out_of_area"


def age_from_dob(dob: str | None, today: date | None = None) -> int | None:
    if not dob:
        return None
    try:
        y, m, d = (int(x) for x in str(dob)[:10].split("-"))
    except ValueError:
        return None
    t = today or date.today()
    age = t.year - y
    if (t.month, t.day) < (m, d):
        age -= 1
    return age


def _num(v: Any) -> float | None:
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def build_facts(profile: dict | None, state_code: str | None = None, district_id: int | None = None) -> dict:
    p = profile or {}
    f: dict[str, Any] = {}
    f["age"] = age_from_dob(p.get("dob")) if p.get("dob") else _num(p.get("age"))
    for k in ("gender", "residence", "education", "employment", "occupation", "social_category", "marital_status"):
        if p.get(k) and p.get(k) != "prefer_not":
            f[k] = p[k]
    for k in ("annual_income", "monthly_income", "family_size", "disability_percent", "class12_percent", "last_exam_percent"):
        f[k] = _num(p.get(k))
    for k, v in (p.get("flags") or {}).items():
        if v is True or v == "yes":
            f[k] = True
        elif v is False or v == "no":
            f[k] = False
    if f.get("has_disability") is None and f.get("disability_percent") is not None:
        f["has_disability"] = f["disability_percent"] > 0
    f["state_code"] = state_code or None
    f["district_id"] = district_id or None
    return {k: v for k, v in f.items() if v is not None}


def _opt_label(options: list, key: str) -> str:
    for k, label in options or []:
        if k == key:
            return label
    return str(key)


def _fmt(field: str, v: Any) -> str:
    d = FIELDS.get(field)
    if not d:
        return str(v)
    if d["type"] == "enum":
        if isinstance(v, list):
            return ", ".join(_opt_label(d.get("options"), x) for x in v)
        return _opt_label(d.get("options"), v)
    if d.get("unit") == "₹":
        n = int(float(v))
        s = str(n)
        # Indian digit grouping
        if len(s) > 3:
            head, tail = s[:-3], s[-3:]
            parts = []
            while len(head) > 2:
                parts.insert(0, head[-2:])
                head = head[:-2]
            if head:
                parts.insert(0, head)
            s = ",".join(parts) + "," + tail
        return "₹" + s
    if d.get("unit") == "%":
        return f"{_clean(v)}%"
    return str(_clean(v))


def _clean(v: Any) -> Any:
    if isinstance(v, float) and v.is_integer():
        return int(v)
    return v


def describe(leaf: dict) -> str:
    if leaf.get("label"):
        return leaf["label"]
    d = FIELDS.get(leaf.get("field"), {"label": leaf.get("field")})
    L, op, v, f = d["label"], leaf.get("op"), leaf.get("value"), leaf.get("field")
    if op == "gte":
        return f"{L} at least {_fmt(f, v)}"
    if op == "gt":
        return f"{L} more than {_fmt(f, v)}"
    if op == "lte":
        return f"{L} up to {_fmt(f, v)}"
    if op == "lt":
        return f"{L} below {_fmt(f, v)}"
    if op == "between":
        return f"{L} between {_fmt(f, v[0])} and {_fmt(f, v[1])}"
    if op in ("eq", "in"):
        return f"{L}: {_fmt(f, v)}"
    if op in ("neq", "nin"):
        return f"{L} is not {_fmt(f, v)}"
    if op == "level_gte":
        return f"{L}: {_opt_label(d.get('options'), v)} or higher"
    if op == "level_lte":
        return f"{L}: {_opt_label(d.get('options'), v)} or lower"
    if op == "is":
        return L if v else f"Not true: “{L}”"
    return f"{L} {op} {v}"


def eval_leaf(leaf: dict, facts: dict) -> bool | None:
    if leaf.get("op") == "manual":
        return None
    val = facts.get(leaf.get("field"))
    if val is None or val == "":
        return None
    op, v = leaf.get("op"), leaf.get("value")
    try:
        if op == "gte":
            return float(val) >= float(v)
        if op == "gt":
            return float(val) > float(v)
        if op == "lte":
            return float(val) <= float(v)
        if op == "lt":
            return float(val) < float(v)
        if op == "between":
            return float(v[0]) <= float(val) <= float(v[1])
        if op == "eq":
            return val == v
        if op == "neq":
            return val != v
        if op == "in":
            return isinstance(v, list) and val in v
        if op == "nin":
            return isinstance(v, list) and val not in v
        if op == "level_gte":
            return EDU_ORDER.index(val) >= EDU_ORDER.index(v)
        if op == "level_lte":
            return EDU_ORDER.index(val) <= EDU_ORDER.index(v)
        if op == "is":
            return bool(val) == bool(v)
    except (TypeError, ValueError):
        return None
    return None


def _res(r: bool | None) -> str:
    return "met" if r is True else "unmet" if r is False else "unknown"


def eval_node(node: Any, facts: dict, trace: list) -> bool | None:
    if not isinstance(node, dict):
        return True
    if isinstance(node.get("all"), list) or isinstance(node.get("any"), list):
        is_all = isinstance(node.get("all"), list)
        children = node["all"] if is_all else node["any"]
        if not children:
            return True
        results = []
        for child in children:
            ct: list = []
            r = eval_node(child, facts, ct)
            results.append((r, ct, child.get("mandatory") is not False if isinstance(child, dict) else True))
        counted = [x for x in results if x[2]]
        if not counted:
            out: bool | None = True
        elif is_all:
            out = False if any(x[0] is False for x in counted) else None if any(x[0] is None for x in counted) else True
        else:
            out = True if any(x[0] is True for x in counted) else None if any(x[0] is None for x in counted) else False
        if not is_all:
            opts = [" and ".join(t["label"] for t in ct) for _, ct, _ in results]
            opts = [o for o in opts if o]
            missing: list[str] = []
            for _, ct, _ in results:
                for t in ct:
                    if t["result"] == "unknown" and t["field"] and t["field"] not in missing:
                        missing.append(t["field"])
            trace.append({
                "label": node.get("label") or "Any one of: " + " OR ".join(opts),
                "result": _res(out), "field": missing[0] if missing else None, "fields": missing,
                "mandatory": node.get("mandatory") is not False,
            })
        else:
            for _, ct, _ in results:
                trace.extend(ct)
        return out
    r = eval_leaf(node, facts)
    if r is False and node.get("falseIsUnknown"):
        r = None
    fld = node.get("field")
    trace.append({
        "label": describe(node), "result": _res(r), "field": fld,
        "fields": [fld] if (r is None and node.get("op") != "manual" and facts.get(fld) is None) else [],
        "mandatory": node.get("mandatory") is not False,
    })
    return r


def location_applies(scheme: dict, facts: dict) -> str:
    codes = scheme.get("state_codes") or []
    dids = scheme.get("district_ids") or []
    if scheme.get("level") == "central":
        if codes:
            if not facts.get("state_code"):
                return "unknown"
            return "yes" if facts["state_code"] in codes else "no"
        return "yes"
    if not facts.get("state_code"):
        return "unknown"
    if facts["state_code"] not in codes:
        return "no"
    if scheme.get("level") == "district" or dids:
        if not dids:
            return "yes"
        if not facts.get("district_id"):
            return "unknown"
        return "yes" if int(facts["district_id"]) in [int(x) for x in dids] else "no"
    return "yes"


def evaluate_scheme(scheme: dict, facts: dict) -> dict:
    loc = location_applies(scheme, facts)
    if loc == "no":
        return {"status": OUT_OF_AREA, "scheme": scheme, "trace": []}
    trace = [{
        "label": "Available across India (Central Government scheme)" if scheme.get("level") == "central" and not scheme.get("state_codes")
        else "Available in your state / district",
        "result": "met" if loc == "yes" else "unknown", "field": None if loc == "yes" else "state",
        "fields": [] if loc == "yes" else ["state"], "mandatory": True,
    }]
    rules = scheme.get("rules") or {"all": []}
    if isinstance(rules, str):
        rules = json.loads(rules)
    r = eval_node(rules, facts, trace)
    mand = [t for t in trace if t["mandatory"]]
    if any(t["result"] == "unmet" for t in mand):
        status = NOT_ELIGIBLE
    elif r is None or loc == "unknown" or any(t["result"] == "unknown" for t in mand):
        status = MORE_INFO
    else:
        status = ELIGIBLE
    missing: list[str] = []
    for t in trace:
        if t["result"] == "unknown":
            for f in t.get("fields") or []:
                if f and f not in missing:
                    missing.append(f)
    return {
        "status": status, "scheme": scheme, "trace": trace,
        "met": [t["label"] for t in trace if t["result"] == "met"],
        "unknown": [t["label"] for t in trace if t["result"] == "unknown"],
        "unmet": [t["label"] for t in trace if t["result"] == "unmet" and t["mandatory"]],
        "missing_fields": missing,
    }


def match_all(schemes: list[dict], facts: dict) -> dict:
    groups: dict[str, list] = {ELIGIBLE: [], MORE_INFO: [], NOT_ELIGIBLE: []}
    for s in schemes:
        ev = evaluate_scheme(s, facts)
        if ev["status"] != OUT_OF_AREA:
            groups[ev["status"]].append(ev)
    groups[ELIGIBLE].sort(key=lambda e: (-len(e["met"]), len(e["missing_fields"])))
    groups[MORE_INFO].sort(key=lambda e: (len(e["missing_fields"]), -len(e["met"])))
    return groups


def unlock_suggestions(more_info: list[dict]) -> list[tuple[str, int]]:
    counts: dict[str, int] = {}
    order: list[str] = []
    for ev in more_info:
        for f in ev["missing_fields"]:
            if f not in counts:
                order.append(f)
            counts[f] = counts.get(f, 0) + 1
    return sorted(((f, counts[f]) for f in order), key=lambda x: -x[1])
