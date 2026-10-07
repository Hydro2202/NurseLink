"""
Blocked accounts (pending, rejected, deactivated) must not keep working tokens.
Enforced once, in api/access.py, and applied by the token auth class, the
default permission, the WebSocket, and the save-time signal that revokes
sessions when an account is blocked.
"""

import datetime
import uuid
from io import StringIO

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.contrib.auth.models import User
from django.core.cache import cache
from django.core.management import call_command
from rest_framework.test import APITestCase, APITransactionTestCase

from .auth_sessions import issue_session
from .models import AuthSession, NurseProfile, RegistrationSession

PASSWORD = 'pw-test-1234'


def make_nurse(email, approval='approved', active=True):
    user = User.objects.create_user(username=email, email=email, password=PASSWORD,
                                    first_name='Ana', last_name='Cruz')
    NurseProfile.objects.create(user=user, role='staff_nurse', department='ICU',
                                approval_status=approval, is_active_staff=active)
    return user


def make_admin():
    return User.objects.create_user(username='admin@hospital.com', email='admin@hospital.com',
                                    password='pw-admin-1234', is_staff=True)


def make_session():
    return RegistrationSession.objects.create(
        session_id=uuid.uuid4(), face_verified=True, id_verification_status='verified', id_portrait='data:image/jpeg;base64,PORTRAIT',
        verification_method='face', id_last_name='CRUZ', id_first_name='ANA',
        id_middle_name='', id_registration_no='1234567',
        id_registration_date=datetime.date(2025, 1, 1), id_valid_until=datetime.date(2029, 1, 1),
    )


class PendingApplicantTests(APITestCase):
    def setUp(self):
        cache.clear()

    def test_signup_returns_no_token(self):
        res = self.client.post('/api/auth/signup/', {
            'email': 'new@hospital.com', 'password': 'Str0ng-Pass-9012',
            'firstName': 'Ana', 'lastName': 'Cruz', 'licenseNumber': '1234567',
            'registrationSessionId': str(make_session().session_id),
        }, format='json')
        self.assertEqual(res.status_code, 201, res.content)
        self.assertNotIn('token', res.data)
        self.assertEqual(res.data['approvalStatus'], 'pending')

    def test_login_is_refused_with_account_pending_and_no_token(self):
        make_nurse('pending@hospital.com', approval='pending')
        res = self.client.post('/api/auth/login/', {'email': 'pending@hospital.com', 'password': PASSWORD})
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.data['code'], 'account_pending')
        self.assertNotIn('token', res.data)

    def test_a_pending_accounts_existing_token_is_refused_everywhere(self):
        user = make_nurse('pending2@hospital.com', approval='pending')
        key = issue_session(user).key
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {key}')

        for method, url in [('get', '/api/auth/me/'), ('get', '/api/live/'), ('get', '/api/patients/')]:
            res = getattr(self.client, method)(url)
            self.assertEqual(res.status_code, 403, url)
            self.assertEqual(res.data['code'], 'account_pending', url)

    def test_pending_user_cannot_edit_profile_or_licence(self):
        user = make_nurse('pending3@hospital.com', approval='pending')
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {issue_session(user).key}')
        res = self.client.patch('/api/auth/me/', {'licenseNumber': 'FAKE-999'}, format='json')
        self.assertEqual(res.status_code, 403)
        self.assertEqual(NurseProfile.objects.get(user=user).license_number, '')


class DeactivatedAccountTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.admin = make_admin()
        self.user = make_nurse('gone@hospital.com')
        self.key = issue_session(self.user).key

    def test_old_token_is_refused_after_admin_deactivation(self):
        self.client.force_authenticate(self.admin)
        self.client.post(f'/api/admin/users/{self.user.pk}/deactivate/')

        self.client.force_authenticate(None)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {self.key}')
        res = self.client.get('/api/auth/me/')
        self.assertEqual(res.status_code, 401)  # session already deleted
        self.assertFalse(AuthSession.objects.filter(user=self.user).exists())

    def test_deactivation_via_profile_save_also_revokes_sessions(self):
        # The Django admin / any direct save path.
        profile = NurseProfile.objects.get(user=self.user)
        profile.is_active_staff = False
        profile.save()
        self.assertFalse(AuthSession.objects.filter(user=self.user).exists())

    def test_deactivation_via_user_is_active_also_revokes_sessions(self):
        self.user.is_active = False
        self.user.save()
        self.assertFalse(AuthSession.objects.filter(user=self.user).exists())

    def test_bulk_reject_action_also_revokes_sessions(self):
        profile = NurseProfile.objects.get(user=self.user)
        profile.approval_status = 'rejected'
        profile.rejection_reason = 'test'
        profile.save()
        self.assertFalse(AuthSession.objects.filter(user=self.user).exists())

    def test_reactivation_does_not_bring_old_tokens_back(self):
        self.client.force_authenticate(self.admin)
        self.client.post(f'/api/admin/users/{self.user.pk}/deactivate/')
        self.client.post(f'/api/admin/users/{self.user.pk}/reactivate/')

        self.client.force_authenticate(None)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {self.key}')
        self.assertEqual(self.client.get('/api/live/').status_code, 401)

        # But logging in again works.
        self.client.credentials()
        res = self.client.post('/api/auth/login/', {'email': self.user.email, 'password': PASSWORD})
        self.assertEqual(res.status_code, 200, res.content)

    def test_a_deactivated_account_with_a_live_token_gets_403_not_data(self):
        profile = NurseProfile.objects.get(user=self.user)
        profile.is_active_staff = False
        profile.save()
        key = issue_session(self.user).key  # a token minted before the block
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {key}')
        res = self.client.get('/api/live/')
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.data['code'], 'account_deactivated')


class SocketClosedOnBlockTests(APITransactionTestCase):
    def test_blocking_an_account_sends_the_socket_close_to_its_group(self):
        from .consumers import user_group

        user = make_nurse('socket@hospital.com')
        layer = get_channel_layer()
        channel = async_to_sync(layer.new_channel)()
        async_to_sync(layer.group_add)(user_group(user.pk), channel)

        profile = NurseProfile.objects.get(user=user)
        profile.is_active_staff = False
        profile.save()

        message = async_to_sync(layer.receive)(channel)
        self.assertEqual(message['type'], 'account.revoked')

    def test_socket_auth_refuses_a_blocked_account_with_4003_code_path(self):
        from .consumers import _user_for_token

        user = make_nurse('blocked-socket@hospital.com', approval='pending')
        key = issue_session(user).key
        resolved, code = async_to_sync(_user_for_token)(key)
        self.assertIsNone(resolved)
        self.assertEqual(code, 'account_pending')

    def test_socket_auth_accepts_an_approved_account(self):
        from .consumers import _user_for_token

        user = make_nurse('ok-socket@hospital.com')
        key = issue_session(user).key
        resolved, code = async_to_sync(_user_for_token)(key)
        self.assertEqual(resolved, user)
        self.assertIsNone(code)


class ApprovedAndAllowlistTests(APITestCase):
    def setUp(self):
        cache.clear()

    def test_approved_active_user_works_as_before(self):
        user = make_nurse('fine@hospital.com')
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {issue_session(user).key}')
        self.assertEqual(self.client.get('/api/auth/me/').status_code, 200)
        self.assertEqual(self.client.get('/api/live/').status_code, 200)

    def test_login_still_works_when_a_blocked_accounts_stale_header_is_sent(self):
        blocked = make_nurse('stale@hospital.com', approval='pending')
        stale = issue_session(blocked).key
        make_nurse('approved@hospital.com')
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {stale}')
        res = self.client.post('/api/auth/login/', {'email': 'approved@hospital.com', 'password': PASSWORD})
        self.assertEqual(res.status_code, 200, res.content)

    def test_registration_steps_are_not_blocked_by_a_stale_header(self):
        blocked = make_nurse('stale2@hospital.com', approval='pending')
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {issue_session(blocked).key}')
        res = self.client.get('/api/auth/face-verification/status/',
                              {'registrationSessionId': str(uuid.uuid4())})
        self.assertNotEqual(res.status_code, 403, res.content)


class RevokeInactiveTokensCommandTests(APITestCase):
    def test_dry_run_deletes_nothing_and_real_run_deletes_blocked_tokens_only(self):
        approved = make_nurse('keep@hospital.com')
        pending = make_nurse('drop@hospital.com', approval='pending')
        issue_session(approved)
        issue_session(pending)

        out = StringIO()
        call_command('revoke_inactive_tokens', '--dry-run', stdout=out)
        self.assertIn('Dry run', out.getvalue())
        self.assertEqual(AuthSession.objects.count(), 2)

        call_command('revoke_inactive_tokens', stdout=StringIO())
        self.assertTrue(AuthSession.objects.filter(user=approved).exists())
        self.assertFalse(AuthSession.objects.filter(user=pending).exists())
