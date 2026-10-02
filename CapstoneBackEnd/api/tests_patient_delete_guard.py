"""
Deleting a patient.

A staff nurse can admit through the Kardex, so they keep a way to undo a
mistaken entry: they may delete their own patient while no care is on file.
Once there is clinical history (charting, vitals, referrals, medication
records, completed tasks, past visits) deleting would destroy a medical record,
so only a head nurse may do it.
"""

import datetime

from django.contrib.auth.models import User
from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from .models import (
    ChartingNote, Department, HandoverNote, KardexMedication, MedicationIntake, NurseProfile,
    Patient, PatientVisit, Task, VitalSigns,
)


def make_nurse(email, first, role='staff_nurse'):
    user = User.objects.create_user(
        username=email, email=email, password='pw-test-1234', first_name=first, last_name='Nurse',
    )
    NurseProfile.objects.create(
        user=user, role=role, department='ICU', approval_status='approved', is_active_staff=True,
    )
    return user


class PatientDeleteGuardTests(TestCase):
    def setUp(self):
        cache.clear()
        self.nurse = make_nurse('nurse@hospital.com', 'Ana')
        self.other = make_nurse('other@hospital.com', 'Ben')
        self.head = make_nurse('head@hospital.com', 'Cara', role='head_nurse')
        self.dept = Department.objects.get_or_create(name='Delete Guard Ward')[0]
        self.patient = Patient.objects.create(
            patient_code='P-DG1', name='Juan Dela Cruz', age=61, gender='Male', room='204-B',
            diagnosis='CHF', admission_date=timezone.localdate(), risk_level='medium',
            attending_physician='Dr. Lim', department=self.dept, assigned_nurse=self.nurse,
        )
        # Every admission opens a visit; that alone is not recorded care.
        PatientVisit.objects.create(patient=self.patient, admission_date=self.patient.admission_date)
        self.url = f'/api/patients/{self.patient.patient_code}/'

    def delete_as(self, user):
        client = APIClient()
        client.force_authenticate(user)
        return client.delete(self.url)

    def assert_blocked(self, label):
        res = self.delete_as(self.nurse)
        self.assertEqual(res.status_code, 403, res.content)
        self.assertIn(label, res.data['recordedCare'])
        self.assertTrue(Patient.objects.filter(pk=self.patient.pk).exists())

    def test_nurse_can_delete_mistaken_entry_with_no_care(self):
        res = self.delete_as(self.nurse)
        self.assertEqual(res.status_code, 204, res.content)
        self.assertFalse(Patient.objects.filter(pk=self.patient.pk).exists())

    def test_nurse_cannot_delete_someone_elses_patient(self):
        res = self.delete_as(self.other)
        self.assertEqual(res.status_code, 403)

    def test_blocked_by_charting_note(self):
        ChartingNote.objects.create(
            note_code='N-DG1', patient=self.patient, nurse=self.other,
            timestamp=timezone.now(), note_type='progress', content='Assessed.',
        )
        self.assert_blocked('charting notes')

    def test_blocked_by_vital_signs(self):
        VitalSigns.objects.create(patient=self.patient, heart_rate=80, recorded_by=self.nurse)
        self.assert_blocked('vital signs')

    def test_blocked_by_referral(self):
        HandoverNote.objects.create(
            handover_code='H-DG1', patient=self.patient, patient_name=self.patient.name,
            shift='morning', date=timezone.localdate(), nurse_from='Ana Nurse', nurse_to='Ben Nurse',
            nurse_to_user=self.other, status='sent', created_by=self.nurse,
        )
        self.assert_blocked('referrals')

    def test_blocked_by_medication_record(self):
        med = KardexMedication.objects.create(
            patient=self.patient, medication_name='Furosemide', dose='40mg', route='Oral', frequency='OD',
            start_date=timezone.localdate(),
        )
        MedicationIntake.objects.create(
            medication=med, scheduled_time=timezone.now(), administered_at=timezone.now(),
            administered_by=self.nurse,
        )
        self.assert_blocked('medication records')

    def test_blocked_by_completed_task(self):
        Task.objects.create(
            task_code='T-DG1', patient=self.patient, title='Check IV', assigned_to='Ana Nurse',
            assigned_nurse=self.nurse, status='completed',
        )
        self.assert_blocked('completed tasks')

    def test_pending_task_does_not_block(self):
        Task.objects.create(
            task_code='T-DG2', patient=self.patient, title='Check IV', assigned_to='Ana Nurse',
            assigned_nurse=self.nurse, status='pending',
        )
        self.assertEqual(self.delete_as(self.nurse).status_code, 204)

    def test_blocked_by_past_visit(self):
        PatientVisit.objects.create(
            patient=self.patient, admission_date=datetime.date(2025, 1, 1),
            discharge_date=timezone.now() - datetime.timedelta(days=200),
        )
        self.assert_blocked('past visits')

    def test_head_nurse_can_delete_patient_with_care_on_file(self):
        ChartingNote.objects.create(
            note_code='N-DG2', patient=self.patient, nurse=self.nurse,
            timestamp=timezone.now(), note_type='progress', content='Assessed.',
        )
        res = self.delete_as(self.head)
        self.assertEqual(res.status_code, 204, res.content)
        self.assertFalse(Patient.objects.filter(pk=self.patient.pk).exists())
