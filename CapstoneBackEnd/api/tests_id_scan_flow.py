"""
End-to-end ID scan flow: OCR → confidence → n8n → attempt logging.

The assertions that matter most are the negative ones. A verification system
that over-reports success is worse than one that fails loudly, so several
tests here exist purely to prove the system will *not* say "verified" when a
required step did not actually succeed.
"""

import base64
from unittest.mock import patch

import cv2
import numpy as np
from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from api.id_photo_check import PortraitCheckResult
from api.models import IdScanAttempt, RegistrationSession
from api.n8n_client import N8nWorkflowOffline, as_data_uri, strip_data_uri
from api.prc_ocr import LOW_CONFIDENCE_THRESHOLD, field_report

# Two genuinely different layouts, to prove extraction is label-driven and
# not tuned to one card.
PRC_LAYOUT = """
REPUBLIC OF THE PHILIPPINES
PROFESSIONAL REGULATION COMMISSION
NURSE
LAST NAME    DELA CRUZ
FIRST NAME   JUAN
MIDDLE NAME  SANTOS
REGISTRATION NO. 0012345
REGISTRATION DATE 04/05/2019
VALID UNTIL 11/25/2027
"""

HOSPITAL_LAYOUT = """
ST LUKES MEDICAL CENTER
SURNAME
REYES
GIVEN NAME
MARIA
MIDDLE NAME
LOPEZ
LICENSE NO.: 7654321
DATE OF ISSUE JANUARY 5, 2020
EXPIRY DATE MARCH 3, 2028
"""

PARTIAL_LAYOUT = """
LAST NAME  CRUZ
FIRST NAME MARIA
VALID UNTIL 01/01/2029
"""


def _image() -> str:
    img = np.full((300, 480, 3), 244, dtype=np.uint8)
    ok, buf = cv2.imencode('.jpg', img)
    return 'data:image/jpeg;base64,' + base64.b64encode(buf.tobytes()).decode()


class FieldExtractionAcrossLayoutsTests(TestCase):
    """Different cards, same six fields — extraction follows labels, not position."""

    def test_prc_layout(self):
        r = field_report(PRC_LAYOUT)
        self.assertEqual(r['lastName'], 'Dela Cruz')
        self.assertEqual(r['firstName'], 'Juan')
        self.assertEqual(r['middleName'], 'Santos')
        self.assertEqual(r['registrationNumber'], '0012345')
        self.assertEqual(r['registrationDate'], '04/05/2019')
        self.assertEqual(r['validUntil'], '11/25/2027')
        self.assertTrue(r['complete'])

    def test_hospital_layout_with_different_labels_and_word_dates(self):
        r = field_report(HOSPITAL_LAYOUT)
        self.assertEqual(r['lastName'], 'Reyes')
        self.assertEqual(r['firstName'], 'Maria')
        self.assertEqual(r['middleName'], 'Lopez')
        self.assertEqual(r['registrationNumber'], '7654321')
        # Written dates are normalised to the same MM/DD/YYYY as numeric ones.
        self.assertEqual(r['registrationDate'], '01/05/2020')
        self.assertEqual(r['validUntil'], '03/03/2028')
        self.assertTrue(r['complete'])

    def test_fields_are_never_swapped_between_slots(self):
        r = field_report(PRC_LAYOUT)
        # The classic OCR failure is a date landing in a name field.
        self.assertNotIn('/', r['lastName'])
        self.assertNotIn('/', r['firstName'])
        self.assertFalse(any(ch.isdigit() for ch in r['lastName']))
        self.assertNotEqual(r['registrationDate'], r['validUntil'])

    def test_missing_fields_are_reported_not_invented(self):
        r = field_report(PARTIAL_LAYOUT)
        self.assertEqual(r['middleName'], '')
        self.assertEqual(r['registrationDate'], '')
        self.assertIn('registrationNumber', r['missingRequired'])
        self.assertFalse(r['complete'])

    def test_low_confidence_values_are_flagged_for_review(self):
        r = field_report(PARTIAL_LAYOUT)
        self.assertIn('registrationNumber', r['needsReview'])
        for name in r['needsReview']:
            self.assertLess(
                r['confidence'][name], LOW_CONFIDENCE_THRESHOLD + 0.001,
                f'{name} was flagged but scored high',
            )

    def test_label_anchored_values_score_higher_than_guesses(self):
        labelled = field_report(PRC_LAYOUT)
        self.assertGreaterEqual(labelled['confidence']['lastName'], 0.9)
        # A date with no label is a guess and must score lower.
        guessed = field_report('SOME CARD 12/31/2030')
        self.assertLess(guessed['confidence']['validUntil'], 0.75)


