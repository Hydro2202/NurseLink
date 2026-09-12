"""
The ward roster is shared.

A patient added by one nurse — typically through Kardex — has to be visible to
every other nurse, because handover, charting and cover shifts all depend on
seeing patients you are not personally assigned to. These tests pin that down,
along with the two things that keep a shared list readable: `?mine=true` still
narrows it to your own patients, and each row names both the assigned nurse and
whoever assigned them.
"""

import datetime

from django.contrib.auth.models import User
from django.core.cache import cache
from rest_framework.test import APITestCase

from .models import NurseProfile, Patient, PatientAssignment


def make_nurse(email, first, last, role='staff_nurse'):
    user = User.objects.create_user(
        username=email, email=email, password='pw-test-1234',
        first_name=first, last_name=last,
    )
    NurseProfile.objects.create(user=user, role=role, department='Med-Surg')
    return user


def make_patient(code, name, assigned_nurse, assigned_by):
    patient = Patient.objects.create(
        patient_code=code,
        name=name,
        age=40,
        gender='Male',
        room='201-A',
        diagnosis='Pneumonia',
        admission_date=datetime.date(2026, 1, 5),
        risk_level='low',
        assigned_nurse=assigned_nurse,
    )
    PatientAssignment.objects.create(
        patient=patient,
        assigned_nurse=assigned_nurse,
        assigned_nurse_name=assigned_nurse.get_full_name(),
        assigned_by=assigned_by,
        status='active',
    )
    return patient


class SharedPatientRosterTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.adder = make_nurse('adder@hospital.com', 'Ana', 'Cruz')
        self.other = make_nurse('other@hospital.com', 'Ben', 'Diaz')
        self.supervisor = make_nurse(
            'head@hospital.com', 'Cora', 'Reyes', role='head_nurse'
        )
        self.patient = make_patient('P900', 'Juan Dela Cruz', self.adder, self.adder)

    def rows(self, response):
        data = response.json()
        return data['results'] if isinstance(data, dict) and 'results' in data else data

    def test_patient_added_by_one_nurse_is_visible_to_another(self):
        self.client.force_authenticate(user=self.other)
        response = self.client.get('/api/patients/')
        self.assertEqual(response.status_code, 200)
        codes = [row['id'] for row in self.rows(response)]
        self.assertIn('P900', codes)

    def test_supervisor_sees_the_same_roster(self):
        self.client.force_authenticate(user=self.supervisor)
        codes = [row['id'] for row in self.rows(self.client.get('/api/patients/'))]
        self.assertIn('P900', codes)

    def test_mine_true_still_scopes_to_your_own_patients(self):
        make_patient('P901', 'Rosa Santos', self.other, self.supervisor)

        self.client.force_authenticate(user=self.adder)
        mine = [row['id'] for row in self.rows(self.client.get('/api/patients/?mine=true'))]
        self.assertEqual(mine, ['P900'])

        every = [row['id'] for row in self.rows(self.client.get('/api/patients/'))]
        self.assertCountEqual(every, ['P900', 'P901'])

    def test_rows_name_the_assigned_nurse_and_who_assigned_them(self):
        make_patient('P902', 'Mila Ramos', self.other, self.supervisor)

        self.client.force_authenticate(user=self.adder)
        rows = {row['id']: row for row in self.rows(self.client.get('/api/patients/'))}

        self.assertEqual(rows['P902']['assignedNurseName'], 'Ben Diaz')
        self.assertEqual(rows['P902']['assignedBy'], 'Cora Reyes')

        # Added via Kardex by the nurse who took the patient: both names match.
        self.assertEqual(rows['P900']['assignedNurseName'], 'Ana Cruz')
        self.assertEqual(rows['P900']['assignedBy'], 'Ana Cruz')

    def test_assigned_by_is_null_when_no_active_assignment_exists(self):
        PatientAssignment.objects.filter(patient=self.patient).update(status='completed')

        self.client.force_authenticate(user=self.other)
        rows = {row['id']: row for row in self.rows(self.client.get('/api/patients/'))}
        self.assertIsNone(rows['P900']['assignedBy'])
        self.assertEqual(rows['P900']['assignedNurseName'], 'Ana Cruz')
