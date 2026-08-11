"""
Editable request-body examples for the Scalar API reference.

drf-spectacular already emits a ``requestBody`` for every write endpoint from
its serializer, but Scalar only pre-fills an editable JSON panel when the
operation also carries a concrete example. Without one it renders a schema
skeleton the reader cannot meaningfully edit or send — which is why ``Log in``
was the only endpoint with a usable body: it was the only one with examples.

Every entry here is ``request_only`` so these payloads never leak into the
response samples. Values mirror the accounts created by ``seed_demo``
(Sarah Johnson, staff nurse, ICU / Maria Santos, supervisor) so a reader can
copy one straight into a live call.
"""

from drf_spectacular.utils import OpenApiExample

# A placeholder session id. Registration endpoints reject unknown sessions, so
# swap this for the id returned by the face-verification step before sending.
SESSION_ID = '3f1a7c92-5d84-4a1e-9b2c-8e0d6f4a1b77'


def _example(name, value, description=''):
    """A request-only OpenApiExample — the shape Scalar renders as editable JSON."""
    return OpenApiExample(name, value=value, description=description, request_only=True)


# --- Auth: registration -------------------------------------------------

SIGNUP_EXAMPLES = [
    _example(
        'Staff nurse',
        {
            'email': 'nurse@hospital.com',
            'password': 'password123',
            'firstName': 'Sarah',
            'middleName': '',
            'lastName': 'Johnson',
            'role': 'staff_nurse',
            'department': 'ICU',
            'licenseNumber': 'RN-10001',
            'registrationSessionId': SESSION_ID,
        },
        'Requires a registrationSessionId that has cleared face or OTP verification.',
    ),
    _example(
        'Supervisor',
        {
            'email': 'headnurse@hospital.com',
            'password': 'password123',
            'firstName': 'Maria',
            'lastName': 'Santos',
            'role': 'supervisor',
            'department': 'Nursing Administration',
            'licenseNumber': 'RN-20001',
            'registrationSessionId': SESSION_ID,
        },
    ),
]

FACE_STATUS_EXAMPLES = [
    _example(
        'By session id',
        {'registrationSessionId': SESSION_ID},
        'Preferred. Resumes a registration already in progress.',
    ),
    _example(
        'By email',
        {'registeredEmail': 'nurse@hospital.com'},
        'Fallback when the session id was lost — matches the newest unclaimed session.',
    ),
]

SEND_OTP_EXAMPLES = [
    _example(
        'Send code',
        {'registrationSessionId': SESSION_ID, 'email': 'nurse@hospital.com'},
        'Email fallback offered after 3 failed face attempts. Needs EMAIL_* configured in the backend .env.',
    ),
]

RESEND_OTP_EXAMPLES = [
    _example(
        'Resend code',
        {'registrationSessionId': SESSION_ID, 'email': 'nurse@hospital.com'},
        'Invalidates the previous code. Subject to a 60-second cooldown.',
    ),
]

VERIFY_OTP_EXAMPLES = [
    _example(
        'Verify code',
        {'registrationSessionId': SESSION_ID, 'otp': '482913'},
        'Exactly 6 digits, valid for 5 minutes.',
    ),
]


# --- Auth: account ------------------------------------------------------

UPDATE_ME_EXAMPLES = [
    _example(
        'Update profile',
        {
            'firstName': 'Sarah',
            'middleName': 'Anne',
            'lastName': 'Johnson',
            'department': 'ICU',
            'licenseNumber': 'RN-10001',
            'shift': 'morning',
            'clinicalRole': 'RN',
            'specialization': 'Critical Care',
        },
        'Partial update — send only the fields you want to change.',
    ),
    _example('Change shift only', {'shift': 'night'}),
]

CHANGE_PASSWORD_EXAMPLES = [
    _example(
        'Change password',
        {'currentPassword': 'password123', 'newPassword': 'newPassword456'},
        'Issues a fresh token; the old one stops working immediately.',
    ),
]


# --- Patients -----------------------------------------------------------

PATIENT_CREATE_EXAMPLES = [
    _example(
        'Admit a patient',
        {
            'id': 'P-1042',
            'name': 'Ramon Dela Cruz',
            'age': 67,
            'gender': 'Male',
            'room': 'ICU-04',
            'diagnosis': 'Community-acquired pneumonia',
            'admissionDate': '2026-08-12',
            'riskLevel': 'high',
            'attendingPhysician': 'Dr. Alvarez',
            'vitalSigns': {
                'heartRate': 96,
                'bloodPressure': '138/86',
                'temperature': 38.2,
                'oxygenSaturation': 93,
                'respiratoryRate': 22,
            },
            'allergies': ['Penicillin'],
            'medications': ['Ceftriaxone 1g IV q12h', 'Salbutamol neb q6h'],
            'alerts': ['Fall risk', 'Oxygen dependent'],
        },
        'Supervisor only. "id" becomes the patient_code and must be unique.',
    ),
]

