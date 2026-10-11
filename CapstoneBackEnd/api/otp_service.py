"""Registration OTP lifecycle: generation, delivery, verification, resend."""

from __future__ import annotations

import logging
import secrets
from datetime import timedelta

import requests
from django.conf import settings
from django.contrib.auth.hashers import check_password, make_password
from django.core.mail import send_mail
from django.db import transaction
from django.utils import timezone

from .email_validation import validate_registration_email
from .models import RegistrationOTP, RegistrationSession

logger = logging.getLogger(__name__)

OTP_LENGTH = 6
# Env-configurable via OTP_EXPIRATION_MINUTES / OTP_RESEND_COOLDOWN_SECONDS
# in settings.py, rather than literals here.
OTP_TTL = timedelta(minutes=settings.OTP_EXPIRATION_MINUTES)
RESEND_COOLDOWN = timedelta(seconds=settings.OTP_RESEND_COOLDOWN_SECONDS)
MAX_VERIFY_ATTEMPTS = 5
MAX_RESEND_ATTEMPTS = 3
PURPOSE = 'registration'


class OtpCooldownError(Exception):
    def __init__(self, retry_after: int):
        self.retry_after = retry_after
        super().__init__(f'Please wait {retry_after}s before requesting another code.')


class OtpDeliveryError(Exception):
    """
    ``default_detail`` is what the API layer shows a client — a fixed class
    attribute, matching this class's own raise-site message verbatim.
    """

    default_detail = "We couldn't send the verification code. Please try again."


class OtpNotConfiguredError(OtpDeliveryError):
    default_detail = (
        'Email delivery is not configured on the server. '
        'Set EMAIL_HOST, EMAIL_HOST_USER, EMAIL_HOST_PASSWORD, and DEFAULT_FROM_EMAIL '
        'in the backend .env, then restart the API.'
    )


class OtpResendLimitError(Exception):
    default_detail = 'Maximum resend attempts reached. Please restart face verification.'


def _generate_code() -> str:
    return ''.join(secrets.choice('0123456789') for _ in range(OTP_LENGTH))


def _send_via_resend(email: str, subject: str, message: str) -> None:
    """
    HTTPS delivery (port 443), not SMTP. Needed because Render blocks
    outbound SMTP (ports 25/465/587/2525) on every plan — confirmed in
    production: a real send via the SMTP path below hung ~139s (nothing
    answering the TCP handshake) then failed, while the identical EMAIL_*
    settings deliver in seconds on a non-Render machine. Preferred over SMTP
    whenever RESEND_API_KEY is set; see _send_otp_email.

    Sandbox limitation: without a verified sending domain on the Resend
    account, Resend only accepts `from: onboarding@resend.dev` and only
    delivers `to` the address that owns the Resend API key — not arbitrary
    recipients. Fine for this project's own demo/testing; verify a domain on
    resend.com before relying on it for real end users.
    """
    try:
        response = requests.post(
            'https://api.resend.com/emails',
            headers={
                'Authorization': f'Bearer {settings.RESEND_API_KEY}',
                'Content-Type': 'application/json',
            },
            json={
                'from': 'NurseLink <onboarding@resend.dev>',
                'to': [email],
                'subject': subject,
                'text': message,
            },
            timeout=15,
        )
        response.raise_for_status()
    except requests.RequestException as exc:
        body = getattr(exc.response, 'text', '') if getattr(exc, 'response', None) else ''
        logger.error('Resend OTP email delivery failed for %s: %s %s', email, exc, body)
        raise OtpDeliveryError(
            "We couldn't send the verification code. Please try again."
        ) from exc


def _send_otp_email(email: str, code: str) -> None:
    backend = (getattr(settings, 'EMAIL_BACKEND', '') or '').lower()
    host = (getattr(settings, 'EMAIL_HOST', '') or '').strip()
    resend_key = getattr(settings, 'RESEND_API_KEY', '') or ''

    # Reject console-only delivery so registration OTP always goes through a
    # real provider (Resend or SMTP) configured via environment variables.
    #
    # ALLOW_CONSOLE_OTP is the deliberate exception for local development,
    # where there is often no SMTP account to hand and the alternative is
    # being unable to exercise the OTP fallback at all. It must be switched
    # on explicitly and prints the code to the server log, so it is only ever
    # safe on a machine where that log is already trusted. Never enable it
    # anywhere real: a code in a log is a code anyone with log access can use.
    if not resend_key and not getattr(settings, 'ALLOW_CONSOLE_OTP', False):
        if 'console' in backend or not host:
            raise OtpNotConfiguredError(
                'Email delivery is not configured on the server. '
                'Set RESEND_API_KEY, or EMAIL_HOST/EMAIL_HOST_USER/EMAIL_HOST_PASSWORD/DEFAULT_FROM_EMAIL, '
                'in the backend .env, then restart the API.'
            )
    elif not resend_key and ('console' in backend or not host):
        logger.warning(
            'ALLOW_CONSOLE_OTP is on — printing the code instead of emailing it. '
            'Development only.\n'
            '    ==============================\n'
            '      OTP for %s: %s\n'
            '    ==============================',
            email,
            code,
        )
        return

    subject = 'Your Verification Code'
    message = (
        'Hello,\n\n'
        'Your verification code is:\n\n'
        f'{code}\n\n'
        'This code will expire shortly.\n\n'
        'If you did not request this code, please ignore this email.\n\n'
        'Regards,\n'
        'NurseLink'
    )

    if resend_key:
        _send_via_resend(email, subject, message)
        return

    try:
        send_mail(
            subject,
            message,
            settings.DEFAULT_FROM_EMAIL,
            [email],
            fail_silently=False,
        )
    except OtpDeliveryError:
        raise
    except Exception as exc:  # noqa: BLE001 - collapse any transport failure into one error type
        logger.error('SMTP OTP email delivery failed for %s: %s', email, exc)
        raise OtpDeliveryError(
            "We couldn't send the verification code. Please try again."
        ) from exc


