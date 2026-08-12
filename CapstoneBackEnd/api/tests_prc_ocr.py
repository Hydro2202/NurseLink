"""
PRC nursing licence scanning tests.

Tesseract itself is mocked. What is under test is our logic: does the
document-type gate hold, and do the regexes pull the right fields out of
realistic — including realistically *noisy* — OCR output.

The sample texts below mirror what Tesseract actually emits for a phone
photo of a PRC card: inconsistent spacing, labels on their own line, and
the odd substituted character.
"""

import base64
from unittest.mock import patch

import cv2
import numpy as np
from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from api.prc_ocr import (
    REJECTION_MESSAGE,
    InvalidImageError,
    PrcOcrError,
    _extract_registration_number,
    _extract_valid_until,
    _normalize_date,
    scan_prc_license,
)

# A clean read of a PRC nursing licence.
CLEAN_PRC_TEXT = """
REPUBLIC OF THE PHILIPPINES
PROFESSIONAL REGULATION COMMISSION

NURSE

REGISTRATION NO. 0123456
VALID UNTIL 06/30/2027

LAST NAME
DELA CRUZ
FIRST NAME
MARIA CLARA
MIDDLE NAME
SANTOS
"""

# The same card, read badly: substituted characters, labels inline,
# spacing chewed up. This still has to pass.
NOISY_PRC_TEXT = """
REPUBLlC OF THE PHIL1PPINES
PROFESSIQNAL REGULATION COMMISSION
NURSF
REGISTRATION NO.:  0123456
VALID UNTIL:  6/30/2027
LAST NAME: DELA CRUZ
FIRST NAME: MARIA CLARA
MIDDLE NAME: SANTOS
"""

# A PRC card for a different profession — must be rejected.
PRC_MIDWIFE_TEXT = """
REPUBLIC OF THE PHILIPPINES
PROFESSIONAL REGULATION COMMISSION
MIDWIFE
REGISTRATION NO. 0123456
VALID UNTIL 06/30/2027
LAST NAME
DELA CRUZ
"""

# A driver's licence — must be rejected.
DRIVERS_LICENSE_TEXT = """
REPUBLIC OF THE PHILIPPINES
DEPARTMENT OF TRANSPORTATION
LAND TRANSPORTATION OFFICE
DRIVER'S LICENSE
LAST NAME
DELA CRUZ
LICENSE NO. N01-23-456789
"""

# Says NURSE but is not a PRC card — must be rejected.
HOSPITAL_ID_TEXT = """
ST LUKES MEDICAL CENTER
EMPLOYEE IDENTIFICATION
NURSE
LAST NAME DELA CRUZ
EMPLOYEE NO. 0123456
"""


def _fake_image_b64() -> str:
    """A real, decodable 400x250 PNG so _decode_image succeeds."""
    blank = np.full((250, 400, 3), 255, dtype=np.uint8)
    ok, buf = cv2.imencode('.png', blank)
    assert ok
    return 'data:image/png;base64,' + base64.b64encode(buf.tobytes()).decode()


class DocumentTypeGateTests(TestCase):
    """Only a PRC nursing licence may pass. This is the security boundary."""

    def _scan(self, ocr_text):
        with patch('api.prc_ocr._run_tesseract', return_value=ocr_text):
            return scan_prc_license(_fake_image_b64())

    def test_accepts_clean_prc_nursing_license(self):
        result = self._scan(CLEAN_PRC_TEXT)
        self.assertTrue(result.is_valid)
        self.assertEqual(result.profession, 'Registered Nurse')

    def test_accepts_noisy_ocr_of_a_genuine_card(self):
        # PROFESSIQNAL / REPUBLlC / NURSF must not cost a nurse their signup.
        result = self._scan(NOISY_PRC_TEXT)
        self.assertTrue(result.is_valid)

    def test_rejects_prc_card_for_another_profession(self):
        result = self._scan(PRC_MIDWIFE_TEXT)
        self.assertFalse(result.is_valid)
        self.assertEqual(result.message, REJECTION_MESSAGE)

    def test_rejects_drivers_license(self):
        result = self._scan(DRIVERS_LICENSE_TEXT)
        self.assertFalse(result.is_valid)
        self.assertEqual(result.message, REJECTION_MESSAGE)

    def test_rejects_hospital_id_that_merely_says_nurse(self):
        # "NURSE" alone is not enough — the PRC markers must be there too.
        result = self._scan(HOSPITAL_ID_TEXT)
        self.assertFalse(result.is_valid)

    def test_rejects_empty_ocr_output(self):
        result = self._scan('')
        self.assertFalse(result.is_valid)

    def test_rejected_document_leaks_no_fields(self):
        # Nothing from an unverified document may reach the registration form.
        result = self._scan(DRIVERS_LICENSE_TEXT)
        self.assertEqual(result.last_name, '')
        self.assertEqual(result.registration_number, '')
        self.assertEqual(result.valid_until, '')
        payload = result.as_dict()
        self.assertTrue(all(payload[k] == '' for k in ('lastName', 'firstName', 'middleName')))

    def test_nursery_does_not_satisfy_the_profession_check(self):
        text = CLEAN_PRC_TEXT.replace('NURSE', 'NURSERY ATTENDANT')
        self.assertFalse(self._scan(text).is_valid)


