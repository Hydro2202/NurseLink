"""
PRC (Professional Regulation Commission) nursing licence scanning.

Two jobs, in this order:

1. **Gate the document type.** Only a PRC *nursing* licence gets through.
   The card must carry both institutional markers — "REPUBLIC OF THE
   PHILIPPINES" and "PROFESSIONAL REGULATION COMMISSION" — and the
   profession must read NURSE. Anything else is rejected before a single
   field is parsed, so a driver's licence or a PRC card for another
   profession cannot pre-fill a nurse registration.

2. **Extract the fields** the signup wizard pre-fills: surname, first name,
   middle name, the 7-digit registration number, and the validity date.

A note on matching strategy. OCR of a laminated ID photographed on a phone
is noisy: "PROFESSIONAL" comes back as "PROFESSIQNAL", zeros become O's,
the coloured profession bar bleeds into the text above it. Matching the
required phrases with a plain ``in`` test rejects perfectly good scans, so
phrase detection here is deliberately fuzzy (see :func:`_contains_phrase`)
while *field extraction* stays strict — a loose registration number is far
worse than asking the nurse to retake the photo.

Requires the Tesseract binary, which is a separate install from the
``pytesseract`` Python package:
    Windows  https://github.com/UB-Mannheim/tesseract/wiki
             then set TESSERACT_CMD in CapstoneBackEnd/.env
    macOS    brew install tesseract
    Linux    apt-get install tesseract-ocr
"""

import base64
import binascii
import difflib
import logging
import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional

import cv2
import numpy as np
import pytesseract
from django.conf import settings
from pytesseract import TesseractNotFoundError

logger = logging.getLogger(__name__)

MAX_IMAGE_BYTES = 10 * 1024 * 1024  # matches the documented upload limit

# Both must be present. These are printed on every PRC professional ID.
REQUIRED_MARKERS = (
    'REPUBLIC OF THE PHILIPPINES',
    'PROFESSIONAL REGULATION COMMISSION',
)

# The profession on the coloured header bar. PRC issues cards for ~40
# professions from the same template; only nursing may pre-fill this form.
PROFESSION_MARKER = 'NURSE'

REJECTION_MESSAGE = 'Please upload a valid PRC nursing license.'

# How close an OCR'd phrase must be to count as a match. 0.82 accepts
# "PROFESSIQNAL REGULATION COMMISSION" (one substituted character) while
# still rejecting an unrelated line of similar length.
PHRASE_MATCH_RATIO = 0.82

# The profession is a single short word, so one substituted character costs
# far more ratio than it does in a long phrase: NURSF vs NURSE scores exactly
# 0.80. That is the most common OCR failure on the coloured header bar, so
# the threshold has to admit it. The looseness is safe because it is not the
# whole gate — REQUIRED_MARKERS must also match, and no other PRC profession
# (MIDWIFE, PHARMACIST, DENTIST, …) comes near 0.80 against NURSE.
PROFESSION_MATCH_RATIO = 0.80


class PrcOcrError(Exception):
    """
    OCR could not run at all — distinct from "ran and the card was wrong".

    ``default_detail`` is what the API layer shows a client — a fixed class
    attribute, never the raw message (Tesseract's own RuntimeError text can
    include local temp-file paths).
    """

    default_detail = 'OCR is temporarily unavailable. Please try again.'


class TesseractNotInstalledError(PrcOcrError):
    default_detail = (
        'Tesseract OCR is not installed on the server. Install it and set '
        'TESSERACT_CMD in CapstoneBackEnd/.env '
        '(Windows: https://github.com/UB-Mannheim/tesseract/wiki).'
    )


class TesseractRuntimeFailureError(PrcOcrError):
    default_detail = 'OCR failed. Please try again with a clearer image.'


class InvalidImageError(ValueError):
    """
    The upload was not a decodable image.

    Each concrete reason below is its own subclass with a fixed
    ``default_detail`` string, matching this class's own raise-site message
    verbatim, so the API layer can read a safe class attribute instead of
    the exception's own message — see api/views.py's VerifyPrcLicenseView.
    """

    default_detail = 'Could not process the uploaded image. Please try again.'


class MissingPrcImageError(InvalidImageError):
    default_detail = 'No image supplied.'


class InvalidBase64PrcImageError(InvalidImageError):
    default_detail = 'Image is not valid base64.'


class EmptyPrcImageError(InvalidImageError):
    default_detail = 'Image is empty.'


