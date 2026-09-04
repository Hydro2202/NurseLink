"""
A pending or rejected nurse must not reach hospital records, and must be
told why in plain language — not just handed a generic "invalid credentials"
or a token that then silently fails on every subsequent call.

Signup itself already creates accounts as 'pending' (SignupSerializer); these
tests pin the two enforcement points on top of that: LoginView refuses to
issue a token at all, and IsApprovedNurse refuses access even if a token
already exists (e.g. approved, then later suspended).
"""

import datetime

from django.contrib.auth.models import User
from django.core.cache import cache
from rest_framework.authtoken.models import Token
from rest_framework.test import APITestCase

from .models import NurseProfile, Patient


def make_profile(email, first, last, *, role='staff_nurse', approval_status='approved',
                  is_active_staff=True, rejection_reason=''):
    user = User.objects.create_user(
        username=email, email=email, password='pw-test-1234',
        first_name=first, last_name=last,
    )
    NurseProfile.objects.create(
        user=user, role=role, department='Med-Surg',
        approval_status=approval_status, is_active_staff=is_active_staff,
        rejection_reason=rejection_reason,
    )
    return user


class LoginApprovalGateTests(APITestCase):
    def setUp(self):
        cache.clear()

    def test_approved_nurse_can_log_in(self):
        make_profile('approved@hospital.com', 'Ana', 'Cruz')
        response = self.client.post('/api/auth/login/', {
            'email': 'approved@hospital.com', 'password': 'pw-test-1234',
        })
        self.assertEqual(response.status_code, 200)
        self.assertIn('token', response.data)

    def test_pending_nurse_is_refused_a_token(self):
        make_profile('pending@hospital.com', 'Ben', 'Diaz', approval_status='pending')
        response = self.client.post('/api/auth/login/', {
            'email': 'pending@hospital.com', 'password': 'pw-test-1234',
        })
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data['approvalStatus'], 'pending')
        self.assertNotIn('token', response.data)

    def test_rejected_nurse_sees_the_specific_reason(self):
        make_profile(
            'rejected@hospital.com', 'Cora', 'Reyes',
            approval_status='rejected', rejection_reason='Employee ID did not match hospital records.',
        )
        response = self.client.post('/api/auth/login/', {
            'email': 'rejected@hospital.com', 'password': 'pw-test-1234',
        })
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data['detail'], 'Employee ID did not match hospital records.')

    def test_deactivated_nurse_is_refused_regardless_of_approval_status(self):
        make_profile('suspended@hospital.com', 'Dex', 'Uy', is_active_staff=False)
        response = self.client.post('/api/auth/login/', {
            'email': 'suspended@hospital.com', 'password': 'pw-test-1234',
        })
        self.assertEqual(response.status_code, 403)

    def test_oauth_token_endpoint_enforces_the_same_gate(self):
        make_profile('pending2@hospital.com', 'Eli', 'Fox', approval_status='pending')
        response = self.client.post('/api/auth/token/', {
            'username': 'pending2@hospital.com', 'password': 'pw-test-1234',
        })
        self.assertEqual(response.status_code, 403)
        self.assertNotIn('access_token', response.data)


class ApprovedNurseApiPermissionTests(APITestCase):
    """
    A token that already exists (issued while approved) must stop working
    the moment the account is no longer approved — covers the case Login
    can't: someone approved, then later rejected or deactivated.
    """

    def setUp(self):
        cache.clear()
        Patient.objects.create(
            patient_code='P900', name='Juan Dela Cruz', age=61, gender='Male',
            room='204-B', diagnosis='CHF', admission_date=datetime.date(2026, 3, 2),
            risk_level='medium', attending_physician='Dr. Lim',
        )

    def test_pending_nurse_with_a_token_still_cannot_reach_patients(self):
        user = make_profile('stillpending@hospital.com', 'Gia', 'Lim', approval_status='pending')
        Token.objects.get_or_create(user=user)
        self.client.force_authenticate(user=user)

        response = self.client.get('/api/patients/')
        self.assertEqual(response.status_code, 403)

    def test_approved_nurse_reaches_patients(self):
        user = make_profile('activeforreal@hospital.com', 'Hal', 'Ong')
        self.client.force_authenticate(user=user)

        response = self.client.get('/api/patients/')
        self.assertEqual(response.status_code, 200)

    def test_me_endpoint_still_works_while_pending(self):
        # The pending-approval screen needs this to show real status —
        # it must not be gated the same way protected records are.
        user = make_profile('checkmyownstatus@hospital.com', 'Ivy', 'Reyes', approval_status='pending')
        self.client.force_authenticate(user=user)

        response = self.client.get('/api/auth/me/')
        self.assertEqual(response.status_code, 200)
