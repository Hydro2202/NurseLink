"""
First-pass keyword/pattern detection for vital-sign changes mentioned in a
charting note's assessment/observation text — the trigger for the
auto-charting prompt (see ChartingNoteSerializer._apply_vitals_flag and
VitalSigns in models.py).

Deliberately permissive: a vital-sign keyword co-occurring anywhere in the
same note as a change word is enough to flag it. This only decides whether
to *prompt* a nurse to recheck vitals — it never charts a reading on its
own — so a false positive costs one dismissible prompt, while a false
negative costs a missed recheck. Keys match VitalSignsSerializer's field
names, so a detected key can be used directly to highlight a form field.
"""

import re

VITAL_PATTERNS = {
    'bloodPressure': re.compile(
        r'\b(bp|blood pressure|hypertensive|hypotensive|hypertension|hypotension)\b', re.I
    ),
    'heartRate': re.compile(
        r'\b(hr|heart rate|pulse|tachycardi\w*|bradycardi\w*|irregular heartbeat|'
        r'palpitation\w*|arrhythmi\w*)\b',
        re.I,
    ),
    'temperature': re.compile(
        r'\b(temp|temperature|febrile|fever|afebrile|hypothermi\w*|hyperthermi\w*)\b', re.I
    ),
    'respiratoryRate': re.compile(
        r'\b(rr|respiratory rate|respiration\w*|tachypne\w*|bradypne\w*|dyspne\w*|'
        r'shortness of breath|breathing (?:difficult|labou?red))\b',
        re.I,
    ),
    'oxygenSaturation': re.compile(
        r'\b(o2 ?sat\w*|spo2|oxygen saturation|desaturat\w*|hypoxi\w*)\b', re.I
    ),
    'painScale': re.compile(r'\b(pain scale|pain level|pain score)\b', re.I),
}

CHANGE_WORDS = re.compile(
    r'\b(increas\w*|decreas\w*|elevat\w*|dropp?ed|drop|spik\w*|irregular|abnormal|'
    r'worsen\w*|improv\w*|unstable|rising|falling|climbing|new onset|noted|change\w*|'
    r'trending)\b',
    re.I,
)


def detect_vital_mentions(text: str) -> list[str]:
    """
    Which vital-sign categories this free text seems to describe a change
    in. Returns [] when there's no change-indicating language at all, even
    if a vital-sign keyword appears (e.g. "BP cuff applied" alone should not
    prompt a recheck). Order matches VITAL_PATTERNS, stable for display.
    """
    if not text or not text.strip():
        return []
    if not CHANGE_WORDS.search(text):
        return []
    return [key for key, pattern in VITAL_PATTERNS.items() if pattern.search(text)]
