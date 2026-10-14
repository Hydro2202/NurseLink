"""
Discharge Plan (M.E.T.H.O.D.) — Medications, Environment, Treatment, Health
Teaching, Outpatient Referral, Diet.

Persisted onto the PatientVisit being closed by PatientViewSet.discharge
(see api/tests_patient_discharge.py / api/tests_patient_visits.py for the
discharge action's own behavior — these tests focus on the plan itself:
required-vs-optional and visibility via /visits/). The plan is always typed
by the nurse; there is no AI-draft endpoint.
"""

from django.contrib.auth.models import User
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from .models import NurseProfile, Patient, PatientVisit

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


class DischargePlanTestCase(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.supervisor = make_user('sup@hospital.com', 'Ana', 'Cruz', role='head_nurse')
        self.nurse = make_user('nurse@hospital.com', 'Juan', 'Dela Cruz')
        self.patient = Patient.objects.create(
            patient_code='P-7001', name='Test Patient', age=58, gender='Male',
            room='W-4', diagnosis='CHF', admission_date=timezone.localdate(),
            risk_level='medium', assigned_nurse=self.nurse,
            medications=['Metformin 500mg', 'Lisinopril 10mg'],
        )
        PatientVisit.objects.create(
            patient=self.patient, admission_date=self.patient.admission_date,
            diagnosis='CHF', room='W-4', assigned_nurse=self.nurse,
            assigned_nurse_name='Juan Dela Cruz',
        )


class DischargeRequiresPlanTests(DischargePlanTestCase):
    def test_discharge_persists_the_full_plan_onto_the_closed_visit(self):
        self.client.force_authenticate(self.supervisor)
        response = self.client.post(
            f'/api/patients/{self.patient.patient_code}/discharge/', DISCHARGE_PLAN_PAYLOAD, format='json',
        )
        self.assertEqual(response.status_code, 200, response.content)

        visit = PatientVisit.objects.get(patient=self.patient, discharge_date__isnull=False)
        for camel, text in DISCHARGE_PLAN_PAYLOAD['dischargePlan'].items():
            snake = {
                'medications': 'discharge_plan_medications',
                'environment': 'discharge_plan_environment',
                'treatment': 'discharge_plan_treatment',
                'healthTeaching': 'discharge_plan_health_teaching',
                'outpatientReferral': 'discharge_plan_outpatient_referral',
                'diet': 'discharge_plan_diet',
            }[camel]
            self.assertEqual(getattr(visit, snake), text)

    def test_discharge_rejects_a_missing_field(self):
        self.client.force_authenticate(self.supervisor)
        incomplete = {'dischargePlan': {**DISCHARGE_PLAN_PAYLOAD['dischargePlan']}}
        del incomplete['dischargePlan']['healthTeaching']
        response = self.client.post(
            f'/api/patients/{self.patient.patient_code}/discharge/', incomplete, format='json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('healthTeaching', response.json()['dischargePlan'])

    def test_discharge_rejects_whitespace_only_fields(self):
        self.client.force_authenticate(self.supervisor)
        blank = {'dischargePlan': {**DISCHARGE_PLAN_PAYLOAD['dischargePlan'], 'diet': '   '}}
        response = self.client.post(
            f'/api/patients/{self.patient.patient_code}/discharge/', blank, format='json',
        )
        self.assertEqual(response.status_code, 400)

    @override_settings(DISCHARGE_PLAN_REQUIRED=False)
    def test_plan_is_optional_when_the_setting_is_off(self):
        self.client.force_authenticate(self.supervisor)
        response = self.client.post(f'/api/patients/{self.patient.patient_code}/discharge/')
        self.assertEqual(response.status_code, 200, response.content)
        self.patient.refresh_from_db()
        self.assertEqual(self.patient.status, 'discharged')


class DischargePlanVisibleInVisitHistoryTests(DischargePlanTestCase):
    def test_visits_endpoint_reports_the_plan_and_who_completed_it(self):
        self.client.force_authenticate(self.supervisor)
        self.client.post(
            f'/api/patients/{self.patient.patient_code}/discharge/', DISCHARGE_PLAN_PAYLOAD, format='json',
        )

        response = self.client.get(f'/api/patients/{self.patient.patient_code}/visits/')
        self.assertEqual(response.status_code, 200, response.content)
        closed_visit = next(v for v in response.data if not v['isActive'])

        self.assertTrue(closed_visit['hasDischargePlan'])
        plan = closed_visit['dischargePlan']
        self.assertEqual(plan['medications'], DISCHARGE_PLAN_PAYLOAD['dischargePlan']['medications'])
        self.assertEqual(plan['diet'], DISCHARGE_PLAN_PAYLOAD['dischargePlan']['diet'])
        self.assertEqual(plan['completedByName'], 'Ana Cruz')
        self.assertIsNotNone(plan['completedAt'])
        self.assertFalse(plan['aiGenerated'])

    def test_a_visit_with_no_plan_reports_hasDischargePlan_false_and_a_null_plan(self):
        # An open (still-active) visit has never been through /discharge/ —
        # confirms old/undischarged visits don't fake a plan into existing.
        self.client.force_authenticate(self.supervisor)
        response = self.client.get(f'/api/patients/{self.patient.patient_code}/visits/')
        self.assertEqual(response.status_code, 200, response.content)
        open_visit = next(v for v in response.data if v['isActive'])
        self.assertFalse(open_visit['hasDischargePlan'])
        self.assertIsNone(open_visit['dischargePlan'])


class NoAiDraftEndpointTests(DischargePlanTestCase):
    def test_ai_draft_endpoint_is_gone(self):
        self.client.force_authenticate(self.supervisor)
        response = self.client.post(f'/api/patients/{self.patient.patient_code}/discharge-plan-generate/')
        self.assertEqual(response.status_code, 404)
