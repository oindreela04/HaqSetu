"""
Deterministic information extraction for HaqSetu Voice AI.

Extracts profile facts (state, district, age, income, occupation, gender, …) from
English, Hindi (Devanagari + romanised Hinglish) and Bengali text, including
code-mixed sentences. When an LLM provider is configured, llm.extract() is used
in addition and its output is validated against the same field catalogue.

Everything returned here is a *candidate* fact; the dialogue layer asks the user
before saving anything to their profile.
"""
from __future__ import annotations

import json
import os
import re
import unicodedata

_HERE = os.path.dirname(__file__)
with open(os.path.join(_HERE, "states.json"), encoding="utf-8") as fh:
    STATES = json.load(fh)  # [{code, name}]

_DIGITS = str.maketrans("०१२३४५६७८९০১২৩৪৫৬৭৮৯", "01234567890123456789")

# Native-script and common romanised names for every state / UT.
STATE_ALIASES: dict[str, list[str]] = {
    "AP": ["andhra pradesh", "andhra", "आंध्र प्रदेश", "आंध्र", "অন্ধ্রপ্রদেশ", "অন্ধ্র প্রদেশ"],
    "AR": ["arunachal pradesh", "arunachal", "अरुणाचल प्रदेश", "अरुणाचल", "অরুণাচল প্রদেশ", "অরুণাচল"],
    "AS": ["assam", "असम", "আসাম", "অসম"],
    "BR": ["bihar", "बिहार", "বিহার"],
    "CG": ["chhattisgarh", "chattisgarh", "छत्तीसगढ़", "ছত্তিশগড়"],
    "GA": ["goa", "गोवा", "গোয়া"],
    "GJ": ["gujarat", "गुजरात", "গুজরাট"],
    "HR": ["haryana", "हरियाणा", "হরিয়ানা"],
    "HP": ["himachal pradesh", "himachal", "हिमाचल प्रदेश", "हिमाचल", "হিমাচল প্রদেশ", "হিমাচল"],
    "JH": ["jharkhand", "झारखंड", "झारखण्ड", "ঝাড়খণ্ড"],
    "KA": ["karnataka", "कर्नाटक", "কর্ণাটক"],
    "KL": ["kerala", "केरल", "কেরালা", "কেরল"],
    "MP": ["madhya pradesh", "mp", "मध्य प्रदेश", "मध्यप्रदेश", "মধ্যপ্রদেশ", "মধ্য প্রদেশ"],
    "MH": ["maharashtra", "महाराष्ट्र", "মহারাষ্ট্র"],
    "MN": ["manipur", "मणिपुर", "মণিপুর"],
    "ML": ["meghalaya", "मेघालय", "মেঘালয়"],
    "MZ": ["mizoram", "मिज़ोरम", "मिजोरम", "মিজোরাম"],
    "NL": ["nagaland", "नागालैंड", "নাগাল্যান্ড"],
    "OD": ["odisha", "orissa", "ओडिशा", "उड़ीसा", "ওড়িশা"],
    "PB": ["punjab", "पंजाब", "পাঞ্জাব"],
    "RJ": ["rajasthan", "राजस्थान", "রাজস্থান"],
    "SK": ["sikkim", "सिक्किम", "সিকিম"],
    "TN": ["tamil nadu", "tamilnadu", "तमिलनाडु", "तमिल नाडु", "তামিলনাড়ু"],
    "TS": ["telangana", "तेलंगाना", "তেলেঙ্গানা"],
    "TR": ["tripura", "त्रिपुरा", "ত্রিপুরা"],
    "UP": ["uttar pradesh", "up", "उत्तर प्रदेश", "উত্তরপ্রদেশ", "উত্তর প্রদেশ"],
    "UK": ["uttarakhand", "uttaranchal", "उत्तराखंड", "उत्तराखण्ड", "উত্তরাখণ্ড"],
    "WB": ["west bengal", "bengal", "paschim banga", "पश्चिम बंगाल", "बंगाल", "পশ্চিমবঙ্গ", "পশ্চিম বঙ্গ"],
    "AN": ["andaman and nicobar", "andaman", "अंडमान", "আন্দামান"],
    "CH": ["chandigarh", "चंडीगढ़", "চণ্ডীগড়"],
    "DH": ["dadra and nagar haveli", "daman and diu", "dadra", "daman", "diu", "दादरा", "दमन", "দাদরা", "দমন"],
    "DL": ["delhi", "new delhi", "दिल्ली", "দিল্লি"],
    "JK": ["jammu and kashmir", "jammu", "kashmir", "जम्मू", "कश्मीर", "জম্মু", "কাশ্মীর"],
    "LA": ["ladakh", "लद्दाख", "লাদাখ"],
    "LD": ["lakshadweep", "लक्षद्वीप", "লাক্ষাদ্বীপ"],
    "PY": ["puducherry", "pondicherry", "पुदुचेरी", "পুদুচেরি"],
}
# Short, ambiguous aliases only count as whole words.
_SHORT = {"mp", "up"}

