"""
Kardex Medication (status ACTIVE/ON_HOLD/DISCONTINUED, the new
prescribedBy/scheduledTimes fields) and the new Required Department Visits
section (KardexDepartmentVisit). See api/models.py for both.
"""

import datetime

from django.contrib.auth.models import User
from django.core.cache import cache
from rest_framework.test import APITestCase

from .models import Department, KardexDepartmentVisit, KardexMedication, NurseProfile, Patient


def make_nurse(email, *, role='staff_nurse'):
    user = User.objects.create_user(
        username=email, email=email, password='pw-test-1234', first_name='Ana', last_name='Cruz',
    )
    NurseProfile.objects.create(user=user, role=role, department='ICU', approval_status='approved', is_active_staff=True)
    return user


def make_patient(code, assigned_nurse, name='Juan Dela Cruz'):
    return Patient.objects.create(
        patient_code=code, name=name, age=61, gender='Male', room='204-B', diagnosis='CHF',
        admission_date=datetime.date(2026, 3, 2), risk_level='medium', attending_physician='Dr. Lim',
        assigned_nurse=assigned_nurse,
    )


class KardexMedicationStatusTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.nurse = make_nurse('nurse1@hospital.test')
        self.patient = make_patient('MED001', self.nurse)

    def _create(self, **overrides):
        self.client.force_authenticate(self.nurse)
        body = {
            'patientId': self.patient.patient_code,
            'medicationName': 'Furosemide',
            'dose': '40 mg',
            'route': 'IV',
            'frequency': 'q8h',
            'startDate': '2026-03-02',
        }
        body.update(overrides)
        return self.client.post('/api/kardex-medications/', body, format='json')

    def test_create_medication_defaults_to_active_and_derives_isActive(self):
        response = self._create()
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data['status'], 'ACTIVE')
        self.assertTrue(response.data['isActive'])

    def test_prescribed_by_defaults_to_attending_physician_when_blank(self):
        response = self._create()
        self.assertEqual(response.data['prescribedBy'], 'Dr. Lim')

    def test_prescribed_by_explicit_value_is_kept(self):
        response = self._create(prescribedBy='Dr. Santos')
        self.assertEqual(response.data['prescribedBy'], 'Dr. Santos')

    def test_only_drug_name_dose_route_frequency_are_required(self):
        self.client.force_authenticate(self.nurse)
        response = self.client.post('/api/kardex-medications/', {
            'patientId': self.patient.patient_code,
            'medicationName': 'Paracetamol',
            'dose': '500 mg',
            'route': 'Oral',
            'frequency': 'PRN',
            'startDate': '2026-03-02',
            # scheduledTimes/endDate/prescribedBy/remarks all omitted —
            # must not 400 with "This field may not be blank."
        }, format='json')
        self.assertEqual(response.status_code, 201, response.data)

    def test_put_on_hold_sets_status_and_clears_is_active(self):
        created = self._create()
        response = self.client.patch(f"/api/kardex-medications/{created.data['id']}/", {'status': 'ON_HOLD'}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['status'], 'ON_HOLD')
        self.assertFalse(response.data['isActive'])

    def test_discontinue_sets_status_and_end_date(self):
        created = self._create()
        response = self.client.patch(f"/api/kardex-medications/{created.data['id']}/", {'status': 'DISCONTINUED'}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['status'], 'DISCONTINUED')
        self.assertFalse(response.data['isActive'])
        self.assertIsNotNone(response.data['endDate'])

    def test_discontinue_does_not_delete_the_order_history_stays(self):
        created = self._create()
        self.client.patch(f"/api/kardex-medications/{created.data['id']}/", {'status': 'DISCONTINUED'}, format='json')
        self.assertTrue(KardexMedication.objects.filter(pk=created.data['id']).exists())

    def test_edit_medication_fields(self):
        created = self._create()
        response = self.client.patch(f"/api/kardex-medications/{created.data['id']}/", {
            'dose': '80 mg', 'scheduledTimes': '08:00, 16:00, 00:00',
        }, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['dose'], '80 mg')
        self.assertEqual(response.data['scheduledTimes'], '08:00, 16:00, 00:00')

    def test_scheduled_times_rejects_a_bad_entry_in_the_list(self):
        response = self._create(scheduledTimes='08:00, 25:99')
        self.assertEqual(response.status_code, 400)
        self.assertIn('scheduledTimes', response.data)

    def test_scheduled_times_rejects_free_text(self):
        response = self._create(scheduledTimes='after breakfast and dinner')
        self.assertEqual(response.status_code, 400)
        self.assertIn('scheduledTimes', response.data)

    def test_scheduled_times_blank_is_fine(self):
        response = self._create(scheduledTimes='')
        self.assertEqual(response.status_code, 201, response.data)


class KardexDepartmentVisitTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.nurse = make_nurse('nurse2@hospital.test')
        self.patient = make_patient('VIS001', self.nurse)
        self.radiology = Department.objects.get_or_create(name='Radiology')[0]
        self.lab_dept = Department.objects.get_or_create(name='Laboratory')[0]

    def _create(self, **overrides):
        self.client.force_authenticate(self.nurse)
        body = {
            'patientId': self.patient.patient_code,
            'departmentId': self.radiology.pk,
            'purpose': 'Chest X-ray',
        }
        body.update(overrides)
        return self.client.post('/api/kardex-department-visits/', body, format='json')

    def test_create_visit_defaults_to_pending_routine(self):
        response = self._create()
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data['status'], 'PENDING')
        self.assertEqual(response.data['priority'], 'ROUTINE')
        self.assertEqual(response.data['departmentName'], 'Radiology')

    def test_only_department_and_purpose_are_required(self):
        self.client.force_authenticate(self.nurse)
        response = self.client.post('/api/kardex-department-visits/', {
            'patientId': self.patient.patient_code,
            'departmentId': self.radiology.pk,
            'purpose': 'CBC',
            # scheduledDatetime/priority/preparationNotes/orderedBy all omitted.
        }, format='json')
        self.assertEqual(response.status_code, 201, response.data)

    def test_mark_as_done_sets_completed_at(self):
        created = self._create()
        response = self.client.patch(f"/api/kardex-department-visits/{created.data['id']}/", {'status': 'DONE'}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['status'], 'DONE')
        self.assertIsNotNone(response.data['completedAt'])

    def test_cancel_a_visit(self):
        created = self._create()
        response = self.client.patch(f"/api/kardex-department-visits/{created.data['id']}/", {'status': 'CANCELLED'}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['status'], 'CANCELLED')

    def test_sort_order_pending_first_by_priority_then_time(self):
        routine = self._create(purpose='Routine CBC', priority='ROUTINE', scheduledDatetime='2026-03-05T08:00:00Z').data
        stat = self._create(purpose='STAT Head CT', priority='STAT', scheduledDatetime='2026-03-05T09:00:00Z').data
        urgent = self._create(purpose='Urgent Dialysis', priority='URGENT', scheduledDatetime='2026-03-05T07:00:00Z').data
        done = self._create(purpose='Old PT session', priority='ROUTINE').data
        self.client.patch(f"/api/kardex-department-visits/{done['id']}/", {'status': 'DONE'}, format='json')

        self.client.force_authenticate(self.nurse)
        response = self.client.get(f'/api/kardex-department-visits/?patientId={self.patient.patient_code}')
        self.assertEqual(response.status_code, 200, response.data)
        ids_in_order = [row['id'] for row in response.data]
        # STAT -> Urgent -> Routine, Done last.
        self.assertEqual(ids_in_order, [stat['id'], urgent['id'], routine['id'], done['id']])

    def test_status_filter(self):
        created = self._create()
        self.client.patch(f"/api/kardex-department-visits/{created.data['id']}/", {'status': 'DONE'}, format='json')
        self._create(purpose='Another one')

        self.client.force_authenticate(self.nurse)
        response = self.client.get(
            f'/api/kardex-department-visits/?patientId={self.patient.patient_code}&status=DONE'
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]['status'], 'DONE')

    def test_only_head_nurse_can_delete_staff_nurse_cancels_instead(self):
        created = self._create()
        response = self.client.delete(f"/api/kardex-department-visits/{created.data['id']}/")
        self.assertEqual(response.status_code, 403)
        self.assertTrue(KardexDepartmentVisit.objects.filter(pk=created.data['id']).exists())


class KardexGetIncludesBothListsTests(APITestCase):
    """The main Patient/Kardex GET response includes active medications and
    pending/scheduled department visits in one request — no second round trip."""

    def setUp(self):
        cache.clear()
        self.nurse = make_nurse('nurse3@hospital.test')
        self.patient = make_patient('BOTH001', self.nurse)
        self.radiology = Department.objects.get_or_create(name='Radiology')[0]
        self.lab_dept = Department.objects.get_or_create(name='Laboratory')[0]

    def test_patient_detail_includes_medications_and_department_visits(self):
        self.client.force_authenticate(self.nurse)
        self.client.post('/api/kardex-medications/', {
            'patientId': self.patient.patient_code, 'medicationName': 'Amlodipine',
            'dose': '5 mg', 'route': 'Oral', 'frequency': 'Once daily', 'startDate': '2026-03-02',
        }, format='json')
        self.client.post('/api/kardex-medications/', {
            'patientId': self.patient.patient_code, 'medicationName': 'Metformin',
            'dose': '500 mg', 'route': 'Oral', 'frequency': 'BID', 'startDate': '2026-03-02',
        }, format='json')
        self.client.post('/api/kardex-department-visits/', {
            'patientId': self.patient.patient_code, 'departmentId': self.radiology.pk, 'purpose': 'Chest X-ray',
        }, format='json')
        self.client.post('/api/kardex-department-visits/', {
            'patientId': self.patient.patient_code, 'departmentId': self.lab_dept.pk, 'purpose': 'CBC',
        }, format='json')

        response = self.client.get(f'/api/patients/{self.patient.patient_code}/')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(len(response.data['medicationOrders']), 2)
        self.assertEqual(len(response.data['departmentVisits']), 2)
        self.assertEqual(
            {m['medicationName'] for m in response.data['medicationOrders']}, {'Amlodipine', 'Metformin'},
        )
        self.assertEqual(
            {v['purpose'] for v in response.data['departmentVisits']}, {'Chest X-ray', 'CBC'},
        )
