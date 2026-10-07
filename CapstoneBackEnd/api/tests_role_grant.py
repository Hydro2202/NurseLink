"""
Head nurse can never be self-selected. Signup creates a staff nurse; the
applicant's wish is stored only as requested_role; only an admin, through
AdminUserViewSet.grant_role, changes NurseProfile.role — and that change is
recorded (who and when). Profile-update endpoints never accept a role.
"""

import datetime
import uuid
from io import StringIO

from django.contrib.auth.models import User
from django.core.cache import cache
from django.core.management import call_command
from rest_framework.test import APITestCase

from .models import NurseProfile, RegistrationSession


def make_session():
    return RegistrationSession.objects.create(
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


def make_admin():
    return User.objects.create_user(username='admin@hospital.com', email='admin@hospital.com',
                                    password='pw-admin-1234', is_staff=True)


def make_nurse(email='nurse@hospital.com', role='staff_nurse'):
    user = User.objects.create_user(username=email, email=email, password='pw-test-1234',
                                    first_name='Ana', last_name='Cruz')
    NurseProfile.objects.create(user=user, role=role, department='ICU',
                                approval_status='approved', is_active_staff=True)
    return user


class SignupRoleTests(APITestCase):
    def setUp(self):
        cache.clear()

    def _signup(self, **overrides):
        payload = {
            'email': 'applicant@hospital.com',
            'password': 'Str0ng-Pass-9012',
            'firstName': 'Ana',
            'lastName': 'Cruz',
            'licenseNumber': '1234567',
            'registrationSessionId': str(make_session().session_id),
        }
        payload.update(overrides)
        return self.client.post('/api/auth/signup/', payload, format='json')

    def test_registering_with_role_head_nurse_creates_a_regular_nurse_account(self):
        response = self._signup(role='head_nurse')
        self.assertEqual(response.status_code, 201, response.content)
        profile = NurseProfile.objects.get(user__email='applicant@hospital.com')
        self.assertEqual(profile.role, 'staff_nurse')
        self.assertEqual(profile.requested_role, '')
        self.assertIsNone(profile.role_granted_by)

    def test_requested_head_nurse_is_stored_but_grants_nothing(self):
        response = self._signup(requestedRole='head_nurse')
        self.assertEqual(response.status_code, 201, response.content)
        profile = NurseProfile.objects.get(user__email='applicant@hospital.com')
        self.assertEqual(profile.requested_role, 'head_nurse')
        self.assertEqual(profile.role, 'staff_nurse')
        self.assertIsNone(profile.role_granted_at)


class RoleGrantTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.admin = make_admin()
        self.nurse = make_nurse()
        self.target = make_nurse('other@hospital.com')

    def test_non_admin_cannot_promote_anyone_including_themselves(self):
        self.client.force_authenticate(self.nurse)
        url = f'/api/admin/users/{self.nurse.pk}/grant-role/'
        self.assertEqual(self.client.post(url, {'role': 'head_nurse'}, format='json').status_code, 403)

        url = f'/api/admin/users/{self.target.pk}/grant-role/'
        self.assertEqual(self.client.post(url, {'role': 'head_nurse'}, format='json').status_code, 403)

        self.assertEqual(NurseProfile.objects.get(user=self.nurse).role, 'staff_nurse')
        self.assertEqual(NurseProfile.objects.get(user=self.target).role, 'staff_nurse')

    def test_admin_grants_head_nurse_and_the_grant_is_recorded(self):
        self.client.force_authenticate(self.admin)
        url = f'/api/admin/users/{self.target.pk}/grant-role/'
        response = self.client.post(url, {'role': 'head_nurse'}, format='json')
        self.assertEqual(response.status_code, 200, response.content)

        profile = NurseProfile.objects.get(user=self.target)
        self.assertEqual(profile.role, 'head_nurse')
        self.assertEqual(profile.role_granted_by, self.admin)
        self.assertIsNotNone(profile.role_granted_at)

    def test_admin_grant_rejects_unknown_roles(self):
        self.client.force_authenticate(self.admin)
        url = f'/api/admin/users/{self.target.pk}/grant-role/'
        response = self.client.post(url, {'role': 'admin'}, format='json')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(NurseProfile.objects.get(user=self.target).role, 'staff_nurse')

    def test_profile_update_endpoint_ignores_role_changes(self):
        self.client.force_authenticate(self.nurse)
        response = self.client.patch('/api/auth/me/', {'role': 'head_nurse', 'specialization': 'ICU'},
                                     format='json')
        self.assertEqual(response.status_code, 200, response.content)
        profile = NurseProfile.objects.get(user=self.nurse)
        self.assertEqual(profile.role, 'staff_nurse')

    def test_nurse_assign_endpoint_ignores_role_changes(self):
        self.client.force_authenticate(self.nurse)
        self.client.patch(f'/api/nurses/{self.nurse.pk}/assign/', {'role': 'head_nurse'},
                          format='json')
        self.assertEqual(NurseProfile.objects.get(user=self.nurse).role, 'staff_nurse')


class UnreviewedHeadNurseListTests(APITestCase):
    def test_lists_head_nurses_without_a_grant_and_changes_nothing(self):
        make_nurse('ungranted@hospital.com', role='head_nurse')
        out = StringIO()
        call_command('list_unreviewed_head_nurses', stdout=out)
        self.assertIn('ungranted@hospital.com', out.getvalue())
        self.assertEqual(NurseProfile.objects.get(user__email='ungranted@hospital.com').role,
                         'head_nurse')