NUMBER_WORDS = {
    # English
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
    "half": 0.5, "one and half": 1.5, "two and half": 2.5, "dedh": 1.5, "dhai": 2.5, "dhaai": 2.5,
    # Hindi
    "ek": 1, "do": 2, "teen": 3, "char": 4, "chaar": 4, "paanch": 5, "panch": 5, "chhe": 6, "saat": 7, "aath": 8, "nau": 9, "das": 10,
    "एक": 1, "दो": 2, "तीन": 3, "चार": 4, "पांच": 5, "पाँच": 5, "छह": 6, "सात": 7, "आठ": 8, "नौ": 9, "दस": 10, "डेढ़": 1.5, "ढाई": 2.5,
    # Bengali
    "এক": 1, "দুই": 2, "দু": 2, "তিন": 3, "চার": 4, "পাঁচ": 5, "ছয়": 6, "সাত": 7, "আট": 8, "নয়": 9, "দশ": 10, "দেড়": 1.5, "আড়াই": 2.5,
}

YES = ["yes", "yeah", "yep", "haan", "han", "haa", "ha", "ji haan", "ji", "sure", "correct", "right", "हाँ", "हां", "जी", "जी हाँ", "हा", "সঠিক", "হ্যাঁ", "হ্যা", "হাঁ", "আছে", "है", "हैं", "ok", "okay"]
NO = ["no", "nope", "nahi", "nahin", "na", "not", "नहीं", "नही", "ना", "না", "নেই", "নাই"]

OCCUPATION_WORDS: list[tuple[str, dict]] = [
    (r"tenant farmer|sharecropper|bataidar|batai|बटाईदार|बटाई|ভাগচাষি|ভাগ চাষি", {"occupation": "farmer", "flags": {"is_farmer_landholder": False}}),
    (r"farmer|kisan|kisaan|cultivator|kheti|किसान|खेती|কৃষক|চাষি|চাষী|চাষ", {"occupation": "farmer"}),
    (r"agricultural labou?r|khet mazdoor|खेतिहर मज़दूर|खेत मजदूर|ক্ষেতমজুর|কৃষি শ্রমিক", {"occupation": "agri_labourer", "flags": {"is_unorganised_worker": True}}),
    (r"fisher|fisherman|machhuara|मछुआरा|মৎস্যজীবী|জেলে", {"occupation": "fisher"}),
    (r"street vendor|hawker|thela|rehri|फेरीवाला|ठेला|रेहड़ी|हॉकर|ফেরিওয়ালা|হকার", {"occupation": "street_vendor", "employment": "self_employed", "flags": {"is_unorganised_worker": True}}),
    (r"artisan|craftsman|karigar|carpenter|blacksmith|potter|tailor|cobbler|barber|कारीगर|बढ़ई|लोहार|कुम्हार|दर्जी|मोची|नाई|কারিগর|ছুতোর|কামার|কুমোর|দর্জি|মুচি|নাপিত", {"occupation": "artisan", "employment": "self_employed"}),
    (r"construction worker|mason|raj mistri|मिस्त्री|निर्माण मज़दूर|রাজমিস্ত্রি|নির্মাণ শ্রমিক", {"occupation": "construction_worker", "flags": {"is_unorganised_worker": True}}),
    (r"domestic worker|maid|kaamwali|घरेलू कामगार|কাজের মাসি|গৃহকর্মী", {"occupation": "domestic_worker", "flags": {"is_unorganised_worker": True}}),
    (r"daily wage|labou?rer|mazdoor|majdoor|मज़दूर|मजदूर|দিনমজুর|শ্রমিক", {"employment": "daily_wage", "flags": {"is_unorganised_worker": True}}),
    (r"shopkeeper|small shop|dukaan|दुकान|দোকান", {"occupation": "shopkeeper", "employment": "self_employed", "flags": {"has_existing_enterprise": True}}),
    (r"driver|ड्राइवर|চালক|ড্রাইভার", {"occupation": "driver"}),
    (r"student|studying|padhai|chhatra|chhatr|छात्र|छात्रा|पढ़ाई|পড়াশোনা|ছাত্র|ছাত্রী", {"employment": "student", "flags": {"is_enrolled_in_education": True}}),
    (r"unemployed|jobless|no job|berozgar|बेरोज़गार|बेरोजगार|বেকার", {"employment": "unemployed"}),
    (r"housewife|homemaker|grihini|गृहिणी|গৃহিণী", {"employment": "homemaker"}),
    (r"retired|सेवानिवृत्त|रिटायर|অবসরপ্রাপ্ত", {"employment": "retired"}),
    (r"business|own shop|self[- ]employed|vyapar|व्यापार|व्यवसाय|ব্যবসা", {"employment": "self_employed", "flags": {"has_existing_enterprise": True}}),
    (r"government job|govt job|sarkari naukri|सरकारी नौकरी|সরকারি চাকরি", {"employment": "salaried_govt", "flags": {"is_govt_employee_family": True}}),
    (r"private job|company|naukri|नौकरी|চাকরি", {"employment": "salaried_private"}),
]

