"""
Verified-identity rules shared by sign-up, self-service profile updates,
correction requests and the review command.
"""

import hashlib
import re

from django.conf import settings


# Fields a nurse may not change themselves once sign-up verification and admin
# approval are done. They change only through an approved CorrectionRequest,
# or — for the login email — through EmailChangeRequest.
LOCKED_SELF_SERVICE_FIELDS = (
    'name', 'firstName', 'middleName', 'lastName', 'email', 'licenseNumber', 'clinicalRole',
)


def blocked_name_terms(name: str) -> list[str]:
    """Role words that must not appear in a person's name (settings.NAME_BLOCKED_WORDS)."""
    found = []
    for term in getattr(settings, 'NAME_BLOCKED_WORDS', []):
        if re.search(rf'\b{re.escape(term)}\b', name or '', flags=re.IGNORECASE):
            found.append(term)
    return found


def _alnum(value: str) -> str:
    return re.sub(r'[^a-z0-9]', '', (value or '').lower())


def identity_mismatches(session, submitted: dict) -> list[str]:
    """
    Fields the sign-up form submitted that differ from what was scanned from the
    PRC card. Case, spacing and punctuation are ignored; a blank submitted field
    is not compared (it is taken from the scan).
    """
    mismatches = []
    pairs = (
        ('firstName', session.id_first_name),
        ('middleName', session.id_middle_name),
        ('lastName', session.id_last_name),
    )
    for key, scanned in pairs:
        given = submitted.get(key) or ''
        if given.strip() and _alnum(given) != _alnum(scanned):
            mismatches.append(key)
    given_licence = submitted.get('licenseNumber') or ''
    if given_licence.strip() and _alnum(given_licence) != _alnum(session.id_registration_no):
        mismatches.append('licenseNumber')
    return mismatches


def hash_code(code: str) -> str:
    return hashlib.sha256(f'{code}:{settings.SECRET_KEY}'.encode('utf-8')).hexdigest()


def coded_400(detail, code, **extra):
    """
    A 400 whose body is exactly {'detail', 'code', ...} — not DRF's usual
    list-wrapped field errors — so the app can switch on `code`. Raise it from
    a serializer validate() method.
    """
    from rest_framework.exceptions import APIException

    class _Coded(APIException):
        status_code = 400

    return _Coded(detail={'detail': detail, 'code': code, **extra})
