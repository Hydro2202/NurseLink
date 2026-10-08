"""
Lifetime cap on face verification attempts, and the timed lockout.

Failed comparisons are counted per PRC licence and email across every session:
the first MAX_FACE_ATTEMPTS plus MAX_FACE_VERIFICATION_RETRY_CYCLES more sets.
With the default of 3 retry cycles that is 4 sets. Each set that ends in a
lock is timed (30 min, then 2 h, then 24 h); the set after that spends the
budget and the lock is permanent, leaving only Email OTP.

Nothing an anonymous caller sends can clear a lock (see tests_face_reset_bypass).
"""

from datetime import timedelta
from unittest.mock import patch

from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from api import views
from api.face_match import FaceVerificationOutcome, MAX_FACE_ATTEMPTS
from api.models import RegistrationSession

MISMATCH = FaceVerificationOutcome(False, 10.0, 'MISMATCH', 'Face verification failed.', True)
BUDGET = views.FACE_LIFETIME_ATTEMPT_BUDGET
SETS = BUDGET // MAX_FACE_ATTEMPTS


@override_settings(N8N_FACE_VERIFY_ENABLED=False)
class FaceRetryBudgetTests(TestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)
        self.client = APIClient()
        self.email = 'applicant@gmail.com'
        self.session = self.make_session(self.email)

    def make_session(self, email, reg_no='0987654'):
        return RegistrationSession.objects.create(
            email=email, id_verification_status='verified', id_portrait='data:image/jpeg;base64,PORTRAIT', id_registration_no=reg_no,
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

    def fail_n(self, session, n):
        for _ in range(n):
            self.attempt(session)

    def end_lockout_on_schedule(self, session):
        """The timed lockout running out, as it would in real time."""
        RegistrationSession.objects.filter(pk=session.pk).update(
            face_locked_until=timezone.now() - timedelta(minutes=1),
        )

    def run_sets(self, session, n):
        """Fail n full sets, letting each timed lock run out before the next set."""
        for i in range(n):
            if i:
                self.end_lockout_on_schedule(session)
            self.fail_n(session, MAX_FACE_ATTEMPTS)
        session.refresh_from_db()

    def test_budget_is_four_sets_by_default(self):
        self.assertEqual(SETS, 4)
        self.assertEqual(BUDGET, MAX_FACE_ATTEMPTS * 4)

    @patch('api.views.verify_face_against_id', return_value=MISMATCH)
    def test_locks_run_30_minutes_then_2_hours_then_24_hours(self, _mock):
        expected = [30, 120, 1440]
        for i, minutes in enumerate(expected):
            if i:
                self.end_lockout_on_schedule(self.session)
            self.fail_n(self.session, MAX_FACE_ATTEMPTS)
            self.session.refresh_from_db()
            self.assertTrue(self.session.face_locked)
            self.assertEqual(self.session.face_lock_count, i + 1)
            remaining = self.session.face_locked_until - timezone.now()
            self.assertGreater(remaining, timedelta(minutes=minutes - 1))
            self.assertLessEqual(remaining, timedelta(minutes=minutes))

    @patch('api.views.verify_face_against_id', return_value=MISMATCH)
    def test_the_set_after_the_last_timed_lock_makes_it_permanent(self, _mock):
        self.run_sets(self.session, SETS)
        self.assertTrue(self.session.face_locked)
        self.assertEqual(self.session.face_lock_count, SETS)
        self.assertIsNone(self.session.face_locked_until)

    @patch('api.views.verify_face_against_id', return_value=MISMATCH)
    def test_first_lockout_is_timed_and_then_a_new_set_is_allowed(self, _mock):
        self.fail_n(self.session, MAX_FACE_ATTEMPTS)
        self.session.refresh_from_db()
        self.assertTrue(self.session.face_locked)
        self.assertIsNotNone(self.session.face_locked_until)

        self.end_lockout_on_schedule(self.session)
        res = self.attempt(self.session)

        self.assertEqual(res.status_code, 200, res.data)
        self.assertTrue(res.data['retryAvailable'])
        self.session.refresh_from_db()
        self.assertFalse(self.session.face_locked)
        self.assertEqual(self.session.face_attempts, 1)

    @patch('api.views.verify_face_against_id', return_value=MISMATCH)
    def test_attempts_refused_once_budget_spent(self, _mock):
        self.run_sets(self.session, SETS)
        last = self.attempt(self.session)

        self.assertEqual(last.status_code, 423)
        self.assertFalse(last.data['retryAvailable'])
        self.assertIn('Email OTP', last.data['message'])
        self.session.refresh_from_db()
        self.assertTrue(self.session.face_locked)
        self.assertIsNone(self.session.face_locked_until)

    @patch('api.views.verify_face_against_id', return_value=MISMATCH)
    def test_new_session_for_same_email_cannot_bypass(self, mock_verify):
        self.fail_n(self.session, MAX_FACE_ATTEMPTS)
        calls_before = mock_verify.call_count

        fresh = self.make_session(self.email)
        res = self.attempt(fresh)

        self.assertEqual(res.status_code, 423)
        self.assertEqual(mock_verify.call_count, calls_before, 'no comparison may run')

    @patch('api.views.verify_face_against_id', return_value=MISMATCH)
    def test_a_fresh_session_blocked_by_a_timed_lock_is_told_it_will_end(self, mock_verify):
        self.fail_n(self.session, MAX_FACE_ATTEMPTS)  # first set: timed, not permanent

        fresh = self.make_session(self.email)
        res = self.attempt(fresh)

        self.assertEqual(res.status_code, 423)
        self.assertIn('Wait for the lockout to end', res.data['message'])
        self.assertNotIn('no longer available', res.data['message'])

    @patch('api.views.verify_face_against_id', return_value=MISMATCH)
    def test_a_fresh_session_blocked_by_a_permanent_lock_is_not_told_to_wait(self, mock_verify):
        # The exact bug report this guards against: a brand new session for an
        # email whose lifetime budget was already spent (in an earlier set,
        # possibly days ago) must never be told to "wait for the lockout to
        # end" — a permanent lock has no end, and that message sends an
        # applicant into a wait that never resolves instead of to Email OTP.
        self.run_sets(self.session, SETS)

        fresh = self.make_session(self.email)
        res = self.attempt(fresh)

        self.assertEqual(res.status_code, 423)
        self.assertIn('Email OTP', res.data['message'])
        self.assertNotIn('Wait for the lockout to end', res.data['message'])

    @patch('api.views.verify_face_against_id', return_value=MISMATCH)
    def test_new_email_on_same_licence_cannot_bypass(self, mock_verify):
        self.run_sets(self.session, SETS)
        calls_before = mock_verify.call_count

        other = self.make_session('different.email@gmail.com')
        res = self.attempt(other)

        self.assertEqual(res.status_code, 403)
        self.assertFalse(res.data['retryAvailable'])
        self.assertEqual(mock_verify.call_count, calls_before, 'no comparison may run')

    @patch('api.views.verify_face_against_id', return_value=MISMATCH)
    def test_other_applicants_are_unaffected(self, _mock):
        self.fail_n(self.session, MAX_FACE_ATTEMPTS)

        stranger = self.make_session('someone.else@gmail.com', reg_no='1234567')
        res = self.attempt(stranger)

        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data['retryAvailable'])
