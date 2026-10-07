"""
Tests for the three n8n workflow integrations.

Every test patches ``api.views.call_workflow`` — the point is to prove the
views really route through the n8n client and handle what comes back, not to
hit nurselink.app.n8n.cloud from CI. Live reachability is a separate,
deliberate check: ``python manage.py check_n8n``.
"""

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
        # verify_id and face_verify both prefer N8N_IDENTITY_VERIFY_WEBHOOK when
        # set (they share one consolidated workflow) — clear it here so this
        # test exercises the composed-URL fallback instead of whatever real
        # override happens to be in .env.
        N8N_IDENTITY_VERIFY_WEBHOOK='',
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
        N8N_IDENTITY_VERIFY_WEBHOOK='',
    )
    def test_prefix_switches_to_production(self):
        self.assertEqual(
            webhook_url('verify_id'),
            'https://nurselink.app.n8n.cloud/webhook/verify-id',
        )

    @override_settings(N8N_WEBHOOKS={'structure_chart': ''}, N8N_AUTO_CHARTING_WEBHOOK_URL='')
    def test_unconfigured_workflow_has_no_url(self):
        self.assertEqual(webhook_url('structure_chart'), '')

    @override_settings(
        N8N_BASE_URL='https://old.example.com',
        N8N_WEBHOOK_PREFIX='webhook',
        N8N_WEBHOOKS={'structure_chart': 'structure-chart'},
        N8N_AUTO_CHARTING_WEBHOOK_URL='https://nurselinkk.app.n8n.cloud/webhook/structure-chart',
    )
    def test_auto_charting_override_wins_over_composed_url(self):
        """
        Auto-Charting lives on a different n8n instance from identity
        verification, so it must not inherit N8N_BASE_URL. Without the
        override, charting traffic silently goes to whichever instance the
        identity workflows use.
        """
        self.assertEqual(
            webhook_url('structure_chart'),
            'https://nurselinkk.app.n8n.cloud/webhook/structure-chart',
        )

    @override_settings(N8N_IDENTITY_VERIFY_WEBHOOK='https://nurselink.app.n8n.cloud/webhook/identity-verify')
    def test_identity_verify_override_applies_to_both_actions(self):
        # verify_id and face_verify are one consolidated n8n workflow — a
        # configured override must route both actions to the same URL.
        self.assertEqual(webhook_url('verify_id'), webhook_url('face_verify'))
        self.assertEqual(
            webhook_url('face_verify'),
            'https://nurselink.app.n8n.cloud/webhook/identity-verify',
        )


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
        # A response with no PRC-style fields (no last/first name, no
        # registration number, no dates) cannot claim "verified" — strict
        # field validation is the sole authority, whatever the workflow says.
        self.assertFalse(res.data['verified'])
        self.assertEqual(res.data['fullName'], 'Sarah Johnson')
        self.assertTrue(res.data['registrationSessionId'])
        # Employee-badge fields are no longer read: a PRC licence carries no
        # department, position, hospital or email, so anything OCR put in
        # those slots was text lifted from elsewhere on the card.
        for dropped in ('department', 'position', 'hospitalName', 'employeeId', 'email'):
            self.assertNotIn(dropped, res.data)

    @patch('api.views.call_workflow')
    def test_raw_text_overrides_misaligned_workflow_fields(self, mock_call):
        # Shape seen live: n8n shifted every value by one label on a card
        # whose two date labels are stacked above their values.
        mock_call.return_value = {
            'success': True,
            'lastName': '12/27/2025',
            'firstName': '06/29/2029',
            'middleName': 'NURSE',
            'rawText': 'Republic of the Philippines\nPROFESSIONAL REGULATION COMMISSION\nPROFESSIONAL IDENTIFICATION CARD\nLAST NAME\n• VILLAPANDO\nFIRST NAME\n• RAIDEN\nMIDDLE NAME\nNA\nREGISTRATION NO.\n• 0987654\nREGISTRATION DATE\nVALID UNTIL\n12/27/2025\n06/29/2029\nNURSE',
        }

        res = self.client.post(
            '/api/auth/verify-id/', {'idImage': 'data:image/jpeg;base64,AAAA'}, format='json'
        )

        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data['verified'], res.data)
        self.assertEqual(res.data['lastName'], 'VILLAPANDO')
        self.assertEqual(res.data['firstName'], 'RAIDEN')
        self.assertEqual(res.data['middleName'], '')
        self.assertEqual(res.data['registrationNumber'], '0987654')
        self.assertEqual(res.data['registrationDate'], '2025-12-27')
        self.assertEqual(res.data['validUntil'], '2029-06-29')

    @patch('api.views.call_workflow')
    def test_maps_prc_style_name_and_licence_fields_for_step_2(self, mock_call):
        """
        Step 2 (ID Review) shows Last/First/Middle name, Registration No.,
        Registration Date and Valid Until — a PRC-shaped OCR response, not
        the employee-badge shape. Registration Date and Valid Until are
        distinct fields, not aliases of each other.
        """
        mock_call.return_value = {
            'lastName': 'Dela Cruz',
            'firstName': 'Maria',
            'middleName': 'Santos',
            'registrationNumber': '0123456',
            'registrationDate': '06/15/2022',
            'validUntil': '06/30/2027',
        }

        res = self.client.post(
            '/api/auth/verify-id/', {'idImage': 'data:image/jpeg;base64,AAAA'}, format='json'
        )

        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data['verified'])
        self.assertEqual(res.data['verificationStatus'], 'verified')
        self.assertEqual(res.data['lastName'], 'Dela Cruz')
        self.assertEqual(res.data['firstName'], 'Maria')
        self.assertEqual(res.data['middleName'], 'Santos')
        self.assertEqual(res.data['registrationNumber'], '0123456')
        # Normalized to ISO by strict validation — not the raw OCR format.
        self.assertEqual(res.data['registrationDate'], '2022-06-15')
        self.assertEqual(res.data['validUntil'], '2027-06-30')
        self.assertNotEqual(res.data['registrationDate'], res.data['validUntil'])
        # No fullName came back from the workflow, so one is assembled from
        # the parts for anything downstream that only reads fullName.
        self.assertEqual(res.data['fullName'], 'Maria Santos Dela Cruz')

    @patch('api.views.call_workflow')
    def test_reads_fields_nested_under_a_data_key(self, mock_call):
        """
        {"success": true, "data": {"last_name": ..., ...}} — the shape a
        workflow returns when it nests results instead of a flat object.
        """
        mock_call.return_value = {
            'success': True,
            'verification_status': 'verified',
            'data': {
                'last_name': 'Dela Cruz',
                'first_name': 'Juan',
                'middle_name': 'Santos',
                'registration_no': '1234567',
                'registration_date': '2022-06-15',
                'valid_until': '2027-06-15',
            },
        }

        res = self.client.post(
            '/api/auth/verify-id/', {'idImage': 'data:image/jpeg;base64,AAAA'}, format='json'
        )

        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data['verified'])
        # The workflow's own verification_status is respected as-is.
        self.assertEqual(res.data['verificationStatus'], 'verified')
        self.assertEqual(res.data['lastName'], 'Dela Cruz')
        self.assertEqual(res.data['registrationNumber'], '1234567')
        self.assertEqual(res.data['registrationDate'], '2022-06-15')
        self.assertEqual(res.data['validUntil'], '2027-06-15')

    @patch('api.views.call_workflow')
    def test_partial_extraction_is_validation_error_not_verified(self, mock_call):
        """A name with no registration number/dates fails strict validation, not full verification."""
        mock_call.return_value = {'lastName': 'Dela Cruz', 'firstName': 'Maria'}

        res = self.client.post(
            '/api/auth/verify-id/', {'idImage': 'data:image/jpeg;base64,AAAA'}, format='json'
        )

        self.assertEqual(res.status_code, 200)
        self.assertFalse(res.data['verified'])
        self.assertEqual(res.data['verificationStatus'], 'validation_error')
        self.assertEqual(res.data['status'], 'validation_error')
        self.assertTrue(res.data['message'])
        self.assertIn('registration_no', res.data['errors'])
        self.assertIn('registration_date', res.data['errors'])
        self.assertIn('valid_until', res.data['errors'])
        # The two names that WERE present were valid, so they are not flagged.
        self.assertNotIn('last_name', res.data['errors'])
        self.assertNotIn('first_name', res.data['errors'])

    @patch('api.views.call_workflow')
    def test_reported_bug_end_to_end_is_rejected_and_never_persisted(self, mock_call):
        """
        Reproduces the exact reported failure through the full view: a
        workflow that claims success but garbled the labels, putting
        "REGISTRATION DATE May 21" in last_name and "2005" in first_name.
        Even though the workflow itself says verified=True, the session must
        come out of this with no id_* fields populated at all.
        """
        mock_call.return_value = {
            'verified': True,  # the workflow itself is wrong about this
            'lastName': 'REGISTRATION DATE May 21',
            'firstName': '2005',
            'middleName': '',
            'registrationNumber': '1234567',
            'validUntil': 'May 21, 2005',
            # registrationDate never separately extracted by whatever
            # produced this — matches the bug report exactly.
        }
        existing = RegistrationSession.objects.create()

        res = self.client.post(
            '/api/auth/verify-id/',
            {'idImage': 'data:image/jpeg;base64,AAAA', 'registrationSessionId': str(existing.session_id)},
            format='json',
        )

        self.assertEqual(res.status_code, 200)
        self.assertFalse(res.data['success'])
        self.assertFalse(res.data['verified'])
        self.assertEqual(res.data['verificationStatus'], 'validation_error')
        self.assertIn('last_name', res.data['errors'])
        self.assertIn('first_name', res.data['errors'])

        existing.refresh_from_db()
        self.assertEqual(existing.id_last_name, '')
        self.assertEqual(existing.id_first_name, '')
        self.assertIsNone(existing.id_registration_date)
        self.assertIsNone(existing.id_valid_until)
        self.assertEqual(existing.id_verification_status, '')

    @patch('api.views.call_workflow')
    def test_correct_extraction_end_to_end_is_persisted_to_session(self, mock_call):
        mock_call.return_value = {
            'lastName': 'Mangulabnan',
            'firstName': 'Lawrence',
            'middleName': 'Yanggao',
            'registrationNumber': '1234567',
            'registrationDate': 'May 21, 2005',
            'validUntil': 'May 21, 2010',
        }
        existing = RegistrationSession.objects.create()

        res = self.client.post(
            '/api/auth/verify-id/',
            {'idImage': 'data:image/jpeg;base64,AAAA', 'registrationSessionId': str(existing.session_id)},
            format='json',
        )

        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data['success'])
        self.assertTrue(res.data['verified'])
        self.assertEqual(res.data['verificationStatus'], 'verified')
        self.assertEqual(res.data['registrationDate'], '2005-05-21')
        self.assertEqual(res.data['validUntil'], '2010-05-21')

        existing.refresh_from_db()
        self.assertEqual(existing.id_last_name, 'Mangulabnan')
        self.assertEqual(existing.id_first_name, 'Lawrence')
        self.assertEqual(existing.id_middle_name, 'Yanggao')
        self.assertEqual(existing.id_registration_no, '1234567')
        self.assertEqual(existing.id_registration_date.isoformat(), '2005-05-21')
        self.assertEqual(existing.id_valid_until.isoformat(), '2010-05-21')
        self.assertEqual(existing.id_verification_status, 'verified')

    @patch('api.views.call_workflow')
    def test_empty_extraction_is_invalid_id(self, mock_call):
        mock_call.return_value = {}

        res = self.client.post(
            '/api/auth/verify-id/', {'idImage': 'data:image/jpeg;base64,AAAA'}, format='json'
        )

        self.assertEqual(res.status_code, 200)
        self.assertFalse(res.data['verified'])
        self.assertEqual(res.data['verificationStatus'], 'invalid_id')

    @patch('api.views.call_workflow')
    def test_ocr_no_longer_takes_the_email_off_the_card(self, mock_call):
        mock_call.return_value = {'verified': True, 'fullName': 'Sarah Johnson',
                                  'email': 'Sarah.Johnson@hospital.com'}

        res = self.client.post(
            '/api/auth/verify-id/', {'idImage': 'x'}, format='json'
        )

        session = RegistrationSession.objects.get(
            session_id=res.data['registrationSessionId']
        )
        # A PRC licence carries no email address, so anything OCR produced for
        # one was text taken from elsewhere on the card — and writing that to
        # the session would send the OTP to an address the nurse never gave.
        # Step 2 (RegistrationEmailView) collects it directly instead.
        self.assertEqual(session.email, '')
        self.assertNotIn('email', res.data)

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

    @patch('api.views.call_workflow')
    def test_unreadable_document_is_not_verified(self, mock_call):
        mock_call.return_value = {}

        res = self.client.post('/api/auth/verify-id/', {'idImage': 'x'}, format='json')

        self.assertEqual(res.status_code, 200)
        self.assertFalse(res.data['verified'])
        self.assertIn('retake', res.data['message'].lower())

    # With the local OCR fallback on (the default — see
    # tests_id_photo_check.py for that path), an offline workflow no longer
    # hard-fails registration; it falls through to Tesseract instead. This
    # isolates the n8n-only path by switching the fallback off, same as
    # test_ocr_workflow_returning_nothing_is_not_verified does.
    @override_settings(ID_OCR_LOCAL_FALLBACK=False)
    @patch('api.views.call_workflow', side_effect=N8nWorkflowOffline(workflow='verify_id'))
    def test_offline_workflow_returns_503_not_500(self, _mock_call):
        res = self.client.post('/api/auth/verify-id/', {'idImage': 'x'}, format='json')

        self.assertEqual(res.status_code, 503)
        self.assertFalse(res.data['success'])
        self.assertEqual(res.data['workflow'], 'verify_id')
        self.assertIn('Execute workflow', res.data['detail'])

    def test_id_image_is_required(self):
        # Neither a multipart `prc_id` file nor a legacy `idImage` string —
        # a clean, explicit error, not a raw serializer field error.
        res = self.client.post('/api/auth/verify-id/', {}, format='json')
        self.assertEqual(res.status_code, 400)
        self.assertFalse(res.data['success'])
        self.assertEqual(res.data['message'], 'PRC ID image is required.')


