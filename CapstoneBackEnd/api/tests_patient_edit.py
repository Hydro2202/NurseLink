"""
Editing a patient record — the audit trail (Patient.edit_history, same
{editedBy, editedAt, changes} shape ChartingNote already uses) and the sync
back into a discharged patient's closed PatientVisit snapshot. See
PatientSerializer.update().
"""

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from .models import Department, NurseProfile, Patient, PatientVisit


def make_user(email, first, last, *, role='staff_nurse'):
    user = User.objects.create_user(
        username=email, email=email, password='pw-test-1234',
        first_name=first, last_name=last,
    )
    NurseProfile.objects.create(user=user, role=role, department='ICU', approval_status='approved', is_active_staff=True)
    return user


class PatientEditTestCase(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.supervisor = make_user('sup@hospital.com', 'Ana', 'Cruz', role='head_nurse')
        self.nurse = make_user('nurse@hospital.com', 'Juan', 'Dela Cruz')
        self.other_nurse = make_user('other@hospital.com', 'Maria', 'Santos')
        self.dept, _ = Department.objects.get_or_create(name='Cardiology Unit')
        self.patient = Patient.objects.create(
            patient_code='P-7001', name='Test Patient', age=60, gender='Male',
            room='ICU-01', diagnosis='Observation', admission_date=timezone.localdate(),
            risk_level='low', attending_physician='Dr. Alvarez', department=self.dept,
            assigned_nurse=self.nurse, heart_rate=80, blood_pressure='120/80',
            temperature=37.0, oxygen_saturation=98,
        )
        self.client.force_authenticate(self.supervisor)


class ActivePatientEditTests(PatientEditTestCase):
    def test_editing_a_changed_field_logs_an_edit_history_entry(self):
        response = self.client.patch(
            f'/api/patients/{self.patient.patient_code}/', {'diagnosis': 'Pneumonia'}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(len(response.data['editHistory']), 1)
        entry = response.data['editHistory'][0]
        self.assertEqual(entry['editedBy'], 'Ana Cruz')
        labels = [c['label'] for c in entry['changes']]
        self.assertIn('Diagnosis', labels)
        diag = next(c for c in entry['changes'] if c['label'] == 'Diagnosis')
        self.assertEqual(diag['from'], 'Observation')
        self.assertEqual(diag['to'], 'Pneumonia')
        self.assertIsNotNone(response.data['lastEditedAt'])
        self.assertEqual(response.data['lastEditedByName'], 'Ana Cruz')

    def test_editing_with_no_actual_change_does_not_log_anything(self):
        response = self.client.patch(
            f'/api/patients/{self.patient.patient_code}/', {'diagnosis': 'Observation'}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.data['editHistory'], [])
        self.assertIsNone(response.data['lastEditedAt'])

    def test_editing_multiple_fields_logs_them_together_in_one_entry(self):
        response = self.client.patch(
            f'/api/patients/{self.patient.patient_code}/',
            {'diagnosis': 'Pneumonia', 'room': 'ICU-02', 'riskLevel': 'high'}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(len(response.data['editHistory']), 1)
        labels = [c['label'] for c in response.data['editHistory'][0]['changes']]
        self.assertIn('Diagnosis', labels)
        self.assertIn('Room', labels)
        self.assertIn('Risk Level', labels)

    def test_editing_vitals_is_logged(self):
        response = self.client.patch(
            f'/api/patients/{self.patient.patient_code}/',
            {'vitalSigns': {'heartRate': 95, 'bloodPressure': '130/85'}}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.content)
        labels = [c['label'] for c in response.data['editHistory'][0]['changes']]
        self.assertIn('Heart Rate', labels)
        self.assertIn('Blood Pressure', labels)
        self.assertEqual(response.data['vitalSigns']['heartRate'], 95)

    def test_edit_history_accumulates_across_multiple_edits(self):
        self.client.patch(f'/api/patients/{self.patient.patient_code}/', {'diagnosis': 'A'}, format='json')
        response = self.client.patch(
            f'/api/patients/{self.patient.patient_code}/', {'diagnosis': 'B'}, format='json',
        )
        self.assertEqual(len(response.data['editHistory']), 2)

    def test_editing_does_not_require_touching_status(self):
        response = self.client.patch(
            f'/api/patients/{self.patient.patient_code}/', {'diagnosis': 'Pneumonia'}, format='json',
        )
        self.assertEqual(response.data['status'], 'admitted')

    def test_nurse_not_assigned_to_the_patient_cannot_edit(self):
        self.client.force_authenticate(self.other_nurse)
        response = self.client.patch(
            f'/api/patients/{self.patient.patient_code}/', {'diagnosis': 'X'}, format='json',
        )
        self.assertEqual(response.status_code, 403)


class DischargedPatientEditTests(PatientEditTestCase):
    def setUp(self):
        super().setUp()
        # DISCHARGE_PLAN_REQUIRED defaults to True (see settings.py) — a full
        # M.E.T.H.O.D. plan to post alongside /discharge/.
        self.client.post(
            f'/api/patients/{self.patient.patient_code}/discharge/',
            {
                'dischargePlan': {
                    'medications': 'Metformin 500mg PO BID.',
                    'environment': 'Lives with spouse.',
                    'treatment': 'Continue wound care every other day.',
                    'healthTeaching': 'Reviewed signs of infection.',
                    'outpatientReferral': 'Follow-up with Dr. Alvarez 2026-09-20.',
                    'diet': 'Low-sodium diet.',
                }
            },
            format='json',
        )
        self.patient.refresh_from_db()
        self.visit = PatientVisit.objects.filter(patient=self.patient).order_by('-discharge_date').first()

    def test_editing_a_discharged_patient_does_not_change_status(self):
        response = self.client.patch(
            f'/api/patients/{self.patient.patient_code}/', {'diagnosis': 'Corrected diagnosis'}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.data['status'], 'discharged')

    def test_editing_a_discharged_patient_is_logged(self):
        response = self.client.patch(
            f'/api/patients/{self.patient.patient_code}/', {'diagnosis': 'Corrected diagnosis'}, format='json',
        )
        # The discharge itself now logs a Condition change, so the edit is the
        # most recent entry on top of it.
        history = response.data['editHistory']
        self.assertGreaterEqual(len(history), 1)
        latest = history[-1]
        self.assertEqual(latest['editedBy'], 'Ana Cruz')
        labels = [c['label'] for c in latest['changes']]
        self.assertIn('Diagnosis', labels)

    def test_editing_a_discharged_patients_diagnosis_syncs_into_the_closed_visit(self):
        self.client.patch(
            f'/api/patients/{self.patient.patient_code}/',
            {'diagnosis': 'Corrected diagnosis', 'room': 'ICU-99', 'attendingPhysician': 'Dr. Reyes'},
            format='json',
        )
        self.visit.refresh_from_db()
        self.assertEqual(self.visit.diagnosis, 'Corrected diagnosis')
        self.assertEqual(self.visit.room, 'ICU-99')
        self.assertEqual(self.visit.attending_physician, 'Dr. Reyes')

    def test_editing_a_discharged_patients_vitals_updates_the_card_snapshot(self):
        response = self.client.patch(
            f'/api/patients/{self.patient.patient_code}/',
            {'vitalSigns': {'heartRate': 72}}, format='json',
        )
        self.assertEqual(response.data['vitalSigns']['heartRate'], 72)

    def test_editing_a_discharged_patient_still_requires_supervisor(self):
        self.client.force_authenticate(self.nurse)
        response = self.client.patch(
            f'/api/patients/{self.patient.patient_code}/', {'diagnosis': 'X'}, format='json',
        )
        self.assertEqual(response.status_code, 403)