class ImageFormatForN8nTests(TestCase):
    """The two n8n actions want opposite image formats. Both are one-way trips."""

    def test_extract_id_needs_a_data_uri(self):
        self.assertTrue(as_data_uri('AAAA').startswith('data:image/jpeg;base64,'))
        # Already-prefixed input is left alone rather than double-wrapped.
        self.assertEqual(as_data_uri('data:image/png;base64,XX'), 'data:image/png;base64,XX')

    def test_verify_face_needs_bare_base64(self):
        self.assertEqual(strip_data_uri('data:image/jpeg;base64,AAAA'), 'AAAA')
        self.assertEqual(strip_data_uri('AAAA'), 'AAAA')

    def test_round_trip_is_stable(self):
        self.assertEqual(strip_data_uri(as_data_uri('AAAA')), 'AAAA')


class VerifyIdFlowTests(TestCase):
    """POST /api/auth/verify-id/ — the full chain, including what gets logged."""

    def setUp(self):
        cache.clear()
        self.client = APIClient()
        portrait = patch(
            'api.views.check_id_has_portrait',
            return_value=PortraitCheckResult(has_photo=True, face_count=1, confidence=0.9),
        )
        portrait.start()
        self.addCleanup(portrait.stop)

    def _post(self, **extra):
        body = {'idImage': _image()}
        body.update(extra)
        return self.client.post('/api/auth/verify-id/', body, format='json')

    @patch('api.views.call_workflow')
    @patch('api.views.scan_id_fields')
    def test_sends_every_field_and_the_raw_text_to_n8n(self, mock_ocr, mock_call):
        mock_ocr.return_value = {**field_report(PRC_LAYOUT), 'rawText': PRC_LAYOUT}
        mock_call.return_value = {'success': True, 'data': {}}

        self._post()

        workflow, payload = mock_call.call_args[0]
        self.assertEqual(workflow, 'verify_id')
        self.assertEqual(payload['action'], 'extract_id')
        ocr = payload['ocr']
        self.assertEqual(ocr['lastName'], 'Dela Cruz')
        self.assertEqual(ocr['firstName'], 'Juan')
        self.assertEqual(ocr['middleName'], 'Santos')
        self.assertEqual(ocr['registrationNumber'], '0012345')
        self.assertEqual(ocr['registrationDate'], '04/05/2019')
        self.assertEqual(ocr['validUntil'], '11/25/2027')
        # Raw text travels too, so n8n can validate rather than re-derive.
        self.assertIn('PROFESSIONAL REGULATION COMMISSION', ocr['rawText'])

    @patch('api.views.call_workflow')
    @patch('api.views.scan_id_fields')
    def test_image_reaches_n8n_as_a_data_uri(self, mock_ocr, mock_call):
        # extract_id's OCR service rejects bare base64 outright.
        mock_ocr.return_value = {**field_report(PRC_LAYOUT), 'rawText': ''}
        mock_call.return_value = {'success': True, 'data': {}}

        self._post()

        self.assertTrue(mock_call.call_args[0][1]['idImage'].startswith('data:'))

    @patch('api.views.call_workflow')
    @patch('api.views.scan_id_fields')
    def test_different_ids_send_their_own_values(self, mock_ocr, mock_call):
        """Nothing is hard-coded: a second, different card sends its own data."""
        mock_call.return_value = {'success': True, 'data': {}}

        mock_ocr.return_value = {**field_report(PRC_LAYOUT), 'rawText': ''}
        self._post()
        first = mock_call.call_args[0][1]['ocr']

        mock_ocr.return_value = {**field_report(HOSPITAL_LAYOUT), 'rawText': ''}
        self._post()
        second = mock_call.call_args[0][1]['ocr']

        self.assertEqual(first['registrationNumber'], '0012345')
        self.assertEqual(second['registrationNumber'], '7654321')
        self.assertNotEqual(first['lastName'], second['lastName'])

    @patch('api.views.call_workflow')
    @patch('api.views.scan_id_fields')
    def test_complete_read_is_verified_and_logged_as_success(self, mock_ocr, mock_call):
        mock_ocr.return_value = {**field_report(PRC_LAYOUT), 'rawText': ''}
        mock_call.return_value = {'success': True, 'data': {}}

        res = self._post()

        self.assertTrue(res.data['verified'])
        self.assertEqual(res.data['needsReview'], [])
        attempt = IdScanAttempt.objects.latest('created_at')
        self.assertEqual(attempt.status, 'success')
        self.assertEqual(attempt.registration_number, '0012345')
        self.assertEqual(attempt.registration_date, '04/05/2019')
        self.assertEqual(attempt.n8n_status, 'success')

    @patch('api.views.call_workflow')
    @patch('api.views.scan_id_fields')
    def test_partial_read_is_not_reported_as_verified(self, mock_ocr, mock_call):
        """The core safety property: incomplete must never read as verified."""
        mock_ocr.return_value = {**field_report(PARTIAL_LAYOUT), 'rawText': ''}
        mock_call.return_value = {'success': True, 'data': {}}

        res = self._post()

        self.assertFalse(res.data['verified'])
        self.assertIn('registrationNumber', res.data['needsReview'])
        attempt = IdScanAttempt.objects.latest('created_at')
        self.assertEqual(attempt.status, 'needs_review')
        self.assertFalse(attempt.verified)

    @patch('api.views.call_workflow', side_effect=N8nWorkflowOffline(workflow='verify_id'))
    @patch('api.views.scan_id_fields')
    def test_n8n_failure_does_not_discard_a_good_local_read(self, mock_ocr, _mock_call):
        mock_ocr.return_value = {**field_report(PRC_LAYOUT), 'rawText': ''}

        res = self._post()

        # The nurse still gets their fields; the failure is reported alongside.
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['lastName'], 'Dela Cruz')
        self.assertEqual(res.data['n8nStatus'], 'failed')
        attempt = IdScanAttempt.objects.latest('created_at')
        self.assertEqual(attempt.n8n_status, 'failed')
        self.assertTrue(attempt.n8n_error)

    @patch('api.views.call_workflow')
    @patch('api.views.scan_id_fields')
    def test_every_attempt_is_logged_including_failures(self, mock_ocr, mock_call):
        mock_call.return_value = {'success': True, 'data': {}}

        mock_ocr.return_value = {**field_report(PRC_LAYOUT), 'rawText': ''}
        self._post()
        mock_ocr.return_value = {**field_report(PARTIAL_LAYOUT), 'rawText': ''}
        self._post()

        self.assertEqual(IdScanAttempt.objects.count(), 2)
        statuses = set(IdScanAttempt.objects.values_list('status', flat=True))
        self.assertEqual(statuses, {'success', 'needs_review'})

    @patch('api.views.call_workflow')
    @patch('api.views.scan_id_fields')
    def test_attempt_number_increments_within_a_session(self, mock_ocr, mock_call):
        mock_ocr.return_value = {**field_report(PRC_LAYOUT), 'rawText': ''}
        mock_call.return_value = {'success': True, 'data': {}}

        first = self._post()
        sid = first.data['registrationSessionId']
        second = self._post(registrationSessionId=sid)

        self.assertEqual(second.data['attemptNumber'], 2)

    @patch('api.views.call_workflow')
    @patch('api.views.scan_id_fields')
    def test_duplicate_scan_of_the_same_licence_is_flagged(self, mock_ocr, mock_call):
        mock_ocr.return_value = {**field_report(PRC_LAYOUT), 'rawText': ''}
        mock_call.return_value = {'success': True, 'data': {}}

        self._post()                      # session A
        res = self._post()                # session B, same licence number

        self.assertTrue(res.data['duplicateScan'])
        self.assertIsNotNone(IdScanAttempt.objects.latest('created_at').duplicate_of)

    @patch('api.views.call_workflow')
    def test_missing_portrait_is_logged_and_never_verified(self, mock_call):
        with patch(
            'api.views.check_id_has_portrait',
            return_value=PortraitCheckResult(has_photo=False, message='no portrait'),
        ):
            res = self._post()

        self.assertFalse(res.data['verified'])
        mock_call.assert_not_called()


class OverallVerificationTests(TestCase):
    """`verified` must require every step, not just the last one."""

    def test_success_needs_ocr_portrait_and_no_missing_fields(self):
        attempt = IdScanAttempt(
            status='success', portrait_present=True, missing_required=[]
        )
        self.assertTrue(attempt.verified)

    def test_missing_required_field_blocks_verification(self):
        attempt = IdScanAttempt(
            status='success', portrait_present=True, missing_required=['registrationNumber']
        )
        self.assertFalse(attempt.verified)

    def test_absent_portrait_blocks_verification(self):
        attempt = IdScanAttempt(status='success', portrait_present=False, missing_required=[])
        self.assertFalse(attempt.verified)

    def test_needs_review_status_blocks_verification(self):
        attempt = IdScanAttempt(
            status='needs_review', portrait_present=True, missing_required=[]
        )
        self.assertFalse(attempt.verified)
