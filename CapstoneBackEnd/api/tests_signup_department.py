"""
A new account starts with no department or shift — a supervisor assigns the
real ones via PATCH /api/nurses/{id}/assign/ (see tests_nurse_assignment.py).
Signup used to silently default department to a made-up value
("Medical-Surgical Unit" for a nurse, "Nursing Administration" for a
supervisor) and shift to 'morning' (NurseProfile's model default), both of
which looked like a real assignment nobody had actually made.
"""

import datetime
import uuid

from django.core.cache import cache
from rest_framework.test import APITestCase

from .models import NurseProfile, RegistrationSession


def make_session(**extra):
    """A session as it stands after a successful scan on Step 1."""
    fields = dict(
        session_id=uuid.uuid4(),
        face_verified=True,
        id_verification_status='verified', id_portrait='data:image/jpeg;base64,PORTRAIT',
        verification_method='face',
        id_last_name='CRUZ',
        id_first_name='ANA',
        id_middle_name='',
        id_registration_no='1234567',
        id_registration_date=datetime.date(2025, 1, 1),
        id_valid_until=datetime.date(2029, 1, 1),
    )
    fields.update(extra)
    return RegistrationSession.objects.create(**fields)


class SignupDepartmentTests(APITestCase):
    def setUp(self):
        cache.clear()

    def _signup(self, **overrides):
        session = make_session()
        payload = {
            'email': 'newnurse@hospital.com',
            'password': 'Str0ng-Pass-9012',
            'firstName': 'Ana',
            'lastName': 'Cruz',
            'role': 'staff_nurse',
            'licenseNumber': '1234567',
            'registrationSessionId': str(session.session_id),
        }
        payload.update(overrides)
        return self.client.post('/api/auth/signup/', payload, format='json')

    def test_new_nurse_account_starts_with_no_department(self):
        response = self._signup()
        self.assertEqual(response.status_code, 201, response.content)
        profile = NurseProfile.objects.get(user__email='newnurse@hospital.com')
        self.assertEqual(profile.department, '')

    def test_new_supervisor_account_starts_with_no_department(self):
        response = self._signup(email='newsup@hospital.com', role='head_nurse')
        self.assertEqual(response.status_code, 201, response.content)
        profile = NurseProfile.objects.get(user__email='newsup@hospital.com')
        self.assertEqual(profile.department, '')

    def test_an_explicitly_supplied_department_is_still_respected(self):
        response = self._signup(department='ICU')
        self.assertEqual(response.status_code, 201, response.content)
        profile = NurseProfile.objects.get(user__email='newnurse@hospital.com')
        self.assertEqual(profile.department, 'ICU')

    def test_new_nurse_account_starts_with_no_shift(self):
        response = self._signup()
        self.assertEqual(response.status_code, 201, response.content)
        profile = NurseProfile.objects.get(user__email='newnurse@hospital.com')
        self.assertEqual(profile.shift, '')

    def test_me_endpoint_reports_no_shift_for_a_fresh_account(self):
        # This is what the dashboard actually reads — it must not fall back
        # to 'morning' either. A signup-created account starts 'pending' and
        # can't log in yet, so force_authenticate stands in for that (same
        # pattern as tests_nurse_assignment.py) rather than going through
        # the approval-gated login flow.
        self._signup()
        profile = NurseProfile.objects.get(user__email='newnurse@hospital.com')
        profile.approval_status = 'approved'
        profile.save()
        user = profile.user
        self.client.force_authenticate(user=user)
        response = self.client.get('/api/auth/me/')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.data['shift'], '')
