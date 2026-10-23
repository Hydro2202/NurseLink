"""
Regression tests: an account must be bound to the identity that passed PRC + face verification.

The attack these block: scan a real PRC card (any one, legible), pass the face
check with your own selfie against your own photo, then sign up with the card
holder's name and licence. Before the fix the face check trusted the client's
`idImage` and sign-up silently replaced the submitted details with the scanned
ones.
"""

import datetime
from unittest.mock import patch

from django.contrib.auth.models import User
from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from api.face_match import FaceVerificationOutcome
from api.models import NurseProfile, RegistrationSession

MATCH = FaceVerificationOutcome(True, 96.0, 'MATCH', 'Face verified.', True)
PASSWORD = 'Str0ng-Pass-2026!'
SCANNED_CARD = 'data:image/jpeg;base64,SCANNED_CARD_OF_PERSON_A'


@override_settings(N8N_FACE_VERIFY_ENABLED=False)
@override_settings(SIGNUP_ID_FACE_VERIFICATION=True)
class IdentityBindingTests(TestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)
        self.client = APIClient()
        # Session produced by a successful scan of Person A's card.
        self.session = RegistrationSession.objects.create(
            email='attacker@gmail.com',
            id_verification_status='verified',
            id_first_name='Maria',
            id_middle_name='Santos',
            id_last_name='Dela Cruz',
            id_registration_no='0123456',
            id_portrait=SCANNED_CARD,
        )

    def face_check(self, selfie, id_photo):
        return self.client.post(
            '/api/auth/face-verification/',
            {
                'registrationSessionId': str(self.session.session_id),
                'image': selfie,
                'idImage': id_photo,
            },
            format='json',
        )

    def signup(self, **overrides):
        body = {
            'email': 'attacker@gmail.com',
            'password': PASSWORD,
            'firstName': 'Maria',
            'middleName': 'Santos',
            'lastName': 'Dela Cruz',
            'licenseNumber': '0123456',
            'registrationSessionId': str(self.session.session_id),
        }
        body.update(overrides)
        return self.client.post('/api/auth/signup/', body, format='json')

    # --- face check is matched against the scanned card only -----------------

    @patch('api.views.verify_face_against_id', return_value=MATCH)
    def test_face_check_ignores_the_client_id_photo(self, mock_verify):
        res = self.face_check('data:image/jpeg;base64,ATTACKER_SELFIE', 'data:image/jpeg;base64,ATTACKER_OWN_PHOTO')

        self.assertEqual(res.status_code, 200, res.data)
        args = mock_verify.call_args.args
        self.assertNotIn('ATTACKER_OWN_PHOTO', str(args))
        self.assertIn('SCANNED_CARD_OF_PERSON_A', str(args))

    @patch('api.views.verify_face_against_id', return_value=MATCH)
    def test_face_check_refused_when_no_card_was_scanned(self, mock_verify):
        self.session.id_portrait = ''
        self.session.save(update_fields=['id_portrait'])

        res = self.face_check('data:image/jpeg;base64,ATTACKER_SELFIE', 'data:image/jpeg;base64,ATTACKER_OWN_PHOTO')

        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data['code'], 'id_scan_required')
        mock_verify.assert_not_called()

    def test_portrait_is_never_returned_to_the_client(self):
        with patch('api.views.verify_face_against_id', return_value=MATCH):
            res = self.face_check('data:image/jpeg;base64,ATTACKER_SELFIE', 'data:image/jpeg;base64,X')
        self.assertNotIn('SCANNED_CARD_OF_PERSON_A', res.content.decode())

    # --- sign-up is rejected when the form does not match the scanned card ---

    @patch('api.views.verify_face_against_id', return_value=MATCH)
    def test_signup_with_mismatched_name_and_licence_is_rejected(self, _mock):
        self.face_check('data:image/jpeg;base64,ATTACKER_SELFIE', 'data:image/jpeg;base64,X')

        res = self.signup(firstName='Attacker', lastName='Impostor', licenseNumber='9999999')

        self.assertEqual(res.status_code, 400, res.data)
        self.assertEqual(res.data['code'], 'identity_mismatch')
        self.assertEqual(set(res.data['fields']), {'firstName', 'lastName', 'licenseNumber'})
        self.assertFalse(User.objects.filter(email='attacker@gmail.com').exists())

    @patch('api.views.verify_face_against_id', return_value=MATCH)
    def test_signup_with_a_different_email_is_rejected(self, _mock):
        self.face_check('data:image/jpeg;base64,ATTACKER_SELFIE', 'data:image/jpeg;base64,X')

        res = self.signup(email='someone.else@gmail.com')

        self.assertEqual(res.status_code, 400)
        self.assertFalse(User.objects.filter(email='someone.else@gmail.com').exists())

    @patch('api.views.verify_face_against_id', return_value=MATCH)
    def test_signup_matching_the_scan_ignores_case_and_spacing(self, _mock):
        self.face_check('data:image/jpeg;base64,ATTACKER_SELFIE', 'data:image/jpeg;base64,X')

        res = self.signup(firstName='maria ', lastName='DELA-CRUZ', licenseNumber='0123 456')

        self.assertEqual(res.status_code, 201, res.data)

    @patch('api.views.verify_face_against_id', return_value=MATCH)
    def test_requested_head_nurse_role_is_recorded_as_a_request_only(self, _mock):
        self.face_check('data:image/jpeg;base64,ATTACKER_SELFIE', 'data:image/jpeg;base64,X')

        res = self.signup(requestedRole='head_nurse')

        self.assertEqual(res.status_code, 201, res.data)
        profile = NurseProfile.objects.get(user__email='attacker@gmail.com')
        self.assertEqual(profile.role, 'staff_nurse')
        self.assertEqual(profile.requested_role, 'head_nurse')
        self.assertEqual(profile.approval_status, 'pending')

    @patch('api.views.verify_face_against_id', return_value=MATCH)
    def test_licence_already_on_an_account_is_refused(self, _mock):
        existing = User.objects.create_user(username='existing@h.com', email='existing@h.com', password=PASSWORD)
        NurseProfile.objects.create(user=existing, role='staff_nurse', license_number='0123456')
        self.face_check('data:image/jpeg;base64,ATTACKER_SELFIE', 'data:image/jpeg;base64,X')

        res = self.signup()

        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data['code'], 'licence_already_registered')


