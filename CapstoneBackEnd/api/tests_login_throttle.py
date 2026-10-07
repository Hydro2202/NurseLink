"""
Brute-force protection on the two login endpoints.

Security testing found 30 wrong passwords in a row were all answered 401 on
both /api/auth/login/ and /api/auth/token/. These tests pin the limiter in
api/login_throttle.py: per-account and per-IP lockouts, shared between both
endpoints, counting only failures, with responses that never reveal whether
an account exists.
"""

from unittest.mock import patch

from django.contrib.auth.models import User
from django.core.cache import caches
from django.test import override_settings
from rest_framework.test import APITestCase

from .models import NurseProfile

LOGIN = '/api/auth/login/'
TOKEN = '/api/auth/token/'
PASSWORD = 'Correct-Horse-91'
START = 1_800_000_000.0


class LoginThrottleTestCase(APITestCase):
    def setUp(self):
        caches['login_throttle'].clear()
        self.addCleanup(caches['login_throttle'].clear)
        self.clock = [START]
        patcher = patch('api.login_throttle._now', side_effect=lambda: self.clock[0])
        patcher.start()
        self.addCleanup(patcher.stop)
        self.user = User.objects.create_user(
            username='nurse@hospital.com', email='nurse@hospital.com', password=PASSWORD,
            first_name='Ana', last_name='Cruz',
        )
        NurseProfile.objects.create(
            user=self.user, role='staff_nurse', approval_status='approved', is_active_staff=True,
        )

    def advance(self, seconds):
        self.clock[0] += seconds

    def login(self, email='nurse@hospital.com', password='wrong', ip='10.0.0.5', **meta):
        return self.client.post(
            LOGIN, {'email': email, 'password': password}, format='json', REMOTE_ADDR=ip, **meta,
        )

    def token(self, email='nurse@hospital.com', password='wrong', ip='10.0.0.5'):
        return self.client.post(
            TOKEN, {'username': email, 'password': password, 'grant_type': 'password'},
            format='json', REMOTE_ADDR=ip,
        )


class AccountLimitTests(LoginThrottleTestCase):
    def test_sixth_failed_attempt_is_blocked_with_retry_after(self):
        for _ in range(5):
            self.assertEqual(self.login().status_code, 401)
        res = self.login()
        self.assertEqual(res.status_code, 429)
        self.assertEqual(res['Retry-After'], '900')
        self.assertNotIn('Invalid email or password', str(res.data))

    def test_correct_password_is_also_blocked_while_locked(self):
        for _ in range(5):
            self.login()
        self.assertEqual(self.login(password=PASSWORD).status_code, 429)

    def test_original_report_30_wrong_passwords_on_each_endpoint(self):
        login_codes = [self.login().status_code for _ in range(30)]
        token_codes = [self.token(email='other@hospital.com').status_code for _ in range(30)]
        self.assertEqual(login_codes[:5], [401] * 5)
        self.assertTrue(all(code == 429 for code in login_codes[5:]), login_codes)
        self.assertEqual(token_codes[:5], [401] * 5)
        self.assertTrue(all(code == 429 for code in token_codes[5:]), token_codes)

    def test_endpoints_share_the_same_counter(self):
        self.login()
        self.token()
        self.login()
        self.token()
        self.assertEqual(self.login().status_code, 401)  # 5th failure, triggers the lock
        self.assertEqual(self.token().status_code, 429)
        self.assertEqual(self.login().status_code, 429)

    def test_token_endpoint_blocked_response_has_retry_after(self):
        for _ in range(5):
            self.token()
        res = self.token()
        self.assertEqual(res.status_code, 429)
        self.assertEqual(res.data['error'], 'too_many_requests')
        self.assertEqual(res['Retry-After'], '900')

    def test_success_resets_the_account_counter(self):
        for _ in range(4):
            self.login()
        self.assertEqual(self.login(password=PASSWORD).status_code, 200)
        for _ in range(4):
            self.assertEqual(self.login().status_code, 401)
        self.assertEqual(self.login(password=PASSWORD).status_code, 200)

    def test_email_case_does_not_create_a_separate_counter(self):
        for i in range(5):
            self.login(email='NURSE@hospital.com' if i % 2 else 'nurse@hospital.com')
        self.assertEqual(self.login().status_code, 429)

    def test_login_works_again_after_the_lockout_ends(self):
        for _ in range(5):
            self.login()
        self.advance(899)
        self.assertEqual(self.login(password=PASSWORD).status_code, 429)
        self.advance(2)
        self.assertEqual(self.login(password=PASSWORD).status_code, 200)

    def test_repeat_lockouts_double_up_to_the_cap(self):
        expected = [900, 1800, 3600, 7200, 14400, 28800, 57600, 86400, 86400]
        for duration in expected:
            for _ in range(5):
                self.login()
            res = self.login()
            self.assertEqual(res.status_code, 429)
            self.assertEqual(int(res['Retry-After']), duration)
            self.advance(duration + 1)

    def test_lockout_is_logged_without_the_password(self):
        with self.assertLogs('api.login_throttle', level='WARNING') as logs:
            for _ in range(5):
                self.login(password='hunter2-secret')
        output = '\n'.join(logs.output)
        self.assertIn('kind=account', output)
        self.assertIn("account='nurse@hospital.com'", output)
        self.assertIn('ip=10.0.0.5', output)
        self.assertIn('at=', output)
        self.assertNotIn('hunter2-secret', output)


