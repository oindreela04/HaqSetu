"""The Python engine must agree with the JavaScript engine on every seeded scheme."""
import itertools
import json
import os
import random
import subprocess

from voice import engine

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
SCHEMES = json.loads(subprocess.check_output(["node", os.path.join(ROOT, "scripts", "dump-seed.js")]))


def profiles():
    rnd = random.Random(42)
    states = ["WB", "MH", "BR", "TN", "UP", "KA", "OD", "JH", "MP", "GA", None]
    flags = list(engine.FIELDS)
    bool_flags = [k for k, v in engine.FIELDS.items() if v["type"] == "bool"]
    cases = [{"profile": {}, "state": None, "district": None}]
    for _ in range(250):
        p = {"flags": {}}
        if rnd.random() < .9: p["age"] = rnd.choice([5, 15, 19, 21, 24, 30, 40, 45, 55, 60, 65, 70, 82])
        for k in ("gender", "residence", "education", "employment", "occupation", "social_category", "marital_status"):
            if rnd.random() < .6: p[k] = rnd.choice(engine.FIELDS[k]["options"])[0]
        if rnd.random() < .7: p["annual_income"] = rnd.choice([0, 50000, 120000, 180000, 250000, 300000, 450000, 799999, 900000, 2000000])
        if rnd.random() < .4: p["monthly_income"] = rnd.choice([5000, 15000, 30000])
        if rnd.random() < .2: p["disability_percent"] = rnd.choice([0, 40, 80, 100])
        for f in rnd.sample(bool_flags, rnd.randint(0, len(bool_flags))):
            p["flags"][f] = rnd.random() < .5
        cases.append({"profile": p, "state": rnd.choice(states), "district": None})
    return cases


def test_python_matches_javascript():
    cases = profiles()
    js = json.loads(subprocess.run(["node", os.path.join(ROOT, "scripts", "eval-js.js")], input=json.dumps(cases), capture_output=True, text=True, check=True).stdout)
    mismatches = []
    for c, js_row in zip(cases, js):
        facts = engine.build_facts(c["profile"], c["state"], c["district"])
        for s, j in zip(SCHEMES, js_row):
            ev = engine.evaluate_scheme(s, facts)
            py = {"status": ev["status"], "missing": sorted(ev.get("missing_fields", [])), "met": len(ev.get("met", [])), "unmet": ev.get("unmet", [])}
            jj = {k: j[k] for k in ("status", "missing", "met", "unmet")}
            if py != jj:
                mismatches.append((s["slug"], c, py, jj))
    assert not mismatches, mismatches[:3]
