"""
Whether a nurse is actively using the app right now.

Distinct from the Duty Roster (api.duty_status): a nurse can be logged in
with no shift scheduled, or scheduled with the app closed. NurseProfile.
last_seen_at is updated (throttled, see touch_last_seen) from every
LiveStateView poll while a session is open, and cleared on logout.
"""
from django.utils import timezone

PRESENCE_TOUCH_THROTTLE_SECONDS = 60
ONLINE_WINDOW_SECONDS = 2 * 60
AWAY_WINDOW_SECONDS = 15 * 60


def touch_last_seen(profile):
    """
    Stamp NurseProfile.last_seen_at to now, but only write to the database
    once per PRESENCE_TOUCH_THROTTLE_SECONDS per nurse -- this runs on every
    live poll (every few seconds, from every open session), so an
    unconditional save() here would be a write on every tick.
    """
    now = timezone.now()
    if profile.last_seen_at is not None:
        age = (now - profile.last_seen_at).total_seconds()
        if age < PRESENCE_TOUCH_THROTTLE_SECONDS:
            return
    profile.last_seen_at = now
    profile.save(update_fields=['last_seen_at'])


def presence_for(last_seen_at, *, now=None):
    """'online' | 'away' | 'offline' from a last_seen_at instant (or None)."""
    if last_seen_at is None:
        return 'offline'
    now = now or timezone.now()
    age = (now - last_seen_at).total_seconds()
    if age <= ONLINE_WINDOW_SECONDS:
        return 'online'
    if age <= AWAY_WINDOW_SECONDS:
        return 'away'
    return 'offline'


def clear_last_seen(user):
    """Mark offline immediately (api.auth_sessions logout/logout-all) rather
    than waiting for AWAY_WINDOW_SECONDS to lapse the way a crashed/killed
    session does. A no-op if the user has no NurseProfile (admin accounts)."""
    profile = getattr(user, 'nurse_profile', None)
    if profile is not None and profile.last_seen_at is not None:
        profile.last_seen_at = None
        profile.save(update_fields=['last_seen_at'])


def presence_fields(profile):
    """(presence, lastSeenAt-iso-or-None) for a NurseProfile, for API rows."""
    if profile is None:
        return 'offline', None
    last_seen_at = profile.last_seen_at
    return presence_for(last_seen_at), (last_seen_at.isoformat() if last_seen_at else None)
