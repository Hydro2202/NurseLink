"""
Registration email validation: syntax + MX/A record deliverability + a
disposable-domain blocklist.

This is the honest ceiling of what's checkable without either sending real
mail or paying a third-party mailbox-verification API: it proves the address
is well-formed and that its domain is actually configured to receive mail.
It cannot prove the specific mailbox exists.
"""

from __future__ import annotations

from email_validator import EmailNotValidError, validate_email as _validate_email

INVALID_EMAIL_MESSAGE = (
    'This email address could not be verified. Please enter a valid and existing email address.'
)

# A small, well-known set of disposable/throwaway email domains. Not exhaustive —
# swap for a maintained list or a third-party API if stricter enforcement is needed.
DISPOSABLE_DOMAINS = frozenset(
    {
        'mailinator.com',
        'guerrillamail.com',
        'guerrillamail.info',
        '10minutemail.com',
        'tempmail.com',
        'temp-mail.org',
        'yopmail.com',
        'throwawaymail.com',
        'trashmail.com',
        'getnada.com',
        'discard.email',
        'fakeinbox.com',
        'sharklasers.com',
    }
)


class EmailValidationError(Exception):
    """Raised with a user-facing message when an email fails validation."""


def validate_registration_email(email: str) -> str:
    """Validate syntax + deliverability, returning the normalized address or raising EmailValidationError."""
    try:
        result = _validate_email(email, check_deliverability=True)
    except EmailNotValidError as exc:
        raise EmailValidationError(INVALID_EMAIL_MESSAGE) from exc

    if result.domain.lower() in DISPOSABLE_DOMAINS:
        raise EmailValidationError(INVALID_EMAIL_MESSAGE)

    return result.normalized
