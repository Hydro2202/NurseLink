"""
Brute-force protection for the two login endpoints (LoginView, OAuthTokenView).

DRF's ScopedRateThrottle (used for face verification and OTP) counts every
request, so it cannot express "count only failures, reset on success, double
the lockout each time". This module adds that on top of the same Django cache
framework, in its own cache alias (settings.LOGIN_THROTTLE['CACHE_ALIAS']),
which is database-backed by default so the counters are shared between server
processes and survive a restart. Both endpoints call the same functions with
the same keys, so switching endpoints never buys an attacker extra tries.

Two independent limits:

  * per account — keyed by the identifier being tried, whether or not such an
    account exists, so the limiter never reveals which accounts are real. After
    ACCOUNT_MAX_FAILURES failures within ACCOUNT_WINDOW_SECONDS the identifier
    is locked for ACCOUNT_LOCKOUT_SECONDS, doubling on each repeat lockout up to
    ACCOUNT_LOCKOUT_MAX_SECONDS. A successful login clears the count and level.
  * per IP — after IP_MAX_FAILURES failures (any identifiers) within
    IP_WINDOW_SECONDS the client IP is locked for IP_LOCKOUT_SECONDS.

Lock state stores its own "locked until" timestamp, compared against _now(), so
expiry does not depend on how a particular cache backend handles TTLs.

If the cache store itself fails, the limiter logs an error and lets the login
proceed (fails open): a broken counter table must not lock every user out.
"""

import hashlib
import ipaddress
import logging
import math
import time
from datetime import datetime, timezone as dt_timezone

from django.conf import settings
from django.core.cache import caches

logger = logging.getLogger(__name__)

BLOCKED_MESSAGE = 'Too many sign-in attempts. Please wait and try again later.'


def _now() -> float:
    return time.time()


def _conf(name):
    return settings.LOGIN_THROTTLE[name]


def _cache():
    return caches[_conf('CACHE_ALIAS')]


def _account_key(identifier: str) -> str:
    # Hashed: the cache key never contains the email itself, and any length
    # or character set the client sends is safe as a key.
    normalized = (identifier or '').strip().lower()
    return hashlib.sha256(normalized.encode('utf-8')).hexdigest()[:40]


def _ip_key(ip: str) -> str:
    return hashlib.sha256((ip or 'unknown').encode('utf-8')).hexdigest()[:40]


# --- client IP -------------------------------------------------------------

def _trusted_networks():
    networks = []
    for entry in getattr(settings, 'TRUSTED_PROXIES', []) or []:
        try:
            networks.append(ipaddress.ip_network(entry.strip(), strict=False))
        except ValueError:
            logger.error('Ignoring invalid TRUSTED_PROXIES entry: %r', entry)
    return networks


def _is_trusted(ip: str, networks) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return any(addr in net for net in networks)


def client_ip(request) -> str:
    """
    The real client address.

    REMOTE_ADDR is the only value the client cannot forge. X-Forwarded-For is
    honoured only when the direct peer is a configured trusted proxy; then the
    chain is walked from the right, skipping trusted proxies, and the first
    untrusted hop is the client. With no TRUSTED_PROXIES configured the header
    is ignored entirely, so a client cannot spoof its way to a fresh IP limit.
    """
    remote = (request.META.get('REMOTE_ADDR') or '').strip()
    networks = _trusted_networks()
    if not networks or not _is_trusted(remote, networks):
        return remote or 'unknown'
    forwarded = request.META.get('HTTP_X_FORWARDED_FOR') or ''
    hops = [hop.strip() for hop in forwarded.split(',') if hop.strip()]
    for hop in reversed(hops):
        if not _is_trusted(hop, networks):
            try:
                return str(ipaddress.ip_address(hop))
            except ValueError:
                return remote  # malformed header from a trusted proxy chain
    return remote


# --- counters --------------------------------------------------------------

def _remaining_lock(cache, key: str) -> int:
    until = cache.get(key)
    if not until:
        return 0
    remaining = until - _now()
    return math.ceil(remaining) if remaining > 0 else 0


def _count_failure(cache, key: str, window: int) -> int:
    cache.add(key, 0, timeout=window)
    try:
        return cache.incr(key)
    except ValueError:  # expired between add and incr
        cache.set(key, 1, timeout=window)
        return 1


def blocked_for(identifier: str, ip: str) -> int:
    """
    Seconds until this attempt may proceed, or 0 if it may proceed now.

    Called before the password is checked. The answer depends only on the
    identifier string and the IP — never on whether the account exists.
    """
    try:
        cache = _cache()
        return max(
            _remaining_lock(cache, f'login:acct:lock:{_account_key(identifier)}'),
            _remaining_lock(cache, f'login:ip:lock:{_ip_key(ip)}'),
        )
    except Exception:
        logger.exception('Login throttle store unavailable; allowing the attempt.')
        return 0


def register_failure(identifier: str, ip: str) -> None:
    """Record one failed login; apply a lockout when a threshold is reached."""
    try:
        cache = _cache()
        acct = _account_key(identifier)
        ipk = _ip_key(ip)

        failures = _count_failure(cache, f'login:acct:fail:{acct}', _conf('ACCOUNT_WINDOW_SECONDS'))
        if failures >= _conf('ACCOUNT_MAX_FAILURES'):
            level_key = f'login:acct:level:{acct}'
            level = cache.get(level_key) or 0
            duration = min(
                _conf('ACCOUNT_LOCKOUT_SECONDS') * (2 ** level),
                _conf('ACCOUNT_LOCKOUT_MAX_SECONDS'),
            )
            cache.set(f'login:acct:lock:{acct}', _now() + duration, timeout=duration + 60)
            # The escalation level is remembered for a full max-lockout period
            # after the last lockout, then forgotten.
            cache.set(level_key, level + 1, timeout=_conf('ACCOUNT_LOCKOUT_MAX_SECONDS') + duration)
            cache.delete(f'login:acct:fail:{acct}')
            _log_lockout('account', identifier=identifier, ip=ip, duration=duration, level=level + 1)

        ip_failures = _count_failure(cache, f'login:ip:fail:{ipk}', _conf('IP_WINDOW_SECONDS'))
        if ip_failures >= _conf('IP_MAX_FAILURES'):
            duration = _conf('IP_LOCKOUT_SECONDS')
            cache.set(f'login:ip:lock:{ipk}', _now() + duration, timeout=duration + 60)
            cache.delete(f'login:ip:fail:{ipk}')
            _log_lockout('ip', identifier=identifier, ip=ip, duration=duration, level=None)
    except Exception:
        logger.exception('Login throttle store unavailable; failure not recorded.')


def register_success(identifier: str) -> None:
    """A successful login clears the account's failure count and escalation."""
    try:
        cache = _cache()
        acct = _account_key(identifier)
        cache.delete_many([f'login:acct:fail:{acct}', f'login:acct:level:{acct}'])
    except Exception:
        logger.exception('Login throttle store unavailable; success not recorded.')


def _log_lockout(kind: str, *, identifier: str, ip: str, duration: int, level):
    # Identifier and IP only — the password is never passed to this module.
    logger.warning(
        'login lockout kind=%s account=%r ip=%s duration=%ss level=%s at=%s',
        kind, (identifier or '').strip().lower(), ip, duration, level if level is not None else '-',
        datetime.now(dt_timezone.utc).isoformat(timespec='seconds'),
    )


def clear_account(identifier: str) -> None:
    """Lift one account's lockout now (admin action / management command)."""
    acct = _account_key(identifier)
    _cache().delete_many([f'login:acct:{part}:{acct}' for part in ('lock', 'fail', 'level')])
