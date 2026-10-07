"""
Who may write charting notes and vital signs for a patient.

Same rule as labs and medications: a staff nurse may only write for a patient
assigned to them; a head nurse may write for any patient. Before this, charting
notes, vitals and autocharting let any approved nurse write for any patient.
"""

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from .models import ChartingNote, NurseProfile, Patient, VitalSigns


def make_user(email, *, role='staff_nurse'):
    user = User.objects.create_user(username=email, email=email, password='pw-test-1234',
                                    first_name='Test', last_name=email.split('@')[0])
    NurseProfile.objects.create(user=user, role=role, department='ICU',
                                approval_status='approved', is_active_staff=True)
    return user


class CareScopeWritesTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = make_user('owner@hospital.com')
        self.other = make_user('other@hospital.com')
        self.head = make_user('head@hospital.com', role='head_nurse')
        self.patient = Patient.objects.create(
            patient_code='P-8801', name='Scope Patient', age=60, gender='Female',
            room='E-2', diagnosis='Pneumonia', admission_date=timezone.localdate(),
            risk_level='medium', assigned_nurse=self.owner,
        )

    def note_payload(self):
        return {
            'patientId': self.patient.patient_code,
            'timestamp': timezone.now().isoformat(),
            'type': 'progress',
            'content': 'Patient resting comfortably.',
        }

    def vitals_payload(self):
        return {'patientId': self.patient.patient_code, 'heartRate': 88}

    # --- charting notes -------------------------------------------------------

    def test_assigned_nurse_can_chart_a_note(self):
        self.client.force_authenticate(self.owner)
        res = self.client.post('/api/charting/', self.note_payload(), format='json')
        self.assertEqual(res.status_code, 201, res.content)

    def test_other_nurse_cannot_chart_a_note_for_this_patient(self):
        self.client.force_authenticate(self.other)
        before = ChartingNote.objects.count()
        res = self.client.post('/api/charting/', self.note_payload(), format='json')
        self.assertEqual(res.status_code, 403, res.content)
        self.assertEqual(ChartingNote.objects.count(), before)

    def test_head_nurse_can_chart_for_any_patient(self):
        self.client.force_authenticate(self.head)
        res = self.client.post('/api/charting/', self.note_payload(), format='json')
        self.assertEqual(res.status_code, 201, res.content)

    def test_other_nurse_cannot_edit_a_note_on_this_patient(self):
        self.client.force_authenticate(self.owner)
        created = self.client.post('/api/charting/', self.note_payload(), format='json')
        self.assertEqual(created.status_code, 201, created.content)
        note_code = created.data['id']

        self.client.force_authenticate(self.other)
        res = self.client.patch(f'/api/charting/{note_code}/', {'content': 'Changed.'}, format='json')
        self.assertEqual(res.status_code, 403, res.content)
        self.assertEqual(ChartingNote.objects.get(note_code=note_code).content, 'Patient resting comfortably.')

    def test_nurse_cannot_move_their_own_note_to_a_patient_not_assigned_to_them(self):
        self.client.force_authenticate(self.owner)
        created = self.client.post('/api/charting/', self.note_payload(), format='json')
        self.assertEqual(created.status_code, 201, created.content)
        note_code = created.data['id']
        Patient.objects.create(
            patient_code='P-8802', name='Someone Else', age=50, gender='Male',
            room='E-3', diagnosis='Asthma', admission_date=timezone.localdate(),
            risk_level='low', assigned_nurse=self.other,
        )

        res = self.client.patch(f'/api/charting/{note_code}/', {'patientId': 'P-8802'}, format='json')
        self.assertEqual(res.status_code, 403, res.content)
        self.assertEqual(ChartingNote.objects.get(note_code=note_code).patient.patient_code, 'P-8801')

    # --- vital signs ----------------------------------------------------------

    def test_assigned_nurse_can_record_vitals(self):
        self.client.force_authenticate(self.owner)
        res = self.client.post('/api/vital-signs/', self.vitals_payload(), format='json')
        self.assertEqual(res.status_code, 201, res.content)

    def test_other_nurse_cannot_record_vitals_for_this_patient(self):
        self.client.force_authenticate(self.other)
        before = VitalSigns.objects.count()
        res = self.client.post('/api/vital-signs/', self.vitals_payload(), format='json')
        self.assertEqual(res.status_code, 403, res.content)
        self.assertEqual(VitalSigns.objects.count(), before)

    def test_head_nurse_can_record_vitals_for_any_patient(self):
        self.client.force_authenticate(self.head)
        res = self.client.post('/api/vital-signs/', self.vitals_payload(), format='json')
        self.assertEqual(res.status_code, 201, res.content)

    # --- autocharting ---------------------------------------------------------

    def test_other_nurse_cannot_autochart_for_this_patient(self):
        self.client.force_authenticate(self.other)
        res = self.client.post(
            '/api/charting/structure/',
            {'patientId': self.patient.patient_code, 'assessment': 'Lungs clear.'},
            format='json',
        )
        self.assertEqual(res.status_code, 403, res.content)


