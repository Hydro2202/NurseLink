"""
Vital-sign auto-charting: a charting note whose assessment/observation text
(or an explicit structured checkbox) mentions a vital-sign change gets
flagged 'pending' — see ChartingNoteSerializer._apply_vitals_flag and
api/vitals_detection.py — and /api/vital-signs/ is the insert-only history
a nurse confirms a new reading into, pre-filled from /api/vital-signs/latest/.
"""

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from .models import ChartingNote, NurseProfile, Patient, VitalSigns


class VitalsAutoChartingTestCase(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            username='nurse@hospital.com', email='nurse@hospital.com',
            password='password123', first_name='Sarah', last_name='Johnson',
        )
        NurseProfile.objects.create(user=self.user, role='staff_nurse', department='ICU')
        self.client.force_authenticate(self.user)
        self.patient = Patient.objects.create(
            patient_code='P-3001', name='Ana Reyes', age=54, gender='Female',
            room='Ward-12', diagnosis='Post-op recovery', admission_date='2026-09-01',
            risk_level='low', assigned_nurse=self.user,
        )

    def _create_note(self, *, content='', structured=None, note_type='assessment'):
        return self.client.post(
            '/api/charting/',
            {
                'patientId': self.patient.patient_code,
                'timestamp': timezone.now().isoformat(),
                'type': note_type,
                'content': content,
                'structured': structured or {},
            },
            format='json',
        )


class VitalSignDetectionTests(VitalsAutoChartingTestCase):
    def test_note_with_bp_increase_language_is_flagged_pending(self):
        response = self._create_note(content="Patient's BP has increased since last check.")
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.data['vitalsUpdateStatus'], 'pending')
        self.assertIn('bloodPressure', response.data['flaggedVitals'])

    def test_note_without_change_language_is_not_flagged(self):
        response = self._create_note(content='BP cuff applied, patient resting comfortably.')
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.data['vitalsUpdateStatus'], 'none')
        self.assertEqual(response.data['flaggedVitals'], [])

    def test_multiple_vitals_mentioned_in_one_note_are_all_flagged(self):
        response = self._create_note(
            content='Temperature spiked to 39.2C and an irregular heartbeat was noted on exam.'
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.data['vitalsUpdateStatus'], 'pending')
        self.assertIn('temperature', response.data['flaggedVitals'])
        self.assertIn('heartRate', response.data['flaggedVitals'])

    def test_explicit_structured_flag_without_keyword_match(self):
        response = self._create_note(
            content='Patient reviewed.',
            structured={'vitalSignChangeNoted': True, 'vitalSignsAffected': ['oxygenSaturation']},
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.data['vitalsUpdateStatus'], 'pending')
        self.assertEqual(response.data['flaggedVitals'], ['oxygenSaturation'])

    def test_flag_detected_from_structured_assessment_field(self):
        response = self._create_note(
            content='', structured={'assessment': 'Irregular heartbeat noted, monitoring closely.'}
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.data['vitalsUpdateStatus'], 'pending')
        self.assertIn('heartRate', response.data['flaggedVitals'])

    def test_resolved_note_is_not_re_flagged_on_further_edits(self):
        create = self._create_note(content='BP has increased sharply.')
        note_id = create.data['id']
        self.client.post(
            '/api/vital-signs/',
            {'patientId': self.patient.patient_code, 'triggeredByNoteId': note_id, 'bloodPressure': '150/95'},
            format='json',
        )
        note = ChartingNote.objects.get(note_code=note_id)
        self.assertEqual(note.vitals_update_status, 'resolved')

        edit = self.client.patch(
            f'/api/charting/{note_id}/',
            {'content': 'BP has increased sharply. Temperature also spiked.'},
            format='json',
        )
        self.assertEqual(edit.status_code, 200, edit.content)
        self.assertEqual(edit.data['vitalsUpdateStatus'], 'resolved')

    def test_pending_note_stays_pending_and_is_not_duplicated_on_edit(self):
        create = self._create_note(content='BP has increased sharply.')
        note_id = create.data['id']
        edit = self.client.patch(
            f'/api/charting/{note_id}/',
            {'content': 'BP has increased sharply, patient monitored closely.'},
            format='json',
        )
        self.assertEqual(edit.status_code, 200, edit.content)
        self.assertEqual(edit.data['vitalsUpdateStatus'], 'pending')
        self.assertEqual(edit.data['flaggedVitals'], ['bloodPressure'])


