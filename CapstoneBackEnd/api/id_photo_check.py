"""
Portrait-photo presence check for uploaded ID cards.

Answers one narrow question before any OCR runs: **does this ID actually
carry a photograph of a person?**

The attack it closes is simple and cheap. Text on an ID is easy to fake —
type it in an image editor, or photograph a template. The portrait is the
part a fraudster most often removes, blanks out, or crops away, because
they have the details but not the face. An ID whose photo box is empty,
white, or cropped off is not a usable identity document, and letting it
through means the later face-match step compares a live selfie against
nothing.

Running this first is also just cheaper: it is a local millisecond-scale
check that rejects a bad upload before spending an OCR call on it.

Detector choice
---------------
Haar cascades are the classic answer here, but this project cannot use
them: OpenCV 5.x ships no cascade XML files (``cv2/data/`` is empty), so
Haar would require vendoring a model anyway. It is also the weaker option
for this job — ID portraits are small, often greyscale, low-contrast and
slightly rotated, exactly the conditions where Haar's false-negative rate
climbs and legitimate nurses get turned away.

So this uses **YuNet**, the CNN detector already vendored in this app for
face matching (``api/ml_models/face_detection_yunet_2023mar.onnx``). Same
dependency, no new download, materially better recall on printed portraits.
"""

import logging
from dataclasses import dataclass
from typing import Optional

import cv2
import numpy as np

from .face_match import (
    FaceModelError,
    InvalidImageError,
    YUNET_PATH,
    YUNET_URL,
    _decode_image,
    _ensure_model,
)

logger = logging.getLogger(__name__)

REJECTION_MESSAGE = (
    'No portrait photo detected on the ID. Please upload a valid ID containing a photo.'
)

# Printed ID portraits are lower contrast than a live camera capture, so the
# bar is set below the 0.6 used for selfie matching. Lowering it trades a
# little false-positive risk for far fewer legitimate IDs being rejected —
# the right trade when the alternative is blocking a real nurse's signup.
# Speck detections are filtered separately by MIN_FACE_WIDTH_RATIO.
PORTRAIT_SCORE_THRESHOLD = 0.45

# A real portrait occupies a meaningful share of the card. Anything narrower
# than this is texture noise — a logo, a QR block, a face-like smudge — not a
# photograph. Measured against image width so it is resolution independent.
MIN_FACE_WIDTH_RATIO = 0.04

# YuNet resolves small faces poorly. ID cards photographed at a distance put
# the portrait well under 100px wide, so upscale before detecting.
TARGET_MIN_WIDTH = 900
MAX_UPSCALE = 3.0


@dataclass
class PortraitCheckResult:
    """Outcome of one portrait check."""

    has_photo: bool
    face_count: int = 0
    confidence: float = 0.0
    message: str = ''
    #: Fraction of image width taken up by the largest detected face.
    face_width_ratio: float = 0.0

    def as_dict(self) -> dict:
        return {
            'hasPhoto': self.has_photo,
            'faceCount': self.face_count,
            'confidence': round(self.confidence, 4),
            'message': self.message,
        }


_portrait_detector: Optional[cv2.FaceDetectorYN] = None


def _get_portrait_detector() -> cv2.FaceDetectorYN:
    """
    YuNet tuned for printed ID portraits.

    Built separately from the matcher's detector in ``face_match`` because the
    score threshold is baked in at construction, and this job wants a more
    permissive one.
    """
    global _portrait_detector
    if _portrait_detector is None:
        _ensure_model(YUNET_PATH, YUNET_URL)
        _portrait_detector = cv2.FaceDetectorYN.create(
            str(YUNET_PATH),
            '',
            (320, 320),
            score_threshold=PORTRAIT_SCORE_THRESHOLD,
        )
    return _portrait_detector


def _prepare(image_bgr: np.ndarray) -> np.ndarray:
    """Upscale small captures so the portrait is large enough to detect."""
    height, width = image_bgr.shape[:2]
    if width >= TARGET_MIN_WIDTH:
        return image_bgr
    scale = min(MAX_UPSCALE, TARGET_MIN_WIDTH / max(width, 1))
    return cv2.resize(image_bgr, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)


def detect_portrait(image_bgr: np.ndarray) -> PortraitCheckResult:
    """
    Detect a portrait photograph in an ID card image.

    Takes a decoded BGR array — use :func:`check_id_has_portrait` for the
    base64 the API receives. Raises :class:`FaceModelError` if the detector
    model is unavailable, which is a server problem rather than a bad upload
    and must not be reported to the user as a rejected ID.
    """
    prepared = _prepare(image_bgr)
    height, width = prepared.shape[:2]

    detector = _get_portrait_detector()
    detector.setInputSize((width, height))
    _, faces = detector.detect(prepared)

    if faces is None or len(faces) == 0:
        return PortraitCheckResult(has_photo=False, message=REJECTION_MESSAGE)

    # YuNet rows are [x, y, w, h, ...landmarks..., score].
    usable = []
    for face in faces:
        face_width = float(face[2])
        ratio = face_width / width if width else 0.0
        if ratio >= MIN_FACE_WIDTH_RATIO:
            usable.append((ratio, float(face[-1])))

    if not usable:
        # Something was detected, but nothing large enough to be a portrait.
        largest = max(float(f[2]) / width for f in faces) if width else 0.0
        logger.info(
            'ID portrait check: %d detection(s) below size floor (largest %.3f of width)',
            len(faces),
            largest,
        )
        return PortraitCheckResult(
            has_photo=False,
            face_count=0,
            message=REJECTION_MESSAGE,
            face_width_ratio=largest,
        )

    best_ratio, best_score = max(usable, key=lambda item: item[0])
    return PortraitCheckResult(
        has_photo=True,
        face_count=len(usable),
        confidence=best_score,
        face_width_ratio=best_ratio,
    )


def check_id_has_portrait(image_data: str) -> PortraitCheckResult:
    """
    Portrait check for the base64 an API client uploads.

    ``image_data`` may be bare base64 or a ``data:image/jpeg;base64,`` URI.

    Raises :class:`InvalidImageError` when the upload is not a decodable
    image, and :class:`FaceModelError` when the detector cannot load.
    """
    image = _decode_image(image_data)
    return detect_portrait(image)


__all__ = [
    'FaceModelError',
    'InvalidImageError',
    'MIN_FACE_WIDTH_RATIO',
    'PORTRAIT_SCORE_THRESHOLD',
    'PortraitCheckResult',
    'REJECTION_MESSAGE',
    'check_id_has_portrait',
    'detect_portrait',
]
