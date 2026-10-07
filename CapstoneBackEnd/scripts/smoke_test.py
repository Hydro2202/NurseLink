#!/usr/bin/env python
"""
End-to-end smoke test against a locally running NurseLink backend.

Requires: pip install requests websockets  (not in requirements.txt — these
are smoke-test-only tooling, not something the Django app itself imports).

Usage:
    python manage.py runserver 0.0.0.0:8010      # in one terminal (daphne via channels[daphne])
    python scripts/smoke_test.py                  # in another

Safe to run repeatedly against a local/dev database. Uses only the two
seeded demo accounts (see api/management/commands/seed_demo.py) and data it
creates and cleans up itself; never touches anything else. Does NOT run
`seed_demo` itself (that command wipes the database) — run it yourself first
if you want a clean baseline:  python manage.py seed_demo

Exit code is 0 only if every REQUIRED step passed. Steps marked OPTIONAL
(e.g. live face/OCR verification, which depends on local Tesseract/model
files or a reachable n8n instance) are reported but never fail the run.
"""

import asyncio
import base64
import json
import sys
import time
import uuid

import requests

try:
    import websockets
except ImportError:
    websockets = None

BASE_URL = 'http://127.0.0.1:8010/api'
WS_URL = 'ws://127.0.0.1:8010/ws/notifications/'

NURSE_EMAIL = 'nurse@hospital.com'
NURSE_PASSWORD = 'password123'
HEAD_NURSE_EMAIL = 'headnurse@hospital.com'
HEAD_NURSE_PASSWORD = 'password123'

PASS, FAIL, SKIP = [], [], []


def record(name, ok, detail=''):
    bucket = PASS if ok else FAIL
    bucket.append((name, detail))
    print(f'{"PASS" if ok else "FAIL"}  {name}' + (f'  — {detail}' if detail else ''))


def record_skip(name, reason):
    SKIP.append((name, reason))
    print(f'SKIP  {name}  — {reason}')


def req(method, path, token=None, **kwargs):
    headers = kwargs.pop('headers', {})
    if token:
        headers['Authorization'] = f'Bearer {token}'
    return requests.request(method, f'{BASE_URL}{path}', headers=headers, timeout=20, **kwargs)


def tiny_jpeg_b64() -> str:
    """A minimal valid 1x1 JPEG — decodable, but will fail face/portrait
    detection (no face in a 1x1 pixel). Used only to prove the endpoint is
    reachable and auth-exempt, not to pass identity verification."""
    import cv2
    import numpy as np
    img = np.full((50, 50, 3), 200, dtype=np.uint8)
    ok, buf = cv2.imencode('.jpg', img)
    assert ok
    return 'data:image/jpeg;base64,' + base64.b64encode(buf.tobytes()).decode()


def huge_jpeg_b64() -> str:
    import cv2
    import numpy as np
    img = np.full((100, 7000, 3), 200, dtype=np.uint8)
    ok, buf = cv2.imencode('.jpg', img, [cv2.IMWRITE_JPEG_QUALITY, 60])
    assert ok
    return 'data:image/jpeg;base64,' + base64.b64encode(buf.tobytes()).decode()


def section(title):
    print(f'\n--- {title} ---')


