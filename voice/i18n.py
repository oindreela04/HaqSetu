"""
Response templates for HaqSetu Voice AI.

English, Hindi and Bengali are hand-written and reviewed, so these three are
enabled without any external model. Other Indian languages are enabled only when
a translation provider (IndicTrans2) or an LLM provider is configured and passes
its health check — see providers/.
"""
from __future__ import annotations

TEMPLATED_LANGS = ("en", "hi", "bn")

LANG_NAMES = {
    "en": "English", "hi": "हिन्दी", "bn": "বাংলা", "ta": "தமிழ்", "te": "తెలుగు", "mr": "मराठी", "gu": "ગુજરાતી",
    "kn": "ಕನ್ನಡ", "ml": "മലയാളം", "pa": "ਪੰਜਾਬੀ", "or": "ଓଡ଼ିଆ", "as": "অসমীয়া", "ur": "اردو",
}
# BCP-47 tags for browser speech recognition / synthesis
SPEECH_TAGS = {"en": "en-IN", "hi": "hi-IN", "bn": "bn-IN", "ta": "ta-IN", "te": "te-IN", "mr": "mr-IN", "gu": "gu-IN",
               "kn": "kn-IN", "ml": "ml-IN", "pa": "pa-IN", "or": "or-IN", "as": "as-IN", "ur": "ur-IN"}

