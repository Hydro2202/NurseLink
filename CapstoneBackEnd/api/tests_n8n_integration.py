"""
Tests for the three n8n workflow integrations.

Every test patches ``api.views.call_workflow`` — the point is to prove the
views really route through the n8n client and handle what comes back, not to
hit nurselink.app.n8n.cloud from CI. Live reachability is a separate,
deliberate check: ``python manage.py check_n8n``.
"""

from unittest import skip
from unittest.mock import patch

from django.contrib.auth.models import User
from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from api.id_photo_check import PortraitCheckResult
from api.models import ChartingNote, NurseProfile, Patient, RegistrationSession
from api.n8n_client import (
    N8nTimeout,
    N8nWorkflowOffline,
    webhook_url,
)


class WebhookUrlTests(TestCase):
    """URL assembly is what decides test-mode vs production. Worth pinning down."""

    @override_settings(
        N8N_BASE_URL='https://nurselink.app.n8n.cloud',
        N8N_WEBHOOK_PREFIX='webhook-test',
        N8N_WEBHOOKS={'face_verify': 'face-verify'},
    )
    def test_builds_test_mode_url(self):
        self.assertEqual(
            webhook_url('face_verify'),
            'https://nurselink.app.n8n.cloud/webhook-test/face-verify',
        )
# API STEP 1 ID
    @override_settings(
        N8N_BASE_URL='https://nurselink.app.n8n.cloud',
        N8N_WEBHOOK_PREFIX='webhook',
        N8N_WEBHOOKS={'verify_id': 'verify-id'},
    )
    def test_prefix_switches_to_production(self):
        self.assertEqual(
            webhook_url('verify_id'),
            'https://nurselink.app.n8n.cloud/webhook/verify-id',
        )

    @override_settings(N8N_WEBHOOKS={'structure_chart': ''})
    def test_unconfigured_workflow_has_no_url(self):
        self.assertEqual(webhook_url('structure_chart'), '')