def main():
    section('Connectivity')
    try:
        res = req('GET', '/schema/')
        record('backend is reachable', res.status_code < 500, f'status={res.status_code}')
    except requests.exceptions.ConnectionError as exc:
        print(f'Cannot reach {BASE_URL} — is `python manage.py runserver 0.0.0.0:8010` running? ({exc})')
        sys.exit(1)

    # ---------------------------------------------------------------- Auth
    section('Forbidden cases (anonymous / wrong credentials)')
    res = req('GET', '/patients/')
    record('anonymous GET /patients/ is refused', res.status_code in (401, 403), f'status={res.status_code}')

    res = req('POST', '/auth/login/', json={'email': NURSE_EMAIL, 'password': 'wrong-password', 'role': 'staff_nurse'})
    record('login with wrong password is 401', res.status_code == 401, f'status={res.status_code}')

    res = req('POST', '/auth/login/', json={'email': NURSE_EMAIL, 'password': NURSE_PASSWORD, 'role': 'head_nurse'})
    record('logging in as the wrong role is refused', res.status_code == 403, f'status={res.status_code}')

    section('Login (both roles)')
    res = req('POST', '/auth/login/', json={'email': NURSE_EMAIL, 'password': NURSE_PASSWORD, 'role': 'staff_nurse'})
    record('nurse login', res.status_code == 200, f'status={res.status_code}')
    if res.status_code != 200:
        print('Cannot continue without a working nurse login — run `python manage.py seed_demo` first.')
        sys.exit(1)
    nurse_token = res.json()['token']

    res = req('POST', '/auth/login/', json={'email': HEAD_NURSE_EMAIL, 'password': HEAD_NURSE_PASSWORD, 'role': 'head_nurse'})
    record('head nurse login', res.status_code == 200, f'status={res.status_code}')
    head_token = res.json()['token'] if res.status_code == 200 else None

    section('Current user')
    res = req('GET', '/auth/me/', token=nurse_token)
    record('GET /auth/me/', res.status_code == 200 and res.json().get('email') == NURSE_EMAIL, f'status={res.status_code}')

    # ------------------------------------------------------------- Patients
    section('Patients')
    res = req('GET', '/patients/', token=nurse_token)
    record('list patients', res.status_code == 200, f'status={res.status_code}, count={len(res.json()) if res.status_code == 200 else "?"}')
    patient_code = None
    if res.status_code == 200 and res.json():
        patient_code = res.json()[0]['id']
        res = req('GET', f'/patients/{patient_code}/', token=nurse_token)
        record('retrieve one patient', res.status_code == 200, f'status={res.status_code}')
    else:
        record_skip('retrieve one patient', 'no patients in the database to retrieve')

    created_patient_code = None
    if head_token:
        suffix = uuid.uuid4().hex[:6]
        res = req('POST', '/patients/', token=head_token, json={
            'name': f'Smoke Test Patient {suffix}', 'age': 40, 'gender': 'Male',
            'room': f'SMK-{suffix}', 'diagnosis': 'Smoke test', 'riskLevel': 'low',
            'admissionDate': time.strftime('%Y-%m-%d'),
        })
        record('create patient (head nurse)', res.status_code == 201, f'status={res.status_code}: {res.text[:200]}')
        if res.status_code == 201:
            created_patient_code = res.json()['id']
            res = req('PATCH', f'/patients/{created_patient_code}/', token=head_token, json={'diagnosis': 'Smoke test (edited)'})
            record('edit patient (head nurse)', res.status_code == 200, f'status={res.status_code}')
            res = req('POST', '/patients/', token=nurse_token, json={
                'name': 'Should not be allowed', 'age': 1, 'gender': 'Male', 'room': 'X',
                'diagnosis': 'x', 'riskLevel': 'low', 'admissionDate': time.strftime('%Y-%m-%d'),
            })
            record('staff nurse cannot create a patient', res.status_code == 403, f'status={res.status_code}')
    else:
        record_skip('create/edit patient', 'head nurse login unavailable')

    # ---------------------------------------------------------------- Tasks
    section('Tasks')
    task_id = None
    target_patient = created_patient_code or patient_code
    if target_patient:
        res = req('POST', '/tasks/', token=nurse_token, json={
            'title': 'Smoke test task', 'priority': 'routine', 'status': 'pending',
            'category': 'care', 'patientId': target_patient, 'dueTime': '23:59',
        })
        record('create task', res.status_code == 201, f'status={res.status_code}: {res.text[:200]}')
        if res.status_code == 201:
            task_id = res.json()['id']
            res = req('PATCH', f'/tasks/{task_id}/', token=nurse_token, json={'priority': 'urgent'})
            record('update task priority', res.status_code == 200 and res.json().get('priority') == 'urgent', f'status={res.status_code}')

            # The app correctly refuses to complete a task with unfinished
            # checklist items — tick them all off first, the same way the UI would.
            checklist = res.json().get('checklist', [])
            for item in checklist:
                item['done'] = True
            req('PATCH', f'/tasks/{task_id}/', token=nurse_token, json={'checklist': checklist})

            res = req('POST', f'/tasks/{task_id}/complete/', token=nurse_token)
            record('complete task', res.status_code == 200, f'status={res.status_code}: {res.text[:200]}')
    else:
        record_skip('tasks', 'no patient available to attach a task to')

    res = req('GET', '/tasks/', token=nurse_token)
    record('list tasks', res.status_code == 200, f'status={res.status_code}')

    # ------------------------------------------------------------ Referrals
    section('Referrals (handovers)')
    res = req('GET', '/handovers/?status=pending', token=nurse_token)
    record('list referrals (including possibly-empty list)', res.status_code == 200, f'status={res.status_code}, count={len(res.json()) if res.status_code == 200 else "?"}')

    # ------------------------------------------------------- Notifications
    section('Notifications (WebSocket)')
    if websockets is None:
        record_skip('WebSocket notification push', '`websockets` package not installed (pip install websockets)')
    else:
        res = req('POST', '/auth/ws-ticket/', token=nurse_token)
        record('get a WS connect ticket', res.status_code == 200, f'status={res.status_code}')
        if res.status_code == 200:
            ticket = res.json()['ticket']
            ok, detail = asyncio.run(_check_notification_socket(ticket))
            record('WebSocket connects and identifies the user', ok, detail)
        else:
            record_skip('WebSocket connects and identifies the user', 'no ticket issued')

    # --------------------------------------------------- Analytics/Workload
    section('Analytics & workload')
    if head_token:
        res = req('GET', '/analytics/', token=head_token)
        record('GET /analytics/', res.status_code == 200, f'status={res.status_code}')
        res = req('GET', '/workload/', token=head_token)
        record('GET /workload/', res.status_code == 200, f'status={res.status_code}')
    else:
        record_skip('analytics & workload', 'head nurse login unavailable')

    # --------------------------------------------- Issue 15: upload hardening
    section('Issue 15 — anonymous upload hardening (live, not just unit tests)')
    res = req('POST', '/auth/verify-id/', json={'idImage': 'not-a-real-image-just-text', 'documentType': 'hospital_id'})
    record('a non-image payload is rejected with 400', res.status_code == 400, f'status={res.status_code}')

    res = req('POST', '/auth/verify-id/', json={'idImage': huge_jpeg_b64(), 'documentType': 'hospital_id'})
    record('an oversized-dimension image is rejected with 400', res.status_code == 400, f'status={res.status_code}')

    res = req('POST', '/auth/verify-id/', json={'idImage': tiny_jpeg_b64(), 'documentType': 'hospital_id'})
    record(
        'a small, well-formed (but faceless) image reaches real validation, not a size/format rejection',
        res.status_code == 200,
        f'status={res.status_code}: {res.text[:200]}',
    )

    # --------------------------------------------------------- Sign-up flow
    section('Sign-up flow (OPTIONAL — depends on local Tesseract/OpenCV models/n8n)')
    record_skip(
        'full sign-up (ID scan -> face verify -> account creation)',
        'needs a real photo of a real PRC/hospital ID and a real face to pass OCR + face '
        'detection; not something this script fabricates. The reachability and input-validation '
        'of these endpoints is covered above and in api/tests_upload_hardening.py.',
    )

    # --------------------------------------------------------------- Logout
    section('Logout')
    res = req('POST', '/auth/logout/', token=nurse_token)
    record('logout', res.status_code == 200, f'status={res.status_code}')
    res = req('GET', '/auth/me/', token=nurse_token)
    record('token is invalid after logout', res.status_code == 401, f'status={res.status_code}')

    # ------------------------------------------------------------- Cleanup
    if created_patient_code and head_token:
        req('DELETE', f'/patients/{created_patient_code}/', token=head_token)

    # ------------------------------------------------------------- Summary
    print(f'\n{"=" * 60}')
    print(f'PASS: {len(PASS)}   FAIL: {len(FAIL)}   SKIP: {len(SKIP)}')
    if FAIL:
        print('\nFailed:')
        for name, detail in FAIL:
            print(f'  - {name}: {detail}')
    sys.exit(1 if FAIL else 0)


async def _check_notification_socket(ticket):
    try:
        async with websockets.connect(f'{WS_URL}?ticket={ticket}', open_timeout=5) as ws:
            raw = await asyncio.wait_for(ws.recv(), timeout=5)
            data = json.loads(raw)
            return data.get('type') == 'connected' and 'userId' in data, f'received={data}'
    except Exception as exc:  # noqa: BLE001 - report any failure as a clear detail string
        return False, f'{type(exc).__name__}: {exc}'


if __name__ == '__main__':
    main()
