"""
Autocharting ("Generate Structured Note") must not crash on whatever shape
the n8n workflow's LLM returns. It used to 500 ("Could not generate the
note") when a section such as `assessment` came back as a list or object
instead of a string.
"""

import datetime
from unittest.mock import patch

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
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
