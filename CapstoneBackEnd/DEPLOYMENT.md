# Deployment notes

## Render: migrations and start/build commands

Migrations are **not** run from `asgi.py` (that caused the app to fail to
boot whenever the database connection hiccupped at startup — e.g. Render
Postgres closing the SSL connection, "SSL connection has been closed
unexpectedly"). Run them through Render's deploy pipeline instead, so the
app's ability to start is never tied to a successful DB connection at import
time.

Set these in the Render dashboard for the web service (Root Directory is
`CapstoneBackEnd/`):

- **Build Command:** `pip install -r requirements.txt && python manage.py migrate --noinput`
  Migrations run here, during the build, before the new version starts. A
  failed migration fails the build/deploy and is shown in the logs, instead
  of a silently broken running instance. Render builds a deploy once, so
  there is no multi-worker migration race.
  (Render's dedicated **Pre-Deploy Command** is the cleaner place for this,
  but it is **paid-instances only** — on the free plan, append migrate to the
  Build Command as above.)
- **Start Command:** `daphne -b 0.0.0.0 -p $PORT CapstoneBackEnd.asgi:application`
  (binds `0.0.0.0` and Render's assigned `$PORT`; keeps ASGI/WebSockets.)

Database connection reliability: `settings.py` reads the connection from the
`DB_*` environment variables with `sslmode: 'prefer'` (never hardcoded, SSL
never disabled). On Render, set `DB_HOST` to the database's **Internal**
hostname (from the Postgres instance's "Internal Database URL"), not the
external `*.<region>-postgres.render.com` host — connecting over the
external host from inside Render adds latency and is the usual cause of the
SSL connection being dropped. Connections are not pooled across requests
(`CONN_MAX_AGE` is the default 0), so a stale connection the database has
already closed is never reused.

## Redis is required in production

Live notifications go over WebSocket, through Django Channels' channel
layer. A nurse's socket is accepted by whichever server process handled
that connection; a notification can be *sent* from a different process —
another worker, a Celery task, a management command. The channel layer is
what lets one process reach a socket held open by another.

`channels.layers.InMemoryChannelLayer` keeps that routing table inside a
single process. Running more than one process (multiple daphne/uvicorn
workers, multiple dynos/containers) with the in-memory layer means each
process only ever sees its own sockets — a push sent from process B for a
socket held by process A is silently dropped. `channels_redis.core.RedisChannelLayer`
fixes that by keeping the routing table in Redis, which every process can
reach.

**Production must run a Redis instance and set `REDIS_URL`.** See
`.env.example` for the variable. There is no hard-coded fallback host used
in production — if `REDIS_URL` is wrong or Redis is unreachable, sending a
notification logs a warning and the app keeps working (the notification row
is still saved; only the live push is lost), but every socket also fails to
connect in the first place, since `connect()` needs the layer too. Treat
Redis as a real dependency, not an optional one.

## Running Redis locally

Any of these work; pick whichever is already on your machine.

- **Docker:** `docker run -p 6379:6379 redis:7-alpine` (this project has no
  `docker-compose.yml`; add a `redis` service to one if you create it).
- **WSL / Linux:** install `redis-server` with your package manager and run
  it.
- **Windows without WSL/Docker:** there is no officially supported native
  Redis build. Use Docker or WSL instead of an unofficial Windows port.

Once Redis is running, set `REDIS_URL` in `.env` (default
`redis://127.0.0.1:6379/0` if you leave it unset) and remove/unset
`CHANNEL_LAYER_MEMORY` so the app actually uses it.

If you don't have Redis running yet, set `CHANNEL_LAYER_MEMORY=True` in
`.env`. This keeps the old single-process, in-memory behavior so local dev
still works; it does **not** work across multiple processes, and must not
be set in production.

`manage.py test` always uses the in-memory layer, regardless of
`CHANNEL_LAYER_MEMORY` or `REDIS_URL` — the test suite needs no Redis.

## Running multiple ASGI worker processes

With a shared Redis-backed channel layer, the ASGI server can run more than
one worker process, and notifications still reach every socket no matter
which worker accepted it or which worker (or Celery task, or management
command) sends the push. For example, with daphne:

```
daphne -b 0.0.0.0 -p 8010 --workers 4 CapstoneBackEnd.asgi:application
```

or uvicorn with multiple workers behind a process manager. Scale the
Django/DRF HTTP side the same way you already do; the channel layer is what
makes the WebSocket side safe to scale alongside it.
