"""
A ward with two same-named patients is exactly the wrong-patient risk this
system exists to prevent — Patient.patient_code is the real identifier, but
nothing stopped a second "Juan Dela Cruz" from being created silently.

These tests pin the guard on both places a new Patient actually gets
created: PatientViewSet directly, and KardexRecordSerializer's implicit
"no patientId means register a new patient" path (the one nurses actually
use, per Save Kardex). Matched on name + age since Patient has no
date-of-birth field.
"""

import datetime

from django.contrib.auth.models import User
from django.core.cache import cache
from rest_framework.test import APITestCase

from .models import NurseProfile, Patient


def make_user(email, first, last, role='staff_nurse'):
    user = User.objects.create_user(
        username=email, email=email, password='pw-test-1234',
        first_name=first, last_name=last,
    )
    NurseProfile.objects.create(user=user, role=role, department='Med-Surg')
    return user


class DuplicatePatientTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.nurse = make_user('nurse@hospital.com', 'Ben', 'Diaz')
        self.supervisor = make_user('sup@hospital.com', 'Maria', 'Santos', role='head_nurse')
        self.existing = Patient.objects.create(
            patient_code='P600', name='Juan Dela Cruz', age=61, gender='Male',
            room='204-B', diagnosis='CHF', admission_date=datetime.date(2026, 3, 2),
            risk_level='medium', attending_physician='Dr. Lim',
        )
        self.client.force_authenticate(user=self.nurse)

    def test_patient_endpoint_flags_a_same_name_same_age_match(self):
        # PatientViewSet.create is supervisor-only.
        self.client.force_authenticate(user=self.supervisor)
        response = self.client.post('/api/patients/', {
            'name': 'Juan Dela Cruz', 'age': 61, 'gender': 'Male', 'room': '410-A',
            'diagnosis': 'Pneumonia', 'admissionDate': '2026-03-05', 'riskLevel': 'low',
        })
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data['possibleDuplicates'][0]['patientId'], 'P600')
        self.assertEqual(Patient.objects.filter(name__iexact='Juan Dela Cruz').count(), 1)

    def test_patient_endpoint_lets_a_confirmed_duplicate_through(self):
        self.client.force_authenticate(user=self.supervisor)
        response = self.client.post('/api/patients/', {
            'name': 'Juan Dela Cruz', 'age': 61, 'gender': 'Male', 'room': '410-A',
            'diagnosis': 'Pneumonia', 'admissionDate': '2026-03-05', 'riskLevel': 'low',
            'confirmDuplicate': True,
        })
        self.assertEqual(response.status_code, 201)
        self.assertEqual(Patient.objects.filter(name__iexact='Juan Dela Cruz').count(), 2)

    def test_different_age_is_not_flagged(self):
        self.client.force_authenticate(user=self.supervisor)
        response = self.client.post('/api/patients/', {
            'name': 'Juan Dela Cruz', 'age': 34, 'gender': 'Male', 'room': '410-A',
            'diagnosis': 'Pneumonia', 'admissionDate': '2026-03-05', 'riskLevel': 'low',
        })
        self.assertEqual(response.status_code, 201)

    def test_kardex_registering_a_new_patient_is_flagged(self):
        response = self.client.post('/api/kardex/', {
            'lastName': 'Dela Cruz', 'firstName': 'Juan', 'age': '61',
            'gender': 'Male', 'room': '410-A',
        })
        self.assertEqual(response.status_code, 400)
        self.assertIn('possibleDuplicates', response.data)
        self.assertEqual(Patient.objects.filter(name__iexact='Juan Dela Cruz').count(), 1)

    def test_kardex_updating_an_existing_patient_is_never_flagged(self):
        # patientId means this is an update, not a registration — the
        # existing patient is *supposed* to match itself.
        response = self.client.post('/api/kardex/', {
            'lastName': 'Dela Cruz', 'firstName': 'Juan', 'age': '61',
            'gender': 'Male', 'room': '204-B', 'patientId': 'P600',
        })
        self.assertEqual(response.status_code, 201)
        self.assertEqual(Patient.objects.filter(name__iexact='Juan Dela Cruz').count(), 1)

    def test_kardex_confirmed_duplicate_creates_a_second_patient(self):
        response = self.client.post('/api/kardex/', {
            'lastName': 'Dela Cruz', 'firstName': 'Juan', 'age': '61',
            'gender': 'Male', 'room': '410-A', 'confirmDuplicate': True,
        })
        self.assertEqual(response.status_code, 201)
        self.assertEqual(Patient.objects.filter(name__iexact='Juan Dela Cruz').count(), 2)
