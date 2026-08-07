# I change this by rai
import re
from functools import lru_cache
from typing import Dict, List

NAME_STOPWORDS = {
    'HOSPITAL', 'MEDICAL', 'CENTER', 'CENTRE', 'CLINIC', 'ID', 'IDENTIFICATION',
    'CARD', 'EMPLOYEE', 'STAFF', 'NAME', 'DEPARTMENT', 'POSITION',
}

ID_NUMBER_PATTERN = re.compile(r'\b[A-Z]{0,4}-?\d{4,10}\b')

DEPARTMENT_KEYWORDS = [
    'ICU', 'INTENSIVE CARE', 'EMERGENCY', 'PEDIATRIC', 'SURGERY', 'SURGICAL',
    'MEDICAL-SURGICAL', 'ONCOLOGY', 'CARDIOLOGY', 'MATERNITY', 'OB-GYNE', 'NEUROLOGY',
    'ORTHOPEDIC', 'NURSING', 'WARD', 'UNIT', 'DEPARTMENT', 'DEPT',
]

POSITION_KEYWORDS = [
    'REGISTERED NURSE', 'STAFF NURSE', 'HEAD NURSE', 'NURSING SUPERVISOR',
    'CHARGE NURSE', 'SUPERVISOR', 'NURSE',
]

HOSPITAL_KEYWORDS = ['HOSPITAL', 'MEDICAL CENTER', 'MEDICAL CENTRE', 'CLINIC', 'HEALTHCARE', 'HEALTH CENTER']


@lru_cache(maxsize=1)
def get_reader():
    """EasyOCR's Reader loads its detection/recognition models on first
    construction (and downloads them on first-ever use) — cached as a
    singleton so this only happens once per server process, not per request.
    """
    import easyocr
    # verbose=False also disables the download progress bar, which prints a
    # Unicode block character that crashes on Windows' default console
    # codepage (cp1252) the first time the model has to be downloaded.
    return easyocr.Reader(['en'], gpu=False, verbose=False)


def _strip_label(line: str) -> str:
    """'Department: Intensive Care Unit' -> 'Intensive Care Unit'. Only
    strips when there's a short label before the colon, so values that
    legitimately contain a colon aren't mangled."""
    if ':' in line:
        label, _, value = line.partition(':')
        value = value.strip()
        if value and len(label) <= 20:
            return value
    return line


def _looks_like_name(line: str) -> bool:
    words = line.strip().split()
    if not (2 <= len(words) <= 4):
        return False
    if any(ch.isdigit() for ch in line):
        return False
    if any(w.upper().strip('.,') in NAME_STOPWORDS for w in words):
        return False
    return all(w.replace('.', '').replace('-', '').isalpha() for w in words)


def extract_id_fields(image_path: str) -> Dict[str, str]:
    """Best-effort field extraction from a hospital ID photo. ID layouts vary
    a lot between hospitals, so this is heuristic (keyword/pattern matching
    over the raw OCR text), not a fixed-template parser — fields it can't
    confidently identify are left as empty strings rather than guessed.
    """
    reader = get_reader()
    results = reader.readtext(image_path)
    lines: List[str] = [text.strip() for (_bbox, text, _conf) in results if text and text.strip()]
    upper_lines = [line.upper() for line in lines]
    raw_text = '\n'.join(lines)

    fields = {
        'fullName': '',
        'employeeId': '',
        'hospitalName': '',
        'department': '',
        'position': '',
        'rawText': raw_text,
    }

    for line in lines:
        match = ID_NUMBER_PATTERN.search(line)
        if match and sum(c.isdigit() for c in match.group()) >= 4:
            fields['employeeId'] = match.group()
            break

    for line, upper in zip(lines, upper_lines):
        if any(keyword in upper for keyword in HOSPITAL_KEYWORDS):
            fields['hospitalName'] = _strip_label(line)
            break
    if not fields['hospitalName'] and lines:
        fields['hospitalName'] = lines[0]

    for line, upper in zip(lines, upper_lines):
        if any(keyword in upper for keyword in POSITION_KEYWORDS):
            fields['position'] = _strip_label(line)
            break

    for line, upper in zip(lines, upper_lines):
        if any(keyword in upper for keyword in DEPARTMENT_KEYWORDS):
            fields['department'] = _strip_label(line)
            break

    for index, upper in enumerate(upper_lines):
        if 'NAME' in upper and index + 1 < len(lines):
            candidate = lines[index + 1]
            if _looks_like_name(candidate):
                fields['fullName'] = candidate
                break
    if not fields['fullName']:
        for line in lines:
            if _looks_like_name(line):
                fields['fullName'] = line
                break

    return fields