GENDER_WORDS = [
    (r"\b(woman|female|girl|lady|widow|mother|wife)\b|mahila|aurat|ladki|महिला|औरत|लड़की|स्त्री|विधवा|মহিলা|মেয়ে|নারী|বিধবা", "female"),
    (r"\b(man|male|boy|husband)\b|purush|aadmi|ladka|पुरुष|आदमी|लड़का|পুরুষ|ছেলে", "male"),
    (r"transgender|kinnar|किन्नर|ট্রান্সজেন্ডার|হিজড়া", "transgender"),
]

EDU_WORDS = [
    (r"ph\.?d|doctorate|पीएचडी", "doctorate"),
    (r"post ?graduat|\bpg\b|m\.?a\b|m\.?sc|m\.?com|mba|स्नातकोत्तर|স্নাতকোত্তর", "postgraduate"),
    (r"graduat|college|degree|\bug\b|b\.?a\b|b\.?sc|b\.?com|b\.?tech|स्नातक|कॉलेज|স্নাতক|কলেজ", "undergraduate"),
    (r"diploma|\biti\b|polytechnic|डिप्लोमा|ডিপ্লোমা", "diploma"),
    (r"class ?1[12]|12th|11th|twelfth|higher secondary|intermediate|12वीं|बारहवीं|উচ্চমাধ্যমিক|দ্বাদশ", "higher_secondary"),
    (r"class ?(9|10)|10th|matric|secondary|10वीं|दसवीं|মাধ্যমিক|দশম", "secondary"),
    (r"class ?[678]|8th|middle school|8वीं|অষ্টম", "middle"),
    (r"class ?[1-5]\b|primary|प्राथमिक|প্রাথমিক", "primary"),
    (r"illiterate|no schooling|never went to school|अनपढ़|निरक्षर|নিরক্ষর", "none"),
]

SOCIAL_WORDS = [(r"\bobc\b|ओबीसी|পিছিয়ে পড়া", "obc"), (r"\bsc\b|scheduled caste|dalit|अनुसूचित जाति|দলিত|তফসিলি জাতি", "sc"),
                (r"\bst\b|scheduled tribe|adivasi|tribal|अनुसूचित जनजाति|आदिवासी|আদিবাসী|তফসিলি উপজাতি", "st"),
                (r"\bews\b", "ews"), (r"\bgeneral\b|सामान्य|জেনারেল|সাধারণ", "general")]

MARITAL_WORDS = [(r"widow|vidhwa|विधवा|বিধবা", "widowed"), (r"divorc|separated|तलाक|তালাক", "divorced"),
                 (r"unmarried|single|kunwari|अविवाहित|कुंवारी|অবিবাহিত", "unmarried"), (r"married|shaadi|विवाहित|शादीशुदा|বিবাহিত", "married")]