QUESTIONS: dict[str, dict[str, str]] = {
    "state": {"en": "Which state or Union Territory do you live in?", "hi": "आप किस राज्य या केंद्रशासित प्रदेश में रहते हैं?", "bn": "আপনি কোন রাজ্য বা কেন্দ্রশাসিত অঞ্চলে থাকেন?"},
    "age": {"en": "How old are you?", "hi": "आपकी उम्र कितनी है?", "bn": "আপনার বয়স কত?"},
    "occupation": {"en": "What work do you do? For example farmer, student, daily-wage worker, street vendor, homemaker, or unemployed.", "hi": "आप क्या काम करते हैं? जैसे किसान, छात्र, दिहाड़ी मज़दूर, फेरीवाला, गृहिणी, या बेरोज़गार।", "bn": "আপনি কী কাজ করেন? যেমন কৃষক, ছাত্র, দিনমজুর, ফেরিওয়ালা, গৃহিণী, বা বেকার।"},
    "employment": {"en": "Are you working, studying, looking for work, or retired?", "hi": "क्या आप काम करते हैं, पढ़ाई करते हैं, काम ढूँढ रहे हैं, या सेवानिवृत्त हैं?", "bn": "আপনি কি কাজ করেন, পড়াশোনা করেন, কাজ খুঁজছেন, নাকি অবসরপ্রাপ্ত?"},
    "annual_income": {"en": "Roughly how much does your whole family earn in a year? An approximate figure is fine.", "hi": "आपके पूरे परिवार की सालाना आय लगभग कितनी है? अंदाज़ा भी चलेगा।", "bn": "আপনার পুরো পরিবারের বছরে মোট আয় আনুমানিক কত? আনুমানিক বললেই হবে।"},
    "monthly_income": {"en": "How much do you yourself earn in a month, approximately?", "hi": "आप खुद महीने में लगभग कितना कमाते हैं?", "bn": "আপনি নিজে মাসে আনুমানিক কত আয় করেন?"},
    "gender": {"en": "Some schemes are only for women. May I ask your gender? You can skip this.", "hi": "कुछ योजनाएँ केवल महिलाओं के लिए हैं। क्या मैं आपका लिंग पूछ सकता हूँ? आप चाहें तो छोड़ सकते हैं।", "bn": "কিছু প্রকল্প শুধু মহিলাদের জন্য। আপনার লিঙ্গ জানতে পারি? চাইলে এড়িয়ে যেতে পারেন।"},
    "education": {"en": "What is your highest education, or what are you studying now?", "hi": "आपकी सबसे ऊँची पढ़ाई क्या है, या अभी आप क्या पढ़ रहे हैं?", "bn": "আপনার সর্বোচ্চ শিক্ষা কী, বা এখন কী পড়ছেন?"},
    "social_category": {"en": "Some schemes are for SC, ST or OBC families. Which category do you belong to — General, OBC, SC, ST or EWS? You can skip this.", "hi": "कुछ योजनाएँ SC, ST या OBC परिवारों के लिए हैं। आपकी श्रेणी क्या है — सामान्य, OBC, SC, ST या EWS? आप चाहें तो छोड़ सकते हैं।", "bn": "কিছু প্রকল্প SC, ST বা OBC পরিবারের জন্য। আপনার শ্রেণি কী — সাধারণ, OBC, SC, ST নাকি EWS? চাইলে এড়িয়ে যেতে পারেন।"},
    "marital_status": {"en": "Are you married, unmarried, widowed or divorced?", "hi": "क्या आप विवाहित, अविवाहित, विधवा/विधुर या तलाकशुदा हैं?", "bn": "আপনি কি বিবাহিত, অবিবাহিত, বিধবা/বিপত্নীক নাকি বিবাহবিচ্ছিন্ন?"},
    "residence": {"en": "Do you live in a village or in a town or city?", "hi": "क्या आप गाँव में रहते हैं या शहर/कस्बे में?", "bn": "আপনি কি গ্রামে থাকেন, নাকি শহরে?"},
    "disability_percent": {"en": "If you have a disability certificate, what percentage does it show? Say 'no' if you have no disability.", "hi": "अगर आपके पास विकलांगता प्रमाणपत्र है, तो उसमें कितने प्रतिशत लिखा है? अगर कोई विकलांगता नहीं है तो 'नहीं' कहें।", "bn": "আপনার প্রতিবন্ধী শংসাপত্র থাকলে তাতে কত শতাংশ লেখা আছে? প্রতিবন্ধকতা না থাকলে 'না' বলুন।"},
    "class12_percent": {"en": "What percentage did you get in Class 12?", "hi": "कक्षा 12 में आपके कितने प्रतिशत अंक आए?", "bn": "দ্বাদশ শ্রেণিতে আপনি কত শতাংশ নম্বর পেয়েছেন?"},
    "flag:is_farmer_landholder": {"en": "Do you or your family own agricultural land, or do you work as a tenant farmer or sharecropper?", "hi": "क्या आपके या आपके परिवार के नाम खेती की ज़मीन है, या आप बटाई/किराये पर खेती करते हैं?", "bn": "আপনার বা পরিবারের নামে কি চাষের জমি আছে, নাকি আপনি ভাগচাষি হিসেবে চাষ করেন?"},
    "flag:land_upto_2ha": {"en": "Is your cultivable land 2 hectares (about 5 acres) or less?", "hi": "क्या आपकी खेती की ज़मीन 2 हेक्टेयर (लगभग 5 एकड़) या उससे कम है?", "bn": "আপনার চাষযোগ্য জমি কি ২ হেক্টর (প্রায় ৫ একর) বা তার কম?"},
    "flag:is_bpl": {"en": "Does your family have a BPL, Antyodaya or priority-household ration card?", "hi": "क्या आपके परिवार के पास BPL, अंत्योदय या प्राथमिकता वाला राशन कार्ड है?", "bn": "আপনার পরিবারের কি BPL, অন্ত্যোদয় বা অগ্রাধিকার রেশন কার্ড আছে?"},
    "flag:has_ration_card": {"en": "Does your family have a ration card of any type?", "hi": "क्या आपके परिवार के पास किसी भी प्रकार का राशन कार्ड है?", "bn": "আপনার পরিবারের কি কোনো ধরনের রেশন কার্ড আছে?"},
    "flag:has_bank_account": {"en": "Do you have a bank or post-office savings account?", "hi": "क्या आपका बैंक या डाकघर में बचत खाता है?", "bn": "আপনার কি ব্যাংক বা পোস্ট অফিসে সঞ্চয় অ্যাকাউন্ট আছে?"},
    "flag:is_income_tax_payer": {"en": "Does anyone in your family pay income tax?", "hi": "क्या आपके परिवार में कोई आयकर (इनकम टैक्स) देता है?", "bn": "আপনার পরিবারে কেউ কি আয়কর দেন?"},
    "flag:is_govt_employee_family": {"en": "Is anyone in your family a government employee?", "hi": "क्या आपके परिवार में कोई सरकारी कर्मचारी है?", "bn": "আপনার পরিবারে কেউ কি সরকারি কর্মচারী?"},
    "flag:has_epf_esic_nps": {"en": "Are you covered by EPF, ESIC or NPS at work?", "hi": "क्या आप काम पर EPF, ESIC या NPS में शामिल हैं?", "bn": "আপনি কি কর্মস্থলে EPF, ESIC বা NPS-এর আওতায় আছেন?"},
    "flag:owns_pucca_house": {"en": "Does your family own a pucca (permanent) house?", "hi": "क्या आपके परिवार के पास पक्का मकान है?", "bn": "আপনার পরিবারের কি পাকা বাড়ি আছে?"},
    "flag:has_lpg_connection": {"en": "Does your household already have an LPG gas connection?", "hi": "क्या आपके घर में पहले से LPG गैस कनेक्शन है?", "bn": "আপনার বাড়িতে কি আগে থেকেই LPG গ্যাস সংযোগ আছে?"},
    "flag:is_unorganised_worker": {"en": "Do you work in the informal or unorganised sector, without a formal job contract?", "hi": "क्या आप असंगठित क्षेत्र में काम करते हैं, बिना किसी औपचारिक नौकरी अनुबंध के?", "bn": "আপনি কি অসংগঠিত ক্ষেত্রে কাজ করেন, কোনো আনুষ্ঠানিক চাকরির চুক্তি ছাড়া?"},
    "flag:is_enrolled_in_education": {"en": "Are you currently enrolled in a school, college or training course?", "hi": "क्या आप अभी किसी स्कूल, कॉलेज या प्रशिक्षण कोर्स में नामांकित हैं?", "bn": "আপনি কি এখন কোনো স্কুল, কলেজ বা প্রশিক্ষণ কোর্সে ভর্তি আছেন?"},
    "flag:has_disability": {"en": "Do you have any disability?", "hi": "क्या आपको कोई विकलांगता है?", "bn": "আপনার কি কোনো প্রতিবন্ধকতা আছে?"},
    "flag:is_pregnant_or_lactating": {"en": "Are you pregnant or a breastfeeding mother?", "hi": "क्या आप गर्भवती हैं या स्तनपान कराने वाली माँ हैं?", "bn": "আপনি কি গর্ভবতী বা স্তন্যদানকারী মা?"},
    "flag:has_girl_child_under_10": {"en": "Do you have a daughter below 10 years of age?", "hi": "क्या आपकी 10 साल से कम उम्र की बेटी है?", "bn": "আপনার কি ১০ বছরের কম বয়সী মেয়ে আছে?"},
    "flag:is_head_of_family": {"en": "Are you recorded as the head of the family on your ration card?", "hi": "क्या राशन कार्ड पर आप परिवार के मुखिया के रूप में दर्ज हैं?", "bn": "রেশন কার্ডে কি আপনি পরিবারের প্রধান হিসেবে নথিভুক্ত?"},
    "flag:owns_house_roof": {"en": "Does your family own a house with a roof where solar panels could be installed?", "hi": "क्या आपके परिवार के पास ऐसी छत वाला घर है जिस पर सोलर पैनल लग सकते हैं?", "bn": "আপনার পরিবারের কি এমন ছাদওয়ালা বাড়ি আছে যেখানে সোলার প্যানেল বসানো যায়?"},
    "flag:has_existing_enterprise": {"en": "Do you already run a business?", "hi": "क्या आप पहले से कोई व्यवसाय चलाते हैं?", "bn": "আপনি কি ইতিমধ্যে কোনো ব্যবসা চালান?"},
    "flag:is_minority": {"en": "Do you belong to a notified minority community?", "hi": "क्या आप किसी अधिसूचित अल्पसंख्यक समुदाय से हैं?", "bn": "আপনি কি কোনো বিজ্ঞাপিত সংখ্যালঘু সম্প্রদায়ের?"},
    "flag:studied_govt_school_6_12": {"en": "Did you study Class 6 to 12 in a government school?", "hi": "क्या आपने कक्षा 6 से 12 तक सरकारी स्कूल में पढ़ाई की?", "bn": "আপনি কি ষষ্ঠ থেকে দ্বাদশ শ্রেণি সরকারি স্কুলে পড়েছেন?"},
}

