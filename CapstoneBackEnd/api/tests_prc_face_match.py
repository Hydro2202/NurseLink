"""
PRC licence <-> selfie face-matching, and server-side enforcement that a
registration session cannot reach /auth/signup/ without both a passed PRC
scan and (when identity was verified via Face) a matching selfie.

OCR and the face matcher are both mocked — this suite is about the wiring
between VerifyPrcLicenseView, RegistrationSession, and SignupSerializer, not
about Tesseract or OpenCV themselves (see tests_prc_ocr.py and
tests_face_verification.py for those).
"""

from datetime import date
from unittest.mock import patch

from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from api.face_match import FaceVerificationOutcome
from api.models import FaceVerificationAttempt, NurseProfile, RegistrationSession
from api.n8n_client import N8nTimeout
from api.tests_prc_ocr import CLEAN_PRC_TEXT, PRC_MIDWIFE_TEXT, REJECTION_MESSAGE, _fake_image_b64


@override_settings(N8N_FACE_VERIFY_ENABLED=False)
@override_settings(SIGNUP_ID_FACE_VERIFICATION=True)
class PrcFaceMatchTests(TestCase):
    def setUp(self):
        # DRF keeps throttle history in the shared cache — real traffic to the
        # face_verification scope (shared by this endpoint) can 429 these tests.
        cache.clear()
        self.client = APIClient()
        self.image = _fake_image_b64()
        self.selfie = 'data:image/jpeg;base64,abc'

    def _face_session(self):
        session = RegistrationSession.objects.create(email='nurse@example.com')
        session.face_verified = True
        session.verification_method = 'FACE'
        session.save(update_fields=['face_verified', 'verification_method'])
        return session

    def _otp_session(self):
        session = RegistrationSession.objects.create(email='nurse@example.com')
        session.otp_verified = True
        session.verification_method = 'EMAIL_OTP'
        session.save(update_fields=['otp_verified', 'verification_method'])
        return session

    def _post(self, session, *, selfie=None, image=None):
        body = {'image': image or self.image, 'registrationSessionId': str(session.session_id)}
        if selfie is not None:
            body['selfie'] = selfie
        return self.client.post('/api/auth/verify-prc/', body, format='json')

    @patch('api.views.verify_face_against_id')
    def test_valid_prc_and_matching_selfie_verifies_session(self, mock_verify):
        mock_verify.return_value = FaceVerificationOutcome(True, 92.4, None, None, countable=False)
        session = self._face_session()

        with patch('api.prc_ocr._run_tesseract', return_value=CLEAN_PRC_TEXT):
            res = self._post(session, selfie=self.selfie)

        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data['valid'])
        self.assertTrue(res.data['faceMatch']['matched'])
        session.refresh_from_db()
        self.assertTrue(session.prc_verified)
        self.assertEqual(session.prc_license_number, '0123456')
        self.assertEqual(session.prc_profession, 'Registered Nurse')

        # Reused the same face_verify pipeline as Step 3 — passing id_label so
        # the audit trail/messages read "PRC ID photo", not "Hospital ID photo".
        mock_verify.assert_called_once()
        self.assertEqual(mock_verify.call_args.kwargs.get('id_label'), 'PRC ID photo')
        self.assertEqual(mock_verify.call_args.kwargs.get('reason_prefix'), 'PRC_')

    @patch('api.views.verify_face_against_id')
    def test_valid_prc_but_mismatched_selfie_does_not_verify_session(self, mock_verify):
        mock_verify.return_value = FaceVerificationOutcome(False, 20.0, 'MISMATCH', None, countable=True)
        session = self._face_session()

        with patch('api.prc_ocr._run_tesseract', return_value=CLEAN_PRC_TEXT):
            res = self._post(session, selfie=self.selfie)

        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data['valid'])  # OCR half genuinely succeeded
        self.assertFalse(res.data['faceMatch']['matched'])
        self.assertTrue(res.data['faceMatch']['message'])
        session.refresh_from_db()
        self.assertFalse(session.prc_verified)

        # Logged for audit, but never consumes an attempt — no cap on PRC rescans.
        attempt = FaceVerificationAttempt.objects.get(session=session)
        self.assertFalse(attempt.matched)
        self.assertFalse(attempt.countable)
        self.assertEqual(attempt.reason, 'MISMATCH')

    @patch('api.views.verify_face_against_id')
    def test_invalid_prc_document_never_attempts_face_match(self, mock_verify):
        session = self._face_session()
        with patch('api.prc_ocr._run_tesseract', return_value=PRC_MIDWIFE_TEXT):
            res = self._post(session, selfie=self.selfie)

        self.assertEqual(res.status_code, 200)
        self.assertFalse(res.data['valid'])
        self.assertEqual(res.data['message'], REJECTION_MESSAGE)
        mock_verify.assert_not_called()
        session.refresh_from_db()
        self.assertFalse(session.prc_verified)

    def test_otp_verified_session_skips_face_match_entirely(self):
        session = self._otp_session()
        with patch('api.prc_ocr._run_tesseract', return_value=CLEAN_PRC_TEXT), patch(
            'api.views.verify_face_against_id'
        ) as mock_verify:
            res = self._post(session)  # no selfie sent — none was ever captured for OTP sessions

        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data['valid'])
        self.assertNotIn('faceMatch', res.data)
        mock_verify.assert_not_called()
        session.refresh_from_db()
        self.assertTrue(session.prc_verified)

    def test_face_session_without_selfie_soft_degrades(self):
        """Stale client that hasn't been updated to resend the selfie: OCR is
        still reported truthfully, but prc_verified is withheld."""
        session = self._face_session()
        with patch('api.prc_ocr._run_tesseract', return_value=CLEAN_PRC_TEXT), patch(
            'api.views.verify_face_against_id'
        ) as mock_verify:
            res = self._post(session)  # no selfie

        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data['valid'])
        self.assertFalse(res.data['faceMatch']['matched'])
        mock_verify.assert_not_called()
        session.refresh_from_db()
        self.assertFalse(session.prc_verified)

    @override_settings(N8N_FACE_VERIFY_ENABLED=True, N8N_FACE_VERIFY_FALLBACK_LOCAL=False)
    @patch('api.views.call_workflow')
    def test_n8n_failure_during_prc_face_match_does_not_fail_ocr(self, mock_call_workflow):
        mock_call_workflow.side_effect = N8nTimeout(workflow='face_verify')
        session = self._face_session()

        with patch('api.prc_ocr._run_tesseract', return_value=CLEAN_PRC_TEXT):
            res = self._post(session, selfie=self.selfie)

        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data['valid'])
        self.assertFalse(res.data['faceMatch']['matched'])
        session.refresh_from_db()
        self.assertFalse(session.prc_verified)


