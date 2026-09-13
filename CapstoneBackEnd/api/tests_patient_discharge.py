"""
Patient status/department/discharge — the All Patients supervisor view.

status defaults to 'admitted' and only moves to 'discharged' through the
dedicated discharge action (audit trail: who, when), never a direct field
edit. onDutyNurseId/onDutyNurseName are resolved live against the Duty
Roster for the patient's department, not the static assigned_nurse FK.
"""

from datetime import time as dtime
from datetime import timedelta
from zoneinfo import ZoneInfo

from django.conf import settings
from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from .models import Department, DutyAssignment, NurseProfile, Patient, PatientAssignment

# DISCHARGE_PLAN_REQUIRED defaults to True (see settings.py), so /discharge/
# rejects an incomplete plan — a full M.E.T.H.O.D. plan to post alongside it.
DISCHARGE_PLAN_PAYLOAD = {
    'dischargePlan': {
        'medications': 'Metformin 500mg PO BID with meals.',
        'environment': 'Lives with spouse; home has stairs, needs a rail installed.',
        'treatment': 'Continue wound care dressing changes every other day.',
        'healthTeaching': 'Reviewed signs of infection to watch for.',
        'outpatientReferral': 'Follow-up with Dr. Lim on 2026-09-20, (02) 555-0100.',
        'diet': 'Low-sodium diabetic diet.',
    }
}


def make_user(email, first, last, *, role='staff_nurse'):
    user = User.objects.create_user(
        username=email, email=email, password='pw-test-1234',
        first_name=first, last_name=last,
    )
    NurseProfile.objects.create(user=user, role=role, department='ICU', approval_status='approved', is_active_staff=True)
    return user


