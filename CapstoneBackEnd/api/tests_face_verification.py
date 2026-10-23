"""Face verification attempt counting and Email OTP gating tests."""

from datetime import timedelta
from unittest.mock import patch

from django.core import mail
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from api.face_match import FaceVerificationOutcome, MAX_FACE_ATTEMPTS
from api.models import RegistrationOTP, RegistrationSession
from api.otp_service import issue_otp, verify_otp


@override_settings(
    EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend',
    EMAIL_HOST='smtp.test.local',
    EMAIL_HOST_USER='nurselink@test.local',
    EMAIL_HOST_PASSWORD='test-password',
    DEFAULT_FROM_EMAIL='NurseLink <nurselink@test.local>',
    # These cover attempt counting and lockout, not the matcher itself, so
    # they run against the local engine and patch verify_face_against_id.
    # The n8n path has its own suite in tests_n8n_integration.py.
    N8N_FACE_VERIFY_ENABLED=False,
)
@override_settings(SIGNUP_ID_FACE_VERIFICATION=True)
class FaceVerificationFlowTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.email = 'nurse.otp@gmail.com'
        # Face verification now requires Step 1's ID validation to have
        # already passed — these tests are about attempt counting/lockout
        # specifically, so start from a session that's already cleared it.
        self.session = RegistrationSession.objects.create(
            email=self.email, id_verification_status='verified', id_portrait='data:image/jpeg;base64,PORTRAIT'
        )

    def test_status_endpoint_returns_session_state(self):
        self.session.face_attempts = 2
        self.session.save(update_fields=['face_attempts'])
        res = self.client.post(
            '/api/auth/face-verification/status/',
            {'registrationSessionId': str(self.session.session_id)},
            format='json',
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['attemptsUsed'], 2)
        self.assertEqual(res.data['attemptsRemaining'], 1)
        self.assertEqual(res.data['maxAttempts'], MAX_FACE_ATTEMPTS)
        self.assertEqual(res.data['status'], 'failed')
        self.assertFalse(res.data['locked'])

    @patch('api.views.verify_face_against_id')
    def test_failed_validation_consumes_one_attempt(self, mock_verify):
        mock_verify.return_value = FaceVerificationOutcome(
            False, 12.0, 'NO_FACE', 'No face detected.', True
        )
        res = self.client.post(
            '/api/auth/face-verification/',
            {
                'registrationSessionId': str(self.session.session_id),
                'image': 'data:image/jpeg;base64,abc',
                'idImage': 'data:image/jpeg;base64,def',
            },
            format='json',
        )
        self.assertEqual(res.status_code, 200)
        self.assertFalse(res.data['matched'])
        self.assertEqual(res.data['attemptsUsed'], 1)
        self.session.refresh_from_db()
        self.assertEqual(self.session.face_attempts, 1)
        self.assertFalse(self.session.face_locked)

    @patch('api.views.verify_face_against_id')
    def test_three_failures_lock_and_enable_otp_choice(self, mock_verify):
        mock_verify.return_value = FaceVerificationOutcome(
            False, 10.0, 'MISMATCH', 'Face verification failed.', True
        )
        for _ in range(3):
            res = self.client.post(
                '/api/auth/face-verification/',
                {
                    'registrationSessionId': str(self.session.session_id),
                    'image': 'data:image/jpeg;base64,abc',
                    'idImage': 'data:image/jpeg;base64,def',
                },
                format='json',
            )
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data['locked'])
        self.assertEqual(res.data['attemptsUsed'], 3)
        self.assertEqual(res.data['status'], 'max_attempts_reached')
        self.session.refresh_from_db()
        self.assertTrue(self.session.face_locked)

    @patch('api.views.verify_face_against_id')
    def test_reset_flag_is_refused_and_keeps_the_lock(self, mock_verify):
        self.session.face_attempts = 3
        self.session.face_locked = True
        self.session.save(update_fields=['face_attempts', 'face_locked'])
        res = self.client.post(
            '/api/auth/face-verification/',
            {'registrationSessionId': str(self.session.session_id), 'reset': True},
            format='json',
        )
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data['code'], 'reset_not_allowed')
        mock_verify.assert_not_called()
        self.session.refresh_from_db()
        self.assertEqual(self.session.face_attempts, 3)
        self.assertTrue(self.session.face_locked)

    @patch('api.views.verify_face_against_id')
    def test_new_scan_without_session_does_not_reuse_locked_session(self, mock_verify):
        """A locked prior session for the same email must not auto-skip to max attempts."""
        self.session.face_attempts = 3
        self.session.face_locked = True
        self.session.face_locked_until = timezone.now() - timedelta(minutes=1)  # timed lock has run out
        self.session.save(update_fields=['face_attempts', 'face_locked', 'face_locked_until'])
        mock_verify.return_value = FaceVerificationOutcome(
            False, 10.0, 'MISMATCH', 'Face verification failed.', True
        )
        res = self.client.post(
            '/api/auth/face-verification/',
            {
                'registeredEmail': self.email,
                'image': 'data:image/jpeg;base64,abc',
                'idImage': 'data:image/jpeg;base64,def',
            },
            format='json',
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['attemptsUsed'], 1)
        self.assertFalse(res.data['locked'])
        self.assertNotEqual(str(self.session.session_id), res.data['registrationSessionId'])

    def test_otp_requires_matching_registered_email(self):
        self.session.face_locked = True
        self.session.save(update_fields=['face_locked'])
        res = self.client.post(
            '/api/auth/send-registration-otp/',
            {
                'registrationSessionId': str(self.session.session_id),
                'email': 'wrong@example.com',
            },
            format='json',
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn('email', res.data)
        self.assertEqual(len(mail.outbox), 0)

    def test_otp_blocked_before_lockout(self):
        res = self.client.post(
            '/api/auth/send-registration-otp/',
            {
                'registrationSessionId': str(self.session.session_id),
                'email': self.email,
            },
            format='json',
        )
        self.assertEqual(res.status_code, 400)
        self.assertEqual(len(mail.outbox), 0)

    @patch('api.otp_service.validate_registration_email', side_effect=lambda email: email.lower())
    def test_otp_send_delivers_real_email_without_returning_code(self, _validate):
        self.session.face_locked = True
        self.session.save(update_fields=['face_locked'])
        res = self.client.post(
            '/api/auth/send-registration-otp/',
            {
                'registrationSessionId': str(self.session.session_id),
                'email': self.email,
            },
            format='json',
        )
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data['success'])
        self.assertNotIn('otp', res.data)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, [self.email])
        self.assertIn('Your verification code is:', mail.outbox[0].body)
        self.assertTrue(RegistrationOTP.objects.filter(session=self.session, is_active=True).exists())

    @patch('api.otp_service.validate_registration_email', side_effect=lambda email: email.lower())
    def test_otp_verify_success_and_invalid(self, _validate):
        self.session.face_locked = True
        self.session.save(update_fields=['face_locked'])
        with patch('api.otp_service._generate_code', return_value='654321'):
            issue_otp(self.session)
        verified, message, code = verify_otp(self.session, '000000')
        self.assertFalse(verified)
        self.assertEqual(code, 'INVALID')
        verified, message, code = verify_otp(self.session, '654321')
        self.assertTrue(verified)
        self.assertIsNone(code)
        self.session.refresh_from_db()
        self.assertTrue(self.session.otp_verified)

    @patch('api.otp_service.validate_registration_email', side_effect=lambda email: email.lower())
    def test_otp_send_without_email_field_still_delivers_to_registered_email(self, _validate):
        """Session identity alone is sufficient — the email field is optional."""
        self.session.face_locked = True
        self.session.save(update_fields=['face_locked'])
        res = self.client.post(
            '/api/auth/send-registration-otp/',
            {'registrationSessionId': str(self.session.session_id)},
            format='json',
        )
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data['success'])
        self.assertEqual(res.data['status'], 'otp_sent')
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, [self.email])

    def test_otp_send_reports_email_not_registered_when_session_has_no_email(self):
        session = RegistrationSession.objects.create(email='', face_locked=True)
        res = self.client.post(
            '/api/auth/send-registration-otp/',
            {'registrationSessionId': str(session.session_id)},
            format='json',
        )
        self.assertEqual(res.status_code, 400)
        self.assertFalse(res.data['success'])
        self.assertEqual(res.data['status'], 'email_not_registered')
        self.assertEqual(len(mail.outbox), 0)

    def test_otp_resend_reports_email_not_registered_when_session_has_no_email(self):
        session = RegistrationSession.objects.create(email='', face_locked=True)
        res = self.client.post(
            '/api/auth/resend-registration-otp/',
            {'registrationSessionId': str(session.session_id)},
            format='json',
        )
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data['status'], 'email_not_registered')

    @patch('api.otp_service.validate_registration_email', side_effect=lambda email: email.lower())
    def test_otp_verify_success_response_includes_status(self, _validate):
        self.session.face_locked = True
        self.session.save(update_fields=['face_locked'])
        with patch('api.otp_service._generate_code', return_value='111222'):
            issue_otp(self.session)
        res = self.client.post(
            '/api/auth/verify-registration-otp/',
            {'registrationSessionId': str(self.session.session_id), 'otp': '111222'},
            format='json',
        )
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data['verified'])
        self.assertEqual(res.data['status'], 'email_verified')


