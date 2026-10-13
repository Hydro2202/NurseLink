"""
One place that decides how a person's name is displayed.

Django's User.get_full_name() is first + last only; the middle name lives on
NurseProfile. Every display name in the API goes through full_name() so a
nurse who signed up with a middle name sees it everywhere (profile, dashboard,
head-nurse and admin screens, notifications).

Some records still point at nurses by their typed display name (Task.assigned_to,
handover names). Rows written before middle names were displayed hold
"First Last", newer ones may hold "First Middle Last" -- name_variants() returns
every form a user can be addressed by so matching accepts both.
"""


def _middle_name(user):
    profile = getattr(user, 'nurse_profile', None) if user is not None else None
    try:
        return (profile.middle_name or '').strip() if profile else ''
    except Exception:
        return ''


def full_name(user, fallback_username=True):
    """'First Middle Last' (middle omitted when blank); username if no name."""
    if user is None:
        return ''
    parts = [user.first_name, _middle_name(user), user.last_name]
    name = ' '.join(' '.join(p.split()) for p in parts if p and p.strip())
    if name or not fallback_username:
        return name
    return user.username


def name_variants(user):
    """Every name form this user may be referenced by, lowercased, blanks dropped."""
    if user is None:
        return set()
    forms = {
        full_name(user, fallback_username=False),
        user.get_full_name(),
        user.username,
        user.email or '',
    }
    return {' '.join(f.lower().split()) for f in forms if f and f.strip()}


def name_match_q(field, user):
    """Q() matching `field` case-insensitively against any of the user's names."""
    from django.db.models import Q

    q = Q()
    for form in {full_name(user, fallback_username=False), user.get_full_name().strip(), user.username}:
        if form:
            q |= Q(**{f'{field}__iexact': form})
    return q