@override_settings(N8N_FACE_VERIFY_ENABLED=False)
@override_settings(SIGNUP_ID_FACE_VERIFICATION=True)
class SignupRequiresPrcVerificationTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()

    def _payload(self, session):
        return {
            'email': 'nurse.new@example.com',
            'password': 'S3curePass!',
            'firstName': 'Maria',
            'lastName': 'Dela Cruz',
            'role': 'staff_nurse',
            'registrationSessionId': str(session.session_id),
        }

    def test_signup_blocked_when_id_not_verified(self):
        # Face/OTP passed, but Step 1's PRC ID OCR never reached
        # id_verification_status='verified' — the sole PRC-verification gate
        # now that Step 5's separate scan has been removed from the wizard.
        session = RegistrationSession.objects.create(email='nurse.new@example.com')
        session.face_verified = True
        session.verification_method = 'FACE'
        session.save(update_fields=['face_verified', 'verification_method'])

        res = self.client.post('/api/auth/signup/', self._payload(session), format='json')

        self.assertEqual(res.status_code, 400)
        self.assertIn('registrationSessionId', res.data)

    def test_signup_succeeds_once_id_verified_and_persists_fields(self):
        session = RegistrationSession.objects.create(
            email='nurse.new@example.com',
            id_first_name='Maria',
            id_last_name='Dela Cruz',
            id_registration_no='0123456',
            id_portrait='data:image/jpeg;base64,PORTRAIT',
        )
        session.face_verified = True
        session.verification_method = 'FACE'
        session.id_verification_status = 'verified'
        session.id_valid_until = date(2027, 6, 30)
        session.save(
            update_fields=[
                'face_verified',
                'verification_method',
                'id_verification_status',
                'id_valid_until',
            ]
        )

        res = self.client.post('/api/auth/signup/', self._payload(session), format='json')

        self.assertEqual(res.status_code, 201, res.data)
        profile = NurseProfile.objects.get(user__email='nurse.new@example.com')
        self.assertEqual(profile.prc_license_expiry, '06/30/2027')
        self.assertIsNotNone(profile.prc_verified_at)