class NoAccountEnumerationTests(LoginThrottleTestCase):
    def test_blocked_response_is_identical_for_real_and_missing_accounts(self):
        for _ in range(5):
            self.login(email='nurse@hospital.com', ip='10.0.0.6')
            self.login(email='nobody@hospital.com', ip='10.0.0.7')
        real = self.login(email='nurse@hospital.com', ip='10.0.0.6')
        missing = self.login(email='nobody@hospital.com', ip='10.0.0.7')
        self.assertEqual(real.status_code, missing.status_code)
        self.assertEqual(real.status_code, 429)
        self.assertEqual(real.data, missing.data)
        self.assertEqual(real['Retry-After'], missing['Retry-After'])

    def test_missing_accounts_are_counted_too(self):
        for _ in range(5):
            self.assertEqual(self.login(email='ghost@hospital.com').status_code, 401)
        self.assertEqual(self.login(email='ghost@hospital.com').status_code, 429)


class IpLimitTests(LoginThrottleTestCase):
    def test_many_usernames_from_one_ip_trigger_the_ip_limit(self):
        for i in range(20):
            self.assertEqual(self.login(email=f'user{i}@hospital.com').status_code, 401)
        res = self.login(email='fresh@hospital.com')
        self.assertEqual(res.status_code, 429)
        self.assertEqual(res['Retry-After'], '900')
        # The real nurse on that IP is blocked too, but not from another IP.
        self.assertEqual(self.login(password=PASSWORD).status_code, 429)
        self.assertEqual(self.login(password=PASSWORD, ip='10.0.0.99').status_code, 200)

    def test_spoofed_forwarded_header_is_ignored_without_trusted_proxy(self):
        for i in range(20):
            self.login(email=f'user{i}@hospital.com', HTTP_X_FORWARDED_FOR=f'203.0.113.{i}')
        res = self.login(email='fresh@hospital.com', HTTP_X_FORWARDED_FOR='198.51.100.1')
        self.assertEqual(res.status_code, 429)

    @override_settings(TRUSTED_PROXIES=['10.0.0.5'])
    def test_forwarded_header_is_used_behind_a_trusted_proxy(self):
        for i in range(20):
            self.login(email=f'user{i}@hospital.com', HTTP_X_FORWARDED_FOR='203.0.113.7')
        blocked = self.login(email='fresh@hospital.com', HTTP_X_FORWARDED_FOR='203.0.113.7')
        other_client = self.login(password=PASSWORD, HTTP_X_FORWARDED_FOR='203.0.113.8')
        self.assertEqual(blocked.status_code, 429)
        self.assertEqual(other_client.status_code, 200)

    @override_settings(TRUSTED_PROXIES=['10.0.0.5'])
    def test_client_cannot_prepend_a_fake_hop_behind_a_trusted_proxy(self):
        # The proxy appends the real peer; anything to its left is client-supplied.
        for i in range(20):
            self.login(
                email=f'user{i}@hospital.com', HTTP_X_FORWARDED_FOR=f'198.51.100.{i}, 203.0.113.7',
            )
        res = self.login(email='fresh@hospital.com', HTTP_X_FORWARDED_FOR='1.2.3.4, 203.0.113.7')
        self.assertEqual(res.status_code, 429)

    def test_ip_lock_expires(self):
        for i in range(20):
            self.login(email=f'user{i}@hospital.com')
        self.advance(901)
        self.assertEqual(self.login(password=PASSWORD).status_code, 200)


class StoreFailureTests(LoginThrottleTestCase):
    def test_login_still_works_if_the_store_is_down(self):
        with patch('api.login_throttle._cache', side_effect=RuntimeError('store down')):
            with self.assertLogs('api.login_throttle', level='ERROR'):
                self.assertEqual(self.login(password=PASSWORD).status_code, 200)
