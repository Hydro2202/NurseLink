"""
Patient visit history — discharge preserves the record (never deletes),
archives that admission's final diagnosis/room/nurse/medical team onto a
PatientVisit, and readmitting a discharged patient reuses the same
Patient row (same patient_code) with a fresh visit rather than creating a
duplicate. See PatientVisit's docstring in models.py for why vitals/notes
are read live by date range while diagnosis/room/nurse/medical team are
snapshotted instead.
"""

from datetime import timedelta

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from .models import (
    Department,
    Doctor,
    NurseProfile,
    Patient,
    PatientDoctor,
    PatientVisit,
    VitalSigns,
)


def make_user(email, first, last, *, role='staff_nurse'):
    user = User.objects.create_user(
        username=email, email=email, password='pw-test-1234',
        first_name=first, last_name=last,
    )
    NurseProfile.objects.create(user=user, role=role, department='ICU', approval_status='approved', is_active_staff=True)
    return user


class PatientVisitTestCase(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.supervisor = make_user('sup@hospital.com', 'Ana', 'Cruz', role='supervisor')
        self.nurse = make_user('nurse@hospital.com', 'Juan', 'Dela Cruz')
        self.client.force_authenticate(self.supervisor)


class PatientCreationOpensAVisitTests(PatientVisitTestCase):
    def test_creating_a_patient_opens_an_active_visit(self):
        response = self.client.post(
            '/api/patients/',
            {
                'name': 'Ana Reyes', 'age': 54, 'gender': 'Female', 'room': 'W-1',
                'diagnosis': 'Pneumonia', 'admissionDate': timezone.localdate().isoformat(),
                'riskLevel': 'low',
            },
            format='json',
        )
        self.assertEqual(response.status_code, 201, response.content)
        patient = Patient.objects.get(patient_code=response.data['id'])
        visit = PatientVisit.objects.get(patient=patient)
        self.assertIsNone(visit.discharge_date)
        self.assertEqual(visit.diagnosis, 'Pneumonia')


class PatientDischargeArchivesTheVisitTests(PatientVisitTestCase):
    def setUp(self):
        super().setUp()
        self.dept, _ = Department.objects.get_or_create(name='Cardiology Unit')
        self.doctor = Doctor.objects.create(full_name='Dr. Alvarez', department=self.dept, specialization='Cardiology')
        self.patient = Patient.objects.create(
            patient_code='P-8001', name='Test Patient', age=60, gender='Male',
            room='ICU-01', diagnosis='Observation', admission_date=timezone.localdate(),
            risk_level='low', assigned_nurse=self.nurse,
        )
        self.visit = PatientVisit.objects.create(
            patient=self.patient, admission_date=self.patient.admission_date,
            diagnosis='Observation', room='ICU-01', assigned_nurse=self.nurse,
            assigned_nurse_name='Juan Dela Cruz',
        )
        PatientDoctor.objects.create(patient=self.patient, doctor=self.doctor, assigned_by=self.supervisor)

    def test_discharge_does_not_delete_the_patient(self):
        self.client.post(f'/api/patients/{self.patient.patient_code}/discharge/')
        self.assertTrue(Patient.objects.filter(patient_code='P-8001').exists())

    def test_discharge_closes_the_active_visit_with_a_snapshot(self):
        self.patient.diagnosis = 'Pneumonia — updated mid-stay'
        self.patient.room = 'ICU-02'
        self.patient.save(update_fields=['diagnosis', 'room'])

        response = self.client.post(f'/api/patients/{self.patient.patient_code}/discharge/')
        self.assertEqual(response.status_code, 200, response.content)

        self.visit.refresh_from_db()
        self.assertIsNotNone(self.visit.discharge_date)
        self.assertEqual(self.visit.diagnosis, 'Pneumonia — updated mid-stay')
        self.assertEqual(self.visit.room, 'ICU-02')
        self.assertEqual(self.visit.assigned_nurse_name, 'Juan Dela Cruz')
        self.assertEqual(self.visit.medical_team, [
            {'name': 'Dr. Alvarez', 'specialization': 'Cardiology', 'departmentName': 'Cardiology Unit'}
        ])
        self.assertEqual(self.visit.discharged_by, self.supervisor)

    def test_discharge_without_an_existing_visit_row_still_creates_one(self):
        # Defensive path — a patient somehow missing its opening visit (e.g.
        # predates PatientVisit and was never backfilled) must still get a
        # closed visit recorded on discharge, not silently lose the event.
        self.visit.delete()
        response = self.client.post(f'/api/patients/{self.patient.patient_code}/discharge/')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(PatientVisit.objects.filter(patient=self.patient, discharge_date__isnull=False).exists())

    def test_discharged_patient_still_reports_its_last_assigned_nurse(self):
        """
        Discharge clears Patient.assigned_nurse (nobody is *actively*
        assigned to a discharged patient) — but the Discharged Patients view
        still needs to show who the last assigned nurse was, so
        assignedNurseId/Name must fall back to the closed visit's snapshot
        rather than going blank.
        """
        response = self.client.post(f'/api/patients/{self.patient.patient_code}/discharge/')
        self.assertEqual(response.status_code, 200, response.content)
        self.patient.refresh_from_db()
        self.assertIsNone(self.patient.assigned_nurse)
        self.assertEqual(response.data['assignedNurseId'], str(self.nurse.pk))
        self.assertEqual(response.data['assignedNurseName'], 'Juan Dela Cruz')

        # And still correct on a plain GET after the fact, not just the
        # discharge response itself.
        get_response = self.client.get(f'/api/patients/{self.patient.patient_code}/')
        self.assertEqual(get_response.data['assignedNurseName'], 'Juan Dela Cruz')


class PatientVisitsEndpointTests(PatientVisitTestCase):
    def setUp(self):
        super().setUp()
        self.patient = Patient.objects.create(
            patient_code='P-8002', name='Multi Visit', age=45, gender='Female',
            room='W-3', diagnosis='Follow-up', admission_date=timezone.localdate() - timedelta(days=30),
            risk_level='low', assigned_nurse=self.nurse,
        )
        self.closed_visit = PatientVisit.objects.create(
            patient=self.patient, admission_date=timezone.localdate() - timedelta(days=30),
            discharge_date=timezone.now() - timedelta(days=25),
            diagnosis='First stay', room='W-1', assigned_nurse_name='Juan Dela Cruz',
        )
        self.open_visit = PatientVisit.objects.create(
            patient=self.patient, admission_date=timezone.localdate() - timedelta(days=2),
            diagnosis='Second stay', room='W-3',
        )
        VitalSigns.objects.create(
            patient=self.patient, heart_rate=70,
            recorded_at=timezone.now() - timedelta(days=27),
        )
        VitalSigns.objects.create(
            patient=self.patient, heart_rate=88,
            recorded_at=timezone.now() - timedelta(hours=1),
        )

    def test_visits_lists_every_admission_newest_first(self):
        response = self.client.get(f'/api/patients/{self.patient.patient_code}/visits/')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(len(response.data), 2)
        self.assertTrue(response.data[0]['isActive'])
        self.assertFalse(response.data[1]['isActive'])

    def test_open_visit_shows_live_patient_fields_not_a_stale_snapshot(self):
        self.patient.diagnosis = 'Changed after visit was opened'
        self.patient.save(update_fields=['diagnosis'])
        response = self.client.get(f'/api/patients/{self.patient.patient_code}/visits/')
        active = next(v for v in response.data if v['isActive'])
        self.assertEqual(active['diagnosis'], 'Changed after visit was opened')

    def test_vitals_are_scoped_to_each_visits_own_date_range(self):
        response = self.client.get(f'/api/patients/{self.patient.patient_code}/visits/')
        closed = next(v for v in response.data if not v['isActive'])
        active = next(v for v in response.data if v['isActive'])
        self.assertEqual([v['heartRate'] for v in closed['vitals']], [70])
        self.assertEqual([v['heartRate'] for v in active['vitals']], [88])


class PatientReadmitTests(PatientVisitTestCase):
    def setUp(self):
        super().setUp()
        self.patient = Patient.objects.create(
            patient_code='P-8003', name='Returning Patient', age=50, gender='Male',
            room='W-9', diagnosis='Pneumonia', admission_date=timezone.localdate() - timedelta(days=60),
            status='discharged', discharged_at=timezone.now() - timedelta(days=55),
            discharged_by=self.supervisor, risk_level='low',
        )
        self.old_visit = PatientVisit.objects.create(
            patient=self.patient, admission_date=self.patient.admission_date,
            discharge_date=self.patient.discharged_at, diagnosis='Pneumonia', room='W-9',
        )

    def test_readmit_reuses_the_same_patient_code_no_duplicate(self):
        before_count = Patient.objects.count()
        response = self.client.post(
            f'/api/patients/{self.patient.patient_code}/readmit/',
            {'diagnosis': 'Recurrent pneumonia', 'room': 'W-10'}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.data['id'], 'P-8003')
        self.assertEqual(Patient.objects.count(), before_count)

    def test_readmit_reactivates_status_and_clears_discharge_fields(self):
        self.client.post(
            f'/api/patients/{self.patient.patient_code}/readmit/',
            {'diagnosis': 'Recurrent pneumonia', 'room': 'W-10'}, format='json',
        )
        self.patient.refresh_from_db()
        self.assertEqual(self.patient.status, 'admitted')
        self.assertIsNone(self.patient.discharged_at)
        self.assertIsNone(self.patient.discharged_by)
        self.assertEqual(self.patient.diagnosis, 'Recurrent pneumonia')
        self.assertEqual(self.patient.room, 'W-10')

    def test_readmit_opens_a_new_visit_and_keeps_the_old_one(self):
        self.client.post(
            f'/api/patients/{self.patient.patient_code}/readmit/',
            {'diagnosis': 'Recurrent pneumonia', 'room': 'W-10'}, format='json',
        )
        visits = PatientVisit.objects.filter(patient=self.patient).order_by('admission_date')
        self.assertEqual(visits.count(), 2)
        self.old_visit.refresh_from_db()
        self.assertIsNotNone(self.old_visit.discharge_date)
        self.assertEqual(self.old_visit.diagnosis, 'Pneumonia')
        new_visit = visits.last()
        self.assertIsNone(new_visit.discharge_date)
        self.assertEqual(new_visit.diagnosis, 'Recurrent pneumonia')

    def test_cannot_readmit_a_patient_who_is_not_discharged(self):
        self.patient.status = 'admitted'
        self.patient.save(update_fields=['status'])
        response = self.client.post(
            f'/api/patients/{self.patient.patient_code}/readmit/',
            {'diagnosis': 'X', 'room': 'Y'}, format='json',
        )
        self.assertEqual(response.status_code, 400)

    def test_readmit_requires_diagnosis_and_room(self):
        response = self.client.post(
            f'/api/patients/{self.patient.patient_code}/readmit/', {}, format='json',
        )
        self.assertEqual(response.status_code, 400)

    def test_nurse_cannot_readmit(self):
        self.client.force_authenticate(self.nurse)
        response = self.client.post(
            f'/api/patients/{self.patient.patient_code}/readmit/',
            {'diagnosis': 'X', 'room': 'Y'}, format='json',
        )
        self.assertEqual(response.status_code, 403)


class DuplicatePatientPayloadIncludesStatusTests(PatientVisitTestCase):
    def test_duplicate_match_reports_status_so_a_discharged_match_reads_as_a_readmit_candidate(self):
        Patient.objects.create(
            patient_code='P-8004', name='Jane Roe', age=40, gender='Female', room='W-1',
            diagnosis='X', admission_date=timezone.localdate(), status='discharged',
        )
        response = self.client.post(
            '/api/patients/',
            {
                'name': 'Jane Roe', 'age': 40, 'gender': 'Female', 'room': 'W-2',
                'diagnosis': 'Y', 'admissionDate': timezone.localdate().isoformat(), 'riskLevel': 'low',
            },
            format='json',
        )
        self.assertEqual(response.status_code, 400)
        match = response.data['possibleDuplicates'][0]
        self.assertEqual(match['status'], 'discharged')
        self.assertEqual(match['statusLabel'], 'Discharged')
