"""
Correcting what the scanner read.

OCR misreads names and digits, so the ID Review step lets the nurse fix the six
extracted fields before continuing. What matters here is that the correction
actually replaces the scan everywhere downstream, and that being editable does
not mean being trusted: a corrected value passes exactly the same validation the
scanned one did.
"""

import datetime
import uuid

from django.contrib.auth.models import User
from django.core.cache import cache
from rest_framework.test import APITestCase

from .models import NurseProfile, RegistrationSession


def make_session(**extra):
    """A session as it stands after a successful scan on Step 1."""
    fields = dict(
        session_id=uuid.uuid4(),
        # Step 2 (ID Review) runs before Step 3 (face/OTP), so a session being
        # reviewed is not verified yet — once it is, Step 2 is locked.
        face_verified=False,
        id_verification_status='verified', id_portrait='data:image/jpeg;base64,PORTRAIT',
        verification_method='face',
        # What OCR read — deliberately wrong, so a correction is visible.
        id_last_name='SITERAKAS',
        id_first_name='MALOU',
        id_middle_name='KELEMEN',
        id_registration_no='2223332',
        id_registration_date=datetime.date(2025, 12, 4),
        id_valid_until=datetime.date(2029, 6, 29),
    )
    fields.update(extra)
    return RegistrationSession.objects.create(**fields)


class ReviewedIdFieldTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.session = make_session()

    def post(self, **extra):
        body = {
            'registrationSessionId': str(self.session.session_id),
            'email': 'malou@hospital.com',
        }
        body.update(extra)
        return self.client.post('/api/auth/registration-email/', body, format='json')

    def corrected(self, **overrides):
        body = {
            'lastName': 'CORTEZ',
            'firstName': 'MALOU',
            'middleName': 'KELEMEN',
            'registrationNumber': '2223332',
            'registrationDate': '2025-12-04',
            'validUntil': '2029-06-29',
        }
        body.update(overrides)
        return body

    # --- the correction reaches the database ----------------------------

    def test_a_corrected_name_replaces_what_ocr_read(self):
        response = self.post(**self.corrected())

        self.assertEqual(response.status_code, 200, response.content)
        self.session.refresh_from_db()
        self.assertEqual(self.session.id_last_name, 'CORTEZ')
        self.assertNotEqual(self.session.id_last_name, 'SITERAKAS')

    def test_card_dates_cannot_be_corrected_to_other_dates(self):
        # Policy: only names are correctable. Dates come from the card.
        response = self.post(**self.corrected(registrationDate='2024-01-15', validUntil='2028-01-15'))

        self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual(response.json()['code'], 'card_field_not_editable')
        self.session.refresh_from_db()
        self.assertEqual(self.session.id_registration_date, datetime.date(2025, 12, 4))
        self.assertEqual(self.session.id_valid_until, datetime.date(2029, 6, 29))

    def test_the_registration_number_cannot_be_corrected(self):
        # Policy: a licence typed in Step 2 could belong to someone else.
        response = self.post(**self.corrected(registrationNumber='7654321'))

        self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual(response.json()['fields'], ['registrationNumber'])
        self.session.refresh_from_db()
        self.assertEqual(self.session.id_registration_no, '2223332')

    def test_the_email_is_still_saved_alongside_the_corrections(self):
        self.post(**self.corrected())

        self.session.refresh_from_db()
        self.assertEqual(self.session.email, 'malou@hospital.com')

    def test_a_middle_name_can_be_cleared(self):
        # Plenty of PRC IDs carry no middle name; OCR sometimes invents one.
        response = self.post(**self.corrected(middleName=''))

        self.assertEqual(response.status_code, 200, response.content)
        self.session.refresh_from_db()
        self.assertEqual(self.session.id_middle_name, '')

    def test_dates_may_be_sent_as_typed_rather_than_iso(self):
        response = self.post(
            **self.corrected(registrationDate='12/04/2025', validUntil='06/29/2029')
        )

        self.assertEqual(response.status_code, 200, response.content)
        self.session.refresh_from_db()
        self.assertEqual(self.session.id_registration_date, datetime.date(2025, 12, 4))

    # --- editable is not the same as trusted -----------------------------

    def test_a_nonsense_name_is_rejected(self):
        response = self.post(**self.corrected(lastName='12345'))

        self.assertEqual(response.status_code, 400)
        self.assertIn('lastName', response.json())
        self.session.refresh_from_db()
        self.assertEqual(self.session.id_last_name, 'SITERAKAS', 'nothing may be saved on reject')

    def test_a_registration_number_that_is_not_seven_digits_is_rejected(self):
        response = self.post(**self.corrected(registrationNumber='12'))

        self.assertEqual(response.status_code, 400)
        self.assertIn('registrationNumber', response.json())

    def test_a_date_that_does_not_exist_is_rejected(self):
        response = self.post(**self.corrected(registrationDate='02/30/2025'))

        self.assertEqual(response.status_code, 400)
        self.assertIn('registrationDate', response.json())

    def test_a_valid_until_before_the_registration_date_is_rejected(self):
        response = self.post(
            **self.corrected(registrationDate='2029-06-29', validUntil='2025-12-04')
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn('validUntil', response.json())

    def test_a_blank_required_name_is_rejected(self):
        response = self.post(**self.corrected(lastName=''))

        self.assertEqual(response.status_code, 400)
        self.assertIn('lastName', response.json())

    def test_errors_are_keyed_by_the_field_the_client_sent(self):
        # So the app can put the message under the input that needs fixing
        # rather than only in a banner.
        response = self.post(**self.corrected(firstName='###', registrationNumber='abc'))

        errors = response.json()
        self.assertEqual(response.status_code, 400)
        self.assertIn('firstName', errors)
        self.assertIn('registrationNumber', errors)

    # --- nothing else changes -------------------------------------------

    def test_sending_only_an_email_still_works(self):
        # The original contract: older clients and the email-only path are
        # unaffected by the new optional fields.
        response = self.post()

        self.assertEqual(response.status_code, 200, response.content)
        self.session.refresh_from_db()
        self.assertEqual(self.session.email, 'malou@hospital.com')
        self.assertEqual(self.session.id_last_name, 'SITERAKAS', 'scan left untouched')

    def test_an_unknown_session_is_still_a_404(self):
        response = self.client.post(
            '/api/auth/registration-email/',
            {'registrationSessionId': str(uuid.uuid4()), 'email': 'x@hospital.com'},
            format='json',
        )
        self.assertEqual(response.status_code, 404)


class CorrectedFieldsReachTheAccountTests(APITestCase):
    """The whole point: the created account carries the corrected values."""

    def setUp(self):
        cache.clear()
        self.session = make_session()

    def test_signup_stores_the_corrected_name_and_licence(self):
        # Step 2: the nurse fixes the surname the scanner got wrong.
        self.client.post(
            '/api/auth/registration-email/',
            {
                'registrationSessionId': str(self.session.session_id),
                'email': 'malou@hospital.com',
                'lastName': 'CORTEZ',
                'firstName': 'MALOU',
                'middleName': 'KELEMEN',
                'registrationNumber': '2223332',
                'registrationDate': '2025-12-04',
                'validUntil': '2029-06-29',
            },
            format='json',
        )

        # Step 3: face verification passes.
        RegistrationSession.objects.filter(pk=self.session.pk).update(face_verified=True)

        # Step 5: the account is created from the reviewed values.
        response = self.client.post(
            '/api/auth/signup/',
            {
                'email': 'malou@hospital.com',
                'password': 'Str0ng-Pass-9012',
                'firstName': 'MALOU',
                'middleName': 'KELEMEN',
                'lastName': 'CORTEZ',
                'name': 'MALOU KELEMEN CORTEZ',
                'role': 'staff_nurse',
                'licenseNumber': '2223332',
                'registrationSessionId': str(self.session.session_id),
            },
            format='json',
        )
        self.assertEqual(response.status_code, 201, response.content)

        user = User.objects.get(username='malou@hospital.com')
        self.assertEqual(user.last_name, 'CORTEZ', 'the corrected surname must reach the account')
        self.assertEqual(user.first_name, 'MALOU')

        profile = NurseProfile.objects.get(user=user)
        self.assertEqual(profile.middle_name, 'KELEMEN')
        self.assertEqual(profile.license_number, '2223332')
        # Licence expiry comes from the scanned card date (dates are not correctable).
        self.assertEqual(profile.prc_license_expiry, '06/29/2029')
