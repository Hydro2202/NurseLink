"""
ASGI entry point.

Two protocols share the process: ordinary HTTP for the REST API, and WebSocket
for pushing notifications to a signed-in nurse the moment something happens.

get_asgi_application() is called before the routing import on purpose — it sets
the app registry up, and api.routing imports consumers that touch models.
"""

import os

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'CapstoneBackEnd.settings')

from django.core.asgi import get_asgi_application

django_asgi_app = get_asgi_application()

# Render's Build Command for this service only runs `pip install`, with no
# step to apply migrations before the app starts — so a deploy that adds a
# model field (e.g. the 2026-10 NurseProfile.phone_number column) would
# otherwise go live with code that immediately 500s on that column. Running
# migrate here, once, right after the app registry is ready and before any
# request is served, means a deploy is self-contained regardless of the
# Render dashboard's Build Command. Safe for this service specifically: it
# runs as a single instance (no horizontal scaling), so there is no
# concurrent-migration race to worry about. A failed migration raises here
# and the process exits non-zero, which surfaces as a failed deploy in
# Render's logs rather than a silently broken running instance.
from django.core.management import call_command  # noqa: E402

call_command('migrate', interactive=False)

from channels.routing import ProtocolTypeRouter, URLRouter  # noqa: E402

from api.routing import websocket_urlpatterns  # noqa: E402

application = ProtocolTypeRouter(
    {
        'http': django_asgi_app,
        # No AuthMiddlewareStack: these sockets carry a DRF token, not a session
        # cookie, and the consumer authenticates it itself.
        'websocket': URLRouter(websocket_urlpatterns),
    }
)
