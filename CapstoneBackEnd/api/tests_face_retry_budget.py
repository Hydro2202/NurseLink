"""
Lifetime cap on face verification attempts.

"Retry Face Verification" after a lockout is a designed feature, but it used to
reset the counter forever — via the reset flag, or by starting a new session.
Failed comparisons are now counted per PRC licence (and email) across every
session: the first MAX_FACE_ATTEMPTS plus MAX_FACE_VERIFICATION_RETRY_CYCLES
more sets. After that only Email OTP remains.
"""

from unittest.mock import patch

from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from api import views
from api.face_match import FaceVerificationOutcome, MAX_FACE_ATTEMPTS
from api.models import RegistrationSession

MISMATCH = FaceVerificationOutcome(False, 10.0, 'MISMATCH', 'Face verification failed.', True)
BUDGET = views.FACE_LIFETIME_ATTEMPT_BUDGET


@override_settings(N8N_FACE_VERIFY_ENABLED=False)
class FaceRetryBudgetTests(TestCase):
    def setUp(self):
        cache.clear()  # the face_verification throttle would otherwise trip mid-suite
        self.addCleanup(cache.clear)
        self.client = APIClient()
        self.email = 'applicant@gmail.com'
        self.session = self.make_session(self.email)

    def make_session(self, email, reg_no='0987654'):
        return RegistrationSession.objects.create(
            email=email, id_verification_status='verified', id_registration_no=reg_no,
        )

    def attempt(self, session):
        return self.client.post(
            '/api/auth/face-verification/',
            {
                'registrationSessionId': str(session.session_id),
                'image': 'data:image/jpeg;base64,abc',
                'idImage': 'data:image/jpeg;base64,def',
            },
            format='json',
        )

    def reset(self, session):
        return self.client.post(
            '/api/auth/face-verification/',
            {'registrationSessionId': str(session.session_id), 'reset': True},
            format='json',
        )

    def fail_n(self, session, n):
        for _ in range(n):
            self.attempt(session)

    def test_budget_is_two_sets_by_default(self):
        self.assertEqual(BUDGET, MAX_FACE_ATTEMPTS * 2)

    @patch('api.views.verify_face_against_id', return_value=MISMATCH)
    def test_first_lockout_can_still_be_retried(self, _mock):
        self.fail_n(self.session, MAX_FACE_ATTEMPTS)
        self.session.refresh_from_db()
        self.assertTrue(self.session.face_locked)

        res = self.reset(self.session)

        self.assertEqual(res.status_code, 200, res.data)
        self.assertTrue(res.data['retryAvailable'])
        self.session.refresh_from_db()
        self.assertFalse(self.session.face_locked)
        self.assertEqual(self.session.face_attempts, 0)

    @patch('api.views.verify_face_against_id', return_value=MISMATCH)
    def test_reset_refused_once_budget_spent(self, _mock):
        self.fail_n(self.session, MAX_FACE_ATTEMPTS)
        self.reset(self.session)
        last = None
        for _ in range(MAX_FACE_ATTEMPTS):
            last = self.attempt(self.session)
        self.assertFalse(last.data['retryAvailable'])

        res = self.reset(self.session)

        self.assertEqual(res.status_code, 403)
        self.assertFalse(res.data['retryAvailable'])
        self.assertIn('Email OTP', res.data['message'])
        self.session.refresh_from_db()
        self.assertTrue(self.session.face_locked)

    @patch('api.views.verify_face_against_id', return_value=MISMATCH)
    def test_new_session_for_same_email_cannot_bypass(self, mock_verify):
        self.fail_n(self.session, MAX_FACE_ATTEMPTS)
        self.reset(self.session)
        self.fail_n(self.session, MAX_FACE_ATTEMPTS)
        calls_before = mock_verify.call_count

        fresh = self.make_session(self.email)
        res = self.attempt(fresh)

        self.assertEqual(res.status_code, 403)
        self.assertFalse(res.data['retryAvailable'])
        self.assertEqual(mock_verify.call_count, calls_before, 'no comparison may run')

    @patch('api.views.verify_face_against_id', return_value=MISMATCH)
    def test_new_email_on_same_licence_cannot_bypass(self, mock_verify):
        self.fail_n(self.session, MAX_FACE_ATTEMPTS)
        self.reset(self.session)
        self.fail_n(self.session, MAX_FACE_ATTEMPTS)
        calls_before = mock_verify.call_count

        other = self.make_session('different.email@gmail.com')
        res = self.attempt(other)

        self.assertEqual(res.status_code, 403)
        self.assertEqual(mock_verify.call_count, calls_before)

    @patch('api.views.verify_face_against_id', return_value=MISMATCH)
    def test_other_applicants_are_unaffected(self, _mock):
        self.fail_n(self.session, MAX_FACE_ATTEMPTS)
        self.reset(self.session)
        self.fail_n(self.session, MAX_FACE_ATTEMPTS)

        stranger = self.make_session('someone.else@gmail.com', reg_no='1234567')
        res = self.attempt(stranger)

        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data['retryAvailable'])
