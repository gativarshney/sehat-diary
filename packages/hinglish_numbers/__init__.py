"""Hinglish number parsing for spoken health readings.

Turns Prisma transcripts (Devanagari or Latin script, digits or number words,
including Hindi fraction words such as dedh, dhai, sawa, paune) into candidate
numeric values with an explicit doubt flag.
"""

from .parser import (
    Candidate,
    ParseResult,
    normalize_digits,
    parse_numbers,
    parse_reading,
    words_to_numbers,
)

__all__ = [
    "Candidate",
    "ParseResult",
    "normalize_digits",
    "parse_numbers",
    "parse_reading",
    "words_to_numbers",
]