class PrcImageTooLargeError(InvalidImageError):
    default_detail = 'Image is larger than 10MB.'


class PdfNotSupportedPrcImageError(InvalidImageError):
    default_detail = 'PDF uploads cannot be scanned. Please upload a JPG or PNG photo.'


class PrcImageDecodeError(InvalidImageError):
    default_detail = 'Image could not be decoded. Please retake the photo.'


@dataclass
class PrcScanResult:
    """Outcome of one scan. ``is_valid`` gates everything downstream."""

    is_valid: bool
    message: str = ''
    last_name: str = ''
    first_name: str = ''
    middle_name: str = ''
    registration_number: str = ''
    registration_date: str = ''
    valid_until: str = ''
    profession: str = ''
    raw_text: str = ''
    matched_markers: list = field(default_factory=list)
    #: Per-field confidence and review flags — see :func:`field_report`.
    report: dict = field(default_factory=dict)

    @property
    def full_name(self) -> str:
        parts = [self.first_name, self.middle_name, self.last_name]
        return ' '.join(p for p in parts if p).strip()

    def as_dict(self) -> dict:
        """The JSON the frontend pre-fills its form from."""
        return {
            'valid': self.is_valid,
            'message': self.message,
            'lastName': self.last_name,
            'firstName': self.first_name,
            'middleName': self.middle_name,
            'fullName': self.full_name,
            'registrationNumber': self.registration_number,
            'licenseNumber': self.registration_number,  # alias the wizard uses
            'registrationDate': self.registration_date,
            'validUntil': self.valid_until,
            'profession': self.profession,
            'confidence': self.report.get('confidence', {}),
            'overallConfidence': self.report.get('overallConfidence', 0.0),
            'needsReview': self.report.get('needsReview', []),
            'missingRequired': self.report.get('missingRequired', []),
            'complete': self.report.get('complete', False),
        }


# --- image handling -----------------------------------------------------


def _decode_image(image_data: str) -> np.ndarray:
    """Base64 (with or without a data-URI prefix) to a BGR array."""
    if not image_data:
        raise MissingPrcImageError('No image supplied.')

    payload = image_data.strip()
    if payload.startswith('data:'):
        _, _, payload = payload.partition(',')

    try:
        raw = base64.b64decode(payload, validate=False)
    except (binascii.Error, ValueError) as exc:
        raise InvalidBase64PrcImageError('Image is not valid base64.') from exc

    if not raw:
        raise EmptyPrcImageError('Image is empty.')
    if len(raw) > MAX_IMAGE_BYTES:
        raise PrcImageTooLargeError('Image is larger than 10MB.')
    if raw[:4] == b'%PDF':
        raise PdfNotSupportedPrcImageError('PDF uploads cannot be scanned. Please upload a JPG or PNG photo.')

    image = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise PrcImageDecodeError('Image could not be decoded. Please retake the photo.')
    return image


def _preprocess(image: np.ndarray) -> np.ndarray:
    """
    Prepare a phone photo of an ID card for Tesseract.

    Tesseract wants dark text on a flat light background at roughly 300 DPI.
    A phone shot is none of those, so: grayscale, upscale small captures,
    flatten the uneven lighting a laminated card produces, then binarise.
    """
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

    # PRC cards are credit-card sized; a capture under ~1000px wide leaves
    # the small print below what Tesseract can resolve.
    height, width = gray.shape[:2]
    if width < 1000:
        scale = min(3.0, 1000 / max(width, 1))
        gray = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)

    # Lamination glare shows up as a low-frequency brightness gradient.
    # Dividing by a heavy blur of the image flattens it.
    background = cv2.GaussianBlur(gray, (0, 0), sigmaX=25)
    normalized = cv2.divide(gray, background, scale=255)

    denoised = cv2.bilateralFilter(normalized, 7, 50, 50)
    return cv2.threshold(denoised, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)[1]


