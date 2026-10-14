"""
Signing up as Head Nurse: the choice is stored as requested_role, and the
admin approving the account applies it -- so the person can sign in as head
nurse. Previously approval left them a staff nurse.
"""

import importlib

from django.apps import apps as global_apps
from django.contrib.auth.models import User
from django.utils import timezone
from rest_framework.test import APITestCase

from .models import NurseProfile, RegistrationSession

PASSWORD = 'Str0ng!Passw0rd'


def register(client, email, role, first='Maria', last='Santos'):
    session = RegistrationSession.objects.create(
        email=email, otp_verified=True, verification_method='EMAIL_OTP',
    )
    return client.post('/api/auth/signup-v2/register/', {
        'lastName': last, 'firstName': first, 'middleName': '', 'role': role,
        'personalEmail': email, 'phone': '09171234567', 'password': PASSWORD,
        'confirmPassword': PASSWORD, 'registrationSessionId': str(session.session_id),
    }, format='json')


class HeadNurseSignupTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            username='admin@admin.com', email='admin@admin.com', password='pw-admin-1234', is_staff=True,
        )

    def login(self, email, role):
        return self.client.post('/api/auth/login/', {'email': email, 'password': PASSWORD, 'role': role}, format='json')

    def approve(self, email):
        user = User.objects.get(email=email)
        self.client.force_authenticate(self.admin)
        response = self.client.post(f'/api/admin/users/{user.pk}/approve/')
        self.client.force_authenticate(None)
        return response

    def test_head_nurse_signup_is_approved_as_head_nurse_and_can_log_in(self):
        self.assertEqual(register(self.client, 'head@hospital.com', 'head_nurse').status_code, 201)
        profile = NurseProfile.objects.get(user__email='head@hospital.com')
        # Signing up alone grants nothing.
        self.assertEqual(profile.role, 'staff_nurse')
        self.assertEqual(profile.requested_role, 'head_nurse')

        response = self.approve('head@hospital.com')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.data['role'], 'head_nurse')
        profile.refresh_from_db()
        self.assertEqual(profile.role, 'head_nurse')
        self.assertEqual(profile.role_granted_by, self.admin)
        self.assertIsNotNone(profile.role_granted_at)

        login = self.login('head@hospital.com', 'head_nurse')
        self.assertEqual(login.status_code, 200, login.content)
        self.assertEqual(login.data['user']['role'], 'head_nurse')

    def test_staff_nurse_signup_stays_staff_nurse(self):
        register(self.client, 'nurse@hospital.com', 'staff_nurse', first='Ana', last='Cruz')
        response = self.approve('nurse@hospital.com')
        self.assertEqual(response.data['role'], 'staff_nurse')
        self.assertEqual(self.login('nurse@hospital.com', 'staff_nurse').status_code, 200)

    def test_approve_does_not_undo_an_admin_role_choice(self):
        register(self.client, 'head@hospital.com', 'head_nurse')
        user = User.objects.get(email='head@hospital.com')
        self.client.force_authenticate(self.admin)
        # Admin deliberately keeps them a staff nurse before approving.
        self.client.post(f'/api/admin/users/{user.pk}/grant-role/', {'role': 'staff_nurse'}, format='json')
        response = self.client.post(f'/api/admin/users/{user.pk}/approve/')
        self.assertEqual(response.data['role'], 'staff_nurse')

    def test_admin_can_switch_role_both_ways_but_a_nurse_cannot(self):
        register(self.client, 'head@hospital.com', 'head_nurse')
        self.approve('head@hospital.com')
        user = User.objects.get(email='head@hospital.com')
        self.client.force_authenticate(self.admin)
        down = self.client.post(f'/api/admin/users/{user.pk}/grant-role/', {'role': 'staff_nurse'}, format='json')
        self.assertEqual(down.data['role'], 'staff_nurse')
        up = self.client.post(f'/api/admin/users/{user.pk}/grant-role/', {'role': 'head_nurse'}, format='json')
        self.assertEqual(up.data['role'], 'head_nurse')

        self.client.force_authenticate(User.objects.get(pk=user.pk))
        denied = self.client.post(f'/api/admin/users/{user.pk}/grant-role/', {'role': 'staff_nurse'}, format='json')
        self.assertEqual(denied.status_code, 403)

    def test_role_cannot_be_self_granted_at_signup(self):
        register(self.client, 'sneaky@hospital.com', 'head_nurse', first='Sne', last='Aky')
        self.assertEqual(NurseProfile.objects.get(user__email='sneaky@hospital.com').role, 'staff_nurse')
        # Not approved yet: cannot log in at all, as either role.
        self.assertNotEqual(self.login('sneaky@hospital.com', 'head_nurse').status_code, 200)


class PromoteAffectedAccountsMigrationTests(APITestCase):
    def make(self, email, **profile):
        user = User.objects.create_user(username=email, email=email, password='x')
        return NurseProfile.objects.create(user=user, **profile)

    def test_only_affected_accounts_are_promoted(self):
        affected = self.make('a@h.com', role='staff_nurse', requested_role='head_nurse', approval_status='approved')
        pending = self.make('b@h.com', role='staff_nurse', requested_role='head_nurse', approval_status='pending')
        admin_chose = self.make(
            'c@h.com', role='staff_nurse', requested_role='head_nurse', approval_status='approved',
            role_granted_at=timezone.now(),
        )
        nurse = self.make('d@h.com', role='staff_nurse', requested_role='staff_nurse', approval_status='approved')

        migration = importlib.import_module('api.migrations.0059_apply_requested_head_nurse_role')
        migration.promote(global_apps, None)

        roles = {p.user.email: NurseProfile.objects.get(pk=p.pk).role for p in (affected, pending, admin_chose, nurse)}
        self.assertEqual(roles, {
            'a@h.com': 'head_nurse', 'b@h.com': 'staff_nurse', 'c@h.com': 'staff_nurse', 'd@h.com': 'staff_nurse',
        })
