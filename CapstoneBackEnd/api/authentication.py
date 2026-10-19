"""Authentication helpers for NurseLink API and Scalar docs."""

from django.conf import settings
from django.utils import timezone
from rest_framework.authentication import TokenAuthentication, get_authorization_header
from rest_framework.exceptions import AuthenticationFailed

from .access import account_block_code, account_blocked_exception
from .models import AuthSession


# Writing last_used on every request would add a DB write per API call; once
# a minute is plenty for an idle timeout measured in hours.
LAST_USED_WRITE_INTERVAL_SECONDS = 60


def session_is_expired(session: AuthSession) -> bool:
    """
    Shared by the REST auth class below and the WebSocket middleware.

    Expired after TOKEN_TTL_SECONDS of inactivity (counted from the last
    authenticated request, or login if never used), or once it is older than
    TOKEN_MAX_AGE_SECONDS regardless of use.
    """
    now = timezone.now()
    last_activity = session.last_used or session.created
    if (now - last_activity).total_seconds() > settings.TOKEN_TTL_SECONDS:
        return True
    return (now - session.created).total_seconds() > settings.TOKEN_MAX_AGE_SECONDS


def touch_session(session: AuthSession) -> None:
    """Record activity on a session (throttled to one write a minute)."""
    now = timezone.now()
    if session.last_used and (now - session.last_used).total_seconds() < LAST_USED_WRITE_INTERVAL_SECONDS:
        return
    AuthSession.objects.filter(pk=session.pk).update(last_used=now)
    session.last_used = now


class BearerTokenAuthentication(TokenAuthentication):
    """
    Accept:
      Authorization: Bearer <token>
      Authorization: Token <token>
      Authorization: <token>   (bare key — some API clients)

    Incomplete headers like ``Authorization: Bearer`` (no key) are ignored
    instead of raising, so Scalar can still call AllowAny login/token endpoints
    when an empty Bearer scheme is selected.
    """

    keyword = 'Bearer'
    keywords = ('Bearer', 'Token')
    model = AuthSession

    def authenticate(self, request):
        auth = get_authorization_header(request).split()
        if not auth:
            return None

        try:
            first = auth[0].decode()
        except UnicodeError:
            return None

        first_lower = first.lower()
        is_keyword = first_lower in {k.lower() for k in self.keywords}

        # ``Authorization: Bearer`` or ``Authorization: Token`` with no value
        if is_keyword and len(auth) == 1:
            return None

        # Bare token (no scheme prefix)
        if not is_keyword and len(auth) == 1:
            return self.authenticate_credentials(first)

        if not is_keyword:
            return None

        # ``Authorization: Bearer <token>`` (ignore extra accidental parts)
        try:
            key = auth[1].decode().strip()
        except UnicodeError:
            raise AuthenticationFailed(
                'Invalid token header. Token string should not contain invalid characters.'
            )

        if not key:
            return None

        return self.authenticate_credentials(key)

    def authenticate_credentials(self, key):
        # A valid token for an account that may not use the app (pending,
        # rejected, deactivated) is refused here, for every endpoint, instead
        # of only where a view remembered to check.
        user, session = super().authenticate_credentials(key)

        if session_is_expired(session):
            # Deleted, not just refused: an expired session must not keep
            # counting as "logged in" anywhere (e.g. LogoutAllView's count),
            # and never becomes valid again just because time moves on.
            session.delete()
            raise AuthenticationFailed('Your session has expired. Please log in again.')

        code = account_block_code(user)
        if code:
            raise account_blocked_exception(code)
        touch_session(session)
        return user, session

    def authenticate_header(self, request):
        return self.keyword