class PatientOwnershipAcrossAllFourResourcesTests(TestCase):
    """
    The same assigned-nurse rule for charting, vitals, labs and medications.
    Nurse A (other) is not assigned to Nurse B's patient (owner).
    """

    def setUp(self):
        self.client = APIClient()
        self.owner = make_user('owner@hospital.com')
        self.other = make_user('other@hospital.com')
        self.head = make_user('head@hospital.com', role='head_nurse')
        self.patient = Patient.objects.create(
            patient_code='P-8810', name='Ownership Patient', age=64, gender='Male',
            room='F-1', diagnosis='COPD', admission_date=timezone.localdate(),
            risk_level='medium', assigned_nurse=self.owner,
        )
        self.today = timezone.localdate().isoformat()

    def payloads(self):
        return {
            '/api/charting/': {
                'patientId': self.patient.patient_code, 'timestamp': timezone.now().isoformat(),
                'type': 'progress', 'content': 'Resting.',
            },
            '/api/vital-signs/': {'patientId': self.patient.patient_code, 'heartRate': 80},
            '/api/kardex-laboratories/': {
                'patientId': self.patient.patient_code, 'testName': 'CBC', 'dateOrdered': self.today,
            },
            '/api/kardex-medications/': {
                'patientId': self.patient.patient_code, 'medicationName': 'Salbutamol',
                'startDate': self.today,
            },
        }

    def test_assigned_nurse_can_write_all_four(self):
        self.client.force_authenticate(self.owner)
        for url, body in self.payloads().items():
            with self.subTest(url=url):
                res = self.client.post(url, body, format='json')
                self.assertEqual(res.status_code, 201, res.content)

    def test_non_assigned_nurse_is_denied_on_all_four(self):
        self.client.force_authenticate(self.other)
        for url, body in self.payloads().items():
            with self.subTest(url=url):
                res = self.client.post(url, body, format='json')
                self.assertEqual(res.status_code, 403, res.content)

    def test_head_nurse_can_write_all_four(self):
        self.client.force_authenticate(self.head)
        for url, body in self.payloads().items():
            with self.subTest(url=url):
                res = self.client.post(url, body, format='json')
                self.assertEqual(res.status_code, 201, res.content)

    def test_denial_has_the_same_shape_on_all_four(self):
        self.client.force_authenticate(self.other)
        bodies = []
        for url, body in self.payloads().items():
            res = self.client.post(url, body, format='json')
            self.assertEqual(res.status_code, 403)
            self.assertEqual(set(res.data.keys()), {'detail'})
            self.assertIn('assigned to you', res.data['detail'])
            bodies.append(res.data['detail'])
        self.assertEqual(len(bodies), 4)
