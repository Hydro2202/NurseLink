"""
Real face detection + face recognition for registration Face Verification.

Two-stage pipeline using OpenCV's DNN face models (OpenCV Zoo):
  1. Detection (YuNet)   — is there exactly one real human face in the image?
     Rejects zero faces, multiple faces, and (heuristically) very blurry crops.
  2. Recognition (SFace)  — do the selfie and Hospital ID photo embeddings match?

No raw images or biometric embeddings are persisted anywhere — both images are
decoded in memory, compared, and discarded. Only the verification *outcome*
(matched/confidence/reason) is stored, in FaceVerificationAttempt.

Model weights are not committed to the repo; they are downloaded once (from
the official OpenCV Zoo) into api/ml_models/ on first use and cached there.
"""

from __future__ import annotations

import base64
import binascii
import os
import tempfile
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import cv2
import numpy as np
from django.conf import settings

# Sourced from settings (env-configurable) rather than literals, so both the
# attempt cap and the match threshold live in exactly one place — see
# MAX_FACE_VERIFICATION_ATTEMPTS / FACE_MATCH_THRESHOLD in settings.py.
MAX_FACE_ATTEMPTS = settings.MAX_FACE_VERIFICATION_ATTEMPTS
MAX_IMAGE_BYTES = 10 * 1024 * 1024  # 10 MB, matches the documented upload limit

MODEL_DIR = Path(__file__).resolve().parent / 'ml_models'
YUNET_PATH = MODEL_DIR / 'face_detection_yunet_2023mar.onnx'
SFACE_PATH = MODEL_DIR / 'face_recognition_sface_2021dec.onnx'

YUNET_URL = (
    'https://media.githubusercontent.com/media/opencv/opencv_zoo/main/'
    'models/face_detection_yunet/face_detection_yunet_2023mar.onnx'
)
SFACE_URL = (
    'https://media.githubusercontent.com/media/opencv/opencv_zoo/main/'
    'models/face_recognition_sface/face_recognition_sface_2021dec.onnx'
)

# Official OpenCV Zoo SFace verification threshold by default (0.363) — see
# FACE_MATCH_THRESHOLD in settings.py for why this must not be confused with
# the separate, differently-scaled FACE_SIMILARITY_THRESHOLD (n8n/Rekognition).
COSINE_MATCH_THRESHOLD = settings.FACE_MATCH_THRESHOLD
BLUR_VARIANCE_THRESHOLD = 15.0  # Laplacian variance on the 112x112 aligned crop
# ID-card portraits occupy a small part of a phone image. 0.60 was too
# strict for otherwise clear printed portraits, causing the comparison never
# to reach the real face matcher. YuNet still performs landmark validation,
# so 0.45 remains conservative while admitting those smaller portraits.
DETECTOR_SCORE_THRESHOLD = 0.45

_detector: Optional[cv2.FaceDetectorYN] = None
_recognizer: Optional[cv2.FaceRecognizerSF] = None


class FaceModelError(Exception):
    """
    Raised when the ONNX model files can't be loaded or downloaded.

    ``default_detail`` is what the API layer shows a client — a fixed class
    attribute, never the raw message (which can include a local file path).
    """

    default_detail = 'Face verification service is temporarily unavailable. Please try again later.'


class InvalidImageError(ValueError):
    """
    Base class for a request whose image payload couldn't be used.

    Each concrete reason below is its own subclass with a fixed
    ``default_detail`` string, so the API layer can hand a client a safe,
    specific reason (PDF vs. too large vs. undecodable, etc.) without ever
    reading the exception's own message/args — see api/views.py's
    PortraitImageError handling.
    """

    default_detail = 'Could not process the uploaded image. Please try again.'


class MissingImageError(InvalidImageError):
    default_detail = 'No image data provided.'


class UnsupportedImageFormatError(InvalidImageError):
    default_detail = 'Unsupported image format.'


