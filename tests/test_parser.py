import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages"))

import pytest  # noqa: E402

from hinglish_numbers import parse_numbers  # noqa: E402


@pytest.mark.parametrize(
    "text,expect",
    [
        ("बीपी एक सौ अट्ठाईस बाय बयासी", [128, 82]),
        ("BP ek sau atthais by bayasi", [128, 82]),
        ("ब्लड प्रेशर एक सौ बीस बटा अस्सी", [120, 80]),
        ("ऊपर एक सौ तीस नीचे पचासी", [130, 85]),
        ("बीपी 128/82", [128, 82]),
        ("BP १२८ बाय ८२", [128, 82]),
        ("शुगर फास्टिंग डेढ़ सौ", [150]),
        ("sugar fasting dedh sau", [150]),
        ("खाने के बाद शुगर ढाई सौ", [250]),
        ("शुगर सवा सौ था", [125]),
        ("शुगर पौने दो सौ", [175]),
        ("sugar paune do sau", [175]),
        ("वेट चौवन पॉइंट पाँच किलो", [54.5]),
        ("weight 54.5 kilo", [54.5]),
        ("वज़न बहत्तर दशमलव दो", [72.2]),
        ("sugar 1,40 nahi 140", [140, 140]),
        ("दवाई ले ली", []),
        ("आज मौसम बहुत अच्छा है", []),
        ("sugar ek sau chhabbees", [126]),
        ("do hazaar paanch", [2005]),
    ],
)
def test_values(text, expect):
    assert parse_numbers(text).values() == [float(x) for x in expect]


def test_bp_bare_pair_is_doubtful():
    r = parse_numbers("बीपी एक सौ चौवन चौरानवे")
    assert r.bp == (154.0, 94.0)
    assert r.doubt and "bare pair without separator" in r.reasons


def test_bp_with_separator_is_confident():
    r = parse_numbers("BP ek sau atthais by bayasi")
    assert r.bp == (128.0, 82.0)
    assert not r.doubt


def test_fraction_sets_doubt():
    r = parse_numbers("sugar fasting dedh sau")
    assert r.doubt and "fraction word" in r.reasons


def test_correction_detected():
    r = parse_numbers("नहीं, एक सौ अट्ठाईस")
    assert r.is_correction and r.values() == [128.0]
    r2 = parse_numbers("nahi atthais")
    assert r2.is_correction and r2.values() == [28.0]
