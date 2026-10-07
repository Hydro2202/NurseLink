"""
Session tokens expire (api/authentication.py, api/consumers.py) and the
WebSocket requires a one-time ticket rather than the token itself
(api/ws_tickets.py, api/views.py:WsTicketView).
"""

import datetime

from channels.db import database_sync_to_async
from channels.testing import WebsocketCommunicator
from django.contrib.auth.models import User
from django.test import TransactionTestCase, override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from CapstoneBackEnd.asgi import application

from .auth_sessions import issue_session
from .models import AuthSession, NurseProfile
from .ws_tickets import issue_ticket

PASSWORD = 'pw-test-1234'


def make_nurse(email='nurse@hospital.com'):
    user = User.objects.create_user(
        username=email, email=email, password=PASSWORD, first_name='Ana', last_name='Cruz'
    )
    NurseProfile.objects.create(
        user=user, role='staff_nurse', department='ICU', approval_status='approved', is_active_staff=True
    )
    return user


def age_session(session, seconds):
    """Backdate a session's `created` as if it had been issued `seconds` ago."""
    AuthSession.objects.filter(pk=session.pk).update(
        created=timezone.now() - datetime.timedelta(seconds=seconds)
    )


class TokenExpiryHttpTests(APITestCase):
    def setUp(self):
        self.user = make_nurse()

    def as_token(self, key):
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {key}')

    @override_settings(TOKEN_TTL_SECONDS=86400)
    def test_a_fresh_token_works(self):
        session = issue_session(self.user)
        self.as_token(session.key)
        self.assertEqual(self.client.get('/api/auth/me/').status_code, 200)

    @override_settings(TOKEN_TTL_SECONDS=60)
    def test_an_expired_token_gets_401(self):
        session = issue_session(self.user)
        age_session(session, seconds=61)
        self.as_token(session.key)
        res = self.client.get('/api/auth/me/')
        self.assertEqual(res.status_code, 401)

    @override_settings(TOKEN_TTL_SECONDS=60)
    def test_an_expired_token_is_deleted_not_just_refused(self):
        session = issue_session(self.user)
        age_session(session, seconds=61)
        self.as_token(session.key)
        self.client.get('/api/auth/me/')
        self.assertFalse(AuthSession.objects.filter(pk=session.pk).exists())

    @override_settings(TOKEN_TTL_SECONDS=60)
    def test_logging_in_again_after_expiry_gives_a_working_token(self):
        session = issue_session(self.user)
        age_session(session, seconds=61)

        res = self.client.post('/api/auth/login/', {'email': self.user.email, 'password': PASSWORD})
        self.assertEqual(res.status_code, 200, res.content)
        new_token = res.data['token']
        self.assertNotEqual(new_token, session.key)

        self.as_token(new_token)
        self.assertEqual(self.client.get('/api/auth/me/').status_code, 200)

    def test_logout_invalidates_the_token(self):
        session = issue_session(self.user)
        self.as_token(session.key)
        self.assertEqual(self.client.post('/api/auth/logout/').status_code, 200)

        self.as_token(session.key)
        self.assertEqual(self.client.get('/api/auth/me/').status_code, 401)


class WsTicketHttpTests(APITestCase):
    def setUp(self):
        self.user = make_nurse()

    def as_token(self, key):
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {key}')

    def test_requesting_a_ticket_requires_a_valid_session(self):
        res = self.client.post('/api/auth/ws-ticket/')
        self.assertEqual(res.status_code, 401)

    def test_a_signed_in_nurse_gets_a_ticket(self):
        session = issue_session(self.user)
        self.as_token(session.key)
        res = self.client.post('/api/auth/ws-ticket/')
        self.assertEqual(res.status_code, 200, res.content)
        self.assertTrue(res.data['ticket'])
        self.assertIn('expiresInSeconds', res.data)


async def connect(*, ticket=None, token=None):
    url = '/ws/notifications/'
    if ticket:
        url += '?ticket=%s' % ticket
    elif token:
        url += '?token=%s' % token
    communicator = WebsocketCommunicator(application, url)
    connected, _ = await communicator.connect()
    return communicator, connected


@database_sync_to_async
def make_nurse_async(email):
    return make_nurse(email)


@database_sync_to_async
def issue_session_async(user):
    return issue_session(user)


@database_sync_to_async
def issue_ticket_async(user):
    return issue_ticket(user)


@database_sync_to_async
def age_session_async(session, seconds):
    age_session(session, seconds)


class TokenExpiryWebSocketTests(TransactionTestCase):
    """TransactionTestCase: the consumer's DB access runs in a real transaction."""

    @override_settings(TOKEN_TTL_SECONDS=60)
    async def test_an_expired_token_is_refused_on_the_socket(self):
        user = await make_nurse_async('ben@hospital.com')
        session = await issue_session_async(user)
        await age_session_async(session, seconds=61)

        communicator, connected = await connect(token=session.key)
        self.assertFalse(connected)
        await communicator.disconnect()

    async def test_a_fresh_token_still_connects_via_the_legacy_query_param(self):
        user = await make_nurse_async('ben@hospital.com')
        session = await issue_session_async(user)

        communicator, connected = await connect(token=session.key)
        self.assertTrue(connected)
        hello = await communicator.receive_json_from(timeout=2)
        self.assertEqual(hello['userId'], str(user.pk))
        await communicator.disconnect()


class WsTicketSocketTests(TransactionTestCase):
    async def test_a_valid_ticket_connects(self):
        user = await make_nurse_async('ben@hospital.com')
        ticket = await issue_ticket_async(user)

        communicator, connected = await connect(ticket=ticket)
        self.assertTrue(connected)
        hello = await communicator.receive_json_from(timeout=2)
        self.assertEqual(hello['userId'], str(user.pk))
        await communicator.disconnect()

    async def test_a_ticket_cannot_be_used_twice(self):
        user = await make_nurse_async('ben@hospital.com')
        ticket = await issue_ticket_async(user)

        first, connected = await connect(ticket=ticket)
        self.assertTrue(connected)
        await first.disconnect()

        second, connected_again = await connect(ticket=ticket)
        self.assertFalse(connected_again, 'a used ticket must not work a second time')
        await second.disconnect()

    async def test_a_bogus_ticket_is_refused(self):
        communicator, connected = await connect(ticket='not-a-real-ticket')
        self.assertFalse(connected)
        await communicator.disconnect()