PATIENT_UPDATE_EXAMPLES = [
    _example(
        'Update vitals and risk',
        {
            'riskLevel': 'medium',
            'vitalSigns': {
                'heartRate': 84,
                'bloodPressure': '124/78',
                'temperature': 37.1,
                'oxygenSaturation': 97,
                'respiratoryRate': 18,
            },
        },
        'Staff nurses may only edit patients assigned to them; anything else returns 403.',
    ),
    _example('Move room', {'room': 'WARD-2B'}),
]


# --- Tasks --------------------------------------------------------------

TASK_CREATE_EXAMPLES = [
    _example(
        'Medication round',
        {
            'id': 'T-2075',
            'patientId': 'P-1042',
            'title': 'Administer Ceftriaxone 1g IV',
            'description': 'Second dose. Flush line before and after.',
            'priority': 'urgent',
            'dueTime': '14:00',
            'assignedTo': 'Sarah Johnson',
            'status': 'pending',
            'category': 'medication',
            'attendingPhysician': 'Dr. Alvarez',
            'patientRoom': 'ICU-04',
            'doctorOrder': 'Ceftriaxone 1g IV q12h x 7 days',
        },
        'priority: urgent | routine | completed. category: medication | vital_signs | care | assessment | documentation.',
    ),
    _example(
        'Routine vitals check',
        {
            'patientId': 'P-1042',
            'title': 'Record vital signs',
            'priority': 'routine',
            'dueTime': '16:00',
            'assignedTo': 'Sarah Johnson',
            'category': 'vital_signs',
        },
    ),
]

TASK_UPDATE_EXAMPLES = [
    _example(
        'Reassign and re-prioritise',
        {'assignedTo': 'Maria Santos', 'priority': 'urgent', 'status': 'in_progress'},
        'status: pending | in_progress | completed | overdue.',
    ),
    _example('Mark overdue', {'status': 'overdue'}),
]


# --- Handovers ----------------------------------------------------------

HANDOVER_CREATE_EXAMPLES = [
    _example(
        'SBAR handover',
        {
            'id': 'H-3011',
            'patientId': 'P-1042',
            'shift': 'morning',
            'date': '2026-08-12',
            'nurseFrom': 'Sarah Johnson',
            'nurseTo': 'Maria Santos',
            'sbar': {
                'situation': 'Post-op day 2, febrile overnight at 38.4 C.',
                'background': '67M admitted 2026-08-10 for community-acquired pneumonia.',
                'assessment': 'Sats holding at 93% on 2L nasal cannula. Crackles at right base.',
                'recommendation': 'Continue q4h vitals, escalate if sats drop below 92%.',
            },
            'unfinishedTasks': ['T-2075'],
            'photos': [],
            'status': 'pending',
        },
        'shift: morning | afternoon | night. status: pending | acknowledged | completed.',
    ),
]

HANDOVER_UPDATE_EXAMPLES = [
    _example(
        'Revise assessment',
        {
            'sbar': {
                'situation': 'Afebrile since 06:00.',
                'background': '67M, pneumonia, day 3.',
                'assessment': 'Sats 96% on room air. Chest clearing.',
                'recommendation': 'Step down to q8h vitals.',
            },
            'status': 'completed',
        },
    ),
]


# --- Charting -----------------------------------------------------------

CHARTING_CREATE_EXAMPLES = [
    _example(
        'Progress note',
        {
            'id': 'CN-5008',
            'patientId': 'P-1042',
            'timestamp': '2026-08-12T09:30:00Z',
            'type': 'progress',
            'content': (
                'Patient alert and oriented x3. Tolerated breakfast without nausea. '
                'Ambulated to bathroom with standby assist. No acute distress.'
            ),
            'aiGenerated': False,
            'attendingPhysician': 'Dr. Alvarez',
        },
        'type: progress | assessment | medication | vital_signs.',
    ),
    _example(
        'Medication note',
        {
            'patientId': 'P-1042',
            'timestamp': '2026-08-12T14:05:00Z',
            'type': 'medication',
            'content': 'Ceftriaxone 1g IV administered via left forearm PIV. Site clean, no infiltration.',
        },
    ),
]

CHARTING_UPDATE_EXAMPLES = [
    _example(
        'Amend a note',
        {
            'content': 'Corrected: ambulated to bathroom with one-person assist, not standby.',
            'edited': True,
        },
        'Sets the edited flag so the amendment is visible in the chart.',
    ),
]


# --- Notifications ------------------------------------------------------

NOTIFICATION_CREATE_EXAMPLES = [
    _example(
        'Critical alert',
        {'type': 'critical', 'patient': 'Ramon Dela Cruz — ICU-04', 'isRead': False},
        'type: critical | warning | info | success. Title and message are set server-side.',
    ),
]

NOTIFICATION_UPDATE_EXAMPLES = [
    _example('Mark as read', {'isRead': True}, 'The only field this endpoint acts on.'),
    _example('Mark as unread', {'isRead': False}),
]