class VerifyIdMultipartUploadTests(TestCase):
    """
    POST /api/auth/verify-id/ with a real multipart file (field name
    `prc_id`) — the preferred path, sending actual image bytes to n8n
    instead of a base64 string in a JSON body.
    """

    def setUp(self):
        cache.clear()
        self.client = APIClient()
        patcher = patch(
            'api.views.check_id_has_portrait',
            return_value=PortraitCheckResult(has_photo=True, face_count=1, confidence=0.9),
        )
        patcher.start()
        self.addCleanup(patcher.stop)

    def _uploaded_file(self, name='prc_id.jpg', content_type='image/jpeg', size=2048):
        from django.core.files.uploadedfile import SimpleUploadedFile

        return SimpleUploadedFile(name, b'\xff' * size, content_type=content_type)

    @patch('api.views.call_workflow_multipart')
    def test_sends_real_file_bytes_not_a_filename_string(self, mock_multipart):
        mock_multipart.return_value = {
            'success': True,
            'verification_status': 'verified',
            'data': {
                'last_name': 'Dela Cruz',
                'first_name': 'Juan',
                'middle_name': 'Santos',
                'registration_no': '1234567',
                'registration_date': '2022-06-15',
                'valid_until': '2027-06-15',
            },
        }

        res = self.client.post(
            '/api/auth/verify-id/', {'prc_id': self._uploaded_file()}, format='multipart'
        )

        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data['verified'])
        self.assertEqual(res.data['lastName'], 'Dela Cruz')
        self.assertEqual(res.data['registrationDate'], '2022-06-15')

        mock_multipart.assert_called_once()
        call_kwargs = mock_multipart.call_args.kwargs
        self.assertEqual(mock_multipart.call_args.args[0], 'verify_id')
        sent_files = call_kwargs['files']
        self.assertIn('prc_id', sent_files)
        filename, file_obj, content_type = sent_files['prc_id']
        self.assertEqual(filename, 'prc_id.jpg')
        self.assertEqual(content_type, 'image/jpeg')
        # The actual bytes are readable from the stream handed to n8n — not
        # just the filename and not a data-URI string.
        self.assertTrue(hasattr(file_obj, 'read'))
        # form fields (action, documentType, etc.) travel as `data`, not `files`.
        self.assertEqual(call_kwargs['data']['action'], 'extract_id')

    def test_rejects_empty_upload(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        empty = SimpleUploadedFile('prc_id.jpg', b'', content_type='image/jpeg')
        res = self.client.post('/api/auth/verify-id/', {'prc_id': empty}, format='multipart')
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data['message'], 'PRC ID image is required.')

    def test_rejects_unsupported_file_type(self):
        pdf = self._uploaded_file(name='prc_id.pdf', content_type='application/pdf')
        res = self.client.post('/api/auth/verify-id/', {'prc_id': pdf}, format='multipart')
        self.assertEqual(res.status_code, 400)
        self.assertIn('Unsupported file format', res.data['message'])

    def test_rejects_oversized_file(self):
        oversized = self._uploaded_file(size=6 * 1024 * 1024)
        res = self.client.post('/api/auth/verify-id/', {'prc_id': oversized}, format='multipart')
        self.assertEqual(res.status_code, 400)
        self.assertIn('too large', res.data['message'].lower())

    # Same reasoning as test_offline_workflow_returns_503_not_500 above: the
    # local OCR fallback (on by default) now catches this instead of
    # hard-failing, so isolating the n8n-only path needs it switched off.
    @override_settings(ID_OCR_LOCAL_FALLBACK=False)
    @patch('api.views.call_workflow_multipart')
    def test_n8n_error_on_multipart_path_is_handled_like_json_path(self, mock_multipart):
        mock_multipart.side_effect = N8nWorkflowOffline(workflow='verify_id')

        res = self.client.post(
            '/api/auth/verify-id/', {'prc_id': self._uploaded_file()}, format='multipart'
        )

        self.assertEqual(res.status_code, 503)
        self.assertFalse(res.data['success'])
        self.assertEqual(res.data['verificationStatus'], 'unavailable')