@override_settings(N8N_FACE_VERIFY_ENABLED=False)
@override_settings(SIGNUP_ID_FACE_VERIFICATION=True)
class FaceVerificationRequiresIdVerificationTests(TestCase):
    """
    Face verification compares the selfie against the Step-1 ID photo — that
    comparison is meaningless, and open to abuse, if Step 1's own strict
    field validation never actually passed. The backend must enforce this
    itself; it cannot rely on the frontend having gated progression to Step 3.
    """

    def setUp(self):
        self.client = APIClient()

    def _post(self, session_id):
        return self.client.post(
            '/api/auth/face-verification/',
            {
                'registrationSessionId': str(session_id),
                'image': 'data:image/jpeg;base64,abc',
                'idImage': 'data:image/jpeg;base64,def',
            },
            format='json',
        )

    def test_session_without_verified_id_is_rejected(self):
        session = RegistrationSession.objects.create(email='nurse@hospital.com')
        self.assertEqual(session.id_verification_status, '')

        res = self._post(session.session_id)

        self.assertEqual(res.status_code, 400)
        self.assertFalse(res.data['success'])
        self.assertEqual(res.data['status'], 'id_not_verified')
        session.refresh_from_db()
        # Rejected as a precondition failure — never touched the attempt counter.
        self.assertEqual(session.face_attempts, 0)

    def test_session_with_validation_error_status_is_also_rejected(self):
        session = RegistrationSession.objects.create(
            email='nurse@hospital.com', id_verification_status='validation_error'
        )
        res = self._post(session.session_id)
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data['status'], 'id_not_verified')

    @patch('api.views.verify_face_against_id')
    def test_session_with_verified_id_proceeds_to_face_match(self, mock_verify):
        from api.face_match import FaceVerificationOutcome

        mock_verify.return_value = FaceVerificationOutcome(True, 92.0, None, None, countable=False)
        session = RegistrationSession.objects.create(
            email='nurse@hospital.com', id_verification_status='verified', id_portrait='data:image/jpeg;base64,PORTRAIT'
        )

        res = self._post(session.session_id)

        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data['matched'])
        mock_verify.assert_called_once()

    def test_fresh_fallback_session_inherits_id_status_from_prior_session_by_email(self):
        """
        A locked prior session (excluded from resumption) for this email
        already completed Step 1 — a fresh attempt cycle for face matching
        should not be forced back through ID re-verification.
        """
        prior = RegistrationSession.objects.create(
            email='nurse@hospital.com',
            id_verification_status='verified', id_portrait='data:image/jpeg;base64,PORTRAIT',
            id_last_name='Dela Cruz',
            face_locked=True,
            face_attempts=3,
            face_locked_until=timezone.now() - timedelta(minutes=1),  # timed lock has run out
        )

        res = self.client.post(
            '/api/auth/face-verification/',
            {
                'registeredEmail': 'nurse@hospital.com',
                'image': 'data:image/jpeg;base64,abc',
                'idImage': 'data:image/jpeg;base64,def',
            },
            format='json',
        )

        # A fresh session was created (not the locked one)...
        self.assertNotEqual(res.data.get('registrationSessionId'), str(prior.session_id))
        # ...but it did not need to re-verify the ID from scratch.
        self.assertNotEqual(res.data.get('status'), 'id_not_verified')
        new_session = RegistrationSession.objects.get(session_id=res.data['registrationSessionId'])
        self.assertEqual(new_session.id_verification_status, 'verified')
        self.assertEqual(new_session.id_last_name, 'Dela Cruz')
