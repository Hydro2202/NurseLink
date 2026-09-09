"""ChartingNote persistence — structured data round-trip and empty-save guard."""

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from api.models import ChartingNote, NurseProfile, Patient


class ChartingNotePersistenceTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            username='nurse@hospital.com',
            email='nurse@hospital.com',
            password='password123',
            first_name='Sarah',
            last_name='Johnson',
        )
        NurseProfile.objects.create(user=self.user, role='staff_nurse', department='ICU')
        self.client.force_authenticate(self.user)
        self.patient = Patient.objects.create(
            patient_code='P-2001',
            name='Ana Reyes',
            age=54,
            gender='Female',
            room='Ward-12',
            diagnosis='Post-op recovery',
            admission_date='2026-09-01',
            risk_level='low',
            attending_physician='Dr. Cruz',
            heart_rate=78,
            blood_pressure='118/76',
            temperature=36.8,
            oxygen_saturation=98,
            respiratory_rate=16,
            assigned_nurse=self.user,
        )

    def test_create_persists_structured_and_returns_it_on_retrieve(self):
        structured = {
            'patientName': 'Ana Reyes',
            'patientId': 'P-2001',
            'room': 'Ward-12',
            'assessment': 'Ambulated to chair, tolerated well. No complaints of pain.',
            'interventions': ['Assisted ambulation to chair'],
            'patientResponse': 'Tolerated well.',
            'vitalSigns': {
                'heartRate': '78 bpm',
                'bloodPressure': '118/76 mmHg',
            },
            'diagnosis': 'Post-op recovery',
            'riskLevel': 'Low',
        }
        create = self.client.post(
            '/api/charting/',
            {
                'patientId': 'P-2001',
                'timestamp': timezone.now().isoformat(),
                'type': 'progress',
                'content': '',
                'structured': structured,
                'aiGenerated': True,
            },
            format='json',
        )
        self.assertEqual(create.status_code, 201, create.data)
        note_id = create.data['id']
        self.assertTrue(note_id)
        self.assertIn('Ambulated to chair', create.data['content'])
        self.assertEqual(
            create.data['structured']['assessment'],
            'Ambulated to chair, tolerated well. No complaints of pain.',
        )
        self.assertEqual(
            create.data['structured']['interventions'],
            ['Assisted ambulation to chair'],
        )
        # Must not invent clinical content that was never provided.
        self.assertNotIn('fever', (create.data['content'] or '').lower())
        self.assertNotIn(
            'Medication administration as prescribed',
            str(create.data['structured']),
        )

        retrieve = self.client.get(f'/api/charting/{note_id}/')
        self.assertEqual(retrieve.status_code, 200)
        self.assertEqual(
            retrieve.data['structured']['assessment'],
            'Ambulated to chair, tolerated well. No complaints of pain.',
        )
        self.assertEqual(retrieve.data['patientId'], 'P-2001')
        self.assertEqual(retrieve.data['patientName'], 'Ana Reyes')

        listed = self.client.get('/api/charting/?patientId=P-2001')
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(len(listed.data), 1)
        self.assertEqual(
            listed.data[0]['structured']['patientResponse'],
            'Tolerated well.',
        )

        db_note = ChartingNote.objects.get(note_code=note_id)
        self.assertEqual(
            db_note.structured_data['assessment'],
            'Ambulated to chair, tolerated well. No complaints of pain.',
        )

    def test_empty_create_is_rejected(self):
        res = self.client.post(
            '/api/charting/',
            {
                'patientId': 'P-2001',
                'timestamp': timezone.now().isoformat(),
                'type': 'progress',
                'content': '   ',
                'structured': {},
                'aiGenerated': True,
            },
            format='json',
        )
        self.assertEqual(res.status_code, 400)
        self.assertEqual(ChartingNote.objects.count(), 0)

    def test_patient_filter_does_not_mix_records(self):
        other = Patient.objects.create(
            patient_code='P-2002',
            name='Other Patient',
            age=40,
            gender='Male',
            room='Ward-1',
            diagnosis='Observation',
            admission_date='2026-09-01',
            risk_level='low',
            attending_physician='Dr. Cruz',
            assigned_nurse=self.user,
        )
        ChartingNote.objects.create(
            note_code='C-TEST1',
            patient=self.patient,
            patient_name=self.patient.name,
            nurse=self.user,
            nurse_name='Sarah Johnson',
            timestamp=timezone.now(),
            note_type='progress',
            content='Note for Ana',
            structured_data={'assessment': 'Ana assessment'},
            ai_generated=True,
        )
        ChartingNote.objects.create(
            note_code='C-TEST2',
            patient=other,
            patient_name=other.name,
            nurse=self.user,
            nurse_name='Sarah Johnson',
            timestamp=timezone.now(),
            note_type='progress',
            content='Note for Other',
            structured_data={'assessment': 'Other assessment'},
            ai_generated=True,
        )

        ana = self.client.get('/api/charting/?patientId=P-2001')
        self.assertEqual(len(ana.data), 1)
        self.assertEqual(ana.data[0]['structured']['assessment'], 'Ana assessment')

    def _create_note(self, **overrides):
        payload = {
            'patientId': 'P-2001',
            'timestamp': timezone.now().isoformat(),
            'type': 'progress',
            'content': 'Patient ambulated to chair, tolerated well.',
            'structured': {
                'assessment': 'Patient ambulated to chair, tolerated well.',
                'patientName': 'Ana Reyes',
                'patientId': 'P-2001',
            },
            'aiGenerated': True,
        }
        payload.update(overrides)
        res = self.client.post('/api/charting/', payload, format='json')
        self.assertEqual(res.status_code, 201, res.data)
        return res.data

    def test_confirm_is_idempotent_and_persisted(self):
        created = self._create_note()
        note_id = created['id']
        self.assertFalse(created['confirmed'])

        first = self.client.post(f'/api/charting/{note_id}/confirm/')
        self.assertEqual(first.status_code, 200)
        self.assertTrue(first.data['confirmed'])
        self.assertIsNotNone(first.data['confirmedAt'])

        second = self.client.post(f'/api/charting/{note_id}/confirm/')
        self.assertEqual(second.status_code, 200)
        self.assertTrue(second.data['confirmed'])
        self.assertEqual(ChartingNote.objects.count(), 1)

        note = ChartingNote.objects.get(note_code=note_id)
        self.assertTrue(note.confirmed)

    def test_edit_updates_existing_record_without_duplicate(self):
        created = self._create_note()
        note_id = created['id']
        patch = self.client.patch(
            f'/api/charting/{note_id}/',
            {
                'content': 'Updated: ambulated and wound checked.',
                'structured': {
                    'assessment': 'Updated: ambulated and wound checked.',
                    'patientName': 'Ana Reyes',
                    'patientId': 'P-2001',
                },
            },
            format='json',
        )
        self.assertEqual(patch.status_code, 200, patch.data)
        self.assertEqual(patch.data['content'], 'Updated: ambulated and wound checked.')
        self.assertTrue(patch.data['edited'])
        self.assertEqual(ChartingNote.objects.count(), 1)
        self.assertEqual(
            ChartingNote.objects.get(note_code=note_id).structured_data['assessment'],
            'Updated: ambulated and wound checked.',
        )

    def test_delete_removes_only_target_note(self):
        a = self._create_note(content='Note A', structured={'assessment': 'A'})
        b = self._create_note(content='Note B', structured={'assessment': 'B'})
        deleted = self.client.delete(f'/api/charting/{a["id"]}/')
        self.assertEqual(deleted.status_code, 204)
        self.assertFalse(ChartingNote.objects.filter(note_code=a['id']).exists())
        self.assertTrue(ChartingNote.objects.filter(note_code=b['id']).exists())

    def test_history_dates_and_mine_are_nurse_scoped(self):
        other = User.objects.create_user(
            username='other@hospital.com',
            email='other@hospital.com',
            password='password123',
            first_name='Other',
            last_name='Nurse',
        )
        NurseProfile.objects.create(user=other, role='staff_nurse', department='ICU')
        self._create_note(content='Sarah note', structured={'assessment': 'Sarah'})
        ChartingNote.objects.create(
            note_code='C-OTHER1',
            patient=self.patient,
            patient_name=self.patient.name,
            nurse=other,
            nurse_name='Other Nurse',
            timestamp=timezone.now(),
            note_type='progress',
            content='Other nurse note',
            structured_data={'assessment': 'Other'},
            ai_generated=True,
        )

        mine = self.client.get('/api/charting/?mine=true')
        self.assertEqual(mine.status_code, 200)
        self.assertEqual(len(mine.data), 1)
        self.assertEqual(mine.data[0]['content'], 'Sarah note')

        dates = self.client.get('/api/charting/history-dates/')
        self.assertEqual(dates.status_code, 200)
        self.assertGreaterEqual(len(dates.data), 1)
        self.assertTrue(all('date' in row and 'count' in row for row in dates.data))
        # Other nurse's note must not inflate Sarah's history.
        total = sum(row['count'] for row in dates.data)
        self.assertEqual(total, 1)

        # Other nurse cannot confirm Sarah's note.
        other_client = APIClient()
        other_client.force_authenticate(other)
        forbidden = other_client.post(f'/api/charting/{mine.data[0]["id"]}/confirm/')
        self.assertEqual(forbidden.status_code, 403)

        other_dates = other_client.get('/api/charting/history-dates/')
        self.assertEqual(len(other_dates.data), 1)
        self.assertEqual(other_dates.data[0]['count'], 1)