@override_settings(N8N_FACE_VERIFY_ENABLED=True, N8N_FACE_VERIFY_FALLBACK_LOCAL=False)
class FaceVerifyWorkflowTests(TestCase):
    """The face matcher routes through n8n, but the session rules stay server-side."""

    def setUp(self):
        cache.clear()  # throttle history leaks in from real traffic
        self.client = APIClient()
        # Face verification now requires Step 1's ID validation to have
        # already passed — these tests are about the face-match logic
        # specifically, so start from a session that's already cleared it.
        self.session = RegistrationSession.objects.create(
            email='nurse@hospital.com', id_verification_status='verified', id_portrait='data:image/jpeg;base64,PORTRAIT'
        )

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
        # The card the face is matched against is the one scanned for this session
        # (stored server-side), never the idImage the client sent.
        self.assertEqual(payload['idImage'], 'PORTRAIT')
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

        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data['code'], 'reset_not_allowed')
        mock_call.assert_not_called()
        self.session.refresh_from_db()
        self.assertEqual(self.session.face_attempts, 3)
        self.assertTrue(self.session.face_locked)


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
        # The nurse types the assessment; the server supplies demographic
        # context. Vitals are NOT seeded from Patient's stored snapshot —
        # they must be extracted from the assessment text (or an explicit
        # manual override), so with neither given here the payload carries
        # no vitalSigns at all rather than the patient's on-record 96 bpm.
        self.assertEqual(payload['assessment'], 'Alert and oriented x3.')
        self.assertEqual(payload['patient']['name'], 'Ramon Dela Cruz')
        self.assertIsNone(payload['vitalSigns'])
        self.assertEqual(payload['nurseName'], 'Sarah Johnson')

    @patch('api.views.call_workflow')
    def test_supplied_vitals_are_sent_as_a_manual_override(self, mock_call):
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
        self.assertEqual(note.content, 'NURSING PROGRESS NOTE\nPatient stable.')

    @patch('api.views.call_workflow')
    def test_save_persists_structured_sections(self, mock_call):
        mock_call.return_value = {
            'note': '',
            'structured': {
                'assessment': 'Ambulated to chair, tolerated well.',
                'interventions': ['Assisted ambulation'],
                'patientResponse': 'No complaints of pain.',
            },
        }

        res = self._post(save=True)

        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data['saved'])
        note = ChartingNote.objects.get(note_code=res.data['noteId'])
        self.assertEqual(note.structured_data.get('assessment'), 'Ambulated to chair, tolerated well.')
        self.assertEqual(note.structured_data.get('interventions'), ['Assisted ambulation'])
        self.assertIn('Ambulated to chair', note.content)
        # Must not invent clinical interventions beyond what was returned.
        self.assertNotIn('Medication administration as prescribed', note.content)

    @patch('api.views.call_workflow')
    def test_without_save_nothing_is_persisted(self, mock_call):
        mock_call.return_value = {'note': 'x'}

        res = self._post()

        self.assertFalse(res.data['saved'])
        self.assertEqual(ChartingNote.objects.count(), 0)

    @patch('api.views.call_workflow')
    def test_structured_response_is_backfilled_with_patient_context(self, mock_call):
        mock_call.return_value = {
            'structured': {
                'assessment': 'Stable. HR 88, temp 38.9C noted on exam.',
                'vitalSigns': {'heartRate': 88, 'temperature': 38.9},
            }
        }

        res = self._post()

        structured = res.data['structured']
        self.assertEqual(structured['assessment'], 'Stable. HR 88, temp 38.9C noted on exam.')
        # Server forces authoritative patient identity/demographic context
        # onto the structured payload — but NOT vitals, which come from
        # exactly what the workflow extracted from the assessment text.
        self.assertEqual(structured['patientName'], 'Ramon Dela Cruz')
        self.assertEqual(structured['room'], 'ICU-04')
        self.assertEqual(structured['nurseName'], 'Sarah Johnson')
        self.assertEqual(structured['sourceAssessment'], 'Alert and oriented x3.')
        self.assertEqual(structured['vitalSigns']['heartRate'], 88)
        self.assertEqual(structured['vitalSigns']['temperature'], 38.9)
        self.assertEqual(structured['diagnosis'], 'Community-acquired pneumonia')

    @patch('api.views.call_workflow')
    def test_vitals_not_mentioned_in_the_assessment_come_back_null_not_the_stored_record(self, mock_call):
        """
        The bug this guards against: vitalSigns used to be unconditionally
        overwritten with Patient.heart_rate/etc. (96/138/86/38.2/93/22 here),
        discarding whatever — or nothing — the workflow actually found in
        the assessment text. A vital genuinely not documented must come back
        null, never silently backfilled from the patient's on-record values.
        """
        mock_call.return_value = {'structured': {'assessment': 'Stable.'}}

        res = self._post()

        vitals = res.data['structured']['vitalSigns']
        self.assertEqual(
            vitals,
            {
                'heartRate': None, 'bloodPressure': None, 'temperature': None,
                'oxygenSaturation': None, 'respiratoryRate': None,
            },
        )

    @patch('api.views.call_workflow')
    def test_workflow_returning_zero_for_a_vital_is_treated_as_not_documented(self, mock_call):
        mock_call.return_value = {
            'structured': {'vitalSigns': {'heartRate': 0, 'temperature': 37.1}},
        }

        res = self._post()

        vitals = res.data['structured']['vitalSigns']
        self.assertIsNone(vitals['heartRate'])
        self.assertEqual(vitals['temperature'], 37.1)

    @patch('api.views.call_workflow')
    def test_vitals_are_extracted_from_the_assessment_text_even_when_the_workflow_returns_none(
        self, mock_call
    ):
        """
        Reproduces the real, confirmed n8n behavior: the workflow's own LLM
        node turns vitals language into prose (assessment/clinicalSummary
        text) rather than a structured vitalSigns object — verified by
        calling it live with this exact kind of text. The backend's own
        deterministic extraction (api/vitals_extraction.py) must still
        populate the form fields from the assessment text alone.
        """
        mock_call.return_value = {
            'structured': {
                'assessment': 'Patient is febrile with tachycardia and hypertension.',
                # No 'vitalSigns' key — exactly what the live workflow returns.
            }
        }

        res = self._post(
            assessment=(
                'Heart rate 110 bpm, irregular. Temperature 38.6C, febrile. '
                'SpO2 92% on room air. Respiratory rate 24. BP 160/100, elevated.'
            )
        )

        vitals = res.data['structured']['vitalSigns']
        self.assertEqual(vitals['heartRate'], 110)
        self.assertEqual(vitals['temperature'], 38.6)
        self.assertEqual(vitals['oxygenSaturation'], 92)
        self.assertEqual(vitals['respiratoryRate'], 24)
        self.assertEqual(vitals['bloodPressure'], '160/100')

    @patch('api.views.call_workflow')
    def test_text_extraction_wins_over_the_workflows_own_extraction(self, mock_call):
        # The nurse's own words are more trustworthy than whatever the
        # workflow's LLM node happened to produce for the same note.
        mock_call.return_value = {
            'structured': {'vitalSigns': {'heartRate': 70}},
        }

        res = self._post(assessment='Heart rate 110, irregular rhythm noted.')

        self.assertEqual(res.data['structured']['vitalSigns']['heartRate'], 110)

    @patch('api.views.call_workflow')
    def test_manual_override_wins_over_the_workflows_own_extraction(self, mock_call):
        mock_call.return_value = {
            'structured': {'vitalSigns': {'heartRate': 88, 'bloodPressure': '120/80'}},
        }

        res = self._post(vitalSigns={'heartRate': 102})

        vitals = res.data['structured']['vitalSigns']
        self.assertEqual(vitals['heartRate'], 102)
        # A field the override didn't touch still falls back to the
        # workflow's own extraction rather than going blank.
        self.assertEqual(vitals['bloodPressure'], '120/80')

    @patch('api.views.call_workflow')
    def test_empty_workflow_output_falls_back_but_is_not_silently_saved(self, mock_call):
        mock_call.return_value = {}

        res = self._post(save=True)

        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data['fallback'])
        self.assertFalse(res.data['aiGenerated'])
        self.assertFalse(res.data['saved'])
        self.assertTrue(res.data['warning'])
        self.assertEqual(ChartingNote.objects.count(), 0)

    @patch('api.views.call_workflow')
    def test_unusable_workflow_output_is_structured_from_nurse_text(self, mock_call):
        # Shape seen live from the structure-chart webhook.
        mock_call.return_value = {
            'title': 'Empty Chart', 'category': 'General',
            'summary': 'No data was provided for chart creation.', 'data': [], 'status': 'completed',
        }

        res = self._post(
            assessment=(
                'Data:\nHeadache 4/10. BP 160/100.\n\n'
                'Action:\nAssisted patient to a comfortable position. Encouraged rest.\n\n'
                'Response:\nHeadache decreased to 2/10.'
            ),
        )

        self.assertEqual(res.status_code, 200)
        structured = res.data['structured']
        self.assertTrue(res.data['fallback'])
        self.assertEqual(structured['assessment'], 'Headache 4/10. BP 160/100.')
        self.assertEqual(
            structured['interventions'],
            ['Assisted patient to a comfortable position.', 'Encouraged rest.'],
        )
        self.assertEqual(structured['patientResponse'], 'Headache decreased to 2/10.')
        self.assertEqual(structured['vitalSigns']['bloodPressure'], '160/100')

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
