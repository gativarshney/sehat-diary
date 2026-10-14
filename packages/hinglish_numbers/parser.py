"""Deterministic Hinglish number parser (v0, pre-registered for E-min).

Design notes
- Input: a raw transcript string from Prisma (`hi-IN`, any script).
- Output: numbers found, in order, plus a doubt flag with reasons.
- No LLM. No clinical interpretation. Pure text rules.

Scope of v0 (what E-min scores against)
- Devanagari and ASCII digits, decimal points ("point", "dashamlav", ".")
- Hindi cardinals 0 to 99 in Devanagari and common Roman spellings
- "sau" (100), "hazaar" (1000)
- Fraction words: dedh (1.5x), dhai (2.5x), sawa (1.25x), paune (-0.25 of next), aadha (0.5x)
- Blood-pressure separators: "by", "bata", "upar ... neeche", "/" and bare pairs
- Correction phrases: "nahi <value>" marks a correction

The parser never invents numbers; when a token sequence is ambiguous it emits
alternative candidates and sets doubt=True with a reason.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Iterable

DEVANAGARI_DIGITS = str.maketrans("०१२३४५६७८९", "0123456789")

# Devanagari cardinals 0..100 (standard forms)
_DEV_UNITS = {
    "शून्य": 0, "एक": 1, "दो": 2, "तीन": 3, "चार": 4, "पाँच": 5, "पांच": 5, "छह": 6, "छः": 6, "छे": 6,
    "सात": 7, "आठ": 8, "नौ": 9, "दस": 10, "ग्यारह": 11, "बारह": 12, "तेरह": 13, "चौदह": 14,
    "पंद्रह": 15, "पन्द्रह": 15, "सोलह": 16, "सत्रह": 17, "अठारह": 18, "उन्नीस": 19, "बीस": 20,
    "इक्कीस": 21, "बाईस": 22, "बाइस": 22, "तेईस": 23, "चौबीस": 24, "पच्चीस": 25, "छब्बीस": 26,
    "सत्ताईस": 27, "सत्ताइस": 27, "अट्ठाईस": 28, "अट्ठाइस": 28, "अठ्ठाईस": 28, "उनतीस": 29, "तीस": 30,
    "इकतीस": 31, "बत्तीस": 32, "तैंतीस": 33, "चौंतीस": 34, "पैंतीस": 35, "छत्तीस": 36, "सैंतीस": 37,
    "अड़तीस": 38, "उनतालीस": 39, "चालीस": 40, "इकतालीस": 41, "बयालीस": 42, "तैंतालीस": 43,
    "चवालीस": 44, "पैंतालीस": 45, "छियालीस": 46, "सैंतालीस": 47, "अड़तालीस": 48, "उनचास": 49,
    "पचास": 50, "इक्यावन": 51, "बावन": 52, "तिरपन": 53, "चौवन": 54, "पचपन": 55, "छप्पन": 56,
    "सत्तावन": 57, "अट्ठावन": 58, "उनसठ": 59, "साठ": 60, "इकसठ": 61, "बासठ": 62, "तिरसठ": 63,
    "चौंसठ": 64, "पैंसठ": 65, "छियासठ": 66, "सड़सठ": 67, "अड़सठ": 68, "उनहत्तर": 69, "सत्तर": 70,
    "इकहत्तर": 71, "बहत्तर": 72, "तिहत्तर": 73, "चौहत्तर": 74, "पचहत्तर": 75, "छिहत्तर": 76,
    "सतहत्तर": 77, "अठहत्तर": 78, "उनासी": 79, "अस्सी": 80, "इक्यासी": 81, "बयासी": 82, "तिरासी": 83,
    "चौरासी": 84, "पचासी": 85, "छियासी": 86, "सत्तासी": 87, "अट्ठासी": 88, "नवासी": 89, "नब्बे": 90,
    "इक्यानवे": 91, "बानवे": 92, "तिरानवे": 93, "चौरानवे": 94, "पचानवे": 95, "छियानवे": 96,
    "सत्तानवे": 97, "अट्ठानवे": 98, "निन्यानवे": 99, "सौ": 100,
}

# Roman spellings (lower-case). Multiple variants per number, as heard in Hinglish transcripts.
_ROMAN_UNITS = {
    0: ["shunya", "zero"], 1: ["ek", "one"], 2: ["do", "two"], 3: ["teen", "three"], 4: ["char", "chaar", "four"],
    5: ["panch", "paanch", "five"], 6: ["chhe", "che", "chah", "six"], 7: ["saat", "sat", "seven"], 8: ["aath", "ath", "eight"],
    9: ["nau", "nine"], 10: ["das", "dus", "ten"], 11: ["gyarah", "gyaarah", "eleven"], 12: ["barah", "baarah", "twelve"],
    13: ["terah", "thirteen"], 14: ["chaudah", "chodah", "fourteen"], 15: ["pandrah", "fifteen"], 16: ["solah", "sixteen"],
    17: ["satrah", "seventeen"], 18: ["atharah", "eighteen"], 19: ["unnis", "unees", "nineteen"], 20: ["bees", "bis", "twenty"],
    21: ["ikkis", "ikees", "twenty one"], 22: ["bais", "baees", "twenty two"], 23: ["teis", "tees", "twenty three"],
    24: ["chaubis", "chaubees", "twenty four"], 25: ["pachhis", "pachchis", "pachees", "twenty five"],
    26: ["chhabbis", "chabbis", "chhabbees", "twenty six"], 27: ["sattais", "sattaees", "twenty seven"],
    28: ["atthais", "atthaees", "athais", "twenty eight"], 29: ["untis", "untees", "twenty nine"], 30: ["tis", "tees", "thirty"],
    31: ["iktis", "ikattis", "thirty one"], 32: ["battis", "battees", "thirty two"], 33: ["taintis", "tentis", "thirty three"],
    34: ["chauntis", "chontis", "thirty four"], 35: ["paintis", "pentis", "thirty five"], 36: ["chhattis", "chattis", "thirty six"],
    37: ["saintis", "sentis", "thirty seven"], 38: ["adtis", "artis", "thirty eight"], 39: ["untalis", "unchalis", "thirty nine"],
    40: ["chalis", "chaalis", "forty"], 41: ["iktalis", "forty one"], 42: ["bayalis", "bayaalis", "forty two"], 43: ["taintalis", "forty three"],
    44: ["chavalis", "chauvalis", "forty four"], 45: ["paintalis", "forty five"], 46: ["chhiyalis", "forty six"], 47: ["saintalis", "forty seven"],
    48: ["adtalis", "forty eight"], 49: ["unchas", "forty nine"], 50: ["pachas", "pachaas", "fifty"], 51: ["ikyavan", "fifty one"],
    52: ["bavan", "baavan", "fifty two"], 53: ["tirpan", "fifty three"], 54: ["chauvan", "chawan", "chauwan", "fifty four"],
    55: ["pachpan", "fifty five"], 56: ["chhappan", "chappan", "fifty six"], 57: ["sattavan", "fifty seven"], 58: ["atthavan", "fifty eight"],
    59: ["unsath", "fifty nine"], 60: ["sath", "saath", "sixty"], 61: ["iksath", "sixty one"], 62: ["basath", "baasath", "sixty two"],
    63: ["tirsath", "sixty three"], 64: ["chaunsath", "sixty four"], 65: ["painsath", "sixty five"], 66: ["chhiyasath", "sixty six"],
    67: ["sadsath", "sixty seven"], 68: ["adsath", "sixty eight"], 69: ["unhattar", "sixty nine"], 70: ["sattar", "seventy"],
    71: ["ikhattar", "seventy one"], 72: ["bahattar", "seventy two"], 73: ["tihattar", "seventy three"], 74: ["chauhattar", "seventy four"],
    75: ["pachhattar", "pachattar", "seventy five"], 76: ["chhihattar", "seventy six"], 77: ["sathattar", "seventy seven"],
    78: ["athhattar", "seventy eight"], 79: ["unasi", "unaasi", "seventy nine"], 80: ["assi", "eighty"], 81: ["ikyasi", "eighty one"],
    82: ["bayasi", "bayaasi", "eighty two"], 83: ["tirasi", "eighty three"], 84: ["chaurasi", "eighty four"], 85: ["pachasi", "pachaasi", "eighty five"],
    86: ["chhiyasi", "eighty six"], 87: ["sattasi", "eighty seven"], 88: ["atthasi", "eighty eight"], 89: ["navasi", "eighty nine"],
    90: ["nabbe", "ninety"], 91: ["ikyanve", "ninety one"], 92: ["banve", "baanve", "ninety two"], 93: ["tiranve", "ninety three"],
    94: ["chauranve", "ninety four"], 95: ["pachanve", "ninety five"], 96: ["chhiyanve", "ninety six"], 97: ["sattanve", "ninety seven"],
    98: ["atthanve", "ninety eight"], 99: ["ninyanve", "ninety nine"], 100: ["sau", "so", "hundred"],
}

_WORD_TO_NUM: dict[str, int] = {}
for _n, _spellings in _ROMAN_UNITS.items():
    for _s in _spellings:
        _WORD_TO_NUM[_s] = _n
_WORD_TO_NUM.update(_DEV_UNITS)

_THOUSAND = {"hazaar", "hazar", "thousand", "हज़ार", "हजार"}
_HUNDRED = {"sau", "so", "hundred", "सौ"}
_DECIMAL = {"point", "dashamlav", "dashamlab", "पॉइंट", "पाइंट", "दशमलव", "."}
_FRACTION = {
    "dedh": ("mul", 1.5), "डेढ़": ("mul", 1.5), "डेढ": ("mul", 1.5),
    "dhai": ("mul", 2.5), "dhaai": ("mul", 2.5), "ढाई": ("mul", 2.5),
    "sawa": ("mul", 1.25), "sava": ("mul", 1.25), "सवा": ("mul", 1.25),
    "paune": ("sub", 0.25), "pone": ("sub", 0.25), "पौने": ("sub", 0.25),
    "aadha": ("mul", 0.5), "adha": ("mul", 0.5), "आधा": ("mul", 0.5),
}
_BP_SEP = {"by", "bata", "batta", "बटा", "बाय", "/", "over", "upon"}
_BP_UPAR = {"upar", "ऊपर", "oopar"}
_BP_NEECHE = {"neeche", "niche", "नीचे"}
_CORRECTION = {"nahi", "nahin", "नहीं", "नही", "galat", "ग़लत", "गलत"}
_NUMBER_WORDS = set(_WORD_TO_NUM) | _THOUSAND | _HUNDRED | _DECIMAL | set(_FRACTION)


def normalize_digits(text: str) -> str:
    """Map Devanagari digits to ASCII and normalise comma-grouped integers."""
    t = text.translate(DEVANAGARI_DIGITS)
    t = re.sub(r"(?<=\d),(?=\d)", "", t)
    return t


def _tokenize(text: str) -> list[str]:
    t = normalize_digits(text.lower())
    t = re.sub(r"(\d)\s*\.\s*(\d)", r"\1 . \2", t)  # "54.5" -> "54 . 5"
    t = t.replace("/", " / ")
    t = re.sub(r"[,;!?।]", " ", t)
    return [tok for tok in t.split() if tok]


@dataclass
class Candidate:
    value: float
    span: tuple[int, int]
    source: str  # "digits" | "words" | "fraction"

    def as_text(self) -> str:
        return str(int(self.value)) if float(self.value).is_integer() else f"{self.value:g}"


@dataclass
class ParseResult:
    numbers: list[Candidate] = field(default_factory=list)
    bp: tuple[float, float] | None = None
    is_correction: bool = False
    doubt: bool = False
    reasons: list[str] = field(default_factory=list)
    alternatives: list[list[float]] = field(default_factory=list)

    def values(self) -> list[float]:
        return [c.value for c in self.numbers]


def words_to_numbers(tokens: list[str]) -> list[Candidate]:
    """Scan tokens and fold number words/digits into Candidates."""
    out: list[Candidate] = []
    i = 0
    n = len(tokens)
    while i < n:
        tok = tokens[i]
        start = i
        # fraction word: dedh sau = 150, sawa sau = 125, paune do sau = 175, dhai = 2.5
        if tok in _FRACTION:
            kind, f = _FRACTION[tok]
            j = i + 1
            base = None
            unit = 1.0
            if j < n and tokens[j] in _WORD_TO_NUM and tokens[j] not in _HUNDRED:
                base = float(_WORD_TO_NUM[tokens[j]])
                j += 1
            if j < n and tokens[j] in _HUNDRED:
                unit = 100.0
                j += 1
            elif j < n and tokens[j] in _THOUSAND:
                unit = 1000.0
                j += 1
            if kind == "mul":
                if base is not None and unit > 1:
                    # "sawa do sau" = 2.25*100? No: idiomatic 'sawa do sau' = 225
                    value = (base + (f - 1.0)) * unit
                elif base is not None:
                    value = f * base if tok in ("aadha", "adha", "आधा") else base + (f - 1.0)
                else:
                    value = f * unit
            else:  # paune: 0.25 less than the next number (of the unit)
                if base is not None:
                    value = (base - f) * unit
                elif unit > 1:
                    value = (1.0 - f) * unit
                else:
                    value = -1.0  # unresolved
            if value >= 0:
                out.append(Candidate(value, (start, j), "fraction"))
            i = j
            continue
        # digits (possibly with decimal)
        if re.fullmatch(r"\d+", tok):
            value = float(tok)
            j = i + 1
            if j + 1 < n and tokens[j] in _DECIMAL and re.fullmatch(r"\d+", tokens[j + 1]):
                value = float(f"{tok}.{tokens[j + 1]}")
                j += 2
            elif j + 1 < n and tokens[j] in _DECIMAL and tokens[j + 1] in _WORD_TO_NUM:
                value = float(f"{tok}.{_WORD_TO_NUM[tokens[j + 1]]}")
                j += 2
            out.append(Candidate(value, (start, j), "digits"))
            i = j
            continue
        # number words: [a] sau [b] | a hazaar ...
        if tok in _WORD_TO_NUM or tok in _HUNDRED or tok in _THOUSAND:
            total = 0.0
            cur = 0.0
            j = i
            consumed_any = False
            while j < n:
                w = tokens[j]
                if w in _THOUSAND:
                    cur = (cur if cur else 1.0) * 1000.0
                    total += cur
                    cur = 0.0
                    j += 1
                    consumed_any = True
                elif w in _HUNDRED:
                    cur = (cur if cur else 1.0) * 100.0
                    j += 1
                    consumed_any = True
                elif w in _WORD_TO_NUM:
                    v = _WORD_TO_NUM[w]
                    if cur and cur % 100 == 0 and v < 100:
                        cur += v
                    elif cur and v < 100:
                        # two bare units in a row, e.g. "ek sau chauvan chauranve": stop, second is a new number
                        break
                    else:
                        cur = float(v)
                    j += 1
                    consumed_any = True
                else:
                    break
            total += cur
            if not consumed_any:
                i += 1
                continue
            # decimal continuation: "chauvan point paanch"
            if j + 1 < n and tokens[j] in _DECIMAL:
                frac_tok = tokens[j + 1]
                frac = _WORD_TO_NUM.get(frac_tok)
                if frac is None and re.fullmatch(r"\d+", frac_tok):
                    frac = int(frac_tok)
                if frac is not None:
                    total = float(f"{int(total)}.{frac}")
                    j += 2
            out.append(Candidate(total, (start, j), "words"))
            i = j
            continue
        i += 1
    return out


def parse_numbers(text: str) -> ParseResult:
    tokens = _tokenize(text)
    res = ParseResult()
    res.is_correction = any(t in _CORRECTION for t in tokens[:3])
    cands = words_to_numbers(tokens)
    res.numbers = cands

    # blood pressure detection
    if len(cands) >= 2:
        a, b = cands[0], cands[1]
        between = tokens[a.span[1]:b.span[0]]
        has_sep = any(t in _BP_SEP for t in between)
        upar_before = any(t in _BP_UPAR for t in tokens[: a.span[0]])
        neeche_between = any(t in _BP_NEECHE for t in between)
        if has_sep or (upar_before and neeche_between):
            res.bp = (a.value, b.value)
        elif not between and 60 <= a.value <= 260 and 30 <= b.value <= 160:
            res.bp = (a.value, b.value)
            res.doubt = True
            res.reasons.append("bare pair without separator")

    # doubt heuristics (v0): fraction words, decimals by words, more than two numbers, no numbers
    if any(c.source == "fraction" for c in cands):
        res.doubt = True
        res.reasons.append("fraction word")
    if any(t in _DECIMAL for t in tokens):
        res.doubt = True
        res.reasons.append("spoken decimal")
    if len(cands) > 2:
        res.doubt = True
        res.reasons.append("more than two numbers")
    return res


def parse_reading(text: str) -> ParseResult:
    """Alias kept for API clarity: a reading is one spoken entry."""
    return parse_numbers(text)
