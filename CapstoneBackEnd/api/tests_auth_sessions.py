"""
Per-device sessions: logging out on one device must not sign out the others.

Each login issues its own AuthSession (see auth_sessions.py). Logout revokes
only the session the request authenticated with; logout-all revokes every
session the account has; password change and account deactivation use the
logout-all behaviour.
"""

from importlib import import_module

from django.apps import apps
from django.contrib.auth.models import User
from django.core.cache import cache
from rest_framework.test import APITestCase

from .auth_sessions import issue_session
from .models import AuthSession, NurseProfile

PASSWORD = 'pw-test-1234'


def make_nurse(email='nurse@hospital.com'):
    user = User.objects.create_user(username=email, email=email, password=PASSWORD,
                                    first_name='Ana', last_name='Cruz')
    NurseProfile.objects.create(user=user, role='staff_nurse', department='ICU',
                                approval_status='approved', is_active_staff=True)
    return user


class PerDeviceSessionTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.user = make_nurse()

    def login(self):
        res = self.client.post('/api/auth/login/', {'email': self.user.email, 'password': PASSWORD})
        self.assertEqual(res.status_code, 200, res.content)
        return res.data['token']

    def as_token(self, key):
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {key}')

    def test_two_logins_get_two_independent_tokens(self):
        token_a = self.login()
        token_b = self.login()
        self.assertNotEqual(token_a, token_b)
        self.assertEqual(AuthSession.objects.filter(user=self.user).count(), 2)

    def test_logout_on_one_device_leaves_the_other_working(self):
        token_a = self.login()
        token_b = self.login()

        self.as_token(token_a)
        self.assertEqual(self.client.post('/api/auth/logout/').status_code, 200)

        self.as_token(token_a)
        self.assertEqual(self.client.get('/api/live/').status_code, 401)

        self.as_token(token_b)
        self.assertEqual(self.client.get('/api/live/').status_code, 200)

    def test_logout_all_revokes_every_session(self):
        token_a = self.login()
        token_b = self.login()

        self.as_token(token_a)
        res = self.client.post('/api/auth/logout-all/')
        self.assertEqual(res.status_code, 200, res.content)
        self.assertFalse(AuthSession.objects.filter(user=self.user).exists())

        for key in (token_a, token_b):
            self.as_token(key)
            self.assertEqual(self.client.get('/api/live/').status_code, 401)

    def test_logging_out_twice_with_the_same_token_does_not_crash(self):
        token = self.login()
        self.as_token(token)
        self.assertEqual(self.client.post('/api/auth/logout/').status_code, 200)

        self.as_token(token)
        second = self.client.post('/api/auth/logout/')
        self.assertEqual(second.status_code, 401)

    def test_revoked_token_is_rejected_on_another_authenticated_endpoint(self):
        token = self.login()
        self.as_token(token)
        self.assertEqual(self.client.get('/api/patients/').status_code, 200)

        self.client.post('/api/auth/logout/')

        self.as_token(token)
        self.assertEqual(self.client.get('/api/patients/').status_code, 401)

    def test_password_change_revokes_other_sessions_and_returns_a_new_token(self):
        old_a = self.login()
        old_b = self.login()
        self.as_token(old_a)
        res = self.client.post('/api/auth/change-password/', {
            'currentPassword': PASSWORD, 'newPassword': 'pw-new-5678',
        }, format='json')
        self.assertEqual(res.status_code, 200, res.content)
        new_token = res.data['token']

        self.assertNotIn(new_token, (old_a, old_b))
        for key in (old_a, old_b):
            self.as_token(key)
            self.assertEqual(self.client.get('/api/live/').status_code, 401)
        self.as_token(new_token)
        self.assertEqual(self.client.get('/api/live/').status_code, 200)


class TokenCopyMigrationTests(APITestCase):
    def test_existing_drf_tokens_are_copied_into_sessions(self):
        from rest_framework.authtoken.models import Token

        user = make_nurse('legacy@hospital.com')
        legacy = Token.objects.create(user=user)
        AuthSession.objects.filter(user=user).delete()

        migration = import_module('api.migrations.0050_auth_sessions')
        migration.copy_existing_tokens(apps, None)

        session = AuthSession.objects.get(user=user)
        self.assertEqual(session.key, legacy.key)

        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {legacy.key}')
        self.assertEqual(self.client.get('/api/live/').status_code, 200)
