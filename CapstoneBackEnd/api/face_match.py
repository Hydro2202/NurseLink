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

MAX_FACE_ATTEMPTS = 3

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

COSINE_MATCH_THRESHOLD = 0.363  # official OpenCV Zoo SFace verification threshold
BLUR_VARIANCE_THRESHOLD = 15.0  # Laplacian variance on the 112x112 aligned crop
DETECTOR_SCORE_THRESHOLD = 0.6

_detector: Optional[cv2.FaceDetectorYN] = None
_recognizer: Optional[cv2.FaceRecognizerSF] = None


class FaceModelError(Exception):
    """Raised when the ONNX model files can't be loaded or downloaded."""


class InvalidImageError(ValueError):
    pass


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
        raise InvalidImageError('No image data provided.')

    payload = image_data.strip()
    if payload.startswith('data:'):
        header, _, rest = payload.partition(',')
        if allow_pdf_hint and 'application/pdf' in header:
            raise InvalidImageError('PDF')
        if 'image/' not in header:
            raise InvalidImageError('Unsupported image format.')
        payload = rest
    if not payload:
        raise InvalidImageError('No image data provided.')

    try:
        raw = base64.b64decode(payload, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise InvalidImageError('Image data is not valid base64.') from exc

    if len(raw) < 500:
        raise InvalidImageError('Image data is too small to be a valid photo.')

    array = np.frombuffer(raw, dtype=np.uint8)
    img = cv2.imdecode(array, cv2.IMREAD_COLOR)
    if img is None:
        raise InvalidImageError('Could not decode image. Please upload a valid JPG or PNG.')
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


def verify_face_against_id(selfie_data: str, id_data: str) -> FaceVerificationOutcome:
    """
    Full pipeline: decode both images, detect a single clear face in each,
    then compare embeddings. Detection/quality failures never consume an
    attempt — only a genuine face-to-face comparison (match or mismatch) does.
    """
    try:
        id_img = _decode_image(id_data, allow_pdf_hint=True)
    except InvalidImageError as exc:
        if str(exc) == 'PDF':
            return FaceVerificationOutcome(
                False,
                0.0,
                'ID_NOT_IMAGE',
                'Face verification requires a photo (JPG or PNG) of your Hospital ID. '
                'PDF uploads can’t be used for face matching — please re-upload your ID as an image in Step 1.',
                countable=True,
            )
        return FaceVerificationOutcome(False, 0.0, 'ID_INVALID_IMAGE', str(exc), countable=True)

    try:
        selfie_img = _decode_image(selfie_data)
    except InvalidImageError as exc:
        return FaceVerificationOutcome(
            False, 0.0, 'INVALID_IMAGE',
            'Face not detected. Only a real human face captured using the camera is accepted.',
            countable=True,
        )

    id_check = _detect_single_face(id_img, label='Hospital ID photo')
    if not id_check.ok:
        return FaceVerificationOutcome(False, 0.0, f'ID_{id_check.reason}', id_check.message, countable=True)

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
        return FaceVerificationOutcome(True, confidence, None, None, countable=True)

    return FaceVerificationOutcome(
        False,
        confidence,
        'MISMATCH',
        'Face does not match your Hospital ID. Please try again.',
        countable=True,
    )