T: dict[str, dict[str, str]] = {
    "greeting": {
        "en": "Namaste! I am HaqSetu's assistant. Tell me a little about yourself — for example where you live, your age and your work — and I will find government schemes that may apply to you.",
        "hi": "नमस्ते! मैं हकसेतु सहायक हूँ। अपने बारे में थोड़ा बताइए — जैसे आप कहाँ रहते हैं, आपकी उम्र और आपका काम — और मैं आपके लिए सरकारी योजनाएँ ढूँढूँगा।",
        "bn": "নমস্কার! আমি হকসেতুর সহকারী। নিজের সম্পর্কে একটু বলুন — যেমন কোথায় থাকেন, বয়স আর কী কাজ করেন — আমি আপনার জন্য সরকারি প্রকল্প খুঁজে দেব।",
    },
    "understood": {"en": "Noted: {facts}.", "hi": "समझ गया: {facts}।", "bn": "বুঝেছি: {facts}।"},
    "intro_help": {"en": "I can help you find relevant schemes.", "hi": "मैं आपके लिए सही योजनाएँ ढूँढने में मदद कर सकता हूँ।", "bn": "আমি আপনার জন্য প্রাসঙ্গিক প্রকল্প খুঁজে দিতে পারি।"},
    "results_head": {
        "en": "I checked {total} schemes for {place}. You may be eligible for {n}:",
        "hi": "मैंने {place} के लिए {total} योजनाओं की जाँच की। आप इन {n} योजनाओं के लिए संभावित रूप से पात्र हो सकते हैं:",
        "bn": "আমি {place}-এর জন্য {total}টি প্রকল্প যাচাই করেছি। আপনি সম্ভবত এই {n}টির জন্য যোগ্য হতে পারেন:",
    },
    "results_none": {
        "en": "I checked {total} schemes for {place}. Based on what you told me, none clearly matches yet.",
        "hi": "मैंने {place} के लिए {total} योजनाओं की जाँच की। आपकी बताई जानकारी के आधार पर अभी कोई योजना पूरी तरह मेल नहीं खाती।",
        "bn": "আমি {place}-এর জন্য {total}টি প্রকল্প যাচাই করেছি। আপনার দেওয়া তথ্য অনুযায়ী এখনো কোনোটি পুরোপুরি মেলেনি।",
    },
    "results_more": {
        "en": "{n} more schemes need one or two more details to check.",
        "hi": "{n} और योजनाओं की जाँच के लिए एक-दो जानकारी और चाहिए।",
        "bn": "আরও {n}টি প্রকল্প যাচাই করতে আর এক-দুটি তথ্য লাগবে।",
    },
    "scheme_line": {"en": "{name} — {benefit}.", "hi": "{name} — {benefit}।", "bn": "{name} — {benefit}।"},
    "disclaimer": {
        "en": "This is only a guide. The government department makes the final decision. Please apply only on the official website — applying is free.",
        "hi": "यह केवल मार्गदर्शन है। अंतिम निर्णय सरकारी विभाग करता है। केवल आधिकारिक वेबसाइट पर ही आवेदन करें — आवेदन मुफ़्त है।",
        "bn": "এটি শুধু একটি নির্দেশিকা। চূড়ান্ত সিদ্ধান্ত সরকারি দপ্তরের। শুধুমাত্র সরকারি ওয়েবসাইটে আবেদন করুন — আবেদন বিনামূল্যে।",
    },
    "ask_save": {
        "en": "Would you like me to save these details to your HaqSetu profile? Nothing is saved unless you say yes.",
        "hi": "क्या मैं यह जानकारी आपकी हकसेतु प्रोफ़ाइल में सहेज दूँ? आपकी हाँ के बिना कुछ भी सहेजा नहीं जाएगा।",
        "bn": "এই তথ্যগুলো কি আপনার হকসেতু প্রোফাইলে সংরক্ষণ করব? আপনি হ্যাঁ না বললে কিছুই সংরক্ষিত হবে না।",
    },
    "saved": {"en": "Saved to your profile.", "hi": "आपकी प्रोफ़ाइल में सहेज दिया गया।", "bn": "আপনার প্রোফাইলে সংরক্ষিত হয়েছে।"},
    "not_saved": {"en": "Okay, I have not saved anything.", "hi": "ठीक है, मैंने कुछ भी सहेजा नहीं है।", "bn": "ঠিক আছে, আমি কিছুই সংরক্ষণ করিনি।"},
    "didnt_get": {
        "en": "Sorry, I could not understand that. You can type your answer, or say 'show results'.",
        "hi": "माफ़ कीजिए, मैं समझ नहीं पाया। आप अपना जवाब टाइप कर सकते हैं, या 'योजनाएं दिखाओ' कहें।",
        "bn": "দুঃখিত, বুঝতে পারিনি। আপনি উত্তর টাইপ করতে পারেন, অথবা 'দেখাও' বলুন।",
    },
    "reset": {"en": "Okay, let's start again.", "hi": "ठीक है, फिर से शुरू करते हैं।", "bn": "ঠিক আছে, আবার শুরু করি।"},
    "scheme_info": {
        "en": "{name}: {desc} Benefit: {benefit}. Who can apply: {elig}",
        "hi": "{name}: {desc} लाभ: {benefit}। कौन आवेदन कर सकता है: {elig}",
        "bn": "{name}: {desc} সুবিধা: {benefit}। কে আবেদন করতে পারেন: {elig}",
    },
    "whole_india": {"en": "all of India (Central schemes only — tell me your state for state schemes)", "hi": "पूरे भारत (केवल केंद्रीय योजनाएँ — राज्य की योजनाओं के लिए अपना राज्य बताइए)", "bn": "সারা ভারত (শুধু কেন্দ্রীয় প্রকল্প — রাজ্যের প্রকল্পের জন্য আপনার রাজ্য বলুন)"},
}