class PdfNotSupportedImageError(InvalidImageError):
    default_detail = 'PDF uploads are not supported. Please upload a JPG or PNG photo.'


class InvalidBase64ImageError(InvalidImageError):
    default_detail = 'Image data is not valid base64.'


class ImageTooSmallError(InvalidImageError):
    default_detail = 'Image data is too small to be a valid photo.'


class ImageTooLargeError(InvalidImageError):
    default_detail = 'Image is too large. Maximum file size is 10 MB.'


class ImageDecodeError(InvalidImageError):
    default_detail = 'Could not decode image. Please upload a valid JPG or PNG.'


def _ensure_model(path: Path, url: str) -> None:
    if path.exists() and path.stat().st_size > 0:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        fd, tmp_path = tempfile.mkstemp(dir=str(path.parent), suffix='.download')
        os.close(fd)
        urllib.request.urlretrieve(url, tmp_path)  # noqa: S310 - fixed, trusted OpenCV Zoo URL
        os.replace(tmp_path, path)
    except Exception as exc:  # noqa: BLE001 - collapse any network/IO failure
        raise FaceModelError(
            f'Could not download required face-verification model ({path.name}). '
            'Check network access or place the file manually in api/ml_models/.'
        ) from exc


def _get_detector() -> cv2.FaceDetectorYN:
    global _detector
    if _detector is None:
        _ensure_model(YUNET_PATH, YUNET_URL)
        _detector = cv2.FaceDetectorYN.create(
            str(YUNET_PATH), '', (320, 320), score_threshold=DETECTOR_SCORE_THRESHOLD
        )
    return _detector


def _get_recognizer() -> cv2.FaceRecognizerSF:
    global _recognizer
    if _recognizer is None:
        _ensure_model(SFACE_PATH, SFACE_URL)
        _recognizer = cv2.FaceRecognizerSF.create(str(SFACE_PATH), '')
    return _recognizer


