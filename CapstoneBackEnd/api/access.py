"""
The single answer to "may this account use the app right now?".

Every place that lets a token in (the API auth class, the permission classes,
the WebSocket) asks this module, so the rule cannot drift between them.
"""


def account_block_code(user):
    """
    Why this account cannot use the app, as a stable error code — or None
    when it can. Admin accounts (User.is_staff, no NurseProfile) are allowed
    while Django's own User.is_active is True.
    """
    if user is None or not user.is_active:
        return 'account_deactivated'
    profile = getattr(user, 'nurse_profile', None)
    if profile is None:
        return None if user.is_staff else 'account_pending'
    if not profile.is_active_staff:
        return 'account_deactivated'
    if profile.approval_status == 'pending':
        return 'account_pending'
    if profile.approval_status == 'rejected':
        return 'account_rejected'
    return None


def user_is_active_member(user) -> bool:
    return account_block_code(user) is None


BLOCKED_MESSAGES = {
    'account_pending': 'Your account is waiting for administrator approval.',
    'account_rejected': 'Your registration was rejected. Contact an administrator.',
    'account_deactivated': 'This account has been deactivated. Contact an administrator.',
}


def account_blocked_exception(code):
    """A 403 whose body carries the stable `code` the frontend switches on."""
    from rest_framework.exceptions import PermissionDenied

    return PermissionDenied(detail={'detail': BLOCKED_MESSAGES[code], 'code': code})


# Sensitive nurse fields: HR and wellbeing data about a colleague. Head nurses
# and admins may see them; a staff nurse may not see them about anyone. Every
# nurse endpoint that returns these keys goes through filter_nurse_fields().
SENSITIVE_NURSE_FIELDS = frozenset({'email', 'nurseEmail', 'overtimeHours', 'burnoutRisk'})


def may_see_sensitive_nurse_fields(user) -> bool:
    if user is None or not user.is_authenticated:
        return False
    if user.is_staff:
        return True
    profile = getattr(user, 'nurse_profile', None)
    return bool(profile and profile.role == 'head_nurse')


def filter_nurse_fields(row: dict, user) -> dict:
    """A nurse row with the sensitive fields removed unless the caller may see them."""
    if may_see_sensitive_nurse_fields(user):
        return row
    return {key: value for key, value in row.items() if key not in SENSITIVE_NURSE_FIELDS}