FACT_LABELS = {
    "state": {"en": "state {v}", "hi": "राज्य {v}", "bn": "রাজ্য {v}"},
    "district": {"en": "district {v}", "hi": "ज़िला {v}", "bn": "জেলা {v}"},
    "age": {"en": "age {v}", "hi": "उम्र {v}", "bn": "বয়স {v}"},
    "annual_income": {"en": "family income about ₹{v} a year", "hi": "परिवार की सालाना आय लगभग ₹{v}", "bn": "পরিবারের বার্ষিক আয় প্রায় ₹{v}"},
    "monthly_income": {"en": "your income about ₹{v} a month", "hi": "आपकी मासिक आय लगभग ₹{v}", "bn": "আপনার মাসিক আয় প্রায় ₹{v}"},
    "occupation": {"en": "work: {v}", "hi": "काम: {v}", "bn": "কাজ: {v}"},
    "employment": {"en": "{v}", "hi": "{v}", "bn": "{v}"},
    "gender": {"en": "{v}", "hi": "{v}", "bn": "{v}"},
}

VALUE_NAMES = {
    "farmer": {"en": "farmer", "hi": "किसान", "bn": "কৃষক"}, "student": {"en": "student", "hi": "छात्र", "bn": "ছাত্র/ছাত্রী"},
    "street_vendor": {"en": "street vendor", "hi": "फेरीवाला", "bn": "ফেরিওয়ালা"}, "artisan": {"en": "artisan", "hi": "कारीगर", "bn": "কারিগর"},
    "female": {"en": "woman", "hi": "महिला", "bn": "মহিলা"}, "male": {"en": "man", "hi": "पुरुष", "bn": "পুরুষ"},
    "unemployed": {"en": "looking for work", "hi": "बेरोज़गार", "bn": "বেকার"}, "daily_wage": {"en": "daily-wage worker", "hi": "दिहाड़ी मज़दूर", "bn": "দিনমজুর"},
    "homemaker": {"en": "homemaker", "hi": "गृहिणी", "bn": "গৃহিণী"}, "retired": {"en": "retired", "hi": "सेवानिवृत्त", "bn": "অবসরপ্রাপ্ত"},
    "self_employed": {"en": "self-employed", "hi": "स्वरोज़गार", "bn": "স্বনিযুক্ত"},
}


def t(key: str, lang: str, **kw) -> str:
    table = T.get(key, {})
    s = table.get(lang) or table.get("en", key)
    return s.format(**kw)


def question(field: str, lang: str) -> str | None:
    q = QUESTIONS.get(field)
    if not q:
        return None
    return q.get(lang) or q.get("en")


def value_name(v: str, lang: str) -> str:
    return (VALUE_NAMES.get(v) or {}).get(lang) or str(v).replace("_", " ")


def inr(n: float) -> str:
    n = int(n)
    if n >= 100000 and n % 1000 == 0:
        lakh = n / 100000
        return (f"{lakh:.2f}".rstrip("0").rstrip(".")) + " lakh"
    s = str(n)
    if len(s) <= 3:
        return s
    head, tail = s[:-3], s[-3:]
    parts = []
    while len(head) > 2:
        parts.insert(0, head[-2:])
        head = head[:-2]
    if head:
        parts.insert(0, head)
    return ",".join(parts) + "," + tail
