"""
The account must belong to the identity that was verified.

Sign-up used to take name, licence number and email from the request body and
only check that the session had passed verification — so one person's verified
PRC ID and face could create an account under any other name. Now:

  * name and licence number come from the session's verified ID fields;
  * the login email must be the email registered (and OTP-verified) on Step 2;
  * Step 2 cannot change the email or ID fields once verification has passed.
"""

import datetime
import uuid

from django.contrib.auth.models import User
from django.core.cache import cache
from rest_framework.test import APITestCase

from .models import RegistrationSession


def verified_session(**extra):
    fields = dict(
        session_id=uuid.uuid4(),
        email='raiden@gmail.com',
        face_verified=True,
        verification_method='FACE',
        id_verification_status='verified', id_portrait='data:image/jpeg;base64,PORTRAIT',
        id_last_name='VILLAPANDO',
        id_first_name='RAIDEN',
        id_middle_name='',
        id_registration_no='0987654',
        id_registration_date=datetime.date(2025, 12, 27),
        id_valid_until=datetime.date(2029, 6, 29),
    )
    fields.update(extra)
    return RegistrationSession.objects.create(**fields)


class SignupIdentityBindingTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)
        self.session = verified_session()

    def signup(self, **overrides):
        body = {
            'email': 'raiden@gmail.com',
            'password': 'Sup3r-Secret-99',
            'firstName': 'RAIDEN',
            'lastName': 'VILLAPANDO',
            'licenseNumber': '0987654',
            'registrationSessionId': str(self.session.session_id),
        }
        body.update(overrides)
        return self.client.post('/api/auth/signup/', body, format='json')

    def test_matching_signup_succeeds(self):
        res = self.signup()
        self.assertEqual(res.status_code, 201, res.content)
        user = User.objects.get(email='raiden@gmail.com')
        self.assertEqual(user.first_name, 'RAIDEN')
        self.assertEqual(user.nurse_profile.license_number, '0987654')

    def test_different_email_is_rejected(self):
        res = self.signup(email='someone.else@gmail.com')
        self.assertEqual(res.status_code, 400)
        self.assertIn('email', res.data)
        self.assertFalse(User.objects.filter(email='someone.else@gmail.com').exists())

    def test_email_match_ignores_case(self):
        res = self.signup(email='Raiden@Gmail.com')
        self.assertEqual(res.status_code, 201, res.content)

    def test_form_that_differs_from_the_scan_is_rejected_not_replaced(self):
        res = self.signup(firstName='Totally', lastName='Different', middleName='X', licenseNumber='1111111')
        self.assertEqual(res.status_code, 400, res.content)
        self.assertEqual(res.data['code'], 'identity_mismatch')
        self.assertFalse(User.objects.filter(email='raiden@gmail.com').exists())

    def test_session_without_scanned_id_fields_cannot_create_an_account(self):
        self.session = verified_session(
            email='old@gmail.com', id_last_name='', id_first_name='', id_registration_no='',
        )
        res = self.signup(email='old@gmail.com', firstName='Ana', lastName='Cruz', licenseNumber='7654321')
        self.assertEqual(res.status_code, 400, res.content)
        self.assertFalse(User.objects.filter(email='old@gmail.com').exists())


class RegistrationStepTwoLockTests(APITestCase):
    URL = '/api/auth/registration-email/'

    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)

    def body(self, session, **id_overrides):
        fields = {
            'lastName': 'VILLAPANDO', 'firstName': 'RAIDEN', 'middleName': '',
            'registrationNumber': '0987654', 'registrationDate': '2025-12-27', 'validUntil': '2029-06-29',
        }
        fields.update(id_overrides)
        return {'registrationSessionId': str(session.session_id), 'email': 'raiden@gmail.com', **fields}

    def test_unverified_session_can_still_be_corrected(self):
        session = verified_session(face_verified=False, id_last_name='VILAPANDO')
        res = self.client.post(self.URL, self.body(session), format='json')
        self.assertEqual(res.status_code, 200, res.content)
        session.refresh_from_db()
        self.assertEqual(session.id_last_name, 'VILLAPANDO')

    def test_verified_session_rejects_changed_email(self):
        session = verified_session()
        body = self.body(session)
        body['email'] = 'other@gmail.com'
        res = self.client.post(self.URL, body, format='json')
        self.assertEqual(res.status_code, 409)
        session.refresh_from_db()
        self.assertEqual(session.email, 'raiden@gmail.com')

    def test_verified_session_rejects_changed_name(self):
        session = verified_session()
        res = self.client.post(self.URL, self.body(session, lastName='CRUZ'), format='json')
        self.assertEqual(res.status_code, 409)
        session.refresh_from_db()
        self.assertEqual(session.id_last_name, 'VILLAPANDO')

    def test_verified_session_accepts_identical_resend(self):
        session = verified_session()
        res = self.client.post(self.URL, self.body(session), format='json')
        self.assertEqual(res.status_code, 200, res.content)
