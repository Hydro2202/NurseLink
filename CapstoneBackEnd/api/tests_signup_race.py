"""
Two sign-ups for the exact same email at the exact same instant (e.g. a
double-tap, or two browser tabs) can both pass the serializer's own
"does this email exist" check before either has committed a row. The second
create_user() then hits the database's real unique constraint on
username/email. SignupV2RegisterView must turn that into the same clean
"email already exists" response as the ordinary (non-race) duplicate case,
not let it escape as an unhandled 500.
"""

from unittest.mock import patch

from django.contrib.auth.models import User
from rest_framework.test import APITestCase

from .models import RegistrationSession
from .serializers import SignupV2RegisterSerializer

PASSWORD = 'Str0ng!Passw0rd'
EMAIL = 'racer@hospital.com'


class SignupRaceConditionTests(APITestCase):
    def test_duplicate_email_that_slips_past_the_precheck_gets_a_clean_400_not_a_500(self):
        # A user with this email already exists (as if a concurrent request
        # created it a moment ago), but we force validate_personalEmail to
        # miss it -- reproducing the narrow window where both requests see
        # "no existing user" before either commits.
        User.objects.create_user(username=EMAIL, email=EMAIL, password=PASSWORD)
        session = RegistrationSession.objects.create(
            email=EMAIL, otp_verified=True, verification_method='EMAIL_OTP',
        )

        with patch.object(
            SignupV2RegisterSerializer, 'validate_personalEmail',
            lambda self, value: value.strip().lower(),
        ):
            response = self.client.post('/api/auth/signup-v2/register/', {
                'lastName': 'Santos', 'firstName': 'Maria', 'middleName': '', 'role': 'staff_nurse',
                'personalEmail': EMAIL, 'phone': '09171234567', 'password': PASSWORD,
                'confirmPassword': PASSWORD, 'registrationSessionId': str(session.session_id),
            }, format='json')

        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn('already exists', str(response.data))
        # Only the one pre-existing account -- the race did not create a
        # second, half-formed one.
        self.assertEqual(User.objects.filter(email=EMAIL).count(), 1)
        session.refresh_from_db()
        self.assertIsNone(session.user_id)