# --- Assignments --------------------------------------------------------

ASSIGNMENT_CREATE_EXAMPLES = [
    _example(
        'Assign a patient',
        {
            'patientId': 'P-1042',
            'nurseId': '2',
            'nurseName': 'Sarah Johnson',
            'ward': 'ICU',
            'priority': 'urgent',
            'notes': 'Needs hourly neuro checks for the first 12 hours.',
            'status': 'active',
        },
        'Supervisor only. A patient can hold only one active assignment at a time.',
    ),
]

ASSIGNMENT_UPDATE_EXAMPLES = [
    _example(
        'Hand over to another nurse',
        {'nurseId': '3', 'nurseName': 'Maria Santos', 'status': 'active'},
    ),
    _example('Close the assignment', {'status': 'completed'}),
]


# --- Kardex -------------------------------------------------------------

KARDEX_CREATE_EXAMPLES = [
    _example(
        'Save a kardex card',
        {
            'patientId': 'P-1042',
            'lastName': 'Dela Cruz',
            'firstName': 'Ramon',
            'middleName': 'Batista',
            'age': '67',
            'gender': 'Male',
            'religion': 'Roman Catholic',
            'room': 'ICU-04',
            'bedNumber': '2',
            'admissionDate': '2026-08-10',
            'attendingPhysician': 'Dr. Alvarez',
            'chiefComplaint': 'Productive cough and shortness of breath for 4 days.',
            'admittingDiagnosis': 'Community-acquired pneumonia, moderate risk',
            'finalDiagnosis': '',
            'diet': 'Soft diet, low salt',
            'temperature': '38.2',
            'pulseRate': '96',
            'respiratoryRate': '22',
            'bloodPressure': '138/86',
            'oxygenSaturation': '93',
            'specialEndorsements': 'Fall risk. Keep bed in lowest position with rails up.',
        },
        'All clinical values are free text, matching the paper kardex.',
    ),
]


# --- n8n-backed features ------------------------------------------------
# Editable bodies for the three workflow integrations. Base64 values are
# truncated so the panel stays readable — paste a full payload before sending.

_B64_JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD...'

VERIFY_ID_EXAMPLES = [
    _example(
        'Read a Hospital ID',
        {
            'idImage': _B64_JPEG,
            'documentType': 'hospital_id',
            'expectedRole': 'staff_nurse',
        },
        'First call — omit registrationSessionId and one is created and returned to you.',
    ),
    _example(
        'Re-scan within an existing session',
        {
            'idImage': _B64_JPEG,
            'registrationSessionId': SESSION_ID,
            'documentType': 'hospital_id',
        },
        'Retake after a poor first scan. Reuses the session so wizard progress is kept.',
    ),
    _example(
        'Read a PRC licence',
        {'idImage': _B64_JPEG, 'documentType': 'prc_license'},
    ),
]

STRUCTURE_CHART_EXAMPLES = [
    _example(
        'Generate a note',
        {
            'patientId': 'P-1042',
            'assessment': (
                'Patient alert and oriented x3. Reports chest tightness 4/10 on exertion, '
                'relieved by rest. Bibasilar crackles on auscultation. Ambulated 20 metres '
                'with standby assist, no desaturation below 93%.'
            ),
            'interventions': [
                'Administered Ceftriaxone 1g IV',
                'Repositioned to high Fowler\u2019s',
                'Incentive spirometry x10 reps',
            ],
            'patientResponse': 'Tolerated interventions well. No increase in work of breathing.',
            'noteType': 'progress',
            'shift': 'morning',
            'save': False,
        },
        'Vitals and demographics are pulled from the patient record — you do not send them.',
    ),
    _example(
        'Generate and save',
        {
            'patientId': 'P-1042',
            'assessment': 'Afebrile overnight. Sats 97% on room air. No overnight events.',
            'noteType': 'progress',
            'save': True,
        },
        'save: true persists the result as a ChartingNote with aiGenerated = true.',
    ),
    _example(
        'Override the vitals',
        {
            'patientId': 'P-1042',
            'assessment': 'Post-ambulation reassessment.',
            'vitalSigns': {
                'heartRate': 102,
                'bloodPressure': '142/88',
                'temperature': 37.4,
                'oxygenSaturation': 94,
                'respiratoryRate': 24,
            },
            'noteType': 'vital_signs',
        },
        'Use when charting a set of vitals that is not yet on the patient record.',
    ),
]

FACE_VERIFY_EXAMPLES = [
    _example(
        'Verify selfie against ID',
        {
            'registrationSessionId': SESSION_ID,
            'image': _B64_JPEG,
            'idImage': _B64_JPEG,
        },
        'Routed to the n8n face-verify workflow. A completed failure costs one of 3 attempts.',
    ),
    _example(
        'Reset after lockout',
        {'registrationSessionId': SESSION_ID, 'reset': True},
        'Handled entirely server-side — no workflow call. Zeroes the counter and clears the lock.',
    ),
]