def _run_tesseract(image: np.ndarray) -> str:
    """
    OCR one prepared image, trying two page-segmentation modes.

    PSM 6 ("a single uniform block") reads the card body well but often
    misses the profession bar, which sits alone against a colour fill.
    PSM 11 ("sparse text") catches those stragglers. Concatenating both and
    searching the union is more reliable than choosing between them.
    """
    cmd = getattr(settings, 'TESSERACT_CMD', '')
    if cmd:
        pytesseract.pytesseract.tesseract_cmd = cmd

    chunks = []
    for psm in (6, 11):
        try:
            chunks.append(pytesseract.image_to_string(image, config=f'--oem 3 --psm {psm}'))
        except TesseractNotFoundError as exc:
            raise TesseractNotInstalledError(
                'Tesseract OCR is not installed on the server. Install it and set '
                'TESSERACT_CMD in CapstoneBackEnd/.env '
                '(Windows: https://github.com/UB-Mannheim/tesseract/wiki).'
            ) from exc
        except RuntimeError as exc:  # pragma: no cover - tesseract internal failure
            # Tesseract's own RuntimeError text can include local temp-file
            # paths — log it server-side only, never in the client response.
            logger.warning('Tesseract OCR runtime failure: %s', exc)
            raise TesseractRuntimeFailureError('OCR failed. Please try again with a clearer image.') from exc

    return '\n'.join(chunks)


# --- text normalisation and phrase matching -----------------------------


def _normalize(text: str) -> str:
    """Uppercase, strip punctuation, collapse whitespace — for phrase matching only."""
    return re.sub(r'[^A-Z0-9 ]+', ' ', text.upper())


def _contains_phrase(haystack_words: list, phrase: str, ratio: float = PHRASE_MATCH_RATIO) -> bool:
    """
    True when ``phrase`` appears in the OCR output, allowing for OCR noise.

    Slides a window the length of the phrase across the words and compares
    each window with difflib. An exact match short-circuits, so a clean scan
    costs almost nothing.
    """
    target = phrase.upper().split()
    if not target or len(haystack_words) < len(target):
        return False

    joined = ' '.join(haystack_words)
    if phrase.upper() in joined:
        return True

    span = len(target)
    for i in range(len(haystack_words) - span + 1):
        window = ' '.join(haystack_words[i : i + span])
        if difflib.SequenceMatcher(None, window, phrase.upper()).ratio() >= ratio:
            return True
    return False


def _has_profession(words: list, profession: str = PROFESSION_MARKER) -> bool:
    """
    True when the profession bar reads NURSE.

    Matched per-word rather than as a substring so "NURSERY" cannot pass,
    while still accepting the OCR near-misses this word attracts (NURSF,
    NUR SE joined back up by the word split).
    """
    target = profession.upper()
    for word in words:
        if word == target:
            return True
        # Only consider similarly-sized words, so short tokens don't drift in.
        if abs(len(word) - len(target)) <= 1 and len(word) >= len(target) - 1:
            if difflib.SequenceMatcher(None, word, target).ratio() >= PROFESSION_MATCH_RATIO:
                return True
    return False


# --- field extraction ---------------------------------------------------

# Labels sit either on the same line as their value or directly above it,
# depending on card generation and how the photo was cropped. Both are tried.
_NAME_LABELS = {
    'last_name': r'(?:LAST|SUR)\s*NAME',
    'first_name': r'(?:FIRST|GIVEN)\s*NAME',
    'middle_name': r'MIDDLE\s*(?:NAME|INITIAL)',
}

# A name value: letters, spaces, hyphens, apostrophes, periods (JR., ST.).
# Spaces are matched literally rather than with \s, which would include the
# newline and let a capture run off the end of its line — with two OCR passes
# concatenated, a greedy match swallowed the next pass's header text.
_NAME_VALUE = r"[A-Z][A-Z \-'\.]{0,48}"

_REG_NO_LABEL = re.compile(
    r'(?:REGISTRATION|REG(?:\.|ISTRATION)?|LICENSE|LICENCE)\s*(?:NO|NUMBER|#)?\.?\s*:?\s*([0-9OoIlSsBb]{7})\b'
)
_REG_NO_BARE = re.compile(r'\b(\d{7})\b')

_VALID_UNTIL = re.compile(
    r'VALID\s*(?:UNTIL|THRU|TO)?\s*:?\s*(\d{1,2}\s*[/\-.]\s*\d{1,2}\s*[/\-.]\s*\d{2,4})'
)
_ANY_DATE = re.compile(r'\b(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{4})\b')
_WORD_DATE = r'(?:JAN(?:UARY)?|FEB(?:RUARY)?|MAR(?:CH)?|APR(?:IL)?|MAY|JUN(?:E)?|JUL(?:Y)?|AUG(?:UST)?|SEP(?:TEMBER)?|OCT(?:OBER)?|NOV(?:EMBER)?|DEC(?:EMBER)?)\s+\d{1,2},?\s+\d{4}'

# OCR reliably confuses these with digits inside an otherwise numeric run.
_DIGIT_FIXES = str.maketrans({'O': '0', 'o': '0', 'I': '1', 'l': '1', 'S': '5', 's': '5', 'B': '8', 'b': '8'})