class VerifyIdEndpointTests(TestCase):
    """POST /api/auth/verify-id/ — Persona steps 1 & 2."""

    def setUp(self):
        cache.clear()  # throttle history leaks in from real traffic
        self.client = APIClient()
        # These cover the n8n field mapping, not the portrait gate that now
        # runs ahead of it. Stub the gate open so the dummy images below
        # still reach the workflow; the gate has its own suite in
        # tests_id_photo_check.py.
        patcher = patch(
            'api.views.check_id_has_portrait',
            return_value=PortraitCheckResult(has_photo=True, face_count=1, confidence=0.9),
        )
        patcher.start()
        self.addCleanup(patcher.stop)

    @skip(
        'temporary not use - rai: the n8n verify-id OCR call is commented out in VerifyIdView, so these assert behaviour that returns when it is restored'
    )
    @patch('api.views.call_workflow')
    def test_posts_to_verify_id_workflow_and_maps_fields(self, mock_call):
        mock_call.return_value = {
            'verified': True,
            'fullName': 'Sarah Johnson',
            'employeeId': 'EMP-10001',
            'department': 'ICU',
            'position': 'Registered Nurse',
            'hospitalName': 'St. Luke’s Medical Center',
            'email': 'Sarah.Johnson@hospital.com',
            'confidence': 0.94,
        }

        res = self.client.post(
            '/api/auth/verify-id/',
            {'idImage': 'data:image/jpeg;base64,AAAA', 'documentType': 'hospital_id'},
            format='json',
        )

        self.assertEqual(res.status_code, 200)
        # It called the right workflow, with the image.
        workflow, payload = mock_call.call_args[0]
        self.assertEqual(workflow, 'verify_id')
        # Bare base64 — the data-URI prefix is stripped for the vision API.
        self.assertEqual(payload['idImage'], 'AAAA')
        self.assertEqual(payload['documentType'], 'hospital_id')
        # And mapped the OCR fields the wizard pre-fills.
        self.assertTrue(res.data['verified'])
        self.assertEqual(res.data['fullName'], 'Sarah Johnson')
        self.assertEqual(res.data['department'], 'ICU')
        self.assertTrue(res.data['registrationSessionId'])

    @skip(
        'temporary not use - rai: the n8n verify-id OCR call is commented out in VerifyIdView, so these assert behaviour that returns when it is restored'
    )
    @patch('api.views.call_workflow')
    def test_creates_session_and_stores_email(self, mock_call):
        mock_call.return_value = {'verified': True, 'fullName': 'Sarah Johnson',
                                  'email': 'Sarah.Johnson@hospital.com'}

        res = self.client.post(
            '/api/auth/verify-id/', {'idImage': 'x'}, format='json'
        )

        session = RegistrationSession.objects.get(
            session_id=res.data['registrationSessionId']
        )
        # Lower-cased so the OTP fallback can match it later.
        self.assertEqual(session.email, 'sarah.johnson@hospital.com')

    @patch('api.views.call_workflow')
    def test_reuses_supplied_session(self, mock_call):
        mock_call.return_value = {'verified': True, 'fullName': 'Sarah Johnson'}
        existing = RegistrationSession.objects.create(email='nurse@hospital.com')

        res = self.client.post(
            '/api/auth/verify-id/',
            {'idImage': 'x', 'registrationSessionId': str(existing.session_id)},
            format='json',
        )

        self.assertEqual(res.data['registrationSessionId'], str(existing.session_id))
        self.assertEqual(RegistrationSession.objects.count(), 1)

    @skip(
        'temporary not use - rai: the n8n verify-id OCR call is commented out in VerifyIdView, so these assert behaviour that returns when it is restored'
    )
    @patch('api.views.call_workflow')
    def test_unreadable_document_is_not_verified(self, mock_call):
        mock_call.return_value = {}

        res = self.client.post('/api/auth/verify-id/', {'idImage': 'x'}, format='json')

        self.assertEqual(res.status_code, 200)
        self.assertFalse(res.data['verified'])
        self.assertIn('retake', res.data['message'].lower())

    @skip(
        'temporary not use - rai: the n8n verify-id OCR call is commented out in VerifyIdView, so these assert behaviour that returns when it is restored'
    )
    @patch('api.views.call_workflow', side_effect=N8nWorkflowOffline(workflow='verify_id'))
    def test_offline_workflow_returns_503_not_500(self, _mock_call):
        res = self.client.post('/api/auth/verify-id/', {'idImage': 'x'}, format='json')

        self.assertEqual(res.status_code, 503)
        self.assertFalse(res.data['success'])
        self.assertEqual(res.data['workflow'], 'verify_id')
        self.assertIn('Execute workflow', res.data['detail'])

    def test_id_image_is_required(self):
        res = self.client.post('/api/auth/verify-id/', {}, format='json')
        self.assertEqual(res.status_code, 400)
        self.assertIn('idImage', res.data)


