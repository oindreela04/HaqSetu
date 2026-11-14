'use strict';
/** Interface strings. Scheme content itself is maintained in English by admins. */
const STR = {
  en: {
    tagline: 'Your Rights. Your Benefits. One Bridge.',
    nav_schemes: 'Schemes', nav_check: 'Quick check', nav_dashboard: 'My benefits', nav_profile: 'Profile', nav_login: 'Log in', nav_register: 'Create account', nav_logout: 'Log out', nav_admin: 'Admin', nav_about: 'About',
    hero_title: 'Find the government schemes you are entitled to',
    hero_sub: 'Central, state and UT schemes matched to your age, location, income and situation — explained in plain language, with official links to apply.',
    cta_check: 'Check my eligibility — 2 minutes', cta_browse: 'Browse all schemes', cta_register: 'Create a free account',
    choose_state: 'Choose your state / UT', search_placeholder: 'Search schemes, e.g. scholarship, pension, farmer…', search: 'Search',
    eligible: 'Potentially eligible', more_info: 'More information required', not_eligible: 'Not currently eligible',
    missed: 'Benefits you may be missing', official_site: 'Official website', apply: 'Apply on official site',
    disclaimer_short: 'HaqSetu is an independent information service, not a government website. Eligibility shown here is indicative — the government department makes the final decision.',
    lang: 'Language',
  },
  hi: {
    tagline: 'आपके अधिकार। आपके लाभ। एक सेतु।',
    nav_schemes: 'योजनाएँ', nav_check: 'त्वरित जाँच', nav_dashboard: 'मेरे लाभ', nav_profile: 'प्रोफ़ाइल', nav_login: 'लॉग इन', nav_register: 'खाता बनाएँ', nav_logout: 'लॉग आउट', nav_admin: 'एडमिन', nav_about: 'परिचय',
    hero_title: 'जानिए आप किन सरकारी योजनाओं के हकदार हैं',
    hero_sub: 'केंद्र, राज्य और केंद्रशासित प्रदेशों की योजनाएँ — आपकी उम्र, स्थान, आय और स्थिति के अनुसार, सरल भाषा में, आवेदन के आधिकारिक लिंक के साथ।',
    cta_check: 'अपनी पात्रता जाँचें — 2 मिनट', cta_browse: 'सभी योजनाएँ देखें', cta_register: 'मुफ़्त खाता बनाएँ',
    choose_state: 'अपना राज्य / केंद्रशासित प्रदेश चुनें', search_placeholder: 'योजना खोजें, जैसे छात्रवृत्ति, पेंशन, किसान…', search: 'खोजें',
    eligible: 'संभावित रूप से पात्र', more_info: 'और जानकारी चाहिए', not_eligible: 'अभी पात्र नहीं',
    missed: 'लाभ जो आप शायद छोड़ रहे हैं', official_site: 'आधिकारिक वेबसाइट', apply: 'आधिकारिक साइट पर आवेदन करें',
    disclaimer_short: 'हकसेतु एक स्वतंत्र सूचना सेवा है, सरकारी वेबसाइट नहीं। यहाँ दिखाई गई पात्रता केवल संकेत है — अंतिम निर्णय संबंधित सरकारी विभाग करता है।',
    lang: 'भाषा',
  },
  bn: {
    tagline: 'আপনার অধিকার। আপনার সুবিধা। এক সেতু।',
    nav_schemes: 'প্রকল্প', nav_check: 'দ্রুত যাচাই', nav_dashboard: 'আমার সুবিধা', nav_profile: 'প্রোফাইল', nav_login: 'লগ ইন', nav_register: 'অ্যাকাউন্ট খুলুন', nav_logout: 'লগ আউট', nav_admin: 'অ্যাডমিন', nav_about: 'পরিচিতি',
    hero_title: 'আপনি কোন সরকারি প্রকল্পের যোগ্য তা জানুন',
    hero_sub: 'কেন্দ্র, রাজ্য ও কেন্দ্রশাসিত অঞ্চলের প্রকল্প — আপনার বয়স, এলাকা, আয় ও পরিস্থিতি অনুযায়ী, সহজ ভাষায়, আবেদনের সরকারি লিঙ্ক সহ।',
    cta_check: 'যোগ্যতা যাচাই করুন — ২ মিনিট', cta_browse: 'সব প্রকল্প দেখুন', cta_register: 'বিনামূল্যে অ্যাকাউন্ট খুলুন',
    choose_state: 'আপনার রাজ্য / কেন্দ্রশাসিত অঞ্চল বেছে নিন', search_placeholder: 'প্রকল্প খুঁজুন, যেমন বৃত্তি, পেনশন, কৃষক…', search: 'খুঁজুন',
    eligible: 'সম্ভাব্য যোগ্য', more_info: 'আরও তথ্য প্রয়োজন', not_eligible: 'এখন যোগ্য নন',
    missed: 'যে সুবিধাগুলি আপনি হয়তো পাচ্ছেন না', official_site: 'সরকারি ওয়েবসাইট', apply: 'সরকারি সাইটে আবেদন করুন',
    disclaimer_short: 'হকসেতু একটি স্বাধীন তথ্য পরিষেবা, সরকারি ওয়েবসাইট নয়। এখানে দেখানো যোগ্যতা আনুমানিক — চূড়ান্ত সিদ্ধান্ত সংশ্লিষ্ট সরকারি দপ্তরের।',
    lang: 'ভাষা',
  },
};
const LANGS = [['en', 'English'], ['hi', 'हिन्दी'], ['bn', 'বাংলা']];

function middleware(req, res, next) {
  let lang = req.session.lang;
  if (req.query.lang && STR[req.query.lang]) {
    lang = req.query.lang;
    req.session.lang = lang;
  }
  if (!lang) lang = 'en';
  res.locals.lang = lang;
  res.locals.LANGS = LANGS;
  res.locals.t = (k) => (STR[lang] && STR[lang][k]) || STR.en[k] || k;
  next();
}

module.exports = { middleware, LANGS };