def _clean_name(value: str) -> str:
    """Trim a captured name and drop any label text that bled into it."""
    cleaned = re.sub(r'\s+', ' ', value).strip(" :-.,'")
    # A capture that runs into the next label keeps only the part before it.
    cleaned = re.split(
        r'\b(?:FIRST|MIDDLE|LAST)\s*NAME\b|\bREGISTRATION\b|\bVALID\b', cleaned
    )[0]
    return cleaned.strip(" :-.,'").title()


def _extract_name(text: str, label_pattern: str) -> str:
    """Find one labelled name, checking the same line then the line below."""
    same_line = re.search(rf'{label_pattern}\s*[:\-]?\s*({_NAME_VALUE})', text, re.IGNORECASE)
    if same_line:
        candidate = _clean_name(same_line.group(1))
        if candidate:
            return candidate

    next_line = re.search(
        rf'{label_pattern}\s*[:\-]?\s*\n\s*({_NAME_VALUE})', text, re.IGNORECASE
    )
    if next_line:
        return _clean_name(next_line.group(1))
    return ''


def _extract_registration_number(text: str) -> str:
    """
    The 7-digit registration number, strictly.

    Preference order matters: a label-anchored match is trustworthy, a bare
    7-digit run is a guess. Dates and long ID strings are excluded so a
    "01/15/2027" or a 12-digit serial cannot be mistaken for a licence.
    """
    labelled = _REG_NO_LABEL.search(text)
    if labelled:
        candidate = labelled.group(1).translate(_DIGIT_FIXES)
        if candidate.isdigit() and len(candidate) == 7:
            return candidate

    # Fall back to a standalone 7-digit run that is not part of a date.
    for match in _REG_NO_BARE.finditer(text):
        start, end = match.span(1)
        neighbourhood = text[max(0, start - 1) : min(len(text), end + 1)]
        if any(sep in neighbourhood for sep in ('/', '-', '.')):
            continue  # part of a date or a hyphenated serial
        return match.group(1)
    return ''


def _normalize_date(value: str) -> str:
    """Return MM/DD/YYYY, or '' when the value is not a real date."""
    compact = re.sub(r'\s+', '', value).replace('-', '/').replace('.', '/')
    parts = compact.split('/')
    if len(parts) != 3:
        return ''

    month, day, year = parts
    if len(year) == 2:
        year = f'20{year}'

    try:
        parsed = datetime(int(year), int(month), int(day))
    except (ValueError, TypeError):
        return ''
    return parsed.strftime('%m/%d/%Y')


def _extract_valid_until(text: str) -> str:
    labelled = _VALID_UNTIL.search(text)
    if labelled:
        normalized = _normalize_date(labelled.group(1))
        if normalized:
            return normalized

    # Otherwise take the latest plausible date on the card — an expiry is
    # always further out than the issue date.
    candidates = [_normalize_date(m.group(1)) for m in _ANY_DATE.finditer(text)]
    candidates = [c for c in candidates if c]
    if not candidates:
        return ''
    return max(candidates, key=lambda d: datetime.strptime(d, '%m/%d/%Y'))


def _extract_labelled_date(text: str, label: str) -> str:
    """
    Extract a numeric or written date anchored to an ID-card label.

    ``label`` is wrapped in a non-capturing group before interpolation. A
    label containing a top-level alternation — "REG DATE|DATE OF ISSUE" —
    would otherwise split the whole pattern in two, leaving the first branch
    with no capture group and returning None instead of a date.
    """
    match = re.search(
        rf'(?:{label})\s*[:\-.]?\s*({_WORD_DATE}|\d{{1,2}}\s*[/\-.]\s*\d{{1,2}}\s*[/\-.]\s*\d{{2,4}})',
        text,
        re.IGNORECASE,
    )
    if not match:
        return ''
    value = re.sub(r'\s+', ' ', match.group(1)).strip()
    for pattern in ('%B %d, %Y', '%B %d %Y', '%b %d, %Y', '%b %d %Y'):
        try:
            return datetime.strptime(value, pattern).strftime('%m/%d/%Y')
        except ValueError:
            continue
    return _normalize_date(value)


