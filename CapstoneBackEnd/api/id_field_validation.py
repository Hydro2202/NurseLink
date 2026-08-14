"""
Strict validation for the six PRC-ID fields Step 2 (ID Review) displays.

This is the guarantee layer: regardless of what the n8n identity-verify
workflow's OCR/parsing actually produces — correct, garbled, or a label
value bleeding into the wrong field — nothing gets stored or reported as
"verified" unless it passes real structural checks. A date string can never
end up in a name field and vice versa, a registration number is digits, and
an expiry can never predate its own issue date.

This module does not talk to n8n or Tesseract; it only judges values already
extracted by VerifyIdView from the workflow's JSON response.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date

# --- name validation -----------------------------------------------------

# A name may contain letters (incl. accented), spaces, hyphens and
# apostrophes only. Deliberately does not allow digits — a real Filipino
# surname never contains one, and this alone rejects most OCR mix-ups.
_NAME_CHARS = re.compile(r"^[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ '\-.]{0,99}$")

_MONTH_NAMES = (
    'january|february|march|april|may|june|july|august|september|october|november|december|'
    'jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec'
)
# Anything that smells like a date, a year, or one of the OCR field labels
# has no business inside a name field — this is what catches
# "REGISTRATION DATE May 21" or a bare "2005" before it reaches last_name.
_DATE_OR_LABEL_HINT = re.compile(
    r'\b(?:' + _MONTH_NAMES + r')\b'          # month name
    r'|\d{4}'                                  # a 4-digit year
    r'|\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}'      # numeric date
    r'|\bregistration\b|\bregistered\b|\bvalid\b|\bexpir'  # stray label text
    r'|\bno\.?\b|\bdate\b'
    r'|@|https?://',                            # email / URL
    re.IGNORECASE,
)


def is_valid_person_name(value: str | None, *, required: bool = True) -> bool:
    """True when ``value`` plausibly looks like a person's name component."""
    if not value or not value.strip():
        return not required
    value = value.strip()
    if _DATE_OR_LABEL_HINT.search(value):
        return False
    return bool(_NAME_CHARS.match(value))


# --- registration number validation --------------------------------------

# PRC registration numbers are exactly 7 digits — matching the existing,
# established convention in prc_ocr.py (_extract_registration_number), so
# both PRC-document validation paths in this app agree on what a valid
# number looks like. A 5-6 or 8-9 digit run is a truncated/extended OCR
# misread, not a plausible alternate length.
_REG_NO_DIGITS = re.compile(r'^\d{7}$')


def clean_registration_no(value: str | None) -> str | None:
    """
    The registration number, digits only, or ``None`` if it does not look
    like one. Never a bare fragment of a date or a barcode string — this
    intentionally does not try to salvage a value that fails the shape
    check, since a wrong-but-plausible-looking number is worse than a blank.
    """
    if not value:
        return None
    digits = re.sub(r'\D', '', value)
    if _REG_NO_DIGITS.match(digits):
        return digits
    return None


# --- date validation -------------------------------------------------------

_MONTH_LOOKUP = {
    'jan': 1, 'january': 1, 'feb': 2, 'february': 2, 'mar': 3, 'march': 3,
    'apr': 4, 'april': 4, 'may': 5, 'jun': 6, 'june': 6, 'jul': 7, 'july': 7,
    'aug': 8, 'august': 8, 'sep': 9, 'sept': 9, 'september': 9,
    'oct': 10, 'october': 10, 'nov': 11, 'november': 11, 'dec': 12, 'december': 12,
}

_MONTH_NAME_DATE = re.compile(
    r'(' + _MONTH_NAMES + r')\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})', re.IGNORECASE
)
_NUMERIC_DATE = re.compile(r'(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})')
_ISO_DATE = re.compile(r'(\d{4})-(\d{2})-(\d{2})')


def parse_flexible_date(raw: str | None) -> date | None:
    """
    Parse "May 21, 2005", "05/21/2005", or "2005-05-21" into a real
    ``date``. Returns ``None`` rather than guessing when the value cannot be
    safely interpreted — an unparseable date must never be silently coerced
    into some default.
    """
    if not raw:
        return None
    text = raw.strip()

    iso = _ISO_DATE.search(text)
    if iso:
        year, month, day = (int(g) for g in iso.groups())
        return _safe_date(year, month, day)

    named = _MONTH_NAME_DATE.search(text)
    if named:
        month_name, day, year = named.groups()
        month = _MONTH_LOOKUP.get(month_name.lower())
        if month:
            return _safe_date(int(year), month, int(day))

    numeric = _NUMERIC_DATE.search(text)
    if numeric:
        month, day, year = numeric.groups()
        if len(year) == 2:
            # A PRC nurse could easily have registered decades ago — pivot
            # so "85" reads as 1985, not 2085. 50 is an arbitrary but
            # reasonable cutoff (any two-digit year >= 50 is treated as
            # 19xx, otherwise 20xx).
            year = ('19' if int(year) >= 50 else '20') + year
        return _safe_date(int(year), int(month), int(day))

    return None


def _safe_date(year: int, month: int, day: int) -> date | None:
    try:
        return date(year, month, day)
    except ValueError:
        return None


# --- orchestration ---------------------------------------------------------


@dataclass
class PrcIdValidationResult:
    valid: bool
    status: str  # 'verified' | 'validation_error'
    cleaned: dict = field(default_factory=dict)  # ISO date strings, cleaned strings
    errors: dict = field(default_factory=dict)


def validate_prc_id_fields(
    *,
    last_name: str | None,
    first_name: str | None,
    middle_name: str | None,
    registration_no: str | None,
    registration_date: str | None,
    valid_until: str | None,
) -> PrcIdValidationResult:
    """
    The single gate every extracted PRC-ID field set must pass before it is
    treated as verified or persisted. Reject-and-explain, never guess: a
    field that fails its check is reported by name in ``errors`` rather than
    silently dropped or coerced.
    """
    errors: dict[str, str] = {}

    if not is_valid_person_name(last_name):
        errors['last_name'] = 'Invalid name value detected.'
    if not is_valid_person_name(first_name):
        errors['first_name'] = 'Invalid name value detected.'
    if not is_valid_person_name(middle_name, required=False):
        errors['middle_name'] = 'Invalid name value detected.'

    reg_no = clean_registration_no(registration_no)
    if reg_no is None:
        errors['registration_no'] = 'Registration number could not be identified.'

    reg_date = parse_flexible_date(registration_date)
    if reg_date is None:
        errors['registration_date'] = 'Registration date could not be identified.'

    valid_thru = parse_flexible_date(valid_until)
    if valid_thru is None:
        errors['valid_until'] = 'Valid-until date could not be identified.'

    if reg_date and valid_thru and reg_date >= valid_thru:
        errors['registration_date'] = 'Registration date must be before the valid-until date.'
        errors['valid_until'] = 'Valid-until date must be after the registration date.'

    if errors:
        return PrcIdValidationResult(valid=False, status='validation_error', errors=errors)

    return PrcIdValidationResult(
        valid=True,
        status='verified',
        cleaned={
            'last_name': last_name.strip(),
            'first_name': first_name.strip(),
            'middle_name': (middle_name or '').strip(),
            'registration_no': reg_no,
            'registration_date': reg_date.isoformat(),
            'valid_until': valid_thru.isoformat(),
        },
    )
