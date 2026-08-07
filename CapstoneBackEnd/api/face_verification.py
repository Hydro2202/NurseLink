import io
from typing import Dict, List, Optional, Tuple

import cv2
import numpy as np
from PIL import Image

CASCADE_PATH = cv2.data.haarcascades + 'haarcascade_frontalface_default.xml'
STANDARD_FACE_SIZE = (256, 256)


def load_rgb_image_from_bytes(data: bytes) -> np.ndarray:
    image = Image.open(io.BytesIO(data)).convert('RGB')
    return np.asarray(image)


def load_rgb_image_from_path(path: str) -> np.ndarray:
    image = Image.open(path).convert('RGB')
    return np.asarray(image)


def detect_face_bbox(image: np.ndarray) -> Optional[Tuple[int, int, int, int]]:
    gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
    cascade = cv2.CascadeClassifier(CASCADE_PATH)
    if cascade.empty():
        return None

    faces = cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(80, 80))
    if len(faces) == 0:
        return None

    x, y, w, h = faces[0]
    margin = int(max(w, h) * 0.2)
    x = max(x - margin, 0)
    y = max(y - margin, 0)
    w = min(w + margin * 2, image.shape[1] - x)
    h = min(h + margin * 2, image.shape[0] - y)
    return x, y, w, h


def crop_face(image: np.ndarray, bbox: Tuple[int, int, int, int]) -> np.ndarray:
    x, y, w, h = bbox
    return image[y : y + h, x : x + w]


def normalize_face(image: np.ndarray) -> np.ndarray:
    face = cv2.resize(image, STANDARD_FACE_SIZE)
    if face.ndim == 3:
        face = cv2.cvtColor(face, cv2.COLOR_RGB2GRAY)
    return face


def compute_orb_similarity(base_face: np.ndarray, compare_face: np.ndarray) -> float:
    orb = cv2.ORB_create(500)
    keypoints_a, descriptors_a = orb.detectAndCompute(base_face, None)
    keypoints_b, descriptors_b = orb.detectAndCompute(compare_face, None)

    if descriptors_a is None or descriptors_b is None:
        return 0.0

    matcher = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=False)
    matches = matcher.knnMatch(descriptors_a, descriptors_b, k=2)
    good_matches = 0
    for m, n in matches:
        if m.distance < 0.75 * n.distance:
            good_matches += 1

    if len(matches) == 0:
        return 0.0

    score = float(min(100.0, (good_matches / max(1, min(len(descriptors_a), len(descriptors_b)))) * 100.0))
    return score


def compute_histogram_similarity(base_face: np.ndarray, compare_face: np.ndarray) -> float:
    hist_a = cv2.calcHist([base_face], [0], None, [64], [0, 256])
    hist_b = cv2.calcHist([compare_face], [0], None, [64], [0, 256])
    cv2.normalize(hist_a, hist_a)
    cv2.normalize(hist_b, hist_b)
    score = float(cv2.compareHist(hist_a, hist_b, cv2.HISTCMP_CORREL) * 100.0)
    return max(0.0, min(100.0, score))


def score_face_pair(id_face: np.ndarray, live_face: np.ndarray) -> float:
    orb_score = compute_orb_similarity(id_face, live_face)
    if orb_score > 0:
        return orb_score
    return compute_histogram_similarity(id_face, live_face)


def verify_face_images(id_image_path: str, live_image_bytes: List[bytes]) -> Dict[str, object]:
    id_image = load_rgb_image_from_path(id_image_path)
    id_bbox = detect_face_bbox(id_image)
    if id_bbox is None:
        return {
            'match_score': 0.0,
            'confidence': 'Low',
            'status': 'failed',
            'message': 'Could not detect a face in the uploaded ID image.',
            'details': [],
        }

    id_face = normalize_face(crop_face(id_image, id_bbox))
    details = []
    scores = []

    for image_bytes in live_image_bytes:
        live_image = load_rgb_image_from_bytes(image_bytes)
        live_bbox = detect_face_bbox(live_image)
        if live_bbox is None:
            details.append({'status': 'no_face'})
            continue

        live_face = normalize_face(crop_face(live_image, live_bbox))
        score = score_face_pair(id_face, live_face)
        scores.append(score)
        details.append({'score': round(score, 1), 'face_detected': True})

    if len(scores) == 0:
        return {
            'match_score': 0.0,
            'confidence': 'Low',
            'status': 'failed',
            'message': 'No face was detected in any captured image.',
            'details': details,
        }

    average_score = float(np.mean(scores))
    score = round(min(100.0, average_score), 1)

    if score >= 85.0:
        status = 'verified'
        confidence = 'High'
        message = 'Face verification succeeded. The live captures match the uploaded ID image.'
    elif score >= 65.0:
        status = 'retry'
        confidence = 'Medium'
        message = 'The verification result is inconclusive. Please retry with better lighting and a clearer live capture.'
    else:
        status = 'failed'
        confidence = 'Low'
        message = 'Could not verify your identity. Please try again using better lighting or a clearer ID.'

    return {
        'match_score': score,
        'confidence': confidence,
        'status': status,
        'message': message,
        'details': details,
    }