def _extract_latest_card_date(text: str) -> str:
    """Return the latest readable date when an OCR label was missed."""
    candidates = []
    for match in re.finditer(_WORD_DATE, text, re.IGNORECASE):
        value = re.sub(r'\s+', ' ', match.group(0)).strip()
        for pattern in ('%B %d, %Y', '%B %d %Y', '%b %d, %Y', '%b %d %Y'):
            try:
                candidates.append(datetime.strptime(value, pattern))
                break
            except ValueError:
                continue
    for match in _ANY_DATE.finditer(text):
        normalized = _normalize_date(match.group(1))
        if normalized:
            candidates.append(datetime.strptime(normalized, '%m/%d/%Y'))
    return max(candidates).strftime('%m/%d/%Y') if candidates else ''


def scan_labelled_id(image_data: str) -> dict:
    """Read explicitly labelled identity fields from a Hospital ID card."""
    image = _decode_image(image_data)
    text = _run_tesseract(_preprocess(image))
    last_name = _extract_name(text, _NAME_LABELS['last_name'])
    first_name = _extract_name(text, _NAME_LABELS['first_name'])
    middle_name = _extract_name(text, _NAME_LABELS['middle_name'])
    return {
        'lastName': last_name,
        'firstName': first_name,
        'middleName': middle_name,
        'fullName': ' '.join(part for part in (first_name, middle_name, last_name) if part),
        'registrationNumber': _extract_registration_number(text),
        'registrationDate': _extract_labelled_date(text, r'REGISTRATION\s*DATE'),
        'validUntil': (
            _extract_labelled_date(
                text, r'(?:VALID\s*(?:UNTIL|THRU|TO)?|EXPIR(?:Y|ATION)\s*DATE)'
            )
            or _extract_latest_card_date(text)
        ),
    }


# --- per-field confidence -----------------------------------------------
#
# OCR either found a value next to the label that names it, or it guessed
# from a pattern somewhere on the card. Those are very different levels of
# trust, and collapsing them loses the one signal that tells a reviewer
# which field to check. Every extractor below therefore reports *how* it
# found a value, and that provenance becomes the confidence score.

#: How much to trust a value given how it was located.
CONFIDENCE_BY_SOURCE = {
    'label': 0.95,     # sat directly after the label that names it
    'pattern': 0.75,   # matched the field's shape, but unlabelled
    'fallback': 0.50,  # inferred (e.g. "the latest date on the card")
    '': 0.0,           # not found at all
}

#: Below this a field is flagged for human review before anything is saved.
LOW_CONFIDENCE_THRESHOLD = 0.75

#: Fields a registration cannot proceed without. Middle name is genuinely
#: optional (many people have none) and registration date is often absent or
#: unreadable on older cards, so neither blocks — they are merely flagged.
REQUIRED_FIELDS = ('lastName', 'firstName', 'registrationNumber', 'validUntil')

_LABELLED_REG_DATE = r'(?:REGISTRATION|REG\.?)\s*DATE|DATE\s*(?:OF\s*)?(?:REGISTRATION|ISSUE[D]?)'
_LABELLED_VALID_UNTIL = r'(?:VALID\s*(?:UNTIL|THRU|TO)?|EXPIR(?:Y|ATION)\s*DATE)'


@dataclass
class FieldValue:
    """One extracted field, with how confident we are and why."""

    value: str = ''
    source: str = ''

    @property
    def confidence(self) -> float:
        return CONFIDENCE_BY_SOURCE.get(self.source, 0.0)

    @property
    def needs_review(self) -> bool:
        return self.confidence < LOW_CONFIDENCE_THRESHOLD


def _name_with_source(text: str, label_pattern: str) -> FieldValue:
    value = _extract_name(text, label_pattern)
    # Names are only ever taken from beside their label, never guessed —
    # a name pulled from an unlabelled line could be anyone's.
    return FieldValue(value, 'label' if value else '')


def _reg_no_with_source(text: str) -> FieldValue:
    labelled = _REG_NO_LABEL.search(text)
    if labelled:
        candidate = labelled.group(1).translate(_DIGIT_FIXES)
        if candidate.isdigit() and len(candidate) == 7:
            return FieldValue(candidate, 'label')
    bare = _extract_registration_number(text)
    return FieldValue(bare, 'pattern' if bare else '')


def _date_with_source(text: str, label: str, *, allow_fallback: bool) -> FieldValue:
    labelled = _extract_labelled_date(text, label)
    if labelled:
        return FieldValue(labelled, 'label')
    if allow_fallback:
        guess = _extract_latest_card_date(text)
        if guess:
            return FieldValue(guess, 'fallback')
    return FieldValue('', '')


