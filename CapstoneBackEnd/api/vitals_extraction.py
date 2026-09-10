"""
Deterministic numeric extraction of vital signs explicitly stated in a
nurse's free-text assessment.

This exists because the n8n structure-chart workflow's own LLM node does
not reliably return a structured vitalSigns object — confirmed empirically
by calling it directly with unambiguous vitals language ("Heart rate 110
bpm... Temperature 38.6C... SpO2 92%... RR 24... BP 160/100") and getting
back prose (assessment/clinicalSummary text) with no vitalSigns key at all.
Rather than depend on an external, unverifiable AI prompt to parse numbers
correctly, ChartingViewSet.structure treats this module as the primary
source for vitalSigns and the workflow's own (if any) as a lower-priority
fallback — see api/views.py.

Deliberately conservative: every pattern requires the vital's own label
(heart rate/pulse, temp/temperature, spo2/o2 sat, respiratory rate/RR,
blood pressure/BP) immediately before the number, so an unrelated number
elsewhere in the note is never mistaken for a reading.
"""

import re

_SEP = r'\s*(?:is|of|at|:|was|=|-)?\s*'

_HEART_RATE = re.compile(
    rf'\b(?:heart rate|pulse|hr){_SEP}(\d{{2,3}})\s*(?:bpm)?\b', re.I
)
_TEMPERATURE = re.compile(
    rf'\btemp(?:erature)?{_SEP}(\d{{2,3}}(?:\.\d+)?)\s*°?\s*(F|C)?\b', re.I
)
_OXYGEN_SATURATION = re.compile(
    rf'\b(?:spo2|o2\s*sat(?:uration)?s?|oxygen saturation){_SEP}(\d{{2,3}})\s*%?\b', re.I
)
_RESPIRATORY_RATE = re.compile(
    rf'\b(?:respiratory rate|resp(?:iration)?s?|rr){_SEP}(\d{{1,2}})\b', re.I
)
_BLOOD_PRESSURE = re.compile(
    rf'\b(?:blood pressure|bp){_SEP}(\d{{2,3}}\s*/\s*\d{{2,3}})\b', re.I
)
_PAIN_SCALE = re.compile(
    rf'\bpain (?:scale|level|score){_SEP}(\d{{1,2}})(?:\s*/\s*10)?\b', re.I
)


def extract_vitals_from_text(text: str) -> dict:
    """
    Every vital explicitly labelled with a reading in `text`, keyed to
    match VitalSignsSerializer/ChartingNote's vitalSigns shape. A vital
    with no labelled number nearby is simply absent from the result —
    never guessed, never defaulted.
    """
    if not text or not text.strip():
        return {}

    result: dict = {}

    heart_rate = _HEART_RATE.search(text)
    if heart_rate:
        result['heartRate'] = int(heart_rate.group(1))

    temperature = _TEMPERATURE.search(text)
    if temperature:
        value = float(temperature.group(1))
        if (temperature.group(2) or '').upper() == 'F':
            value = round((value - 32) * 5 / 9, 1)
        result['temperature'] = value

    oxygen_saturation = _OXYGEN_SATURATION.search(text)
    if oxygen_saturation:
        result['oxygenSaturation'] = int(oxygen_saturation.group(1))

    respiratory_rate = _RESPIRATORY_RATE.search(text)
    if respiratory_rate:
        result['respiratoryRate'] = int(respiratory_rate.group(1))

    blood_pressure = _BLOOD_PRESSURE.search(text)
    if blood_pressure:
        result['bloodPressure'] = re.sub(r'\s+', '', blood_pressure.group(1))

    pain_scale = _PAIN_SCALE.search(text)
    if pain_scale:
        result['painScale'] = int(pain_scale.group(1))

    return result