class FieldExtractionTests(TestCase):
    """The regexes, against both clean and noisy reads."""

    def _scan(self, ocr_text):
        with patch('api.prc_ocr._run_tesseract', return_value=ocr_text):
            return scan_prc_license(_fake_image_b64())

    def test_extracts_names_from_labels_on_following_lines(self):
        result = self._scan(CLEAN_PRC_TEXT)
        self.assertEqual(result.last_name, 'Dela Cruz')
        self.assertEqual(result.first_name, 'Maria Clara')
        self.assertEqual(result.middle_name, 'Santos')

    def test_extracts_names_from_inline_labels(self):
        result = self._scan(NOISY_PRC_TEXT)
        self.assertEqual(result.last_name, 'Dela Cruz')
        self.assertEqual(result.first_name, 'Maria Clara')
        self.assertEqual(result.middle_name, 'Santos')

    def test_extracts_seven_digit_registration_number(self):
        self.assertEqual(self._scan(CLEAN_PRC_TEXT).registration_number, '0123456')

    def test_extracts_validity_date_as_mm_dd_yyyy(self):
        self.assertEqual(self._scan(CLEAN_PRC_TEXT).valid_until, '06/30/2027')
        # Single-digit month is padded.
        self.assertEqual(self._scan(NOISY_PRC_TEXT).valid_until, '06/30/2027')

    def test_full_name_is_assembled_in_reading_order(self):
        self.assertEqual(self._scan(CLEAN_PRC_TEXT).full_name, 'Maria Clara Santos Dela Cruz')

    def test_response_dict_exposes_license_number_alias(self):
        payload = self._scan(CLEAN_PRC_TEXT).as_dict()
        self.assertEqual(payload['licenseNumber'], payload['registrationNumber'])

    def test_name_capture_stops_at_end_of_line(self):
        """
        Regression: real Tesseract output only.

        Two page-segmentation passes are concatenated, so the header repeats
        after the last labelled line. The name pattern used \\s, which matches
        a newline, and the middle name greedily swallowed the repeated header:
        "Santos Republic Of The Philippines Professional".
        """
        two_pass_text = (
            CLEAN_PRC_TEXT
            + '\nREPUBLIC OF THE PHILIPPINES\nPROFESSIONAL REGULATION COMMISSION\nNURSE\n'
        )
        result = self._scan(two_pass_text)
        self.assertEqual(result.middle_name, 'Santos')
        self.assertNotIn('Republic', result.middle_name)


class RegistrationNumberTests(TestCase):
    """Strictly 7 digits, and never a fragment of something else."""

    def test_requires_exactly_seven_digits(self):
        self.assertEqual(_extract_registration_number('REGISTRATION NO. 123456'), '')
        self.assertEqual(_extract_registration_number('REGISTRATION NO. 012345678'), '')
        self.assertEqual(_extract_registration_number('REGISTRATION NO. 0123456'), '0123456')

    def test_repairs_ocr_digit_confusions_when_label_anchored(self):
        # O->0, I->1, S->5 inside an otherwise numeric run.
        self.assertEqual(_extract_registration_number('REGISTRATION NO. O12345S'), '0123455')

    def test_does_not_mistake_a_date_for_a_license_number(self):
        self.assertEqual(_extract_registration_number('VALID UNTIL 06/30/2027'), '')

    def test_does_not_mistake_a_hyphenated_serial(self):
        self.assertEqual(_extract_registration_number('CARD NO. N01-1234567-8'), '')

    def test_accepts_license_no_wording(self):
        self.assertEqual(_extract_registration_number('LICENSE NUMBER: 7654321'), '7654321')