def issue_otp(session: RegistrationSession, *, is_resend: bool = False) -> RegistrationOTP:
    """
    Generate a new OTP, invalidate any previous active one for this session,
    email it, and persist. Enforces the 60s resend cooldown based on the most
    recently issued OTP for this session. Fully atomic: if email delivery
    fails, the previous OTP is left untouched (no dangling undeliverable code).

    Raises EmailValidationError (from api.email_validation) if the address
    fails syntax/deliverability checks — no OTP is generated in that case.
    """
    email = validate_registration_email(session.email)

    latest = (
        RegistrationOTP.objects.filter(session=session, purpose=PURPOSE)
        .order_by('-created_at')
        .first()
    )
    if latest:
        elapsed = timezone.now() - latest.created_at
        if elapsed < RESEND_COOLDOWN:
            retry_after = int((RESEND_COOLDOWN - elapsed).total_seconds()) + 1
            raise OtpCooldownError(retry_after)

    if is_resend:
        issued_count = RegistrationOTP.objects.filter(session=session, purpose=PURPOSE).count()
        # The first code is not a resend; at most three replacement codes are allowed.
        if issued_count >= MAX_RESEND_ATTEMPTS + 1:
            raise OtpResendLimitError('Maximum resend attempts reached. Please restart face verification.')

    code = _generate_code()

    with transaction.atomic():
        RegistrationOTP.objects.filter(
            session=session, purpose=PURPOSE, is_active=True
        ).update(is_active=False)

        otp = RegistrationOTP.objects.create(
            session=session,
            email=email,
            otp_hash=make_password(code),
            purpose=PURPOSE,
            expires_at=timezone.now() + OTP_TTL,
        )

        _send_otp_email(email, code)

        if session.email != email:
            session.email = email
            session.save(update_fields=['email', 'updated_at'])

    return otp


def verify_otp(session: RegistrationSession, submitted_code: str):
    """
    Returns (verified: bool, message: str, error_code: str | None).
    error_code is one of NOT_FOUND, EXPIRED, MAX_ATTEMPTS, INVALID, or None on success.
    """
    otp = (
        RegistrationOTP.objects.filter(
            session=session, purpose=PURPOSE, is_active=True, verified=False
        )
        .order_by('-created_at')
        .first()
    )
    if not otp:
        return False, 'No active verification code found. Please request a new code.', 'NOT_FOUND'

    if otp.expires_at < timezone.now():
        otp.is_active = False
        otp.save(update_fields=['is_active'])
        return False, 'Verification Code Expired. Your verification code has expired.', 'EXPIRED'

    if otp.attempts >= MAX_VERIFY_ATTEMPTS:
        otp.is_active = False
        otp.save(update_fields=['is_active'])
        return False, 'Maximum attempts reached. Please request a new code.', 'MAX_ATTEMPTS'

    if otp.email.lower() != session.email.lower() or not check_password(submitted_code, otp.otp_hash):
        otp.attempts += 1
        if otp.attempts >= MAX_VERIFY_ATTEMPTS:
            otp.is_active = False
        otp.save(update_fields=['attempts', 'is_active'])
        if otp.attempts >= MAX_VERIFY_ATTEMPTS:
            return False, 'Maximum attempts reached. Please request a new code.', 'MAX_ATTEMPTS'
        return False, 'Invalid Verification Code. The code you entered is incorrect. Please try again.', 'INVALID'

    otp.verified = True
    otp.is_active = False
    otp.save(update_fields=['verified', 'is_active'])

    session.otp_verified = True
    session.verification_method = 'EMAIL_OTP'
    session.save(update_fields=['otp_verified', 'verification_method', 'updated_at'])

    return True, 'OTP verified successfully.', None
