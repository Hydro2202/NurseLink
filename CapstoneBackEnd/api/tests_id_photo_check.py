"""
Portrait-presence checks for uploaded ID cards.

The security-relevant assertions are the negatives: a card with its photo
erased, blanked or cropped away must be rejected before OCR runs. Positive
detection is exercised against a rendered face-like portrait; YuNet is a CNN,
so a crude drawing will not always trip it — where a test depends on a real
detection it drives :func:`detect_portrait` with a stubbed detector rather
than pretending a rectangle is a face.
"""

import base64
from unittest.mock import patch

import cv2
import numpy as np
from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from api.face_match import FaceModelError, InvalidImageError
from api.id_photo_check import (
    MIN_FACE_WIDTH_RATIO,
    REJECTION_MESSAGE,
    PortraitCheckResult,
    check_id_has_portrait,
    detect_portrait,
)


def _card(with_photo_box=True, blank_photo=False) -> np.ndarray:
    """An ID-card-shaped image, optionally with the portrait area blanked."""
    img = np.full((320, 520, 3), 244, dtype=np.uint8)
    cv2.putText(img, 'PROFESSIONAL REGULATION COMMISSION', (20, 40),
                cv2.FONT_HERSHEY_SIMPLEX, 0.42, (25, 25, 25), 1, cv2.LINE_AA)
    cv2.putText(img, 'LAST NAME  DELA CRUZ', (170, 150),
                cv2.FONT_HERSHEY_SIMPLEX, 0.45, (25, 25, 25), 1, cv2.LINE_AA)
    if with_photo_box:
        # The portrait area. Blank = the photo was erased.
        fill = (255, 255, 255) if blank_photo else (190, 165, 145)
        cv2.rectangle(img, (25, 100), (145, 260), fill, -1)
    return img


def _b64(img: np.ndarray) -> str:
    ok, buf = cv2.imencode('.jpg', img, [cv2.IMWRITE_JPEG_QUALITY, 92])
    assert ok
    return 'data:image/jpeg;base64,' + base64.b64encode(buf.tobytes()).decode()


def _fake_yunet(boxes):
    """A stub detector returning YuNet-shaped rows: [x, y, w, h, ...15 cols..., score]."""
    class _Stub:
        def setInputSize(self, size):
            pass

        def detect(self, image):
            if not boxes:
                return 1, None
            rows = []
            for (x, y, w, h, score) in boxes:
                row = np.zeros(15, dtype=np.float32)
                row[0:4] = (x, y, w, h)
                row[-1] = score
                rows.append(row)
            return 1, np.array(rows, dtype=np.float32)

    return _Stub()


class NoPortraitRejectionTests(TestCase):
    """The attack this closes: an ID with the photo removed."""

    def test_card_with_erased_photo_is_rejected(self):
        result = check_id_has_portrait(_b64(_card(blank_photo=True)))
        self.assertFalse(result.has_photo)
        self.assertEqual(result.message, REJECTION_MESSAGE)

    def test_card_with_photo_cropped_away_is_rejected(self):
        # Only the text half of the card survives the crop.
        cropped = _card()[:, 160:]
        result = check_id_has_portrait(_b64(cropped))
        self.assertFalse(result.has_photo)
        self.assertEqual(result.message, REJECTION_MESSAGE)

    def test_plain_document_with_no_photo_is_rejected(self):
        result = check_id_has_portrait(_b64(_card(with_photo_box=False)))
        self.assertFalse(result.has_photo)

    def test_blank_image_is_rejected(self):
        blank = np.full((300, 300, 3), 255, dtype=np.uint8)
        self.assertFalse(check_id_has_portrait(_b64(blank)).has_photo)

    def test_rejection_carries_the_specified_message(self):
        result = check_id_has_portrait(_b64(_card(blank_photo=True)))
        self.assertEqual(
            result.message,
            'No portrait photo detected on the ID. Please upload a valid ID containing a photo.',
        )