def _decode_image(image_data: str, *, allow_pdf_hint: bool = False) -> np.ndarray:
    """Decode a base64 / data-URI image into a BGR OpenCV image."""
    if not image_data or not isinstance(image_data, str):
        raise MissingImageError('No image data provided.')

    payload = image_data.strip()
    if payload.startswith('data:'):
        header, _, rest = payload.partition(',')
        # verify_face_against_id special-cases this exact message to give a
        # PDF-specific hint — keep the literal 'PDF' text so that check
        # (`str(exc) == 'PDF'`) keeps working unchanged.
        if allow_pdf_hint and 'application/pdf' in header:
            raise PdfNotSupportedImageError('PDF')
        if 'image/' not in header:
            raise UnsupportedImageFormatError('Unsupported image format.')
        payload = rest
    if not payload:
        raise MissingImageError('No image data provided.')

    try:
        raw = base64.b64decode(payload, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise InvalidBase64ImageError('Image data is not valid base64.') from exc

    if len(raw) < 500:
        raise ImageTooSmallError('Image data is too small to be a valid photo.')
    if len(raw) > MAX_IMAGE_BYTES:
        raise ImageTooLargeError('Image is too large. Maximum file size is 10 MB.')

    array = np.frombuffer(raw, dtype=np.uint8)
    img = cv2.imdecode(array, cv2.IMREAD_COLOR)
    if img is None:
        raise ImageDecodeError('Could not decode image. Please upload a valid JPG or PNG.')
    return img


@dataclass
class DetectionResult:
    ok: bool
    reason: Optional[str] = None
    message: Optional[str] = None
    face_box: Optional[np.ndarray] = None


def _detect_single_face(image_bgr: np.ndarray, *, label: str) -> DetectionResult:
    detector = _get_detector()
    recognizer = _get_recognizer()

    h, w = image_bgr.shape[:2]
    detector.setInputSize((w, h))
    _, faces = detector.detect(image_bgr)

    if faces is None or len(faces) == 0:
        return DetectionResult(
            False,
            'NO_FACE',
            'No face detected. Please position your face clearly inside the camera frame and try again.'
            if label == 'photo'
            else f'No face detected in the {label}.',
        )
    if len(faces) > 1:
        return DetectionResult(
            False,
            'MULTIPLE_FACES',
            f'Multiple faces detected in the {label}. Please ensure only your face is visible in the frame.',
        )

    face_box = faces[0]
    aligned = recognizer.alignCrop(image_bgr, face_box)
    gray = cv2.cvtColor(aligned, cv2.COLOR_BGR2GRAY)
    blur_variance = cv2.Laplacian(gray, cv2.CV_64F).var()
    if blur_variance < BLUR_VARIANCE_THRESHOLD:
        return DetectionResult(
            False,
            'BLURRY',
            f'The {label} is too blurry to verify. Please retake it in better lighting and hold steady.',
        )

    return DetectionResult(True, face_box=face_box)


@dataclass
class FaceVerificationOutcome:
    matched: bool
    confidence: float
    reason: Optional[str]
    message: Optional[str]
    countable: bool  # whether this outcome should consume one of the 3 attempts


def verify_face_against_id(
    selfie_data: str,
    id_data: str,
    *,
    id_label: str = 'Hospital ID photo',
    reason_prefix: str = 'ID_',
) -> FaceVerificationOutcome:
    """
    Full pipeline: decode both images, detect a single clear face in each,
    then compare embeddings.

    Any completed validation that does not match (no face, multiple faces,
    blurry, corrupt image, ID issues, or mismatch) is countable=True and
    consumes one of the three face-verification attempts. Camera permission /
    UI / network failures that never reach this function do not count.

    ``id_label``/``reason_prefix`` let a caller compare the selfie against a
    document other than the Hospital ID (e.g. a PRC licence) and get
    correctly-worded messages and reason codes for it, without duplicating
    this pipeline. Defaults reproduce the original Hospital-ID behaviour.
    """
    try:
        id_img = _decode_image(id_data, allow_pdf_hint=True)
    except InvalidImageError as exc:
        if str(exc) == 'PDF':
            return FaceVerificationOutcome(
                False,
                0.0,
                f'{reason_prefix}NOT_IMAGE',
                f'Face verification requires a photo (JPG or PNG) of your {id_label}. '
                'PDF uploads can’t be used for face matching — please re-upload it as an image.',
                countable=True,
            )
        return FaceVerificationOutcome(False, 0.0, f'{reason_prefix}INVALID_IMAGE', str(exc), countable=True)

    try:
        selfie_img = _decode_image(selfie_data)
    except InvalidImageError as exc:
        return FaceVerificationOutcome(False, 0.0, 'INVALID_IMAGE', str(exc), countable=True)

    id_check = _detect_single_face(id_img, label=id_label)
    if not id_check.ok:
        return FaceVerificationOutcome(False, 0.0, f'{reason_prefix}{id_check.reason}', id_check.message, countable=True)

    selfie_check = _detect_single_face(selfie_img, label='photo')
    if not selfie_check.ok:
        return FaceVerificationOutcome(False, 0.0, selfie_check.reason, selfie_check.message, countable=True)

    recognizer = _get_recognizer()
    id_feature = recognizer.feature(recognizer.alignCrop(id_img, id_check.face_box))
    selfie_feature = recognizer.feature(recognizer.alignCrop(selfie_img, selfie_check.face_box))
    cosine_score = float(recognizer.match(id_feature, selfie_feature, cv2.FaceRecognizerSF_FR_COSINE))

    matched = cosine_score >= COSINE_MATCH_THRESHOLD
    confidence = round(max(0.0, min(1.0, cosine_score)) * 100, 2)

    if matched:
        return FaceVerificationOutcome(True, confidence, None, None, countable=False)

    return FaceVerificationOutcome(
        False,
        confidence,
        'MISMATCH',
        'Face verification failed. Please position your face correctly and try again.',
        countable=True,
    )