class PatientDischargeTestCase(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.supervisor = make_user('sup@hospital.com', 'Ana', 'Cruz', role='head_nurse')
        self.nurse = make_user('nurse@hospital.com', 'Juan', 'Dela Cruz')
        self.dept, _ = Department.objects.get_or_create(name='Cardiology Unit')
        self.patient = Patient.objects.create(
            patient_code='P-9001', name='Test Patient', age=50, gender='Male',
            room='ICU-01', diagnosis='Observation', admission_date=timezone.localdate(),
            risk_level='low', department=self.dept, assigned_nurse=self.nurse,
        )
        PatientAssignment.objects.create(
            patient=self.patient, assigned_nurse=self.nurse, assigned_by=self.supervisor, status='active',
        )


class PatientStatusFieldTests(PatientDischargeTestCase):
    def test_status_defaults_to_admitted(self):
        self.assertEqual(self.patient.status, 'admitted')

    def test_status_label_is_human_readable(self):
        self.client.force_authenticate(self.supervisor)
        response = self.client.get(f'/api/patients/{self.patient.patient_code}/')
        self.assertEqual(response.data['status'], 'admitted')
        self.assertEqual(response.data['statusLabel'], 'Admitted')

    def test_supervisor_can_set_status_to_observation(self):
        self.client.force_authenticate(self.supervisor)
        response = self.client.patch(
            f'/api/patients/{self.patient.patient_code}/', {'status': 'observation'}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.data['status'], 'observation')

    def test_cannot_set_status_to_discharged_via_direct_update(self):
        self.client.force_authenticate(self.supervisor)
        response = self.client.patch(
            f'/api/patients/{self.patient.patient_code}/', {'status': 'discharged'}, format='json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('discharge action', str(response.data).lower())
        self.patient.refresh_from_db()
        self.assertEqual(self.patient.status, 'admitted')

    def test_department_can_be_set_via_update(self):
        other_dept, _ = Department.objects.get_or_create(name='Department of Orthopedics')
        self.client.force_authenticate(self.supervisor)
        response = self.client.patch(
            f'/api/patients/{self.patient.patient_code}/', {'departmentId': other_dept.id}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.data['departmentId'], other_dept.id)
        self.assertEqual(response.data['departmentName'], 'Department of Orthopedics')


class PatientDischargeActionTests(PatientDischargeTestCase):
    def test_supervisor_can_discharge_a_patient(self):
        self.client.force_authenticate(self.supervisor)
        response = self.client.post(
            f'/api/patients/{self.patient.patient_code}/discharge/', DISCHARGE_PLAN_PAYLOAD, format='json',
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.data['status'], 'discharged')
        self.assertIsNotNone(response.data['dischargedAt'])
        self.assertEqual(response.data['dischargedByName'], 'Ana Cruz')
        # assignedNurseId is no longer *actively* set (the FK is cleared —
        # see the next assertion), but the Discharged Patients view still
        # needs a "Last Assigned Nurse" to show, so the serializer falls
        # back to the closed visit's snapshot instead of going blank.
        self.assertEqual(response.data['assignedNurseId'], str(self.nurse.pk))
        self.assertEqual(response.data['assignedNurseName'], 'Juan Dela Cruz')

        self.patient.refresh_from_db()
        self.assertEqual(self.patient.status, 'discharged')
        self.assertEqual(self.patient.discharged_by, self.supervisor)
        self.assertIsNone(self.patient.assigned_nurse)
        self.assertIsNone(self.patient.assigned_nurse)

    def test_discharge_ends_the_active_patient_assignment(self):
        self.client.force_authenticate(self.supervisor)
        self.client.post(
            f'/api/patients/{self.patient.patient_code}/discharge/', DISCHARGE_PLAN_PAYLOAD, format='json',
        )
        assignment = PatientAssignment.objects.get(patient=self.patient)
        self.assertEqual(assignment.status, 'completed')

    def test_nurse_cannot_discharge_a_patient(self):
        self.client.force_authenticate(self.nurse)
        response = self.client.post(f'/api/patients/{self.patient.patient_code}/discharge/')
        self.assertEqual(response.status_code, 403)
        self.patient.refresh_from_db()
        self.assertEqual(self.patient.status, 'admitted')

    def test_cannot_discharge_an_already_discharged_patient(self):
        self.client.force_authenticate(self.supervisor)
        self.client.post(
            f'/api/patients/{self.patient.patient_code}/discharge/', DISCHARGE_PLAN_PAYLOAD, format='json',
        )
        response = self.client.post(
            f'/api/patients/{self.patient.patient_code}/discharge/', DISCHARGE_PLAN_PAYLOAD, format='json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('already been discharged', response.json()['detail'])

    def test_discharge_is_rejected_when_the_plan_is_incomplete(self):
        self.client.force_authenticate(self.supervisor)
        incomplete = {'dischargePlan': {**DISCHARGE_PLAN_PAYLOAD['dischargePlan'], 'diet': ''}}
        response = self.client.post(
            f'/api/patients/{self.patient.patient_code}/discharge/', incomplete, format='json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('diet', response.json()['dischargePlan'])
        self.patient.refresh_from_db()
        self.assertEqual(self.patient.status, 'admitted')

    def test_unauthenticated_cannot_discharge(self):
        response = self.client.post(f'/api/patients/{self.patient.patient_code}/discharge/')
        self.assertEqual(response.status_code, 401)


class OnDutyNurseResolutionTests(PatientDischargeTestCase):
    def test_on_duty_nurse_reflects_the_live_duty_roster_not_the_static_assignment(self):
        # Static assignment is self.nurse, but a DIFFERENT nurse is actually
        # on shift right now for this patient's department.
        on_shift_nurse = make_user('onshift@hospital.com', 'Maria', 'Santos')
        # Duty-roster "today" is the facility's local calendar day (see
        # DUTY_LOCAL_TIMEZONE), not Django's own TIME_ZONE (UTC) —
        # timezone.localdate() can be a day off from what
        # PatientViewSet._current_duty_by_department() actually resolves.
        today = timezone.now().astimezone(ZoneInfo(settings.DUTY_LOCAL_TIMEZONE)).date()
        DutyAssignment.objects.create(
            nurse=on_shift_nurse, department=self.dept, duty_date=today,
            shift='morning', start_time=dtime(0, 0), end_time=dtime(23, 59),
        )
        self.client.force_authenticate(self.supervisor)
        response = self.client.get(f'/api/patients/{self.patient.patient_code}/')
        self.assertEqual(response.data['onDutyNurseId'], str(on_shift_nurse.pk))
        self.assertEqual(response.data['onDutyNurseName'], 'Maria Santos')
        # The static, day-to-day assignment is untouched and still distinct.
        self.assertEqual(response.data['assignedNurseId'], str(self.nurse.pk))

    def test_on_duty_nurse_is_null_when_nobody_is_currently_scheduled(self):
        self.client.force_authenticate(self.supervisor)
        response = self.client.get(f'/api/patients/{self.patient.patient_code}/')
        self.assertIsNone(response.data['onDutyNurseId'])
        self.assertIsNone(response.data['onDutyNurseName'])

    def test_on_duty_nurse_is_null_when_patient_has_no_department(self):
        self.patient.department = None
        self.patient.save(update_fields=['department'])
        on_shift_nurse = make_user('onshift2@hospital.com', 'Lena', 'Reyes')
        DutyAssignment.objects.create(
            nurse=on_shift_nurse, department=self.dept, duty_date=timezone.localdate(),
            shift='morning', start_time=dtime(0, 0), end_time=dtime(23, 59),
        )
        self.client.force_authenticate(self.supervisor)
        response = self.client.get(f'/api/patients/{self.patient.patient_code}/')
        self.assertIsNone(response.data['onDutyNurseId'])

    def test_cancelled_duty_assignment_is_not_treated_as_on_duty(self):
        cancelled_nurse = make_user('cancelled@hospital.com', 'Off', 'Duty')
        DutyAssignment.objects.create(
            nurse=cancelled_nurse, department=self.dept, duty_date=timezone.localdate(),
            shift='morning', start_time=dtime(0, 0), end_time=dtime(23, 59), status='cancelled',
        )
        self.client.force_authenticate(self.supervisor)
        response = self.client.get(f'/api/patients/{self.patient.patient_code}/')
        self.assertIsNone(response.data['onDutyNurseId'])
