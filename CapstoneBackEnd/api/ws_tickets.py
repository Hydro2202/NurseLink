"""
One-time WebSocket connect tickets.

The browser/RN WebSocket API cannot set an Authorization header on the
handshake, so some credential has to travel in the URL — which is exactly
what ends up in server, proxy and error logs. A ticket is disposable: a
signed-in client exchanges its real token for a ticket over a normal
authenticated HTTPS request (never logged the same way query strings are),
puts the *ticket* in the socket URL, and the ticket is deleted the moment it
is used. A ticket that leaks into a log is worthless shortly afterwards, and
useless a second time even immediately.

Stored in their own cache alias (settings.WS_TICKET_REDIS_URL when set,
otherwise a database table — see migration 0055), same pattern as
api/login_throttle.py.
"""

import secrets

from django.conf import settings
from django.core.cache import caches


def _cache():
    return caches['ws_tickets']


def _key(ticket: str) -> str:
    return f'ws_ticket:{ticket}'


def issue_ticket(user) -> str:
    """A fresh one-time ticket for `user`, valid for WS_TICKET_TTL_SECONDS."""
    ticket = secrets.token_urlsafe(32)
    _cache().set(_key(ticket), user.pk, timeout=settings.WS_TICKET_TTL_SECONDS)
    return ticket


def consume_ticket(ticket: str):
    """
    The user id the ticket was issued for, or None if it is missing, expired,
    or already used. Either way the ticket is gone after this call — a
    ticket is accepted at most once.
    """
    if not ticket:
        return None
    cache = _cache()
    key = _key(ticket)
    user_id = cache.get(key)
    cache.delete(key)
    return user_id