@override_settings(N8N_FACE_VERIFY_ENABLED=False)
@override_settings(SIGNUP_ID_FACE_VERIFICATION=True)
class IdReviewCorrectionPolicyTests(TestCase):
    """Step 2 may correct names only; licence number and card dates must match the scan."""

    URL = '/api/auth/registration-email/'

    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)
        self.client = APIClient()
        self.session = RegistrationSession.objects.create(
            email='', id_verification_status='verified',
            id_first_name='Maria', id_middle_name='Santos', id_last_name='Dela Cruz',
            id_registration_no='0123456',
            id_registration_date=datetime.date(2025, 12, 27),
            id_valid_until=datetime.date(2029, 6, 29),
        )

    def body(self, **overrides):
        fields = {
            'registrationSessionId': str(self.session.session_id),
            'email': 'maria@gmail.com',
            'lastName': 'Dela Cruz', 'firstName': 'Maria', 'middleName': 'Santos',
            'registrationNumber': '0123456',
            'registrationDate': '2025-12-27', 'validUntil': '2029-06-29',
        }
        fields.update(overrides)
        return fields

    def test_name_correction_is_allowed(self):
        res = self.client.post(self.URL, self.body(firstName='Marla'), format='json')
        self.assertEqual(res.status_code, 200, res.content)
        self.session.refresh_from_db()
        self.assertEqual(self.session.id_first_name, 'Marla')

    def test_licence_number_cannot_be_changed(self):
        res = self.client.post(self.URL, self.body(registrationNumber='9999999'), format='json')
        self.assertEqual(res.status_code, 400, res.content)
        self.assertEqual(res.data['code'], 'card_field_not_editable')
        self.assertIn('registrationNumber', res.data['fields'])
        self.session.refresh_from_db()
        self.assertEqual(self.session.id_registration_no, '0123456')

    def test_licence_formatting_only_is_not_a_change(self):
        res = self.client.post(self.URL, self.body(registrationNumber='0123-456'), format='json')
        self.assertEqual(res.status_code, 200, res.content)

    def test_card_dates_cannot_be_changed(self):
        res = self.client.post(self.URL, self.body(validUntil='2030-01-01'), format='json')
        self.assertEqual(res.status_code, 400, res.content)
        self.assertIn('validUntil', res.data['fields'])
