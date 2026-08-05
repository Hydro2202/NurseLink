"""Authentication helpers for NurseLink API and Scalar docs."""

from rest_framework.authentication import TokenAuthentication, get_authorization_header
from rest_framework.exceptions import AuthenticationFailed


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

    def authenticate_header(self, request):
        return self.keyword
