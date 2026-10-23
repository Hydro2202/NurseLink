from django.test import override_settings
"""
Issue 15 — the anonymous sign-up ID/face upload endpoints must not accept
unbounded uploads: real content is checked (not just extension/Content-Type),
oversized/odd-shaped images are rejected, and anonymous callers are rate
limited per IP without affecting signed-in endpoints.
"""

import base64
from unittest.mock import patch

import cv2
import numpy as np
from django.contrib.auth.models import User
from django.core.cache import cache
from rest_framework.test import APIClient, APITestCase
from rest_framework.throttling import ScopedRateThrottle

from api.auth_sessions import issue_session
from api.face_match import MAX_IMAGE_DIMENSION
from api.id_photo_check import PortraitCheckResult
from api.models import NurseProfile


def _card_bytes(width=520, height=320) -> bytes:
    img = np.full((height, width, 3), 244, dtype=np.uint8)
    cv2.putText(img, 'PROFESSIONAL REGULATION COMMISSION', (20, 40),
                cv2.FONT_HERSHEY_SIMPLEX, 0.42, (25, 25, 25), 1, cv2.LINE_AA)
    cv2.rectangle(img, (25, 100), (145, 260), (190, 165, 145), -1)
    ok, buf = cv2.imencode('.jpg', img, [cv2.IMWRITE_JPEG_QUALITY, 90])
    assert ok
    return buf.tobytes()


def _card_b64(**kwargs) -> str:
    return 'data:image/jpeg;base64,' + base64.b64encode(_card_bytes(**kwargs)).decode()


def make_nurse(email='nurse@hospital.com'):
    user = User.objects.create_user(username=email, email=email, password='pw-test-1234',
                                     first_name='Ana', last_name='Cruz')
    NurseProfile.objects.create(user=user, role='staff_nurse', department='ICU',
                                 approval_status='approved', is_active_staff=True)
    return user


@override_settings(SIGNUP_ID_FACE_VERIFICATION=True)
class MultipartUploadValidationTests(APITestCase):
    """POST /api/auth/verify-id/ with a real multipart file (the preferred path)."""

    def setUp(self):
        cache.clear()
        self.client = APIClient()

    def _post(self, content: bytes, *, content_type='image/jpeg', name='id.jpg'):
        from django.core.files.uploadedfile import SimpleUploadedFile
        upload = SimpleUploadedFile(name, content, content_type=content_type)
        return self.client.post('/api/auth/verify-id/', {'prc_id': upload}, format='multipart')

    def test_a_valid_image_passes_validation_and_reaches_ocr(self):
        # check_id_has_portrait is mocked here because a *synthetic* test
        # card has no real detectable face for YuNet to find — the point of
        # this test is "a well-formed upload clears the format/size gate and
        # reaches OCR", not re-testing face detection itself (covered by
        # tests_id_photo_check.py).
        with patch('api.views.check_id_has_portrait') as mock_portrait, \
             patch('api.views.call_workflow_multipart') as mock_call:
            mock_portrait.return_value = PortraitCheckResult(has_photo=True, face_count=1, confidence=0.9)
            mock_call.return_value = {
                'lastName': 'Johnson', 'firstName': 'Sarah',
                'registrationNumber': '1234567',
                'registrationDate': '01/15/2020', 'validUntil': '01/15/2025',
            }
            res = self._post(_card_bytes())
        self.assertEqual(res.status_code, 200, res.content)
        mock_call.assert_called_once()

    def test_an_oversized_file_is_rejected(self):
        # Exceeds the 5MB per-file ceiling without needing a real decodable
        # image — the size check runs before any decode attempt.
        oversized = b'\xff\xd8\xff' + (b'0' * (6 * 1024 * 1024))
        res = self._post(oversized)
        self.assertEqual(res.status_code, 400)
        self.assertIn('too large', res.data['message'].lower())

    def test_a_fake_image_is_rejected_even_with_a_claimed_jpeg_content_type(self):
        """A .txt renamed to .jpg: the Content-Type header lies, but the real
        bytes are not a decodable image — the content_type check alone would
        let this through, so this proves the downstream real-decode check
        (cv2.imdecode) is what actually catches it."""
        not_really_an_image = b'this is just plain text, not an image at all'
        res = self._post(not_really_an_image, content_type='image/jpeg', name='fake.jpg')
        self.assertEqual(res.status_code, 400)

    def test_empty_file_is_rejected(self):
        res = self._post(b'', content_type='image/jpeg')
        self.assertEqual(res.status_code, 400)

    def test_disallowed_content_type_is_rejected(self):
        res = self._post(_card_bytes(), content_type='application/pdf', name='id.pdf')
        self.assertEqual(res.status_code, 400)
        self.assertIn('unsupported file format', res.data['message'].lower())