class DateHandlingTests(TestCase):
    def test_normalizes_separators_and_pads(self):
        self.assertEqual(_normalize_date('6/3/2027'), '06/03/2027')
        self.assertEqual(_normalize_date('06-30-2027'), '06/30/2027')
        self.assertEqual(_normalize_date('06.30.2027'), '06/30/2027')

    def test_expands_two_digit_year(self):
        self.assertEqual(_normalize_date('06/30/27'), '06/30/2027')

    def test_rejects_impossible_dates(self):
        self.assertEqual(_normalize_date('13/45/2027'), '')
        self.assertEqual(_normalize_date('not a date'), '')

    def test_picks_the_latest_date_when_the_label_is_unreadable(self):
        # Issue date and expiry both present, "VALID UNTIL" garbled away.
        text = 'ISSUED 06/30/2024\nEXPIRY 06/30/2027'
        self.assertEqual(_extract_valid_until(text), '06/30/2027')


class VerifyPrcEndpointTests(TestCase):
    """POST /api/auth/verify-prc/"""

    def setUp(self):
        # DRF keeps throttle history in the shared cache, so real traffic to
        # the face_verification scope can leak in and 429 these tests.
        cache.clear()
        self.client = APIClient()
        self.image = _fake_image_b64()

    def test_valid_license_returns_prefill_fields(self):
        with patch('api.prc_ocr._run_tesseract', return_value=CLEAN_PRC_TEXT):
            res = self.client.post('/api/auth/verify-prc/', {'image': self.image}, format='json')

        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data['valid'])
        self.assertEqual(res.data['lastName'], 'Dela Cruz')
        self.assertEqual(res.data['registrationNumber'], '0123456')
        self.assertEqual(res.data['validUntil'], '06/30/2027')

    def test_wrong_document_is_a_200_with_valid_false(self):
        # A rejected upload is a normal outcome, not a server error.
        with patch('api.prc_ocr._run_tesseract', return_value=DRIVERS_LICENSE_TEXT):
            res = self.client.post('/api/auth/verify-prc/', {'image': self.image}, format='json')

        self.assertEqual(res.status_code, 200)
        self.assertFalse(res.data['valid'])
        self.assertEqual(res.data['message'], REJECTION_MESSAGE)

    def test_undecodable_upload_is_400(self):
        res = self.client.post('/api/auth/verify-prc/', {'image': 'not-an-image'}, format='json')
        self.assertEqual(res.status_code, 400)
        self.assertFalse(res.data['valid'])

    def test_pdf_upload_is_rejected_with_guidance(self):
        pdf = 'data:application/pdf;base64,' + base64.b64encode(b'%PDF-1.4 ...').decode()
        res = self.client.post('/api/auth/verify-prc/', {'image': pdf}, format='json')
        self.assertEqual(res.status_code, 400)
        self.assertIn('JPG or PNG', res.data['message'])

    def test_missing_tesseract_is_503_not_a_bad_upload(self):
        with patch('api.prc_ocr._run_tesseract', side_effect=PrcOcrError('Tesseract not installed')):
            res = self.client.post('/api/auth/verify-prc/', {'image': self.image}, format='json')

        self.assertEqual(res.status_code, 503)

    def test_image_is_required(self):
        res = self.client.post('/api/auth/verify-prc/', {}, format='json')
        self.assertEqual(res.status_code, 400)
        self.assertIn('image', res.data)

    def test_endpoint_is_public(self):
        # Signup happens before an account exists, so this cannot require auth.
        with patch('api.prc_ocr._run_tesseract', return_value=CLEAN_PRC_TEXT):
            res = self.client.post('/api/auth/verify-prc/', {'image': self.image}, format='json')
        self.assertNotIn(res.status_code, (401, 403))


class ImageDecodingTests(TestCase):
    def test_rejects_empty_image(self):
        with self.assertRaises(InvalidImageError):
            scan_prc_license('')

    def test_rejects_oversized_upload(self):
        oversized = 'data:image/png;base64,' + base64.b64encode(b'x' * (11 * 1024 * 1024)).decode()
        with self.assertRaises(InvalidImageError):
            scan_prc_license(oversized)
