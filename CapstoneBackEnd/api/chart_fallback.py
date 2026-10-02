"""
Local fallback for autocharting when the n8n structure-chart workflow returns
nothing usable.

The workflow is external and has been seen answering 200 with a body that has
no note at all (e.g. ``{"title": "Empty Chart", "summary": "No data was
provided...", "data": []}``). Rather than fail the nurse's charting with a 502,
ChartingViewSet.structure falls back to this module, which organises the
nurse's OWN text into the sections the app renders. It never invents content:
every word in the result comes from the assessment the nurse typed, only split
by the section headings they already used (Data / Action / Response / Plan and
common synonyms). Text before any heading is treated as the assessment.
"""

import re

# Heading word(s) -> structured field. Matched case-insensitively at the start
# of a line, followed by a colon (or a dash), with optional text after it.
_HEADINGS = {
    'focus': 'focus',
    'data': 'assessment',
    'assessment': 'assessment',
    'assessment & observations': 'assessment',
    'observation': 'assessment',
    'observations': 'assessment',
    'subjective': 'assessment',
    'objective': 'assessment',
    'action': 'interventions',
    'actions': 'interventions',
    'intervention': 'interventions',
    'interventions': 'interventions',
    'nursing intervention': 'interventions',
    'nursing interventions': 'interventions',
    'response': 'patientResponse',
    'patient response': 'patientResponse',
    'evaluation': 'patientResponse',
    'plan': 'plan',
    'plan of care': 'plan',
    'follow-up': 'plan',
    'follow up': 'plan',
}

_HEADING_RE = re.compile(
    r'^\s*(?:[-*•]\s*)?(?P<head>'
    + '|'.join(sorted((re.escape(h) for h in _HEADINGS), key=len, reverse=True))
    + r')\s*(?:\([^)]*\))?\s*[:\-–]\s*(?P<rest>.*)$',
    re.IGNORECASE,
)

_SENTENCE_SPLIT_RE = re.compile(r'(?<=[.!?])\s+(?=[A-Z0-9])')


def _split_items(text: str) -> list[str]:
    """One intervention per line; a single long paragraph is split by sentence."""
    items = []
    for line in text.splitlines():
        line = re.sub(r'^\s*(?:[-*•]|\d+[.)])\s*', '', line).strip()
        if not line:
            continue
        items.extend(s.strip() for s in _SENTENCE_SPLIT_RE.split(line) if s.strip())
    return items


def structure_from_assessment(text: str) -> dict:
    """
    Split the nurse's assessment into structured sections by its own headings.

    Returns a dict with ``assessment``, ``interventions`` (list),
    ``patientResponse`` and ``plan`` — plus ``focus`` only if the nurse wrote
    one. Empty sections come back as '' / [] so nothing is invented.
    """
    sections: dict[str, list[str]] = {}
    current = 'assessment'
    for raw_line in (text or '').splitlines():
        match = _HEADING_RE.match(raw_line)
        if match:
            current = _HEADINGS[match.group('head').lower()]
            rest = match.group('rest').strip()
            if rest:
                sections.setdefault(current, []).append(rest)
            continue
        sections.setdefault(current, []).append(raw_line.rstrip())

    def joined(key: str) -> str:
        return re.sub(r'\n{3,}', '\n\n', '\n'.join(sections.get(key, []))).strip()

    result = {
        'assessment': joined('assessment'),
        'interventions': _split_items(joined('interventions')),
        'patientResponse': joined('patientResponse'),
        'plan': joined('plan'),
    }
    focus = joined('focus')
    if focus:
        result['focus'] = focus
    return result