@override_settings(N8N_FACE_VERIFY_ENABLED=True, N8N_FACE_VERIFY_FALLBACK_LOCAL=False)
class FaceVerifyWorkflowTests(TestCase):
    """The face matcher routes through n8n, but the session rules stay server-side."""

    def setUp(self):
        cache.clear()  # throttle history leaks in from real traffic
        self.client = APIClient()
        self.session = RegistrationSession.objects.create(email='nurse@hospital.com')

    def _post(self):
        return self.client.post(
            '/api/auth/face-verification/',
            {
                'registrationSessionId': str(self.session.session_id),
                'image': 'data:image/jpeg;base64,AAAA',
                'idImage': 'data:image/jpeg;base64,BBBB',
            },
            format='json',
        )

    @patch('api.views.call_workflow')
    def test_images_are_sent_as_bare_base64(self, mock_call):
        """
        AWS Rekognition CompareFaces rejects a data-URI prefix in Image.Bytes.
        The client sends data-URIs, so the prefix must be stripped here rather
        than left for the workflow to remember.
        """
        mock_call.return_value = {'matched': True, 'confidence': 0.9}

        self._post()

        payload = mock_call.call_args[0][1]
        self.assertEqual(payload['image'], 'AAAA')
        self.assertEqual(payload['idImage'], 'BBBB')
        self.assertNotIn('data:', payload['image'])
        self.assertNotIn('base64,', payload['idImage'])

    @patch('api.views.call_workflow')
    def test_match_from_workflow_verifies_session(self, mock_call):
        mock_call.return_value = {'matched': True, 'confidence': 0.91}

        res = self._post()

        self.assertEqual(mock_call.call_args[0][0], 'face_verify')
        self.assertEqual(res.status_code, 200)
        self.session.refresh_from_db()
        self.assertTrue(self.session.face_verified)
        self.assertEqual(self.session.verification_method, 'FACE')

    @patch('api.views.call_workflow')
    def test_confidence_is_normalised_to_percent(self, mock_call):
        mock_call.return_value = {'matched': True, 'confidence': 0.91}
        res = self._post()
        self.assertAlmostEqual(res.data['confidence'], 91.0, places=3)

    @patch('api.views.call_workflow')
    def test_mismatch_says_the_face_did_not_match_the_hospital_id(self, mock_call):
        """
        A no-match must name the actual problem. "Please try again" sends the
        nurse to retake a photo when the real issue is that the captured face
        does not match the ID they uploaded in Step 1.
        """
        mock_call.return_value = {'matched': False, 'confidence': 0.2}

        res = self._post()

        self.assertIn('not matched with your hospital id', res.data['message'].lower())
        self.assertEqual(res.data['reason'], 'MISMATCH')

    @patch('api.views.call_workflow')
    def test_failure_message_reports_attempts_remaining(self, mock_call):
        mock_call.return_value = {'matched': False, 'confidence': 0.2}

        first = self._post()
        self.assertIn('2 attempts remaining', first.data['message'])

        second = self._post()
        self.assertIn('1 attempt remaining', second.data['message'])

    @patch('api.views.call_workflow')
    def test_reason_specific_message_is_used_when_workflow_supplies_one(self, mock_call):
        mock_call.return_value = {'matched': False, 'reason': 'ID_NO_FACE', 'confidence': 0}

        res = self._post()

        self.assertIn('No photo found on your Hospital ID', res.data['message'])
        self.assertEqual(res.data['reason'], 'ID_NO_FACE')

    @patch('api.views.call_workflow')
    def test_workflow_message_wins_over_the_canned_one(self, mock_call):
        mock_call.return_value = {
            'matched': False, 'message': 'Similarity 41% — below the 85% threshold.'
        }

        res = self._post()

        self.assertIn('Similarity 41%', res.data['message'])

    @patch('api.views.call_workflow')
    def test_mismatch_consumes_one_attempt(self, mock_call):
        mock_call.return_value = {'matched': False, 'confidence': 0.2, 'reason': 'MISMATCH'}

        self._post()

        self.session.refresh_from_db()
        self.assertEqual(self.session.face_attempts, 1)
        self.assertFalse(self.session.face_locked)

    @patch('api.views.call_workflow', return_value={})
    def test_empty_workflow_response_does_not_consume_an_attempt(self, _mock_call):
        """
        Regression, found against the live workflow.

        A Webhook node left on "Respond: Immediately" answers 200 with an
        empty body. Parsed literally that reads as "no match", which would
        fail the check *and* burn one of three attempts — locking a nurse out
        after three photos because of a workflow setting.
        """
        res = self._post()

        self.assertEqual(res.status_code, 502)
        self.assertFalse(res.data['countable'])
        self.session.refresh_from_db()
        self.assertEqual(self.session.face_attempts, 0)
        self.assertIn('Respond to Webhook', res.data['detail'])

    @patch('api.views.call_workflow', return_value={'confidence': 0.9, 'message': 'ok'})
    def test_response_without_a_verdict_key_is_rejected(self, _mock_call):
        # Confidence alone is not a decision.
        res = self._post()
        self.assertEqual(res.status_code, 502)
        self.session.refresh_from_db()
        self.assertEqual(self.session.face_attempts, 0)

    @patch('api.views.call_workflow', return_value={'matched': False, 'confidence': 0.1})
    def test_explicit_false_verdict_still_consumes_an_attempt(self, _mock_call):
        # The guard must not swallow a genuine "no match".
        self._post()
        self.session.refresh_from_db()
        self.assertEqual(self.session.face_attempts, 1)

    @patch('api.views.call_workflow', side_effect=N8nTimeout(workflow='face_verify'))
    def test_workflow_failure_does_not_consume_an_attempt(self, _mock_call):
        res = self._post()

        # No verdict was rendered, so the nurse must not lose one of three tries.
        self.assertEqual(res.status_code, 504)
        self.assertFalse(res.data['countable'])
        self.session.refresh_from_db()
        self.assertEqual(self.session.face_attempts, 0)

    @patch('api.views.verify_face_against_id')
    @patch('api.views.call_workflow', side_effect=N8nWorkflowOffline(workflow='face_verify'))
    @override_settings(N8N_FACE_VERIFY_FALLBACK_LOCAL=True)
    def test_opt_in_fallback_uses_local_matcher(self, _mock_call, mock_local):
        from api.face_match import FaceVerificationOutcome

        mock_local.return_value = FaceVerificationOutcome(True, 88.0, None, None, False)

        res = self._post()

        self.assertEqual(res.status_code, 200)
        mock_local.assert_called_once()
        self.session.refresh_from_db()
        self.assertTrue(self.session.face_verified)

    @override_settings(N8N_FACE_VERIFY_ENABLED=False)
    @patch('api.views.call_workflow')
    @patch('api.views.verify_face_against_id')
    def test_disabling_n8n_uses_local_matcher_only(self, mock_local, mock_call):
        from api.face_match import FaceVerificationOutcome

        mock_local.return_value = FaceVerificationOutcome(True, 88.0, None, None, False)

        self._post()

        mock_local.assert_called_once()
        mock_call.assert_not_called()

    @patch('api.views.call_workflow')
    def test_reset_never_calls_the_workflow(self, mock_call):
        self.session.face_attempts = 3
        self.session.face_locked = True
        self.session.save(update_fields=['face_attempts', 'face_locked'])

        res = self.client.post(
            '/api/auth/face-verification/',
            {'registrationSessionId': str(self.session.session_id), 'reset': True},
            format='json',
        )

        self.assertEqual(res.status_code, 200)
        mock_call.assert_not_called()
        self.session.refresh_from_db()
        self.assertEqual(self.session.face_attempts, 0)
        self.assertFalse(self.session.face_locked)


