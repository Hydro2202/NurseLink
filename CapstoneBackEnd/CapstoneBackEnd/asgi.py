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