def extract_id_fields(text: str) -> dict:
    """
    Every field the signup form needs, each with its provenance.

    Layout independent by design: values are located by the labels printed
    beside them and by each field's own shape, not by position on the card.
    A differently laid out ID still reads correctly as long as it labels its
    fields — and where it does not, the value is flagged rather than guessed
    at silently.
    """
    return {
        'lastName': _name_with_source(text, _NAME_LABELS['last_name']),
        'firstName': _name_with_source(text, _NAME_LABELS['first_name']),
        'middleName': _name_with_source(text, _NAME_LABELS['middle_name']),
        'registrationNumber': _reg_no_with_source(text),
        'registrationDate': _date_with_source(text, _LABELLED_REG_DATE, allow_fallback=False),
        # An expiry is the latest date on a card, so a fallback guess is
        # defensible here — but it is scored low and flagged for review.
        'validUntil': _date_with_source(text, _LABELLED_VALID_UNTIL, allow_fallback=True),
    }


def field_report(text: str) -> dict:
    """
    Serialisable extraction report: values, confidences, and what to check.

    ``needsReview`` is what the UI acts on — it names the fields a human must
    confirm before anything is saved, so a low-confidence read is never
    written silently.
    """
    fields = extract_id_fields(text)
    values = {name: fv.value for name, fv in fields.items()}
    confidences = {name: round(fv.confidence, 2) for name, fv in fields.items()}

    missing_required = [name for name in REQUIRED_FIELDS if not fields[name].value]
    needs_review = sorted(
        {name for name, fv in fields.items() if fv.value and fv.needs_review}
        | set(missing_required)
    )

    present = [fv.confidence for fv in fields.values() if fv.value]
    overall = round(sum(present) / len(present), 2) if present else 0.0

    values['fullName'] = ' '.join(
        part for part in (values['firstName'], values['middleName'], values['lastName']) if part
    )

    return {
        **values,
        'confidence': confidences,
        'overallConfidence': overall,
        'needsReview': needs_review,
        'missingRequired': missing_required,
        'complete': not missing_required,
    }


def scan_id_fields(image_data: str) -> dict:
    """
    OCR an ID card and return every field with confidence, plus the raw text.

    This is the entry point for the Hospital ID step. It does not gate on
    document type — that is the PRC licence scanner's job — so it works
    across the different ID layouts a hospital issues. The raw text travels
    with the result so n8n (and a human debugging a bad read) can see exactly
    what Tesseract produced.
    """
    image = _decode_image(image_data)
    text = _run_tesseract(_preprocess(image))
    report = field_report(text)
    report['rawText'] = text
    return report


# --- public API ---------------------------------------------------------


def scan_prc_license(image_data: str) -> PrcScanResult:
    """
    Scan an uploaded PRC nursing licence.

    Returns a :class:`PrcScanResult`. ``is_valid`` False means the document
    was rejected and ``message`` explains why; every field is blank in that
    case so nothing from an unverified document can reach the form.

    Raises :class:`InvalidImageError` if the upload is not an image, and
    :class:`PrcOcrError` if Tesseract itself could not run — those are
    server-side problems, not "the nurse uploaded the wrong card".
    """
    image = _decode_image(image_data)
    text = _run_tesseract(_preprocess(image))

    normalized = _normalize(text)
    words = normalized.split()

    matched = [marker for marker in REQUIRED_MARKERS if _contains_phrase(words, marker)]
    has_nurse = _has_profession(words)

    if len(matched) < len(REQUIRED_MARKERS) or not has_nurse:
        missing = [m for m in REQUIRED_MARKERS if m not in matched]
        if not has_nurse:
            missing.append(PROFESSION_MARKER)
        logger.info('PRC scan rejected. Missing markers: %s', missing)
        return PrcScanResult(
            is_valid=False,
            message=REJECTION_MESSAGE,
            raw_text=text,
            matched_markers=matched,
        )

    report = field_report(text)
    return PrcScanResult(
        is_valid=True,
        # A valid card whose fields could not all be read is still a pass at
        # the document-type gate — the reviewer is told what to check rather
        # than the whole scan being thrown away.
        message=(
            ''
            if report['complete']
            else 'Some fields could not be read clearly. Please check them before continuing.'
        ),
        last_name=report['lastName'],
        first_name=report['firstName'],
        middle_name=report['middleName'],
        registration_number=report['registrationNumber'],
        registration_date=report['registrationDate'],
        valid_until=report['validUntil'],
        profession='Registered Nurse',
        raw_text=text,
        matched_markers=matched,
        report=report,
    )