class StructureChartEndpointTests(TestCase):
    """POST /api/charting/structure/ — autocharting."""

    def setUp(self):
        cache.clear()  # throttle history leaks in from real traffic
        self.client = APIClient()
        self.user = User.objects.create_user(
            username='nurse@hospital.com', email='nurse@hospital.com',
            password='pw', first_name='Sarah', last_name='Johnson',
        )
        NurseProfile.objects.create(user=self.user, role='staff_nurse', department='ICU')
        self.client.force_authenticate(self.user)
        self.patient = Patient.objects.create(
            patient_code='P-1042',
            name='Ramon Dela Cruz',
            age=67,
            gender='Male',
            room='ICU-04',
            diagnosis='Community-acquired pneumonia',
            admission_date='2026-08-10',
            risk_level='high',
            attending_physician='Dr. Alvarez',
            heart_rate=96,
            blood_pressure='138/86',
            temperature=38.2,
            oxygen_saturation=93,
            respiratory_rate=22,
            assigned_nurse=self.user,
        )

    def _post(self, **overrides):
        payload = {'patientId': 'P-1042', 'assessment': 'Alert and oriented x3.'}
        payload.update(overrides)
        return self.client.post('/api/charting/structure/', payload, format='json')

    @patch('api.views.call_workflow')
    def test_sends_patient_context_to_workflow(self, mock_call):
        mock_call.return_value = {'note': 'NURSING PROGRESS NOTE ...'}

        res = self._post()

        self.assertEqual(res.status_code, 200)
        workflow, payload = mock_call.call_args[0]
        self.assertEqual(workflow, 'structure_chart')
        # The nurse types the assessment; the server supplies the clinical context.
        self.assertEqual(payload['assessment'], 'Alert and oriented x3.')
        self.assertEqual(payload['patient']['name'], 'Ramon Dela Cruz')
        self.assertEqual(payload['vitalSigns']['heartRate'], 96)
        self.assertEqual(payload['nurseName'], 'Sarah Johnson')

    @patch('api.views.call_workflow')
    def test_supplied_vitals_override_the_record(self, mock_call):
        mock_call.return_value = {'note': 'x'}

        self._post(vitalSigns={'heartRate': 102, 'bloodPressure': '142/88'})

        self.assertEqual(mock_call.call_args[0][1]['vitalSigns']['heartRate'], 102)

    @patch('api.views.call_workflow')
    def test_save_persists_an_ai_generated_note(self, mock_call):
        mock_call.return_value = {'note': 'NURSING PROGRESS NOTE\nPatient stable.'}

        res = self._post(save=True)

        self.assertTrue(res.data['saved'])
        note = ChartingNote.objects.get(note_code=res.data['noteId'])
        self.assertTrue(note.ai_generated)
        self.assertEqual(note.patient, self.patient)
        self.assertEqual(note.nurse, self.user)

    @patch('api.views.call_workflow')
    def test_without_save_nothing_is_persisted(self, mock_call):
        mock_call.return_value = {'note': 'x'}

        res = self._post()

        self.assertFalse(res.data['saved'])
        self.assertEqual(ChartingNote.objects.count(), 0)

    @patch('api.views.call_workflow')
    def test_structured_response_is_backfilled_with_patient_context(self, mock_call):
        mock_call.return_value = {'structured': {'assessment': 'Stable.'}}

        res = self._post()

        structured = res.data['structured']
        self.assertEqual(structured['assessment'], 'Stable.')
        # The workflow need not repeat what the server already knows.
        self.assertEqual(structured['patientName'], 'Ramon Dela Cruz')
        self.assertEqual(structured['room'], 'ICU-04')
        self.assertEqual(structured['nurseName'], 'Sarah Johnson')

    @patch('api.views.call_workflow')
    def test_empty_workflow_output_is_reported_not_silently_saved(self, mock_call):
        mock_call.return_value = {}

        res = self._post(save=True)

        self.assertEqual(res.status_code, 502)
        self.assertEqual(ChartingNote.objects.count(), 0)

    @patch('api.views.call_workflow', side_effect=N8nWorkflowOffline(workflow='structure_chart'))
    def test_offline_workflow_returns_503(self, _mock_call):
        res = self._post()
        self.assertEqual(res.status_code, 503)
        self.assertEqual(res.data['workflow'], 'structure_chart')

    @patch('api.views.call_workflow')
    def test_unknown_patient_is_404_and_never_calls_the_workflow(self, mock_call):
        res = self._post(patientId='NOPE')

        self.assertEqual(res.status_code, 404)
        mock_call.assert_not_called()

    def test_requires_authentication(self):
        self.client.force_authenticate(None)
        res = self._post()
        self.assertEqual(res.status_code, 401)
