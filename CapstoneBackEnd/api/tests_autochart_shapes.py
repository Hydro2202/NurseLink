"""
Autocharting ("Generate Structured Note") must not crash on whatever shape
the n8n workflow's LLM returns. It used to 500 ("Could not generate the
note") when a section such as `assessment` came back as a list or object
instead of a string.
"""

import datetime
import http.client
import json
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from django.test import override_settings
from rest_framework.test import APIClient

from .models import KardexLaboratory, KardexMedication, MedicationIntake, NurseProfile, Patient

URL = '/api/charting/structure/'


class AutochartResponseShapeTests(TestCase):
    def setUp(self):
        self.nurse = User.objects.create_user(
            'raiden@hospital.com', 'raiden@hospital.com', 'pw', first_name='Raiden', last_name='Villapando',
        )
        NurseProfile.objects.create(user=self.nurse, role='staff_nurse', approval_status='approved')
        patient = Patient.objects.create(
            patient_code='P619', name='Lawrence G Mangulabnan', age=30, gender='Male', room='619',
            diagnosis='Observation', admission_date=datetime.date.today(), assigned_nurse=self.nurse,
            allergies=['Penicillin'], medications=['Paracetamol'], alerts=['Fall risk'],
        )
        KardexLaboratory.objects.create(patient=patient, test_name='CBC', date_ordered=datetime.date.today())
        med = KardexMedication.objects.create(patient=patient, medication_name='Paracetamol', start_date=datetime.date.today())
        MedicationIntake.objects.create(medication=med, scheduled_time=timezone.now())
        self.client = APIClient()
        self.client.force_authenticate(self.nurse)

    def generate(self, workflow_result, save=False):
        with patch('api.views.call_workflow', return_value=workflow_result):
            return self.client.post(
                URL, {'patientId': 'P619', 'assessment': 'stable vital signs', 'save': save}, format='json',
            )

    def test_list_and_object_sections_are_flattened_to_text(self):
        res = self.generate({
            'note': ['Patient resting.', 'Vitals stable.'],
            'structured': {
                'assessment': ['Alert and oriented', 'No distress'],
                'plan': {'monitor': 'vitals q4h', 'notify': 'MD if febrile'},
                'patientResponse': None,
                'interventions': 'Repositioned patient',
            },
        }, save=True)
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data['note'], 'Patient resting.\nVitals stable.')
        self.assertEqual(res.data['structured']['assessment'], 'Alert and oriented\nNo distress')
        self.assertEqual(res.data['structured']['plan'], 'monitor: vitals q4h\nnotify: MD if febrile')
        self.assertEqual(res.data['structured']['interventions'], ['Repositioned patient'])
        self.assertTrue(res.data['saved'])

    def test_odd_top_level_replies_still_produce_a_note(self):
        for reply in ({}, [], None, 'plain text', {'note': {'x': 1}}, {'structured': {'assessment': {'k': 'v'}}}):
            for save in (False, True):
                with self.subTest(reply=reply, save=save):
                    res = self.generate(reply, save=save)
                    self.assertEqual(res.status_code, 200, res.content)
                    self.assertIsInstance(res.data['structured']['assessment'], str)


class _FakeResponse:
    def __init__(self, body):
        self._body = body
        self.status = 200

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


@override_settings(N8N_AUTO_CHARTING_WEBHOOK_URL='https://n8n.test/webhook/structure-chart')
class AutochartRealPayloadTests(AutochartResponseShapeTests):
    """Runs the real n8n client (only the network is faked), so the request
    payload is actually serialised -- the step that crashed in production."""

    def setUp(self):
        super().setUp()
        Patient.objects.filter(patient_code='P619').update(height_cm=Decimal('170.5'), weight_kg=Decimal('65.2'))

    def post(self):
        return self.client.post(URL, {
            'patientId': 'P619',
            'assessment': (
                'Patient alert and oriented x4. Vital signs: BP 118/76, HR 72, RR 16, '
                'Temp 36.8C, SpO2 98% on room air.'
            ),
            'noteType': 'progress',
        }, format='json')

    def test_patient_with_height_and_weight_generates_a_note(self):
        sent = {}

        def fake_urlopen(request, timeout=None):
            sent['body'] = json.loads(request.data)
            return _FakeResponse(json.dumps({'note': 'Structured.', 'structured': {'assessment': 'A&O x4'}}).encode())

        with patch('api.n8n_client.urllib.request.urlopen', side_effect=fake_urlopen):
            res = self.post()
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(sent['body']['patient']['heightCm'], 170.5)
        self.assertEqual(res.data['note'], 'Structured.')
        self.assertEqual(res.data['structured']['vitalSigns']['heartRate'], 72)

    def test_dropped_connection_is_a_clean_error_not_a_500(self):
        with patch('api.n8n_client.urllib.request.urlopen', side_effect=http.client.RemoteDisconnected('closed')):
            res = self.post()
        self.assertEqual(res.status_code, 502, res.content)
        self.assertIn('detail', res.data)

    def test_unexpected_ai_error_falls_back_to_the_nurses_text(self):
        with patch('api.views.call_workflow', side_effect=RuntimeError('boom')):
            res = self.post()
        self.assertEqual(res.status_code, 200, res.content)
        self.assertTrue(res.data['fallback'])
