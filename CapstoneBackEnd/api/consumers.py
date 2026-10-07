"""
The WebSocket a signed-in nurse holds open.

A handover happens on someone else's device, so the receiving nurse's app has no
local event to react to. This is the push side of that: one socket per signed-in
nurse, joined to a group that only they are in, so the server can reach exactly
one person the moment a handover is saved.

Authentication is by a one-time ticket (api/ws_tickets.py), obtained from
POST /api/auth/ws-ticket/ with the same token the REST API uses. Browsers
cannot set headers on a WebSocket handshake, so *something* has to travel in
the query string where it can end up in server, proxy and access logs — a
ticket is disposable (short-lived, accepted at most once) so that being logged
costs nothing. ?token=<session key> is still accepted for now, for any client
not yet updated to request a ticket; it carries the same risk the ticket
exists to avoid and should be removed once nothing sends it any more.
Nothing is sent to an anonymous socket.

The group name is derived from the authenticated user's primary key, never from
anything the client says about itself. A client cannot ask to join someone
else's group: it does not choose a group at all.
"""

import logging
from urllib.parse import unquote

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer

logger = logging.getLogger(__name__)


def user_group(user_id) -> str:
    """The private channel group for one nurse."""
    return 'nurse_%s' % user_id


@database_sync_to_async
def _user_for_token(key):
    # Imported lazily: this module is loaded from asgi.py, which runs before
    # the app registry is ready if models are imported at module level.
    from .access import account_block_code
    from .authentication import session_is_expired
    from .models import AuthSession

    if not key:
        return None, None
    session = (
        AuthSession.objects.select_related('user')
        .filter(key=key)
        .first()
    )
    if session is None:
        return None, None
    if session_is_expired(session):
        session.delete()
        return None, None
    code = account_block_code(session.user)
    if code:
        return None, code
    return session.user, None


@database_sync_to_async
def _user_for_ticket(ticket):
    from django.contrib.auth.models import User

    from .access import account_block_code
    from .ws_tickets import consume_ticket

    if not ticket:
        return None, None
    user_id = consume_ticket(ticket)
    if user_id is None:
        return None, None
    try:
        user = User.objects.get(pk=user_id)
    except User.DoesNotExist:
        return None, None
    code = account_block_code(user)
    if code:
        return None, code
    return user, None


class NotificationConsumer(AsyncJsonWebsocketConsumer):
    """Pushes notifications to the one nurse who owns this connection."""

    def _query_param(self, name):
        query = (self.scope.get('query_string') or b'').decode('utf-8', 'ignore')
        for part in query.split('&'):
            key, _, value = part.partition('=')
            if key == name:
                return unquote(value).strip()
        return ''

    async def connect(self):
        ticket = self._query_param('ticket')
        if ticket:
            user, blocked = await _user_for_ticket(ticket)
        else:
            # Legacy path — see module docstring. A client sending neither
            # falls straight through with user=None, same as a bad ticket.
            token = self._query_param('token')
            user, blocked = await _user_for_token(token)

        if blocked:
            # 4003: the account exists but may not use the app (pending,
            # rejected, deactivated). Distinct from a bad token (4401).
            logger.info('[Realtime] Rejected socket: account %s', blocked)
            await self.close(code=4003)
            return

        if user is None:
            # 4401: close before accepting, so an unauthenticated client never
            # joins a group and never receives a single message.
            logger.info('[Realtime] Rejected socket with no valid token')
            await self.close(code=4401)
            return

        self.user = user
        self.group = user_group(user.pk)
        await self.channel_layer.group_add(self.group, self.channel_name)
        await self.accept()
        logger.info('[Realtime] Connected: %s -> group %s', user.username, self.group)

        # Tells the client the socket is live and whose it is, so the app can
        # stop its fallback polling only once push is genuinely working.
        await self.send_json({'type': 'connected', 'userId': str(user.pk)})

    async def disconnect(self, code):
        group = getattr(self, 'group', None)
        if group:
            await self.channel_layer.group_discard(group, self.channel_name)
            logger.info('[Realtime] Disconnected: group %s (code %s)', group, code)

    async def receive_json(self, content, **kwargs):
        # The client has nothing to tell us. Answering a ping keeps intermediaries
        # from closing an idle connection; everything else is ignored rather than
        # trusted.
        if isinstance(content, dict) and content.get('type') == 'ping':
            await self.send_json({'type': 'pong'})

    async def account_revoked(self, event):
        # Sent when the account is deactivated or otherwise blocked; the
        # connection stops receiving anything from here on.
        await self.close(code=4003)

    async def notify(self, event):
        """Channel-layer handler. `event['payload']` is sent to this nurse."""
        await self.send_json(event['payload'])
