"""
Administrator activity log (AdminAuditLog). Every admin action worth
accounting for goes through record(): views of a record the server actually
served, successful changes, account decisions, and print requests.

Called by the server after the action succeeded, so the log reflects what
really happened, a direct API call included, and a failed or unauthorized
request is never written as a success. Never pass passwords, OTPs or tokens
in `changes`.
"""

import logging
import uuid

from .models import AdminAuditLog
from .names import full_name

logger = logging.getLogger(__name__)

#: Keys never stored in an audit row, wherever they appear in `changes`.
SECRET_KEYS = {'password', 'newPassword', 'otp', 'otpCode', 'token', 'key', 'secret'}


def _scrub(value):
    if isinstance(value, dict):
        return {k: ('[redacted]' if k in SECRET_KEYS else _scrub(v)) for k, v in value.items()}
    if isinstance(value, list):
        return [_scrub(v) for v in value]
    return value


def _role_label(user):
    if getattr(user, 'is_staff', False):
        return 'Administrator'
    profile = getattr(user, 'nurse_profile', None)
    return profile.get_role_display() if profile else ''


def request_id(request):
    """One id per HTTP request (reused if the client or proxy sent one)."""
    existing = getattr(request, '_audit_request_id', None)
    if existing:
        return existing
    rid = (request.META.get('HTTP_X_REQUEST_ID') or '').strip()[:64] or uuid.uuid4().hex
    try:
        request._audit_request_id = rid
    except AttributeError:
        pass
    return rid


def record(request, action, record_type, record_id='', label='', changes=None, summary='', status='success'):
    user = request.user
    try:
        return AdminAuditLog.objects.create(
            actor=user if user.is_authenticated else None,
            actor_name=full_name(user) if user.is_authenticated else '',
            actor_role=_role_label(user),
            action=action,
            record_type=record_type,
            record_id=str(record_id or ''),
            record_label=str(label or '')[:255],
            summary=str(summary or '')[:255],
            status=status,
            changes=_scrub(changes or {}),
            request_id=request_id(request),
        )
    except Exception:  # an audit write must never take down the action itself
        logger.exception('Could not write admin audit entry (%s %s %s)', action, record_type, record_id)
        return None
