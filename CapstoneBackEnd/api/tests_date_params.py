"""
Malformed or impossible dates in query parameters must return 400, never 500.

Well-formed dates still work (200), and an empty value means "no filter".
"""

from django.contrib.auth.models import User
from django.test import TestCase
from django.test import override_settings
from rest_framework.test import APIClient

from .models import NurseProfile

BAD_DATES = ['2026-99-99', '2026-13-01', '2026-02-30', 'not-a-date', '2026/10/07', '10-07-2026']
GOOD_DATE = '2026-10-07'


def make_user(email, *, role='head_nurse'):
    user = User.objects.create_user(username=email, email=email, password='pw-test-1234',
                                    first_name='Test', last_name=email.split('@')[0])
    NurseProfile.objects.create(user=user, role=role, department='ICU',
                                approval_status='approved', is_active_staff=True)
    return user


@override_settings(SIGNUP_ID_FACE_VERIFICATION=True)
class DateParamValidationTests(TestCase):
    def setUp(self):
        # raise_request_exception=False: a server error comes back as a 500
        # response instead of being re-raised into the test.
        self.client = APIClient(raise_request_exception=False)
        self.client.force_authenticate(make_user('head@hospital.com'))

    def assert_bad_date_is_400(self, url, param):
        for bad in BAD_DATES:
            with self.subTest(url=url, param=param, value=bad):
                res = self.client.get(url, {param: bad})
                self.assertEqual(res.status_code, 400, f'{url}?{param}={bad} -> {res.status_code}')
                self.assertIn('date', str(res.data).lower())

    def assert_good_date_is_accepted(self, url, param):
        res = self.client.get(url, {param: GOOD_DATE})
        self.assertEqual(res.status_code, 200, f'{url}?{param}={GOOD_DATE} -> {res.status_code}')

    # --- charting notes -------------------------------------------------------

    def test_charting_date_malformed_is_400(self):
        self.assert_bad_date_is_400('/api/charting/', 'date')

    def test_charting_date_well_formed_is_200(self):
        self.assert_good_date_is_accepted('/api/charting/', 'date')

    def test_charting_empty_date_means_no_filter(self):
        res = self.client.get('/api/charting/', {'date': ''})
        self.assertEqual(res.status_code, 200)

    # --- duty roster ----------------------------------------------------------

    def test_duty_assignments_date_malformed_is_400(self):
        self.assert_bad_date_is_400('/api/duty-assignments/', 'date')

    def test_duty_assignments_date_from_malformed_is_400(self):
        self.assert_bad_date_is_400('/api/duty-assignments/', 'dateFrom')

    def test_duty_assignments_date_to_malformed_is_400(self):
        self.assert_bad_date_is_400('/api/duty-assignments/', 'dateTo')

    def test_duty_assignments_date_well_formed_is_200(self):
        self.assert_good_date_is_accepted('/api/duty-assignments/', 'date')

    # --- handover eligibility -------------------------------------------------

    def test_handover_eligible_recipients_date_malformed_is_400(self):
        self.assert_bad_date_is_400('/api/task-handovers/eligible_recipients/', 'date')

    # --- nurses list filtered by shift ---------------------------------------

    def test_nurses_shift_filter_date_malformed_is_400(self):
        url = '/api/nurses/'
        for bad in BAD_DATES:
            with self.subTest(value=bad):
                res = self.client.get(url, {'shift': 'day', 'date': bad})
                self.assertEqual(res.status_code, 400, f'{url}?shift=day&date={bad} -> {res.status_code}')


@override_settings(SIGNUP_ID_FACE_VERIFICATION=True)
class IdReviewDateTests(TestCase):
    """Step 2 (ID review) takes dates from the applicant; bad ones are 400, never 500."""

    URL = '/api/auth/registration-email/'

    def setUp(self):
        self.client = APIClient(raise_request_exception=False)
        import datetime
        from .models import RegistrationSession
        # A scanned card: licence and dates in the body must match it (policy).
        self.session = RegistrationSession.objects.create(
            email='', id_verification_status='verified', id_portrait='data:image/jpeg;base64,PORTRAIT',
            id_first_name='RAIDEN', id_last_name='VILLAPANDO', id_registration_no='0987654',
            id_registration_date=datetime.date(2025, 12, 27), id_valid_until=datetime.date(2029, 6, 29),
        )

    def body(self, **overrides):
        fields = {
            'registrationSessionId': str(self.session.session_id),
            'email': 'nurse.dates@gmail.com',
            'lastName': 'VILLAPANDO', 'firstName': 'RAIDEN', 'middleName': '',
            'registrationNumber': '0987654',
            'registrationDate': '2025-12-27', 'validUntil': '2029-06-29',
        }
        fields.update(overrides)
        return fields

    def test_impossible_registration_date_is_400(self):
        res = self.client.post(self.URL, self.body(registrationDate='2026-02-30'), format='json')
        self.assertEqual(res.status_code, 400, res.content)

    def test_malformed_valid_until_is_400(self):
        res = self.client.post(self.URL, self.body(validUntil='2029-99-99'), format='json')
        self.assertEqual(res.status_code, 400, res.content)

    def test_well_formed_dates_are_accepted(self):
        res = self.client.post(self.URL, self.body(), format='json')
        self.assertEqual(res.status_code, 200, res.content)
