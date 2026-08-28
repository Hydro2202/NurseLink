"""
The WebSocket a signed-in nurse holds open.

A handover happens on someone else's device, so the receiving nurse's app has no
local event to react to. This is the push side of that: one socket per signed-in
nurse, joined to a group that only they are in, so the server can reach exactly
one person the moment a handover is saved.

Authentication is by the same DRF token the REST API uses. Browsers cannot set
headers on a WebSocket handshake, so the token arrives as a query parameter —
which is why the socket URL is only ever built from a token already held in the
app's own storage, and why the connection is rejected outright without one.
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
    from rest_framework.authtoken.models import Token

    if not key:
        return None
    token = (
        Token.objects.select_related('user')
        .filter(key=key)
        .first()
    )
    if token is None or not token.user.is_active:
        return None
    return token.user


class NotificationConsumer(AsyncJsonWebsocketConsumer):
    """Pushes notifications to the one nurse who owns this connection."""

    def _token_from_query(self):
        query = (self.scope.get('query_string') or b'').decode('utf-8', 'ignore')
        for part in query.split('&'):
            name, _, value = part.partition('=')
            if name == 'token':
                return unquote(value).strip()
        return ''

    async def connect(self):
        token = self._token_from_query()
        user = await _user_for_token(token)

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

    async def notify(self, event):
        """Channel-layer handler. `event['payload']` is sent to this nurse."""
        await self.send_json(event['payload'])
