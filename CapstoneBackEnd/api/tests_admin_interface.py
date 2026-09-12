"""
The in-app admin interface, backed by real Django is_staff — not an email
pattern. See permissions.IsAdmin for why: a nurse can type anything into the
signup form's email field, so "looks like an admin address" can never be the
actual security check, only a naming convention for readability.
"""

import datetime

from django.contrib.auth.models import User
from django.core.cache import cache
from rest_framework.authtoken.models import Token
from rest_framework.test import APITestCase

from .models import NurseProfile, Notification


def make_nurse(email, first, last, *, role='staff_nurse', approval_status='pending'):
    user = User.objects.create_user(
        username=email, email=email, password='pw-test-1234',
        first_name=first, last_name=last,
    )
    NurseProfile.objects.create(user=user, role=role, department='Med-Surg', approval_status=approval_status)
    return user


def make_admin(email='admin@admin.com'):
    return User.objects.create_user(
        username=email, email=email, password='pw-admin-1234', is_staff=True,
    )


class AdminLoginTests(APITestCase):
    def setUp(self):
        cache.clear()

    def test_admin_can_log_in_selecting_either_role_button(self):
        make_admin('raiden@admin.com')
        for role in ('staff_nurse', 'head_nurse'):
            response = self.client.post('/api/auth/login/', {
                'email': 'raiden@admin.com', 'password': 'pw-admin-1234', 'role': role,
            })
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.data['user']['role'], 'admin')
            self.assertTrue(response.data['user']['isAdmin'])

    def test_admin_email_alone_grants_nothing(self):
        # Signing up through the ordinary flow with an @admin.com email must
        # not grant admin access — only a real is_staff flag does.
        user = User.objects.create_user(
            username='faker@admin.com', email='faker@admin.com', password='pw-test-1234',
        )
        NurseProfile.objects.create(user=user, role='staff_nurse', approval_status='approved')
        self.client.force_authenticate(user=user)

        response = self.client.get('/api/admin/users/')
        self.assertEqual(response.status_code, 403)


class AdminUserManagementTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.admin = make_admin()
        self.pending_nurse = make_nurse('pending@hospital.com', 'Ben', 'Diaz')
        self.approved_supervisor = make_nurse(
            'sup@hospital.com', 'Maria', 'Santos', role='head_nurse', approval_status='approved',
        )
        self.client.force_authenticate(user=self.admin)

    def test_non_admin_cannot_reach_admin_endpoints(self):
        self.client.force_authenticate(user=self.pending_nurse)
        response = self.client.get('/api/admin/users/')
        self.assertEqual(response.status_code, 403)

    def test_admin_lists_every_account_regardless_of_status(self):
        response = self.client.get('/api/admin/users/')
        self.assertEqual(response.status_code, 200)
        emails = {row['email'] for row in response.data}
        self.assertIn('pending@hospital.com', emails)
        self.assertIn('sup@hospital.com', emails)

    def test_admin_never_sees_other_admin_accounts(self):
        make_admin('other@admin.com')
        response = self.client.get('/api/admin/users/')
        emails = {row['email'] for row in response.data}
        self.assertNotIn('admin@admin.com', emails)
        self.assertNotIn('other@admin.com', emails)

    def test_status_filter(self):
        response = self.client.get('/api/admin/users/?status=pending')
        emails = {row['email'] for row in response.data}
        self.assertIn('pending@hospital.com', emails)
        self.assertNotIn('sup@hospital.com', emails)

    def test_approve_flips_status_and_notifies(self):
        response = self.client.post(f'/api/admin/users/{self.pending_nurse.pk}/approve/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['approvalStatus'], 'approved')

        login = self.client.post('/api/auth/login/', {
            'email': 'pending@hospital.com', 'password': 'pw-test-1234',
        })
        self.assertEqual(login.status_code, 200)
        self.assertTrue(Notification.objects.filter(recipient=self.pending_nurse).exists())

    def test_reject_requires_a_reason(self):
        response = self.client.post(f'/api/admin/users/{self.pending_nurse.pk}/reject/', {'reason': ''})
        self.assertEqual(response.status_code, 400)

    def test_reject_with_reason_blocks_login(self):
        self.client.post(
            f'/api/admin/users/{self.pending_nurse.pk}/reject/', {'reason': 'Employee ID mismatch.'},
        )
        login = self.client.post('/api/auth/login/', {
            'email': 'pending@hospital.com', 'password': 'pw-test-1234',
        })
        self.assertEqual(login.status_code, 403)
        self.assertEqual(login.data['detail'], 'Employee ID mismatch.')

    def test_deactivate_then_reactivate(self):
        deactivate = self.client.post(f'/api/admin/users/{self.approved_supervisor.pk}/deactivate/')
        self.assertFalse(deactivate.data['isActiveStaff'])

        login_blocked = self.client.post('/api/auth/login/', {
            'email': 'sup@hospital.com', 'password': 'pw-test-1234',
        })
        self.assertEqual(login_blocked.status_code, 403)

        reactivate = self.client.post(f'/api/admin/users/{self.approved_supervisor.pk}/reactivate/')
        self.assertTrue(reactivate.data['isActiveStaff'])

        login_ok = self.client.post('/api/auth/login/', {
            'email': 'sup@hospital.com', 'password': 'pw-test-1234',
        })
        self.assertEqual(login_ok.status_code, 200)

    def test_set_password_rejects_short_password(self):
        response = self.client.post(
            f'/api/admin/users/{self.pending_nurse.pk}/set-password/', {'password': 'short'},
        )
        self.assertEqual(response.status_code, 400)

    def test_set_password_lets_the_nurse_log_in_with_it(self):
        Token.objects.create(user=self.pending_nurse)
        response = self.client.post(
            f'/api/admin/users/{self.pending_nurse.pk}/set-password/', {'password': 'brand-new-pass-1'},
        )
        self.assertEqual(response.status_code, 200)
        # Old token revoked by the reset.
        self.assertFalse(Token.objects.filter(user=self.pending_nurse).exists())

        self.pending_nurse.nurse_profile.approval_status = 'approved'
        self.pending_nurse.nurse_profile.save()
        login = self.client.post('/api/auth/login/', {
            'email': 'pending@hospital.com', 'password': 'brand-new-pass-1',
        })
        self.assertEqual(login.status_code, 200)
