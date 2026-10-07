"""
Issue, revoke, and look up API tokens (AuthSession). One session per login;
see AuthSession in models.py for why this replaces DRF's Token.
"""

import secrets

from .models import AuthSession


def issue_session(user):
    """A new, independent session for `user` — never reuses an existing key."""
    return AuthSession.objects.create(user=user, key=secrets.token_hex(20))


def revoke_session(session):
    """Revoke only this session. Safe to call on an already-revoked session."""
    if session is not None and session.pk is not None:
        AuthSession.objects.filter(pk=session.pk).delete()


def revoke_all_sessions(user):
    """Revoke every session `user` has — logout-all, password change, deactivation."""
    AuthSession.objects.filter(user=user).delete()


def close_user_sockets(user):
    """Tell every open notification socket for `user` to close (code 4003)."""
    from asgiref.sync import async_to_sync
    from channels.layers import get_channel_layer

    from .consumers import user_group

    layer = get_channel_layer()
    if layer is None:
        return
    async_to_sync(layer.group_send)(user_group(user.pk), {'type': 'account.revoked'})