@override_settings(SIGNUP_ID_FACE_VERIFICATION=True)
class ImageDimensionLimitTests(APITestCase):
    """The new pixel-dimension ceiling, exercised through the shared decode path."""

    def setUp(self):
        cache.clear()
        self.client = APIClient()

    def test_an_extremely_wide_image_is_rejected(self):
        # Small on disk/within the byte-size limit, but far past
        # MAX_IMAGE_DIMENSION on one axis — proves the dimension check is
        # independent of the byte-size check.
        huge = _card_b64(width=MAX_IMAGE_DIMENSION + 500, height=100)
        res = self.client.post('/api/auth/verify-id/', {'idImage': huge}, format='json')
        self.assertEqual(res.status_code, 400)

    def test_a_normal_sized_image_is_not_rejected_for_dimensions(self):
        from unittest.mock import patch
        with patch('api.views.check_id_has_portrait') as mock_portrait, \
             patch('api.views.call_workflow') as mock_call:
            from api.id_photo_check import PortraitCheckResult
            mock_portrait.return_value = PortraitCheckResult(has_photo=True, face_count=1, confidence=0.9)
            mock_call.return_value = {
                'lastName': 'Johnson', 'firstName': 'Sarah',
                'registrationNumber': '1234567',
                'registrationDate': '01/15/2020', 'validUntil': '01/15/2025',
            }
            res = self.client.post('/api/auth/verify-id/', {'idImage': _card_b64()}, format='json')
        self.assertEqual(res.status_code, 200, res.content)


@override_settings(SIGNUP_ID_FACE_VERIFICATION=True)
class AnonymousThrottleTests(APITestCase):
    """Per-IP throttling on the anonymous identity-verification endpoints."""

    def setUp(self):
        cache.clear()
        self.client = APIClient()

    def _low_rate(self, rate='2/min'):
        # ScopedRateThrottle.THROTTLE_RATES is a plain dict snapshotted onto
        # the class at import time (from api_settings.DEFAULT_THROTTLE_RATES
        # as it existed then) — overriding settings.REST_FRAMEWORK in a test
        # does not reach it, since nothing re-reads api_settings into this
        # attribute afterwards. Patching the class attribute directly is what
        # actually changes the rate get_rate() sees.
        rates = dict(ScopedRateThrottle.THROTTLE_RATES)
        rates['face_verification'] = rate
        return patch.object(ScopedRateThrottle, 'THROTTLE_RATES', rates)

    def test_throttle_returns_429_after_the_configured_limit(self):
        with self._low_rate('2/min'):
            cache.clear()
            for _ in range(2):
                res = self.client.post('/api/auth/verify-id/', {'idImage': 'not-a-real-image'}, format='json')
                self.assertNotEqual(res.status_code, 429)
            throttled = self.client.post('/api/auth/verify-id/', {'idImage': 'not-a-real-image'}, format='json')
            self.assertEqual(throttled.status_code, 429)

    def test_signed_in_endpoints_are_not_affected_by_the_anonymous_throttle(self):
        user = make_nurse()
        session = issue_session(user)
        with self._low_rate('1/min'):
            cache.clear()
            # Exhaust the face_verification scope's one allowed request.
            self.client.post('/api/auth/verify-id/', {'idImage': 'not-a-real-image'}, format='json')
            throttled = self.client.post('/api/auth/verify-id/', {'idImage': 'not-a-real-image'}, format='json')
            self.assertEqual(throttled.status_code, 429)

            # An unrelated, authenticated endpoint must be completely unaffected —
            # it has no throttle_scope at all, so it never shares this bucket.
            self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {session.key}')
            res = self.client.get('/api/auth/me/')
            self.assertEqual(res.status_code, 200)