FLAG_PATTERNS = [
    (r"own (agricultural )?land|have (agricultural )?land|zameen hai|jameen hai|ज़मीन है|जमीन है|अपनी ज़मीन|জমি আছে|নিজের জমি", {"is_farmer_landholder": True}),
    (r"(no|don'?t have|without) (agricultural )?land|zameen nahi|ज़मीन नहीं|जमीन नहीं|জমি নেই", {"is_farmer_landholder": False}),
    (r"\bbpl\b|antyodaya|ration card|राशन कार्ड|बीपीएल|अंत्योदय|রেশন কার্ড|বিপিএল", {"is_bpl": True, "has_ration_card": True}),
    (r"(no|without|don'?t have) (a )?bank account|bank account nahi|बैंक खाता नहीं|ব্যাংক অ্যাকাউন্ট নেই", {"has_bank_account": False}),
    (r"bank account|बैंक खाता|ব্যাংক অ্যাকাউন্ট", {"has_bank_account": True}),
    (r"disab|viklang|divyang|विकलांग|दिव्यांग|প্রতিবন্ধী", {"has_disability": True}),
    (r"pregnant|garbhvati|गर्भवती|গর্ভবতী", {"is_pregnant_or_lactating": True}),
    (r"(no|without) (a )?(pucca|pakka) house|kutcha house|kachcha|कच्चा मकान|पक्का मकान नहीं|কাঁচা বাড়ি", {"owns_pucca_house": False}),
    (r"(no|without) (an )?lpg|no gas connection|gas connection nahi|गैस कनेक्शन नहीं|গ্যাস নেই", {"has_lpg_connection": False}),
    (r"income tax", {"is_income_tax_payer": True}),
    (r"village|gaon|gaanv|गांव|गाँव|গ্রাম", {"_residence": "rural"}),
    (r"\bcity\b|\btown\b|shahar|शहर|শহর", {"_residence": "urban"}),
    (r"daughter|beti|बेटी|মেয়ে আছে", {}),
]


def normalize(text: str) -> str:
    t = unicodedata.normalize("NFC", text or "").translate(_DIGITS)
    t = t.replace("₹", " rs ").replace(",", "")
    return re.sub(r"\s+", " ", t).strip().lower()


def _find_state(t: str) -> str | None:
    best: tuple[int, str] | None = None
    for code, aliases in STATE_ALIASES.items():
        for a in aliases:
            if a in _SHORT:
                m = re.search(rf"(?<![a-z]){re.escape(a)}(?![a-z])", t)
            else:
                m = re.search(re.escape(a), t)
            if m and (best is None or len(a) > best[0]):
                best = (len(a), code)
    return best[1] if best else None


def _num_token(tok: str) -> float | None:
    tok = tok.strip()
    try:
        return float(tok)
    except ValueError:
        return NUMBER_WORDS.get(tok)


_NUMTOK = r"(\d+(?:\.\d+)?|one and half|two and half|[a-z]+|[ऀ-ॿ]+|[ঀ-৿]+)"


def _find_income(t: str) -> dict:
    out: dict = {}
    monthly = bool(re.search(r"per month|monthly|a month|mahina|mahine|महीना|महीने|प्रति माह|মাসে|মাসিক", t))
    # "2 lakh", "do lakh", "দুই লাখ"
    m = re.search(_NUMTOK + r"\s*(?:lakh|lac|lakhs|लाख|লাখ|লক্ষ)", t)
    amount = None
    if m:
        n = _num_token(m.group(1))
        if n is not None:
            amount = n * 100000
    if amount is None:
        m = re.search(_NUMTOK + r"\s*(?:thousand|hazaar|hazar|हज़ार|हजार|হাজার)", t)
        if m:
            n = _num_token(m.group(1))
            if n is not None:
                amount = n * 1000
    if amount is None:
        m = re.search(r"(?:income|earn|kamai|aay|aamdani|आय|आमदनी|कमाई|আয়|রোজগার|rs|rupees|रुपये|টাকা)\D{0,25}?(\d{4,8})", t) or re.search(r"(\d{4,8})\s*(?:rs|rupees|रुपये|रुपए|টাকা)", t)
        if m:
            amount = float(m.group(1))
    if amount is not None and amount > 0:
        # "below/under/less than X" is treated as X — the citizen's income is at most X.
        if monthly:
            out["monthly_income"] = amount
            out["annual_income_hint_monthly"] = amount
        else:
            out["annual_income"] = amount
    return out


def _find_age(t: str) -> float | None:
    m = (re.search(r"(\d{1,3})\s*(?:years?|yrs?|year old|saal|sal|baras|वर्ष|साल|बरस|বছর|বয়স)", t)
         or re.search(r"(?:age|aged|umar|umr|उम्र|आयु|বয়স)\D{0,12}(\d{1,3})", t)
         or re.search(r"\b(?:i am|i'm|main|mai)\s+(\d{1,3})\b", t))
    if m:
        a = float(m.group(1))
        if 0 < a < 120:
            return a
    return None


