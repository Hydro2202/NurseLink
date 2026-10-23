"""
Face-verification lockout cannot be cleared by the requester.

Reproduction (first test): an anonymous request with the reset flag cleared a
3-attempt lockout. The reset is now refused; the lock stays and the count
stays at 3. The rest cover the timed lockout, admin unlock, capture errors,
rate limits, and normal verification for an applicant who is not locked.
"""

from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth.models import User
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from api import views
from api.face_match import FaceVerificationOutcome, MAX_FACE_ATTEMPTS
from api.models import FaceVerificationAttempt, RegistrationSession

MISMATCH = FaceVerificationOutcome(False, 10.0, 'MISMATCH', 'Face verification failed.', True)
MATCH = FaceVerificationOutcome(True, 96.0, 'MATCH', 'Face verified.', True)
CAPTURE_ERROR = FaceVerificationOutcome(False, 0.0, 'NO_FACE', 'No face found.', False)


@override_settings(N8N_FACE_VERIFY_ENABLED=False)
@override_settings(SIGNUP_ID_FACE_VERIFICATION=True)
class FaceLockoutTests(TestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)
        self.client = APIClient()  # anonymous, as in sign-up
        self.session = RegistrationSession.objects.create(
            email='applicant@gmail.com', id_verification_status='verified', id_portrait='data:image/jpeg;base64,PORTRAIT', id_registration_no='0987654',
        )

    def attempt(self, session=None):
        session = session or self.session
        return self.client.post('/api/auth/face-verification/', {
            'registrationSessionId': str(session.session_id),
            'image': 'data:image/jpeg;base64,abc',
            'idImage': 'data:image/jpeg;base64,def',
        }, format='json')

    def reset(self, client=None, session=None):
        session = session or self.session
        return (client or self.client).post('/api/auth/face-verification/', {
            'registrationSessionId': str(session.session_id), 'reset': True,
        }, format='json')

    def lock(self, outcome=MISMATCH):
        with patch('api.views.verify_face_against_id', return_value=outcome):
            for _ in range(MAX_FACE_ATTEMPTS):
                self.attempt()
        self.session.refresh_from_db()

    # --- reproduction -------------------------------------------------------

    def test_anonymous_reset_flag_does_not_clear_the_lockout(self):
        self.lock()
        self.assertTrue(self.session.face_locked, 'precondition: session should be locked')
        self.assertEqual(self.session.face_attempts, MAX_FACE_ATTEMPTS)

        res = self.reset()

        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data['code'], 'reset_not_allowed')
        self.session.refresh_from_db()
        self.assertTrue(self.session.face_locked)
        self.assertEqual(self.session.face_attempts, MAX_FACE_ATTEMPTS)

    def test_a_logged_in_user_cannot_reset_their_own_lockout_either(self):
        user = User.objects.create_user(username='x@x.com', email='x@x.com', password='pw-1234567')
        self.lock()
        client = APIClient()
        client.force_authenticate(user)

        res = self.reset(client=client)

        self.assertEqual(res.status_code, 400)
        self.session.refresh_from_db()
        self.assertTrue(self.session.face_locked)

    # --- timed lockout ------------------------------------------------------

    def test_the_first_lockout_lasts_the_first_configured_period(self):
        self.lock()
        remaining = self.session.face_locked_until - timezone.now()
        self.assertGreater(remaining, timedelta(minutes=29))
        self.assertLessEqual(remaining, timedelta(minutes=30))

    def test_the_second_lockout_is_two_hours(self):
        self.lock()
        RegistrationSession.objects.filter(pk=self.session.pk).update(
            face_locked_until=timezone.now() - timedelta(minutes=1))
        with patch('api.views.verify_face_against_id', return_value=MISMATCH):
            for _ in range(MAX_FACE_ATTEMPTS):
                self.attempt()
        self.session.refresh_from_db()
        self.assertEqual(self.session.face_lock_count, 2)
        self.assertTrue(self.session.face_locked)
        remaining = self.session.face_locked_until - timezone.now()
        self.assertGreater(remaining, timedelta(minutes=119))
        self.assertLessEqual(remaining, timedelta(minutes=120))

    def test_lockout_lengths_follow_the_configured_schedule(self):
        self.assertEqual(views._lockout_minutes(1), 30)
        self.assertEqual(views._lockout_minutes(2), 120)
        self.assertEqual(views._lockout_minutes(3), 1440)

    def test_a_locked_session_runs_no_face_matching(self):
        self.lock()
        with patch('api.views.verify_face_against_id', return_value=MATCH) as verify:
            res = self.attempt()
        self.assertEqual(res.status_code, 423)
        self.assertIn('Retry-After', res.headers)
        verify.assert_not_called()

    # --- admin unlock -------------------------------------------------------

    def test_admin_unlock_works_and_records_who_when_and_why(self):
        self.lock()
        admin = User.objects.create_user(username='admin@h.com', email='admin@h.com',
                                         password='pw-admin-1234', is_staff=True)
        client = APIClient()
        client.force_authenticate(admin)

        res = client.post('/api/admin/face-unlock/', {
            'registrationSessionId': str(self.session.session_id),
            'reason': 'Camera failed on the first scan; applicant confirmed by phone.',
        }, format='json')

        self.assertEqual(res.status_code, 200, res.content)
        self.session.refresh_from_db()
        self.assertFalse(self.session.face_locked)
        self.assertEqual(self.session.face_attempts, 0)
        self.assertEqual(self.session.face_unlocked_by, admin)
        self.assertIsNotNone(self.session.face_unlocked_at)
        self.assertIn('Camera failed', self.session.face_unlock_reason)

    def test_admin_unlock_needs_a_reason(self):
        self.lock()
        admin = User.objects.create_user(username='admin2@h.com', email='admin2@h.com',
                                         password='pw-admin-1234', is_staff=True)
        client = APIClient()
        client.force_authenticate(admin)
        res = client.post('/api/admin/face-unlock/', {
            'registrationSessionId': str(self.session.session_id),
        }, format='json')
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data['code'], 'reason_required')

    def test_a_non_admin_cannot_unlock(self):
        self.lock()
        user = User.objects.create_user(username='n@h.com', email='n@h.com', password='pw-1234567')
        client = APIClient()
        client.force_authenticate(user)
        res = client.post('/api/admin/face-unlock/', {
            'registrationSessionId': str(self.session.session_id), 'reason': 'please',
        }, format='json')
        self.assertEqual(res.status_code, 403)
        self.session.refresh_from_db()
        self.assertTrue(self.session.face_locked)

    # --- capture errors -----------------------------------------------------

    def test_a_camera_or_capture_error_does_not_count_as_a_failed_attempt(self):
        with patch('api.views.verify_face_against_id', return_value=CAPTURE_ERROR):
            for _ in range(MAX_FACE_ATTEMPTS + 2):
                self.attempt()
        self.session.refresh_from_db()
        self.assertEqual(self.session.face_attempts, 0)
        self.assertFalse(self.session.face_locked)
        self.assertEqual(
            FaceVerificationAttempt.objects.filter(session=self.session, countable=True).count(), 0)

    # --- normal path --------------------------------------------------------

    def test_an_unlocked_applicant_can_still_verify_normally(self):
        with patch('api.views.verify_face_against_id', return_value=MATCH):
            res = self.attempt()
        self.assertEqual(res.status_code, 200, res.data)
        self.assertTrue(res.data['matched'])

    # --- rate limits --------------------------------------------------------

    @override_settings(FACE_RATE_LIMIT_PER_EMAIL_PER_HOUR=2)
    def test_per_email_rate_limit_returns_429_with_retry_after(self):
        with patch('api.views.verify_face_against_id', return_value=CAPTURE_ERROR):
            self.attempt()
            self.attempt()
            res = self.attempt()
        self.assertEqual(res.status_code, 429)
        self.assertEqual(res.data['code'], 'too_many_requests')
        self.assertIn('Retry-After', res.headers)