class DetectionFilteringTests(TestCase):
    """Size filtering, driven through a stubbed detector for determinism."""

    def test_accepts_a_portrait_of_plausible_size(self):
        img = _card()
        width = img.shape[1]
        face_w = width * 0.20  # a portrait occupies ~20% of card width
        with patch('api.id_photo_check._get_portrait_detector',
                   return_value=_fake_yunet([(30, 110, face_w, face_w * 1.3, 0.88)])):
            result = detect_portrait(img)
        self.assertTrue(result.has_photo)
        self.assertEqual(result.face_count, 1)
        self.assertAlmostEqual(result.confidence, 0.88, places=2)

    def test_speck_detection_below_size_floor_is_not_a_portrait(self):
        img = _card()
        width = img.shape[1]
        tiny = width * (MIN_FACE_WIDTH_RATIO / 2)
        with patch('api.id_photo_check._get_portrait_detector',
                   return_value=_fake_yunet([(10, 10, tiny, tiny, 0.9)])):
            result = detect_portrait(img)
        self.assertFalse(result.has_photo)
        self.assertEqual(result.face_count, 0)
        self.assertEqual(result.message, REJECTION_MESSAGE)

    def test_no_detections_at_all(self):
        with patch('api.id_photo_check._get_portrait_detector', return_value=_fake_yunet([])):
            result = detect_portrait(_card())
        self.assertFalse(result.has_photo)

    def test_largest_face_wins_when_several_are_found(self):
        img = _card()
        width = img.shape[1]
        with patch('api.id_photo_check._get_portrait_detector',
                   return_value=_fake_yunet([
                       (10, 10, width * 0.08, width * 0.10, 0.55),
                       (30, 110, width * 0.22, width * 0.30, 0.93),
                   ])):
            result = detect_portrait(img)
        self.assertTrue(result.has_photo)
        self.assertEqual(result.face_count, 2)
        self.assertAlmostEqual(result.confidence, 0.93, places=2)


class ImageHandlingTests(TestCase):
    def test_rejects_undecodable_upload(self):
        with self.assertRaises(InvalidImageError):
            check_id_has_portrait('not-an-image')

    def test_rejects_empty_upload(self):
        with self.assertRaises(InvalidImageError):
            check_id_has_portrait('')

    def test_accepts_bare_base64_without_data_uri(self):
        ok, buf = cv2.imencode('.jpg', _card(blank_photo=True))
        bare = base64.b64encode(buf.tobytes()).decode()
        result = check_id_has_portrait(bare)  # must not raise
        self.assertFalse(result.has_photo)


