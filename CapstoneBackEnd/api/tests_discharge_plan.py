"""
Discharge Plan (M.E.T.H.O.D.) — Medications, Environment, Treatment, Health
Teaching, Outpatient Referral, Diet.

Persisted onto the PatientVisit being closed by PatientViewSet.discharge
(see api/tests_patient_discharge.py / api/tests_patient_visits.py for the
discharge action's own behavior — these tests focus on the plan itself:
required-vs-optional, visibility via /visits/, and the AI-draft endpoint's
fallback when n8n is unconfigured).
"""

from unittest.mock import patch

from django.contrib.auth.models import User
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from .models import ChartingNote, KardexRecord, NurseProfile, Patient, PatientVisit
from .n8n_client import N8nWorkflowOffline

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


class GenerateDischargePlanTests(DischargePlanTestCase):
    def test_any_approved_nurse_can_generate_a_draft_not_just_head_nurse(self):
        self.client.force_authenticate(self.nurse)
        with patch('api.views.call_workflow', side_effect=N8nWorkflowOffline()):
            response = self.client.post(f'/api/patients/{self.patient.patient_code}/discharge-plan-generate/')
        self.assertEqual(response.status_code, 200, response.content)

    def test_draft_pulls_medications_from_the_patient_record(self):
        self.client.force_authenticate(self.nurse)
        with patch('api.views.call_workflow', side_effect=N8nWorkflowOffline()):
            # n8n offline -> N8nError, caught internally, falls back to the
            # deterministic draft rather than failing the request.
            response = self.client.post(f'/api/patients/{self.patient.patient_code}/discharge-plan-generate/')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertIn('Metformin 500mg', response.data['medications'])
        self.assertIn('Lisinopril 10mg', response.data['medications'])
        self.assertTrue(response.data['aiGenerated'])
        # No reliable source for these in the fallback — left blank rather
        # than invented.
        self.assertEqual(response.data['environment'], '')
        self.assertEqual(response.data['healthTeaching'], '')
        self.assertEqual(response.data['outpatientReferral'], '')

    def test_draft_pulls_diet_from_the_most_recent_kardex_record(self):
        KardexRecord.objects.create(
            patient=self.patient, last_name='Patient', first_name='Test',
            diet='NPO except for medications',
        )
        self.client.force_authenticate(self.nurse)
        with patch('api.views.call_workflow', side_effect=N8nWorkflowOffline()):
            response = self.client.post(f'/api/patients/{self.patient.patient_code}/discharge-plan-generate/')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.data['diet'], 'NPO except for medications')

    def test_draft_pulls_treatment_from_the_latest_fdar_notes_action_field(self):
        ChartingNote.objects.create(
            note_code='C-9001', patient=self.patient, patient_name=self.patient.name,
            nurse=self.nurse, nurse_name='Juan Dela Cruz', timestamp=timezone.now(),
            note_type='progress', content='...', note_format='fdar',
            focus='Wound care', data='Incision clean, dry, intact.',
            action='Dressing changed, site cleaned with saline.', response='Tolerated well.',
        )
        self.client.force_authenticate(self.nurse)
        with patch('api.views.call_workflow', side_effect=N8nWorkflowOffline()):
            response = self.client.post(f'/api/patients/{self.patient.patient_code}/discharge-plan-generate/')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertIn('Dressing changed', response.data['treatment'])

    def test_workflow_supplied_fields_override_the_fallback(self):
        self.client.force_authenticate(self.nurse)
        with patch('api.views.call_workflow') as mock_call:
            mock_call.return_value = {
                'environment': 'Second-floor walk-up apartment; no elevator.',
                'healthTeaching': 'Taught proper insulin injection technique.',
                'outpatientReferral': 'Cardiology follow-up in 2 weeks.',
            }
            response = self.client.post(f'/api/patients/{self.patient.patient_code}/discharge-plan-generate/')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.data['environment'], 'Second-floor walk-up apartment; no elevator.')
        self.assertEqual(response.data['healthTeaching'], 'Taught proper insulin injection technique.')
        self.assertEqual(response.data['outpatientReferral'], 'Cardiology follow-up in 2 weeks.')
        # Fallback-sourced fields stay intact when the workflow doesn't
        # mention them.
        self.assertIn('Metformin 500mg', response.data['medications'])

    def test_unauthenticated_cannot_generate(self):
        response = self.client.post(f'/api/patients/{self.patient.patient_code}/discharge-plan-generate/')
        self.assertEqual(response.status_code, 401)