def extract(text: str, districts: list[dict] | None = None, expecting: str | None = None) -> dict:
    """Return candidate facts: {field: value, flags: {...}, state_code, district_id}."""
    t = normalize(text)
    out: dict = {"flags": {}}
    if not t:
        return out
    code = _find_state(t)
    if code:
        out["state_code"] = code
    if districts:
        for d in sorted(districts, key=lambda d: -len(d["name"])):
            nm = d["name"].lower()
            if re.search(rf"(?<![a-z]){re.escape(nm)}(?![a-z])", t):
                out["district_id"] = d["id"]
                out["district_name"] = d["name"]
                break
    age = _find_age(t)
    if age is not None:
        out["age"] = age
    out.update({k: v for k, v in _find_income(t).items() if not k.endswith("_hint_monthly")})
    for pat, vals in OCCUPATION_WORDS:
        if re.search(pat, t):
            for k, v in vals.items():
                if k == "flags":
                    for fk, fv in v.items():
                        out["flags"].setdefault(fk, fv)
                else:
                    out.setdefault(k, v)
    for pat, val in GENDER_WORDS:
        if re.search(pat, t):
            out["gender"] = val
            break
    for pat, val in EDU_WORDS:
        if re.search(pat, t):
            out["education"] = val
            break
    for pat, val in SOCIAL_WORDS:
        if re.search(pat, t):
            out["social_category"] = val
            break
    for pat, val in MARITAL_WORDS:
        if re.search(pat, t):
            out["marital_status"] = val
            break
    for pat, vals in FLAG_PATTERNS:
        if re.search(pat, t):
            for k, v in vals.items():
                if k == "_residence":
                    out.setdefault("residence", v)
                else:
                    out["flags"].setdefault(k, v)
    # Context: the answer to the question we just asked.
    if expecting:
        yn = yes_no(t)
        if expecting.startswith("flag:") and yn is not None:
            out["flags"][expecting[5:]] = yn
        elif expecting == "age" and "age" not in out:
            m = re.search(r"\b(\d{1,3})\b", t)
            if m and 0 < int(m.group(1)) < 120:
                out["age"] = float(m.group(1))
        elif expecting == "annual_income" and "annual_income" not in out and "monthly_income" not in out:
            m = re.search(r"\b(\d{4,8})\b", t)
            if m:
                out["annual_income"] = float(m.group(1))
            elif yn is False or re.search(r"\b(no income|zero|nil)\b|कोई आय नहीं|আয় নেই", t):
                out["annual_income"] = 0.0
        elif expecting == "monthly_income" and "monthly_income" not in out:
            m = re.search(r"\b(\d{3,7})\b", t)
            if m:
                out["monthly_income"] = float(m.group(1))
        elif expecting == "disability_percent":
            m = re.search(r"\b(\d{1,3})\s*%?", t)
            if m and int(m.group(1)) <= 100:
                out["disability_percent"] = float(m.group(1))
            elif yn is False:
                out["disability_percent"] = 0.0
                out["flags"]["has_disability"] = False
    if not out["flags"]:
        out.pop("flags")
    return out


UNSURE = re.compile(r"not sure|don'?t know|no idea|pata nahi|maloom nahi|पता नहीं|मालूम नहीं|জানি না|নিশ্চিত নই")


def yes_no(t: str) -> bool | None:
    t = normalize(t)
    if UNSURE.search(t):
        return None
    words = re.findall(r"[\wऀ-ॿঀ-৿']+", t)
    head = " ".join(words[:3])
    for n in NO:
        if re.search(rf"(?<![\wऀ-ॿঀ-৿]){re.escape(n)}(?![\wऀ-ॿঀ-৿])", head):
            return False
    for y in YES:
        if re.search(rf"(?<![\wऀ-ॿঀ-৿]){re.escape(y)}(?![\wऀ-ॿঀ-৿])", head):
            return True
    return None


INTENT_RESULTS = re.compile(r"show (me )?(the )?(results|schemes)|skip|that'?s all|nothing else|no more|बस|दिखाओ|योजनाएं दिखा|রেজাল্ট|দেখাও|আর কিছু না")
INTENT_RESET = re.compile(r"start (again|over)|reset|new conversation|फिर से शुरू|আবার শুরু")
