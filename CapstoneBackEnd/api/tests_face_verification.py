"""Face verification attempt counting and Email OTP gating tests."""

from unittest.mock import patch

from django.core import mail
from django.test import TestCase, override_settings
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
)
class FaceVerificationFlowTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.email = 'nurse.otp@gmail.com'
        self.session = RegistrationSession.objects.create(email=self.email)

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
    def test_reset_clears_attempts(self, mock_verify):
        self.session.face_attempts = 3
        self.session.face_locked = True
        self.session.save(update_fields=['face_attempts', 'face_locked'])
        res = self.client.post(
            '/api/auth/face-verification/',
            {'registrationSessionId': str(self.session.session_id), 'reset': True},
            format='json',
        )
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data['reset'])
        self.assertEqual(res.data['attemptsUsed'], 0)
        self.assertFalse(res.data['locked'])
        self.session.refresh_from_db()
        self.assertEqual(self.session.face_attempts, 0)
        self.assertFalse(self.session.face_locked)

    @patch('api.views.verify_face_against_id')
    def test_new_scan_without_session_does_not_reuse_locked_session(self, mock_verify):
        """A locked prior session for the same email must not auto-skip to max attempts."""
        self.session.face_attempts = 3
        self.session.face_locked = True
        self.session.save(update_fields=['face_attempts', 'face_locked'])
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
        self.assertEqual(self.session.verification_method, 'EMAIL_OTP')