class VerifyIdPortraitGateTests(TestCase):
    """POST /api/auth/verify-id/ — the gate runs before any OCR call."""

    def setUp(self):
        cache.clear()
        self.client = APIClient()

    @patch('api.views.call_workflow')
    def test_id_without_photo_never_reaches_the_ocr_workflow(self, mock_call):
        res = self.client.post(
            '/api/auth/verify-id/',
            {'idImage': _b64(_card(blank_photo=True))},
            format='json',
        )

        self.assertEqual(res.status_code, 200)
        self.assertFalse(res.data['verified'])
        self.assertFalse(res.data['hasPhoto'])
        self.assertEqual(res.data['message'], REJECTION_MESSAGE)
        # The whole point: no OCR spend on a document that cannot pass.
        mock_call.assert_not_called()

    @patch('api.views.call_workflow')
    @patch('api.views.check_id_has_portrait')
    def test_id_with_photo_proceeds_to_the_ocr_workflow(self, mock_portrait, mock_call):
        """A present portrait passes the gate, and the OCR call to n8n follows."""
        mock_portrait.return_value = PortraitCheckResult(has_photo=True, face_count=1, confidence=0.9)
        # A full, valid PRC-shaped response — strict field validation (see
        # id_field_validation.py) is what actually decides `verified` now,
        # so a complete set of fields is needed to reach that status here.
        mock_call.return_value = {
            'lastName': 'Johnson',
            'firstName': 'Sarah',
            'registrationNumber': '1234567',
            'registrationDate': '01/15/2020',
            'validUntil': '01/15/2025',
        }

        res = self.client.post('/api/auth/verify-id/', {'idImage': _b64(_card())}, format='json')

        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data['hasPhoto'])
        self.assertTrue(res.data['verified'])
        self.assertEqual(res.data['fullName'], 'Sarah Johnson')
        mock_call.assert_called_once()
        # This webhook now also serves verify_face requests — 'action' tells
        # the Route Action node which branch to run.
        self.assertEqual(mock_call.call_args[0][1]['action'], 'extract_id')

    @override_settings(ID_OCR_LOCAL_FALLBACK=False)
    @patch('api.views.call_workflow')
    @patch('api.views.check_id_has_portrait')
    def test_ocr_workflow_returning_nothing_is_not_verified(self, mock_portrait, mock_call):
        """
        An empty workflow response is a bad read, not a free pass — retake,
        don't guess. The local fallback is switched off here so this covers
        the n8n path alone; the fallback has its own test below.
        """
        mock_portrait.return_value = PortraitCheckResult(has_photo=True, face_count=1, confidence=0.9)
        mock_call.return_value = {}

        res = self.client.post('/api/auth/verify-id/', {'idImage': _b64(_card())}, format='json')

        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data['hasPhoto'])
        self.assertFalse(res.data['verified'])
        self.assertEqual(res.data['fullName'], '')

    @override_settings(ID_OCR_LOCAL_FALLBACK=True)
    @patch('api.views.scan_id_fields')
    @patch('api.views.call_workflow')
    @patch('api.views.check_id_has_portrait')
    def test_local_ocr_fills_in_when_the_workflow_returns_nothing(
        self, mock_portrait, mock_call, mock_scan
    ):
        """
        The workflow's OCR node depends on a third-party service; a 503 there
        makes n8n answer 200 with an empty body. Reading the card locally means
        a provider outage cannot block registration — and the values are really
        read, never invented.
        """
        mock_portrait.return_value = PortraitCheckResult(has_photo=True, face_count=1, confidence=0.9)
        mock_call.return_value = {}
        mock_scan.return_value = {
            'lastName': 'Cortez', 'firstName': 'Raiden', 'middleName': 'Monteiro',
            'registrationNumber': '0987654', 'registrationDate': '12/27/2025',
            'validUntil': '06/29/2029', 'overallConfidence': 0.95,
        }

        res = self.client.post('/api/auth/verify-id/', {'idImage': _b64(_card())}, format='json')

        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data['verified'])
        self.assertEqual(res.data['lastName'], 'Cortez')
        self.assertEqual(res.data['registrationNumber'], '0987654')

    @override_settings(ID_OCR_LOCAL_FALLBACK=True)
    @patch('api.views.scan_id_fields', return_value={})
    @patch('api.views.call_workflow', return_value={})
    @patch('api.views.check_id_has_portrait')
    def test_fallback_reading_nothing_still_fails_closed(self, mock_portrait, _c, _s):
        # Neither engine read anything: that is a failed scan, not a pass.
        mock_portrait.return_value = PortraitCheckResult(has_photo=True, face_count=1, confidence=0.9)

        res = self.client.post('/api/auth/verify-id/', {'idImage': _b64(_card())}, format='json')

        self.assertEqual(res.status_code, 200)
        self.assertFalse(res.data['verified'])

    @patch('api.views.call_workflow')
    def test_undecodable_upload_is_400(self, mock_call):
        res = self.client.post('/api/auth/verify-id/', {'idImage': 'garbage'}, format='json')
        self.assertEqual(res.status_code, 400)
        mock_call.assert_not_called()

    @patch('api.views.check_id_has_portrait', side_effect=FaceModelError('model missing'))
    @patch('api.views.call_workflow')
    def test_detector_failure_is_503_not_a_rejected_id(self, mock_call, _mock_portrait):
        # A server-side model problem must not be reported as "your ID is bad".
        res = self.client.post('/api/auth/verify-id/', {'idImage': _b64(_card())}, format='json')

        self.assertEqual(res.status_code, 503)
        self.assertNotEqual(res.data.get('message'), REJECTION_MESSAGE)
        mock_call.assert_not_called()

    @patch('api.views.call_workflow')
    def test_rejection_still_returns_a_session_id(self, _mock_call):
        # The wizard needs the session to carry on after a retake.
        res = self.client.post(
            '/api/auth/verify-id/', {'idImage': _b64(_card(blank_photo=True))}, format='json'
        )
        self.assertTrue(res.data['registrationSessionId'])
