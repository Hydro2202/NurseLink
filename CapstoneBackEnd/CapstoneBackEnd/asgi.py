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

# NOTE: migrations are deliberately NOT run here.
#
# This module is imported every time a Daphne worker boots. Running
# `migrate` at import meant the app's startup opened a database connection
# and ran the full migration machinery before serving anything — so any
# transient database hiccup at boot (e.g. Render Postgres closing the SSL
# connection: "SSL connection has been closed unexpectedly") raised during
# import, the ASGI application failed to load, and Daphne could not start at
# all. The service then appeared "live" but answered nothing.
#
# Migrations now run once, during the build, before the new version starts —
# the Render Build Command is `pip install -r requirements.txt && python
# manage.py migrate --noinput` (the dedicated Pre-Deploy Command is paid-only;
# see DEPLOYMENT.md). That keeps schema changes applied without tying the
# app's ability to boot and serve requests to a successful database
# connection at import time.

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