class VitalSignsLatestTests(VitalsAutoChartingTestCase):
    def test_no_prior_vitals_for_a_brand_new_patient(self):
        response = self.client.get(f'/api/vital-signs/latest/?patientId={self.patient.patient_code}')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertFalse(response.data['hasPriorVitals'])
        self.assertIsNone(response.data['baseline'])

    def test_falls_back_to_patient_snapshot_when_no_history_rows_exist(self):
        self.patient.heart_rate = 82
        self.patient.blood_pressure = '120/80'
        self.patient.save(update_fields=['heart_rate', 'blood_pressure'])

        response = self.client.get(f'/api/vital-signs/latest/?patientId={self.patient.patient_code}')
        self.assertTrue(response.data['hasPriorVitals'])
        self.assertEqual(response.data['baseline']['heartRate'], 82)
        self.assertEqual(response.data['baseline']['bloodPressure'], '120/80')

    def test_returns_the_most_recent_history_row(self):
        VitalSigns.objects.create(
            patient=self.patient, heart_rate=70, recorded_at=timezone.now() - timezone.timedelta(hours=2),
        )
        newest = VitalSigns.objects.create(
            patient=self.patient, heart_rate=95, recorded_at=timezone.now(),
        )
        response = self.client.get(f'/api/vital-signs/latest/?patientId={self.patient.patient_code}')
        self.assertTrue(response.data['hasPriorVitals'])
        self.assertEqual(response.data['baseline']['id'], newest.id)
        self.assertEqual(response.data['baseline']['heartRate'], 95)

    def test_patient_id_required(self):
        response = self.client.get('/api/vital-signs/latest/')
        self.assertEqual(response.status_code, 400)

    def test_unknown_patient_404s(self):
        response = self.client.get('/api/vital-signs/latest/?patientId=NOPE')
        self.assertEqual(response.status_code, 404)


class VitalSignsCreateTests(VitalsAutoChartingTestCase):
    def test_create_linked_to_a_note_resolves_it_and_defaults_to_assessment_triggered(self):
        create = self._create_note(content='Temperature spiked significantly.')
        note_id = create.data['id']

        response = self.client.post(
            '/api/vital-signs/',
            {'patientId': self.patient.patient_code, 'triggeredByNoteId': note_id, 'temperature': 39.4},
            format='json',
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.data['source'], 'assessment_triggered')

        note = ChartingNote.objects.get(note_code=note_id)
        self.assertEqual(note.vitals_update_status, 'resolved')

    def test_create_without_a_note_defaults_to_scheduled(self):
        response = self.client.post(
            '/api/vital-signs/', {'patientId': self.patient.patient_code, 'heartRate': 76}, format='json',
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.data['source'], 'scheduled')

    def test_create_syncs_patient_snapshot_fields(self):
        self.client.post(
            '/api/vital-signs/',
            {'patientId': self.patient.patient_code, 'heartRate': 101, 'bloodPressure': '140/90'},
            format='json',
        )
        self.patient.refresh_from_db()
        self.assertEqual(self.patient.heart_rate, 101)
        self.assertEqual(self.patient.blood_pressure, '140/90')

    def test_history_is_never_overwritten_each_entry_is_new(self):
        self.client.post('/api/vital-signs/', {'patientId': self.patient.patient_code, 'heartRate': 70}, format='json')
        self.client.post('/api/vital-signs/', {'patientId': self.patient.patient_code, 'heartRate': 95}, format='json')
        self.assertEqual(VitalSigns.objects.filter(patient=self.patient).count(), 2)
        recorded = sorted(VitalSigns.objects.filter(patient=self.patient).values_list('heart_rate', flat=True))
        self.assertEqual(recorded, [70, 95])

    def test_pain_scale_can_be_recorded(self):
        response = self.client.post(
            '/api/vital-signs/', {'patientId': self.patient.patient_code, 'painScale': 7}, format='json',
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.data['painScale'], 7)

    def test_can_correct_but_not_delete_a_charted_reading(self):
        create = self.client.post(
            '/api/vital-signs/', {'patientId': self.patient.patient_code, 'heartRate': 70}, format='json',
        )
        vid = create.data['id']

        patched = self.client.patch(f'/api/vital-signs/{vid}/', {'heartRate': 999}, format='json')
        self.assertEqual(patched.status_code, 200, patched.content)
        self.assertEqual(patched.data['heartRate'], 999)
        self.assertTrue(patched.data['edited'])
        self.assertEqual(len(patched.data['editHistory']), 1)
        self.assertEqual(patched.data['editHistory'][0]['previous']['heart_rate'], 70)

        self.assertEqual(self.client.delete(f'/api/vital-signs/{vid}/').status_code, 405)

    def test_unauthenticated_cannot_access(self):
        anon = APIClient()
        self.assertEqual(anon.get('/api/vital-signs/').status_code, 401)
        self.assertEqual(
            anon.post('/api/vital-signs/', {'patientId': self.patient.patient_code}, format='json').status_code, 401
        )
