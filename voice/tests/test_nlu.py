from voice import nlu


def test_example_bihar_farmer_english():
    c = nlu.extract("I am a farmer from Bihar. My family income is below two lakh rupees. What government schemes can I get?")
    assert c["state_code"] == "BR"
    assert c["occupation"] == "farmer"
    assert c["annual_income"] == 200000


def test_hinglish_and_hindi():
    c = nlu.extract("main UP se hoon, umar 34 saal, kisan hoon, saalana aay dedh lakh")
    assert c["state_code"] == "UP" and c["age"] == 34 and c["occupation"] == "farmer" and c["annual_income"] == 150000
    c = nlu.extract("मैं बिहार की महिला हूँ, मेरी उम्र ४५ वर्ष है और मैं विधवा हूँ")
    assert c["state_code"] == "BR" and c["age"] == 45 and c["gender"] == "female" and c["marital_status"] == "widowed"


def test_bengali():
    c = nlu.extract("আমি পশ্চিমবঙ্গের ছাত্রী, বয়স ২১ বছর, পরিবারের আয় ১.৮ লাখ")
    assert c["state_code"] == "WB" and c["age"] == 21 and c["employment"] == "student" and c["annual_income"] == 180000
    assert c["flags"]["is_enrolled_in_education"] is True


def test_district_and_tenant():
    c = nlu.extract("I live in North 24 Parganas and I am a tenant farmer", districts=[{"id": 7, "name": "North 24 Parganas"}, {"id": 8, "name": "Nadia"}])
    assert c["district_id"] == 7 and c["flags"]["is_farmer_landholder"] is False


def test_contextual_yes_no_and_unsure():
    assert nlu.extract("haan ji", expecting="flag:has_bank_account")["flags"]["has_bank_account"] is True
    assert nlu.extract("না", expecting="flag:is_bpl")["flags"]["is_bpl"] is False
    assert "flags" not in nlu.extract("not sure", expecting="flag:is_bpl")
    assert nlu.extract("34", expecting="age")["age"] == 34


def test_short_aliases_need_word_boundaries():
    assert nlu.extract("I need help with my computer")  .get("state_code") is None
    assert nlu.extract("i am from mp").get("state_code") == "MP"
