import base64
import base64
import json
import logging
import time
import re
from datetime import date, timedelta

from django.conf import settings
from django.core.mail import send_mail
from django.contrib.auth import authenticate
from django.contrib.auth.models import User
from django.shortcuts import get_object_or_404
from django.db import IntegrityError, transaction
from django.core.cache import cache
from django.db.models import Case, Count, IntegerField, Max, Prefetch, Q, Value, When
from django.utils import timezone
from zoneinfo import ZoneInfo
from django.utils.dateparse import parse_date
from drf_spectacular.utils import (
    OpenApiExample,
    extend_schema,
    extend_schema_view,
    inline_serializer,
)
from rest_framework import permissions, serializers, status, viewsets
from .auth_sessions import issue_session, revoke_all_sessions, revoke_session
from .ws_tickets import issue_ticket as issue_ws_ticket
from rest_framework.decorators import action
from rest_framework.exceptions import MethodNotAllowed, PermissionDenied
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from .email_validation import EmailValidationError
from .duty_status import current_duties, duty_fields, today_overtime_hours
from .presence import clear_last_seen, presence_fields, touch_last_seen
from .names import full_name, name_match_q, name_variants
from .face_match import (
    FaceModelError,
    FaceVerificationOutcome,
    MAX_FACE_ATTEMPTS,
    verify_face_against_id,
)
from .n8n_client import (
    N8nError,
    N8nInvalidResponse,
    N8nNoFaceVerdict,
    call_workflow,
    call_workflow_multipart,
    configured_workflows,
    as_data_uri,
    error_response_body,
    strip_data_uri,
)
# face_match and prc_ocr each define their own InvalidImageError. They are
# distinct classes, so the portrait check's version is aliased rather than
# assumed to be the same one prc_ocr raises.
from .id_photo_check import InvalidImageError as PortraitImageError, check_id_has_portrait
from .id_field_validation import validate_prc_id_fields
from .prc_ocr import (
    InvalidImageError,
    PrcOcrError,
    parse_labelled_lines,
    scan_id_fields,
    scan_prc_license,
)
from .access import filter_nurse_fields
from .utils import parse_user_date
from .models import (
    AuthSession,
    ChartingNote,
    Department,
    Doctor,
    DutyAssignment,
    IdScanAttempt,
    EndorsementTask,
    FaceVerificationAttempt,
    HandoverNote,
    HandoverPatient,
    KardexDepartmentVisit,
    KardexLaboratory,
    KardexMedication,
    KardexRecord,
    MedicationIntake,
    Notification,
    NurseProfile,
    Patient,
    PatientAssignment,
    PatientDoctor,
    RegistrationSession,
    Task,
    TaskHandover,
    UserPreferences,
    VitalSigns,
    PatientVisit,
)
from .handover_tasks import adopt_handover_tasks
from .referral_shifts import SHIFT_LABELS, get_eligible_recipients
from . import login_throttle
from .chart_fallback import structure_from_assessment
from .vitals_extraction import extract_vitals_from_text
from .notifications import (
    notify,
    notify_handover_accepted,
    notify_handover_acknowledged,
    notify_handover_cancelled,
    notify_handover_completed,
    notify_handover_created,
    notify_handover_declined,
    notify_kardex_reviewed,
    notify_admin_new_registration,
    notify_duty_assigned,
    notify_nurse_reassigned,
    notify_referral_head_nurse_fyi,
    notify_safety_alert,
    notify_task_handover_accepted,
    notify_task_handover_rejected,
    notify_task_handover_verified,
    check_due_task_reminders,
    check_due_referral_reminders,
)
from .otp_service import OtpCooldownError, OtpDeliveryError, OtpResendLimitError, issue_otp, verify_otp
from .permissions import (
    IsApprovedActiveUser,
    CanManageReferral,
    IsAdmin,
    IsApprovedNurse,
    IsApprovedNurseOrAdmin,
    IsApprovedNurseOrAdminReadOnly,
    IsSupervisor,
    get_user_role,
)
from .schema_examples import (
    ASSIGNMENT_CREATE_EXAMPLES,
    ASSIGNMENT_UPDATE_EXAMPLES,
    CHANGE_PASSWORD_EXAMPLES,
    CHARTING_CREATE_EXAMPLES,
    CHARTING_UPDATE_EXAMPLES,
    FACE_STATUS_EXAMPLES,
    FACE_VERIFY_EXAMPLES,
    HANDOVER_CREATE_EXAMPLES,
    HANDOVER_UPDATE_EXAMPLES,
    KARDEX_CREATE_EXAMPLES,
    NOTIFICATION_CREATE_EXAMPLES,
    NOTIFICATION_UPDATE_EXAMPLES,
    PATIENT_CREATE_EXAMPLES,
    PATIENT_UPDATE_EXAMPLES,
    RESEND_OTP_EXAMPLES,
    SEND_OTP_EXAMPLES,
    SIGNUP_EXAMPLES,
    STRUCTURE_CHART_EXAMPLES,
    TASK_CREATE_EXAMPLES,
    TASK_UPDATE_EXAMPLES,
    UPDATE_ME_EXAMPLES,
    VERIFY_ID_EXAMPLES,
    VERIFY_OTP_EXAMPLES,
    VERIFY_PRC_EXAMPLES,
)
from .serializers import (
    ChangePasswordSerializer,
    CorrectionRequestSerializer,
    EmailChangeConfirmSerializer,
    EmailChangeStartSerializer,
    ChartingNoteSerializer,
    DepartmentSerializer,
    DischargePlanInputSerializer,
    DoctorSerializer,
    DutyAssignmentSerializer,
    FaceVerificationAttemptSerializer,
    find_name_collision,
    RegistrationSessionSerializer,
    StructureChartSerializer,
    StructureChartResponseSerializer,
    VerifyIdSerializer,
    VerifyIdResponseSerializer,
    VerifyPrcSerializer,
    VerifyPrcResponseSerializer,
    FaceVerificationSerializer,
    FaceVerificationStatusSerializer,
    HandoverSerializer,
    KardexDepartmentVisitSerializer,
    KardexLaboratorySerializer,
    KardexMedicationSerializer,
    KardexRecordSerializer,
    MedicationIntakeSerializer,
    LoginSerializer,
    NotificationSerializer,
    NurseAssignmentSerializer,
    PatientAssignmentSerializer,
    PatientSerializer,
    PatientVisitSerializer,
    RegistrationEmailSerializer,
    ResendOtpSerializer,
    SendOtpSerializer,
    SignupSerializer,
    SignupV2CheckNameSerializer,
    SignupV2RegisterSerializer,
    SignupV2ResendOtpSerializer,
    SignupV2SendOtpSerializer,
    SignupV2StartSerializer,
    SignupV2VerifyOtpSerializer,
    TaskHandoverSerializer,
    TaskSerializer,
    VitalSignsSerializer,
    UpdateMeSerializer,
    UserPreferencesSerializer,
    UserSerializer,
    DISCHARGE_PLAN_FIELD_MAP,
    discharge_plan_has_content,
    medical_team_snapshot,
    nurse_display_name,
    open_patient_visit,
    VerifyOtpSerializer,
)


logger = logging.getLogger(__name__)


AuthResponseSerializer = inline_serializer(
    name='AuthResponse',
    fields={
        'token': serializers.CharField(),
        'user': UserSerializer(),
    },
)

OAuthTokenResponseSerializer = inline_serializer(
    name='OAuthTokenResponse',
    fields={
        'access_token': serializers.CharField(),
        'token_type': serializers.CharField(),
        'token': serializers.CharField(help_text='Same value as access_token (app compatibility).'),
        'user': UserSerializer(),
    },
)


def _login_blocked_response(seconds: int, *, oauth: bool) -> Response:
    """
    429 for a throttled login. Identical whether or not the account exists:
    it is decided before any user lookup, and says nothing about the account.
    """
    minutes = max(1, -(-seconds // 60))
    message = (
        f'Too many sign-in attempts. Please wait {minutes} minute'
        f'{"" if minutes == 1 else "s"} and try again.'
    )
    body = (
        {'error': 'too_many_requests', 'error_description': message}
        if oauth else {'detail': message}
    )
    return Response(
        body,
        status=status.HTTP_429_TOO_MANY_REQUESTS,
        headers={'Retry-After': str(max(1, seconds))},
    )


def _authenticate_credentials(email: str, password: str):
    """Resolve user from email/username + password."""
    user = authenticate(username=email, password=password)
    if user is None:
        try:
            matched = User.objects.get(email__iexact=email)
            user = authenticate(username=matched.username, password=password)
        except User.DoesNotExist:
            user = None
    return user


class SignupView(APIView):
    permission_classes = [permissions.AllowAny]
    # Anonymous by design (registration/login). A stale token from a blocked
    # account must not be able to refuse these, so no authentication runs here.
    authentication_classes = []

    @extend_schema(
        request=SignupSerializer,
        responses={201: AuthResponseSerializer},
        tags=['Auth'],
        summary='Sign up',
        description=(
            'Editable request body. `registrationSessionId` must come from a session that '
            'has already cleared face or OTP verification.'
        ),
        auth=None,
        examples=SIGNUP_EXAMPLES,
    )
    def post(self, request):
        serializer = SignupSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        # Outside the transaction SignupSerializer.create() already
        # committed in — this fans out to every admin and can email/push,
        # neither of which belongs inside a DB write's lock.
        notify_admin_new_registration(user)
        # No token: a pending applicant cannot use the app until an admin
        # approves the registration, so none is issued here.
        return Response(
            {
                'detail': 'Application received. It is waiting for administrator approval.',
                'approvalStatus': 'pending',
                'user': UserSerializer(user).data,
            },
            status=status.HTTP_201_CREATED,
        )


class SignupV2CheckNameView(APIView):
    """
    Step 1's "Next" button calls this before advancing to Step 2, so a name
    collision is caught immediately instead of at the very end of the
    wizard. Deliberately read-only and side-effect-free (no session, no
    rate-limit concern beyond the default anonymous throttle) — just a
    yes/no check the applicant can retry freely while editing their name.
    """

    permission_classes = [permissions.AllowAny]
    authentication_classes = []

    def post(self, request):
        serializer = SignupV2CheckNameSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        collision = find_name_collision(data['firstName'], data['middleName'], data['lastName'])
        if collision:
            return Response(
                {
                    'available': False,
                    'message': 'An account with this name already exists. Contact an administrator.',
                }
            )
        return Response({'available': True})


class SignupV2StartView(APIView):
    """
    Step 3 "Send OTP" kickoff for the new 4-step signup wizard. Creates a
    bare RegistrationSession (email only — no PRC/face steps) so the
    existing OTP-issuing service (otp_service.issue_otp) has somewhere to
    attach the code. The frontend calls this first, then immediately calls
    the signup-v2 send-otp endpoint below with the returned session id.
    """

    permission_classes = [permissions.AllowAny]
    # Anonymous by design (registration). See SignupView above.
    authentication_classes = []

    def post(self, request):
        serializer = SignupV2StartSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        session = serializer.save()
        return Response(
            {'registrationSessionId': str(session.session_id), 'email': session.email},
            status=status.HTTP_201_CREATED,
        )


class SignupV2RegisterView(APIView):
    """Final step ("Create Account") of the new 4-step signup wizard."""

    permission_classes = [permissions.AllowAny]
    authentication_classes = []

    def post(self, request):
        serializer = SignupV2RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            user = serializer.save()
        except IntegrityError:
            # The serializer's own uniqueness check (validate_personalEmail)
            # already rejects a known-duplicate email, but two submissions of
            # the exact same email at the exact same instant can both pass
            # that check before either has committed a row — the second
            # create_user() then hits the database's real unique constraint
            # on username/email instead. Surface that race the same way as
            # the ordinary validation error, not as a raw 500.
            raise serializers.ValidationError(
                {'personalEmail': ['A user with this email already exists.']}
            )
        # Same fan-out as the old SignupView — the admin approval queue is
        # generic (keys off NurseProfile.approval_status), so this new
        # pending account needs no separate admin-side handling.
        notify_admin_new_registration(user)
        # No token: a pending applicant cannot use the app until an admin
        # approves the registration, so none is issued here.
        return Response(
            {
                'success': True,
                'message': "Registration submitted! Your account is pending admin approval. You'll be able to log in once approved.",
            },
            status=status.HTTP_201_CREATED,
        )


def _face_session_status(session: RegistrationSession) -> str:
    if session.face_verified or session.otp_verified:
        return 'success'
    if session.face_locked:
        return 'max_attempts_reached'
    if session.face_attempts > 0:
        return 'failed'
    return 'idle'


#: Failed face comparisons allowed per PRC licence across every session and
#: every "Retry Face Verification" reset: the first set of MAX_FACE_ATTEMPTS
#: plus MAX_FACE_VERIFICATION_RETRY_CYCLES more sets. Without a lifetime cap
#: the 3-strike lockout could be cleared forever, by the reset flag or by
#: simply starting a new session.
FACE_LIFETIME_ATTEMPT_BUDGET = MAX_FACE_ATTEMPTS * (
    1 + max(0, getattr(settings, 'MAX_FACE_VERIFICATION_RETRY_CYCLES', 1))
)

FACE_BUDGET_SPENT_MESSAGE = (
    'Face verification is no longer available for this registration after too many '
    'failed attempts. Please verify using Email OTP.'
)


def _lifetime_failed_face_attempts(session: RegistrationSession) -> int:
    """Failed comparisons logged for this session, its PRC licence, or its email."""
    scope = Q(session=session)
    if session.id_registration_no:
        scope |= Q(session__id_registration_no=session.id_registration_no)
    if session.email:
        scope |= Q(session__email__iexact=session.email)
    return FaceVerificationAttempt.objects.filter(scope, countable=True, matched=False).count()


def _face_retry_available(session: RegistrationSession) -> bool:
    return _lifetime_failed_face_attempts(session) < FACE_LIFETIME_ATTEMPT_BUDGET


def _face_rate_limited(ip: str, email: str) -> bool:
    """Outer per-IP and per-applicant-email limits on the face endpoint."""
    checks = [(f'face:ip:{ip}', settings.FACE_RATE_LIMIT_PER_IP_PER_HOUR)]
    if email:
        checks.append((f'face:email:{email}', settings.FACE_RATE_LIMIT_PER_EMAIL_PER_HOUR))
    for key, limit in checks:
        cache.add(key, 0, 3600)
        if cache.incr(key) > limit:
            return True
    return False


def _lockout_minutes(count: int) -> int:
    minutes = settings.FACE_LOCKOUT_MINUTES
    return minutes[min(count, len(minutes)) - 1]


def _start_lockout(session: RegistrationSession) -> None:
    session.face_lock_count += 1
    session.face_locked = True
    if _face_retry_available(session):
        session.face_locked_until = timezone.now() + timedelta(minutes=_lockout_minutes(session.face_lock_count))
    else:
        # Lifetime budget spent: no retry will ever come, so no end time.
        session.face_locked_until = None
    logger.warning(
        'Face lockout started: session=%s count=%s until=%s',
        session.session_id, session.face_lock_count, session.face_locked_until.isoformat() if session.face_locked_until else 'no end (budget spent)',
    )


def _expire_lock_if_due(session: RegistrationSession) -> None:
    """A timed lockout ends by itself. A permanent (budget-spent) one has no end time."""
    if session.face_locked and session.face_locked_until and timezone.now() >= session.face_locked_until:
        session.face_locked = False
        session.face_locked_until = None
        session.face_attempts = 0
        session.save(update_fields=['face_locked', 'face_locked_until', 'face_attempts', 'updated_at'])
        logger.info('Face lockout ended on its own: session=%s', session.session_id)


def _active_lock_for_email(email: str):
    """Any still-active lockout for this applicant email. A new session must not get past it."""
    now = timezone.now()
    return (
        RegistrationSession.objects.filter(email__iexact=email, face_locked=True)
        .filter(Q(face_locked_until__gt=now) | Q(face_locked_until__isnull=True))
        .order_by('-updated_at')
        .first()
    )


def _locked_response(session: RegistrationSession, message: str) -> Response:
    retry_after = 0
    if session.face_locked_until:
        retry_after = max(0, int((session.face_locked_until - timezone.now()).total_seconds()))
    response = Response(
        _face_session_payload(
            session, matched=False, confidence=0, reason=None, message=message,
            retryAfterSeconds=retry_after,
        ),
        status=423,
    )
    if retry_after:
        response['Retry-After'] = str(retry_after)
    return response


def _face_session_payload(session: RegistrationSession, **extra):
    attempts_used = min(MAX_FACE_ATTEMPTS, session.face_attempts)
    status_value = _face_session_status(session)
    payload = {
        'registrationSessionId': str(session.session_id),
        'attemptsUsed': attempts_used,
        'attemptsRemaining': max(0, MAX_FACE_ATTEMPTS - attempts_used),
        'maxAttempts': MAX_FACE_ATTEMPTS,
        'locked': session.face_locked,
        'faceVerified': session.face_verified,
        'otpVerified': session.otp_verified,
        'verificationMethod': session.verification_method or None,
        'status': status_value,
        # Explicit contract aliases for attempt/fallback gating.
        'failed_attempts': attempts_used,
        'max_attempts': MAX_FACE_ATTEMPTS,
        'verification_status': status_value,
        'registeredEmail': session.email or None,
        # False once the lifetime budget is spent: the app should hide
        # "Retry Face Verification" and offer Email OTP only.
        'retryAvailable': _face_retry_available(session),
    }
    payload.update(extra)
    return payload


#: Keys any one of which means the workflow actually rendered a decision.
_FACE_VERDICT_KEYS = ('matched', 'match', 'verified')

#: What went wrong, in words a nurse can act on. A face check can fail for
#: very different reasons and the fix differs each time — "try again" is
#: useless if the real problem is that the ID has no photo on it. Keyed by
#: the reason codes in FaceVerificationAttempt.REASON_CHOICES.
FACE_FAILURE_MESSAGES = {
    'MISMATCH': (
        'Face not matched with your Hospital ID. The face we captured does not match the '
        'photo on the ID you uploaded in Step 1. Make sure you are using your own Hospital '
        'ID and that the ID photo is clear and uncovered.'
    ),
    'NO_FACE': (
        'No face detected. Centre your face in the frame, remove anything covering it, '
        'and make sure the lighting is even.'
    ),
    'MULTIPLE_FACES': (
        'More than one face is visible. Make sure only you are in the frame and try again.'
    ),
    'BLURRY': (
        'The photo is too blurry to verify. Hold the phone steady, move somewhere brighter, '
        'and retake it.'
    ),
    'ID_NO_FACE': (
        'No photo found on your Hospital ID. Re-upload the ID in Step 1 with the portrait '
        'clearly visible and not cropped off.'
    ),
    'ID_MULTIPLE_FACES': (
        'More than one face was found on the Hospital ID. Re-upload a photo of just the ID '
        'card, with nothing else in the frame.'
    ),
    'ID_BLURRY': (
        'The Hospital ID photo is too blurry to compare against. Re-upload it in Step 1, '
        'square-on and in good light.'
    ),
    'ID_NOT_IMAGE': (
        'Your Hospital ID was uploaded as a PDF, which cannot be used for face matching. '
        'Re-upload it as a JPG or PNG photo in Step 1.'
    ),
    'INVALID_IMAGE': (
        'The captured photo could not be read. Please retake it.'
    ),
    'ID_INVALID_IMAGE': (
        'The Hospital ID image could not be read. Re-upload it in Step 1.'
    ),
}

#: Used when the check completed and simply did not match. A verdict of
#: "no match" with no reason attached IS a mismatch, so say so plainly
#: rather than falling back to a vague retry prompt.
DEFAULT_FACE_FAILURE_REASON = 'MISMATCH'


def _face_failure_message(result, session) -> str:
    """
    Explain a failed face check, and say how many tries are left.

    Attempts remaining matters here: a nurse who does not know they are on
    their last try cannot make an informed choice between retrying and
    switching to the Email OTP fallback.
    """
    reason = (result.reason or DEFAULT_FACE_FAILURE_REASON).upper()
    message = result.message or FACE_FAILURE_MESSAGES.get(
        reason, FACE_FAILURE_MESSAGES[DEFAULT_FACE_FAILURE_REASON]
    )

    if result.countable and not session.face_locked:
        remaining = max(0, MAX_FACE_ATTEMPTS - session.face_attempts)
        if remaining == 1:
            message = f'{message} 1 attempt remaining before Email OTP is offered.'
        elif remaining > 1:
            message = f'{message} {remaining} attempts remaining.'

    return message


#: Same idea as FACE_FAILURE_MESSAGES, worded for the PRC card instead of the
#: Hospital ID. PRC-photo matching has no attempt cap (see VerifyPrcLicenseView),
#: so — unlike _face_failure_message — there is no "attempts remaining" suffix.
PRC_FACE_FAILURE_MESSAGES = {
    'MISMATCH': (
        'This selfie does not match the photo on your PRC license. Make sure you are scanning '
        'your own PRC card and that its photo is clear and uncovered, then try again.'
    ),
    'NO_FACE': (
        'No face detected in your selfie. Centre your face in the frame, remove anything '
        'covering it, and make sure the lighting is even.'
    ),
    'MULTIPLE_FACES': (
        'More than one face is visible in your selfie. Make sure only you are in the frame and try again.'
    ),
    'BLURRY': (
        'Your selfie is too blurry to verify. Hold the phone steady, move somewhere brighter, '
        'and retake it.'
    ),
    'PRC_NO_FACE': (
        'No photo was found on your PRC license. Retake the photo with the card photo clearly '
        'visible and not glared over.'
    ),
    'PRC_MULTIPLE_FACES': (
        'More than one face was found on the PRC card photo. Photograph only the card, with '
        'nothing else in the frame.'
    ),
    'PRC_BLURRY': (
        'The PRC card photo is too blurry to compare against. Retake it square-on and in good light.'
    ),
    'PRC_NOT_IMAGE': (
        'Your PRC license was uploaded as a PDF, which cannot be used for face matching. '
        'Re-upload it as a JPG or PNG photo.'
    ),
    'INVALID_IMAGE': 'The captured selfie could not be read. Please retake it.',
    'PRC_INVALID_IMAGE': 'The PRC card image could not be read. Please re-upload it.',
}

DEFAULT_PRC_FACE_FAILURE_REASON = 'MISMATCH'


def _prc_failure_message(result) -> str:
    """Explain a failed PRC-photo face check. No attempt-count messaging — see PRC_FACE_FAILURE_MESSAGES."""
    reason = (result.reason or DEFAULT_PRC_FACE_FAILURE_REASON).upper()
    return result.message or PRC_FACE_FAILURE_MESSAGES.get(
        reason, PRC_FACE_FAILURE_MESSAGES[DEFAULT_PRC_FACE_FAILURE_REASON]
    )


def _has_face_verdict(data) -> bool:
    """True only when the workflow returned an explicit match decision."""
    return isinstance(data, dict) and any(key in data for key in _FACE_VERDICT_KEYS)


def _record_face_outcome(session, *, matched: bool, confidence: float, n8n_status: str = ''):
    """
    Stamp the face result onto this session's most recent ID scan.

    FaceVerificationAttempt already logs every face try in detail; this makes
    the ID-scan row a single place to read the *overall* outcome of one
    registration, which is what "was this person verified?" actually asks.
    """
    attempt = IdScanAttempt.objects.filter(session=session).order_by('-created_at').first()
    if attempt is None:
        return
    attempt.face_verified = matched
    attempt.face_confidence = confidence
    if n8n_status:
        attempt.n8n_status = n8n_status
    try:
        attempt.save(update_fields=['face_verified', 'face_confidence', 'n8n_status'])
    except Exception:  # noqa: BLE001 - logging must never break verification
        logger.exception('Could not stamp face outcome onto IdScanAttempt')


def _face_outcome_from_n8n(data) -> FaceVerificationOutcome:
    """
    Map the n8n face-verify response onto the same outcome the local matcher
    returns, so everything downstream — attempt counting, lockout, audit rows —
    is identical whichever engine ran.

    Field names are read loosely because the workflow author may reasonably
    emit `matched`, `match` or `verified`, and score on either a 0-1 or a
    0-100 scale.
    """
    if not isinstance(data, dict):
        data = {}

    matched = bool(data.get('matched', data.get('match', data.get('verified', False))))

    try:
        confidence = float(data.get('confidence', data.get('score', 0)) or 0)
    except (TypeError, ValueError):
        confidence = 0.0
    # A 0-1 similarity is normalised to the 0-100 the app displays. An exact
    # 1.0 is ambiguous; treat it as 100% since that is what it means either way.
    if 0 < confidence <= 1:
        confidence *= 100

    reason = (data.get('reason') or data.get('errorCode') or '').strip().upper()
    # A completed "no match" with no reason given is a mismatch — record it as
    # one so the audit trail distinguishes it from an image-quality failure.
    if not reason and not matched:
        reason = DEFAULT_FACE_FAILURE_REASON
    message = data.get('message') or data.get('detail') or None

    # A workflow that could not complete validation (bad image, no model)
    # should say so, so it does not burn one of the three attempts.
    countable = bool(data.get('countable', True)) and not matched

    return FaceVerificationOutcome(
        matched=matched,
        confidence=confidence,
        reason=reason or None,
        message=message,
        countable=countable,
    )


def _run_face_match(
    selfie_data: str,
    id_data: str,
    *,
    session=None,
    id_label: str = 'Hospital ID photo',
    reason_prefix: str = 'ID_',
) -> FaceVerificationOutcome:
    """
    Run one face comparison through the configured engine.

    Default is the n8n face-verify workflow. Setting N8N_FACE_VERIFY_ENABLED
    to False uses the bundled OpenCV SFace matcher instead — the two return
    the same shape, so only the decision moves.

    ``id_label``/``reason_prefix`` are forwarded to the local matcher so a
    caller comparing against a document other than the Hospital ID (e.g. a
    PRC licence) gets correctly-worded messages and reason codes.
    """
    if not settings.N8N_FACE_VERIFY_ENABLED:
        return verify_face_against_id(selfie_data, id_data, id_label=id_label, reason_prefix=reason_prefix)

    # Bare base64: AWS Rekognition CompareFaces rejects a data-URI prefix in
    # Image.Bytes, so strip it here rather than in the workflow.
    # -rai: identity-verify is a single combined webhook — `action` is what
    # routes this call to the face-match branch instead of extract_id.
    payload = {
        'action': 'verify_face',
        'image': strip_data_uri(selfie_data),
        'idImage': strip_data_uri(id_data),
        'registrationSessionId': str(session.session_id) if session else '',
        'registeredEmail': session.email if session else '',
        'attemptsUsed': session.face_attempts if session else 0,
        'maxAttempts': MAX_FACE_ATTEMPTS,
        # Best-effort hint — only takes effect if the n8n workflow's
        # Rekognition node is wired to read it. See settings.py.
        'similarityThreshold': settings.FACE_SIMILARITY_THRESHOLD,
        # 'verify_id' and 'face_verify' share one n8n webhook
        # (identity-verify) — must match the Route Action node's expected
        # value exactly, or neither branch fires.
        'action': 'verify_face',
    }

    try:
        result = call_workflow('face_verify', payload)
        # A webhook node left on "Respond: Immediately" answers 200 with an
        # empty body. Read literally that is "no match", which would fail the
        # check *and* consume one of three attempts — locking a nurse out over
        # a workflow misconfiguration. Absence of a verdict is not a verdict.
        if not _has_face_verdict(result):
            raise N8nNoFaceVerdict(workflow='face_verify', payload=result)
        return _face_outcome_from_n8n(result)
    except N8nError as exc:
        if settings.N8N_FACE_VERIFY_FALLBACK_LOCAL:
            logger.warning(
                'n8n face-verify unavailable (%s); falling back to local matcher.', exc
            )
            return verify_face_against_id(selfie_data, id_data, id_label=id_label, reason_prefix=reason_prefix)
        raise


class FaceVerificationStatusView(APIView):
    """Return the server-side face/OTP verification state for session resume."""

    permission_classes = [permissions.AllowAny]
    # Anonymous by design (registration/login). A stale token from a blocked
    # account must not be able to refuse these, so no authentication runs here.
    authentication_classes = []
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'face_verification'

    @extend_schema(
        request=FaceVerificationStatusSerializer,
        tags=['Auth'],
        summary='Get face verification session status (attempt count, lock, OTP)',
        description='Editable request body. Send either `registrationSessionId` or `registeredEmail`.',
        auth=None,
        examples=FACE_STATUS_EXAMPLES,
    )
    def post(self, request):
        serializer = FaceVerificationStatusSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        session = None
        if data.get('registrationSessionId'):
            session = RegistrationSession.objects.filter(session_id=data['registrationSessionId']).first()
        if session is None and data.get('registeredEmail'):
            session = (
                RegistrationSession.objects.filter(
                    email=data['registeredEmail'].lower(),
                    user__isnull=True,
                )
                .order_by('-updated_at')
                .first()
            )

        if session is None:
            return Response(
                {
                    'success': False,
                    'message': 'Registration session not found.',
                    'attemptsUsed': 0,
                    'attemptsRemaining': MAX_FACE_ATTEMPTS,
                    'maxAttempts': MAX_FACE_ATTEMPTS,
                    'locked': False,
                    'faceVerified': False,
                    'otpVerified': False,
                    'status': 'idle',
                },
                status=status.HTTP_404_NOT_FOUND,
            )

        return Response(_face_session_payload(session, success=True))


def _alnum_upper(value):
    return re.sub(r'[^A-Z0-9]', '', (value or '').upper())


def _card_fields_not_matching_scan(session, cleaned, reg_date, valid_until):
    """Client names of card-issued fields (licence, dates) that differ from the scanned card."""
    mismatched = []
    if _alnum_upper(cleaned.get('registration_no')) != _alnum_upper(session.id_registration_no):
        mismatched.append('registrationNumber')
    if reg_date != session.id_registration_date:
        mismatched.append('registrationDate')
    if valid_until != session.id_valid_until:
        mismatched.append('validUntil')
    return mismatched


class RegistrationEmailView(APIView):
    """
    Persists the registered email collected on Step 2 (ID Review) to
    RegistrationSession.email — the single source SendRegistrationOtpView and
    VerifyRegistrationOtpView read from. Without this call session.email
    never gets set for a normal PRC-ID signup (OCR has no email field to
    extract), so the OTP fallback would have nothing to send to.
    """

    permission_classes = [permissions.AllowAny]
    # Anonymous by design (registration/login). A stale token from a blocked
    # account must not be able to refuse these, so no authentication runs here.
    authentication_classes = []
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'registration_otp_send'

    @extend_schema(
        request=RegistrationEmailSerializer,
        tags=['Auth'],
        summary='Save the registered email for a registration session (Step 2)',
        auth=None,
    )
    def post(self, request):
        serializer = RegistrationEmailSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        session = RegistrationSession.objects.filter(session_id=data['registrationSessionId']).first()
        if session is None:
            return Response(
                {'success': False, 'message': 'Registration session not found. Please restart verification.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        new_email = data['email'].lower().strip()
        cleaned = data.get('cleanedIdFields')

        # Once face or OTP verification has passed, the identity it proved is
        # fixed: changing the email or ID fields now would detach the account
        # from what was verified. Re-sending identical values (the app going
        # back and forward through Step 2) is still accepted.
        # Dates the applicant typed: a malformed or impossible one is a 400, not a 500.
        cleaned_reg_date = cleaned_valid_until = None
        if cleaned:
            cleaned_reg_date = parse_user_date(cleaned.get('registration_date'), 'registration_date')
            cleaned_valid_until = parse_user_date(cleaned.get('valid_until'), 'valid_until')

        if session.is_verified:
            unchanged = new_email == (session.email or '').lower() and (
                not cleaned
                or (
                    cleaned['last_name'] == session.id_last_name
                    and cleaned['first_name'] == session.id_first_name
                    and cleaned['middle_name'] == session.id_middle_name
                    and cleaned['registration_no'] == session.id_registration_no
                    and cleaned_reg_date == session.id_registration_date
                    and cleaned_valid_until == session.id_valid_until
                )
            )
            if not unchanged:
                return Response(
                    {
                        'success': False,
                        'message': (
                            'Your identity is already verified, so the email and ID details can no '
                            'longer be changed. Restart registration to use different details.'
                        ),
                    },
                    status=status.HTTP_409_CONFLICT,
                )
            return Response({'success': True, 'registrationSessionId': str(session.session_id)})

        session.email = new_email
        updated = ['email', 'updated_at']

        # The applicant may correct the NAMES (OCR misreads them). The licence
        # number and the two dates come from the card itself: they must match
        # what was scanned exactly. Allowing those to be typed would let someone
        # attach another person's licence to their own card and face.
        if cleaned:
            card_fields = _card_fields_not_matching_scan(session, cleaned, cleaned_reg_date, cleaned_valid_until)
            if card_fields:
                return Response(
                    {
                        'success': False,
                        'code': 'card_field_not_editable',
                        'fields': card_fields,
                        'message': (
                            'The PRC licence number and dates come from your card and cannot be edited. '
                            'Rescan the card if they are wrong.'
                        ),
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )
            session.id_last_name = cleaned['last_name']
            session.id_first_name = cleaned['first_name']
            session.id_middle_name = cleaned['middle_name']
            updated += ['id_last_name', 'id_first_name', 'id_middle_name']
            logger.info(
                'Registration session %s: name fields corrected by the applicant.',
                session.session_id,
            )

        session.save(update_fields=updated)
        return Response({'success': True, 'registrationSessionId': str(session.session_id)})


class FaceVerificationView(APIView):
    """
    Real endpoint backing Step 3 of registration. Attempt counting and the
    3-strike lockout are enforced server-side against RegistrationSession —
    the frontend's local counter is just a mirror for instant UI feedback.

    Two request shapes:
      - {registrationSessionId, image, idImage}: run detection + recognition
        (face_match.verify_face_against_id) comparing the selfie to the
        Hospital ID photo.
      - {registrationSessionId, reset: true}: called when the user picks
        "Retry Face Verification" after lockout — zeroes the attempt counter
        and clears the lock.

    A completed validation failure (no face, multiple faces, blurry, mismatch,
    etc.) consumes one attempt. Camera permission / UI / model-unavailable
    errors that never finish validation do not. Every call is logged to
    FaceVerificationAttempt; no raw image or embedding is persisted.
    """

    permission_classes = [permissions.AllowAny]
    # Anonymous by design (registration/login). A stale token from a blocked
    # account must not be able to refuse these, so no authentication runs here.
    authentication_classes = []
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'face_verification'

    @extend_schema(
        request=FaceVerificationSerializer,
        tags=['Auth'],
        summary='Verify a live selfie against the Hospital ID photo (3-attempt face check)',
        description=(
            'Editable request body. Send `image` + `idImage` as base64 to run the check, '
            'or `reset: true` to clear a lockout.'
        ),
        auth=None,
        examples=FACE_VERIFY_EXAMPLES,
    )
    def post(self, request):
        serializer = FaceVerificationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        session_id = data.get('registrationSessionId')
        session = None
        if session_id:
            session = RegistrationSession.objects.filter(session_id=session_id).first()

        limit_email = (data.get('registeredEmail') or (session.email if session else '') or '').lower()
        if _face_rate_limited(login_throttle.client_ip(request), limit_email):
            response = Response(
                {'success': False, 'code': 'too_many_requests',
                 'message': 'Too many face verification attempts. Try again later.'},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )
            response['Retry-After'] = '3600'
            return response

        if data.get('reset'):
            # Never honoured: an anonymous caller must not be able to clear
            # their own lockout. Logged so attempts to use it stay visible.
            logger.warning(
                'Face reset flag refused: session=%s ip=%s',
                session_id, login_throttle.client_ip(request),
            )
            return Response(
                {
                    'success': False,
                    'code': 'reset_not_allowed',
                    'message': 'A face verification lockout cannot be cleared from here. '
                               'Wait for it to end, or verify with Email OTP.',
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        if session is None:
            # First scan of a client cycle: resume only an unlockable in-progress
            # session. Never silently re-attach a previously locked session — that
            # would jump the user straight to "3 attempts failed" without scanning.
            registered_email = data['registeredEmail'].lower()
            session = (
                RegistrationSession.objects.filter(
                    email=registered_email,
                    user__isnull=True,
                    face_verified=False,
                    otp_verified=False,
                    face_locked=False,
                )
                .order_by('-updated_at')
                .first()
            )
            if session is None:
                blocking = _active_lock_for_email(registered_email)
                if blocking is not None:
                    return _locked_response(
                        blocking,
                        message=(
                            "You've reached the maximum number of face verification attempts. "
                            'Wait for the lockout to end, or verify with Email OTP.'
                            if _face_retry_available(blocking) else FACE_BUDGET_SPENT_MESSAGE
                        ),
                    )
                # No resumable session — but this email may already have
                # completed Step 1 under a prior (e.g. locked) session, and
                # is only starting a fresh attempt cycle for face matching,
                # not re-scanning their ID. Carry that verification forward
                # rather than forcing an unnecessary re-scan.
                prior = (
                    RegistrationSession.objects.filter(email=registered_email, user__isnull=True)
                    .order_by('-updated_at')
                    .first()
                )
                session = RegistrationSession.objects.create(
                    email=registered_email,
                    id_verification_status=prior.id_verification_status if prior else '',
                    id_last_name=prior.id_last_name if prior else '',
                    id_first_name=prior.id_first_name if prior else '',
                    id_middle_name=prior.id_middle_name if prior else '',
                    id_registration_no=prior.id_registration_no if prior else '',
                    id_registration_date=prior.id_registration_date if prior else None,
                    id_valid_until=prior.id_valid_until if prior else None,
                    id_portrait=prior.id_portrait if prior else '',
                )

        # Face verification compares the selfie against the Step-1 ID photo
        # — that comparison is meaningless (and open to abuse) if Step 1's
        # own strict field validation never actually passed. Doesn't count
        # as an attempt: this is a precondition failure, not a completed check.
        if session.id_verification_status != 'verified':
            return Response(
                {
                    'success': False,
                    'status': 'id_not_verified',
                    'message': 'Please complete ID verification before face verification.',
                    'registrationSessionId': str(session.session_id),
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        if session.face_verified:
            return Response(
                _face_session_payload(
                    session,
                    matched=True,
                    confidence=100.0,
                    reason=None,
                )
            )

        if not session.id_portrait:
            # Nothing scanned to match against (session predates the stored card,
            # or the card was never scanned). Refuse rather than fall back to a client image.
            return Response(
                {
                    'success': False,
                    'code': 'id_scan_required',
                    'message': 'Scan your PRC card again before face verification.',
                    'registrationSessionId': str(session.session_id),
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        _expire_lock_if_due(session)
        if not session.face_locked and session.email:
            blocking = _active_lock_for_email(session.email)
            if blocking is not None:
                return _locked_response(
                    blocking,
                    message=(
                        "You've reached the maximum number of face verification attempts. "
                        'Wait for the lockout to end, or verify with Email OTP.'
                        if _face_retry_available(blocking) else FACE_BUDGET_SPENT_MESSAGE
                    ),
                )
        if session.face_locked:
            return _locked_response(
                session,
                message=("You've reached the maximum number of face verification attempts. "
                         'Wait for the lockout to end, or verify with Email OTP.'),
            )

        if not _face_retry_available(session):
            session.face_locked = True
            session.save(update_fields=['face_locked', 'updated_at'])
            return Response(
                _face_session_payload(
                    session, matched=False, confidence=0, reason=None,
                    message=FACE_BUDGET_SPENT_MESSAGE,
                ),
                status=status.HTTP_403_FORBIDDEN,
            )

        try:
            # Match against the card scanned for THIS session, never a client-sent
            # image: a client-chosen photo would let anyone pass with their own face.
            result = _run_face_match(data['image'], session.id_portrait, session=session)
        except N8nError as exc:
            # The workflow never rendered a verdict, so this is not a completed
            # validation attempt and must not consume one of the three tries.
            return Response(
                {
                    **error_response_body(exc),
                    'message': exc.default_detail,
                    'countable': False,
                    **_face_session_payload(session, matched=False, confidence=0),
                },
                status=exc.http_status,
            )
        except FaceModelError as exc:
            # Model/service failure is not a completed validation attempt.
            logger.error('Face verification model unavailable: %s', exc)
            return Response(
                {
                    'success': False,
                    'message': exc.default_detail,
                    'countable': False,
                    **_face_session_payload(session, matched=False, confidence=0),
                },
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        # Re-read the session under a row lock so parallel requests cannot
        # double-consume attempts from one logical scan.
        with transaction.atomic():
            session = RegistrationSession.objects.select_for_update().get(pk=session.pk)
            if session.face_verified:
                return Response(
                    _face_session_payload(session, matched=True, confidence=100.0, reason=None)
                )
            if session.face_locked:
                return _locked_response(
                    session,
                    message=("You've reached the maximum number of face verification attempts. "
                             'Wait for the lockout to end, or verify with Email OTP.'),
                )

            FaceVerificationAttempt.objects.create(
                session=session,
                matched=result.matched,
                confidence=result.confidence,
                reason=result.reason or '',
                countable=result.countable and not result.matched,
            )

            # One completed comparison = one attempt, whatever the verdict.
            # Previously a match reset the counter to zero and a mismatch was
            # the only thing that incremented it, so the number a nurse saw
            # jumped around: scan a matching face and "3 attempts remaining"
            # came back even though three photos had been taken. A technical
            # failure (workflow down, model unavailable) still does not count,
            # because no comparison actually happened.
            comparison_completed = result.matched or result.countable
            if comparison_completed:
                session.face_attempts = min(MAX_FACE_ATTEMPTS, session.face_attempts + 1)

            if result.matched:
                session.face_verified = True
                # Never lock an identity that has just been proven.
                session.face_locked = False
                session.verification_method = 'FACE'
                session.save(
                    update_fields=[
                        'face_verified',
                        'face_attempts',
                        'face_locked',
                        'verification_method',
                        'updated_at',
                    ]
                )
                _record_face_outcome(
                    session, matched=True, confidence=result.confidence,
                    n8n_status='success' if settings.N8N_FACE_VERIFY_ENABLED else 'skipped',
                )
                return Response(
                    _face_session_payload(
                        session,
                        matched=True,
                        confidence=result.confidence,
                        reason=None,
                        message='Face Verified Successfully',
                    )
                )

            # The counter was already advanced above; this only decides lockout.
            if comparison_completed:
                if session.face_attempts >= MAX_FACE_ATTEMPTS and not session.face_locked:
                    _start_lockout(session)
                session.save(update_fields=['face_attempts', 'face_locked', 'face_locked_until',
                                            'face_lock_count', 'updated_at'])

            _record_face_outcome(session, matched=False, confidence=result.confidence)
            message = _face_failure_message(result, session)
            if session.face_locked:
                message = (
                    "You've reached the maximum number of face verification attempts. "
                    'Choose Retry Face Verification or Verify Using Email OTP.'
                    if _face_retry_available(session) else FACE_BUDGET_SPENT_MESSAGE
                )

            return Response(
                _face_session_payload(
                    session,
                    matched=False,
                    confidence=result.confidence,
                    locked=session.face_locked,
                    reason=result.reason or DEFAULT_FACE_FAILURE_REASON,
                    message=message,
                    countable=result.countable,
                )
            )

#: Fields a registration cannot proceed without, mirrored from prc_ocr so the
#: view and the OCR layer agree on what "complete" means.
def _has_any_id_field(result) -> bool:
    """True when an OCR response carried at least one identity field."""
    if not isinstance(result, dict):
        return False
    pool = {**result, **(result['data'] if isinstance(result.get('data'), dict) else {})}
    keys = (
        'lastName', 'last_name', 'firstName', 'first_name', 'fullName', 'full_name',
        'registrationNumber', 'registration_number', 'registration_no', 'licenseNumber',
    )
    return any(str(pool.get(k) or '').strip() for k in keys)


PRC_REQUIRED_FIELDS = ('lastName', 'firstName', 'registrationNumber', 'validUntil')

#: A rescan of the same licence within this window counts as a duplicate
#: rather than a fresh attempt — usually a double-tap or a retry after a
#: network blip, and worth flagging so the log is not misread as two people.
DUPLICATE_SCAN_WINDOW = timedelta(minutes=10)


def _new_id_scan_attempt(session, document_type):
    """Open a log row for this scan before anything can fail."""
    previous = IdScanAttempt.objects.filter(session=session).count()
    return IdScanAttempt(
        session=session,
        attempt_number=previous + 1,
        document_type=document_type or 'hospital_id',
    )


def _find_duplicate_scan(session, registration_number):
    """The most recent successful scan of the same licence, if any."""
    if not registration_number:
        return None
    return (
        IdScanAttempt.objects.filter(
            registration_number=registration_number,
            created_at__gte=timezone.now() - DUPLICATE_SCAN_WINDOW,
        )
        .exclude(session=session)
        .order_by('-created_at')
        .first()
    )


def _finish_id_scan_attempt(
    attempt, report, portrait=None, *, status_value='error',
    failure_reason='', message='', duplicate=None,
):
    """
    Persist the attempt. Called on every path, including the failures —
    a log that only records successes cannot show which IDs the OCR struggles
    with, which is the main thing this table exists to answer.
    """
    report = report or {}
    attempt.status = status_value
    attempt.ocr_ran = bool(report)
    attempt.last_name = (report.get('lastName') or '')[:100]
    attempt.first_name = (report.get('firstName') or '')[:100]
    attempt.middle_name = (report.get('middleName') or '')[:100]
    attempt.registration_number = (report.get('registrationNumber') or '')[:50]
    attempt.registration_date = (report.get('registrationDate') or '')[:30]
    attempt.valid_until = (report.get('validUntil') or '')[:30]
    attempt.overall_confidence = float(report.get('overallConfidence') or 0.0)
    attempt.needs_review = report.get('needsReview') or []
    attempt.missing_required = report.get('missingRequired') or []
    if portrait is not None:
        attempt.portrait_present = portrait.has_photo
    attempt.failure_reason = failure_reason[:60]
    attempt.message = message
    attempt.duplicate_of = duplicate
    attempt.n8n_action = 'extract_id'
    try:
        attempt.save()
    except Exception:  # noqa: BLE001 - logging must never break the request
        logger.exception('Could not save IdScanAttempt')
    return attempt


class VerifyIdView(APIView):
    """
    Persona steps 1 & 2 — read a Hospital ID photo through the n8n verify-id
    workflow and return the identity fields the signup wizard pre-fills.

    The workflow does the OCR; this view owns the registration session, so a
    first call without `registrationSessionId` creates one and returns it for
    the client to carry through the remaining steps. Nothing is written to a
    user account here — signup still has to complete.
    """

    permission_classes = [permissions.AllowAny]
    # Anonymous by design (registration/login). A stale token from a blocked
    # account must not be able to refuse these, so no authentication runs here.
    authentication_classes = []
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'face_verification'

    # Keys the workflow may use for each field we care about, best first.
    # lastName/firstName/middleName/registrationNumber/validUntil are what
    # Step 2 (ID Review) displays and auto-fills. employeeId/department/
    # position/hospitalName/email are kept for backward compatibility — email
    # in particular is still required internally (the Email OTP fallback
    # looks up a session by it) and position still feeds the Step 6 role
    # cross-check, so both stay wired even though Step 2 no longer shows them.
    _FIELD_ALIASES = {
        'fullName': ('fullName', 'full_name', 'name'),
        'lastName': ('lastName', 'last_name', 'surname'),
        'firstName': ('firstName', 'first_name', 'givenName', 'given_name'),
        'middleName': ('middleName', 'middle_name'),
        'registrationNumber': (
            'registrationNumber', 'registration_number', 'registrationNo', 'registration_no',
            'licenseNumber', 'license_number', 'regNo', 'reg_no',
        ),
        'registrationDate': (
            'registrationDate', 'registration_date', 'dateOfRegistration', 'date_of_registration',
            'dateIssued', 'date_issued', 'issueDate', 'issue_date',
        ),
        'validUntil': (
            'validUntil', 'valid_until', 'validThru', 'valid_thru',
            'expirationDate', 'expiration_date', 'expiryDate', 'expiry',
            'validityDate', 'validity_date',
        ),
    }

    #: employeeId, department, position, hospitalName and email were read here
    #: back when Step 1 scanned a hospital employee badge. A PRC licence card
    #: carries none of them, so anything OCR produced for those slots was text
    #: lifted from somewhere else on the card — a department that is really a
    #: line of the licence header is worse than an empty field, because it
    #: looks authoritative. Step 2 collects the email directly instead.


    # Multipart upload validation (the preferred path — see post()). The
    # legacy base64-in-JSON path (idImage) has no file to validate this way;
    # its bytes are checked implicitly when the portrait detector decodes it.
    _ALLOWED_IMAGE_TYPES = {'image/jpeg', 'image/png'}
    _MAX_IMAGE_BYTES = 5 * 1024 * 1024

    @staticmethod
    def _pick(data: dict, keys) -> str:
        for key in keys:
            value = data.get(key)
            if value:
                return str(value).strip()
        return ''

    @staticmethod
    def _is_date_or_number(value: str) -> bool:
        """Dates and document numbers must never be shown in a name field."""
        compact = value.strip()
        if not compact:
            return False
        return bool(
            re.fullmatch(r'\d{1,4}[./-]\d{1,2}[./-]\d{2,4}', compact)
            or re.fullmatch(r'\d{6,}', compact.replace(' ', '').replace('-', ''))
        )

    @classmethod
    def _is_credible_name(cls, value: str) -> bool:
        """Accept only human-name text, never OCR labels or dates."""
        compact = value.strip()
        if not compact or cls._is_date_or_number(compact):
            return False
        if re.search(
            r'\b(registration|licen[cs]e|valid(?:ity)?|expir(?:y|es)|date|number|no\.?|issued)\b',
            compact,
            flags=re.IGNORECASE,
        ):
            return False
        # A year or a numeric date fragment is evidence that OCR picked a
        # document date rather than a person's name.
        if re.search(r'\b(?:19|20)\d{2}\b|\d{1,2}[./-]\d{1,2}', compact):
            return False
        return bool(re.search(r'[A-Za-z]', compact)) and not bool(re.search(r'\d', compact))

    @classmethod
    def _clean_name_fields(cls, fields: dict) -> None:
        """Reject bad OCR field assignments, then derive labelled PRC-style names."""
        for key in ('lastName', 'firstName', 'middleName'):
            if not cls._is_credible_name(fields[key]):
                fields[key] = ''

        full_name = fields['fullName'].strip()
        if full_name and not cls._is_credible_name(full_name):
            fields['fullName'] = ''
            return
        if ',' not in full_name:
            return
        last, _, rest = full_name.partition(',')
        parts = [part for part in rest.strip().split() if cls._is_credible_name(part)]
        parsed_last = last.strip() if cls._is_credible_name(last) else ''
        if parsed_last:
            fields['lastName'] = parsed_last
        if parts:
            fields['firstName'] = parts[0]
            fields['middleName'] = ' '.join(parts[1:])

    @extend_schema(
        request=VerifyIdSerializer,
        responses={200: VerifyIdResponseSerializer},
        tags=['Auth'],
        summary='Verify a PRC ID (Persona steps 1 & 2, via n8n)',
        description=(
            'Multipart/form-data preferred: send the image as a file field named `prc_id`. '
            'A legacy JSON body with `idImage` as base64 is still accepted for backward '
            'compatibility. Posts to the n8n **identity-verify** workflow (`action: extract_id`) '
            'and returns the OCR’d identity fields.\n\n'
            'Returns 503 when the workflow is not listening — in n8n test mode press '
            '"Execute workflow" first, or activate the workflow and set `N8N_WEBHOOK_PREFIX=webhook`.'
        ),
        auth=None,
        examples=VERIFY_ID_EXAMPLES,
    )
    def post(self, request):
        logger.info('PRC ID verification request received')

        serializer = VerifyIdSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        uploaded_file = request.FILES.get('prc_id')
        legacy_base64 = data.get('idImage') or ''

        if not uploaded_file and not legacy_base64:
            logger.info('PRC ID verification rejected: no image supplied')
            return Response(
                {'success': False, 'message': 'PRC ID image is required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if uploaded_file:
            logger.info(
                'PRC ID uploaded: name=%s type=%s size=%s',
                uploaded_file.name, uploaded_file.content_type, uploaded_file.size,
            )
            if uploaded_file.size == 0:
                return Response(
                    {'success': False, 'message': 'PRC ID image is required.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if uploaded_file.content_type not in self._ALLOWED_IMAGE_TYPES:
                return Response(
                    {'success': False, 'message': 'Unsupported file format. Please upload a JPG or PNG photo.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if uploaded_file.size > self._MAX_IMAGE_BYTES:
                return Response(
                    {'success': False, 'message': 'File too large. Maximum size is 5 MB.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        session = None
        if data.get('registrationSessionId'):
            session = RegistrationSession.objects.filter(
                session_id=data['registrationSessionId']
            ).first()
        if session is None:
            session = RegistrationSession.objects.create()

        # Opened before anything can fail, so a rejection is logged too. A log
        # that only captures scans which got far enough to reach OCR would miss
        # exactly the failures worth investigating.
        early_attempt = _new_id_scan_attempt(session, data.get('documentType'))

        # The local portrait detector (check_id_has_portrait) only knows how
        # to read a base64/data-URI string — build one from the uploaded
        # file's bytes so that check stays unchanged either way, then rewind
        # the stream so the *same* file object can still be streamed to n8n
        # below without re-reading from disk/memory twice.
        if uploaded_file:
            raw_bytes = uploaded_file.read()
            uploaded_file.seek(0)
            id_image_data_uri = f'data:{uploaded_file.content_type};base64,' + base64.b64encode(raw_bytes).decode()
        else:
            id_image_data_uri = legacy_base64

        # Portrait check first. An ID whose photo has been erased or cropped
        # out is not a usable identity document, and the later face match
        # would have nothing to compare the selfie against. Rejecting here
        # also avoids spending an OCR call on a document that cannot pass.
        try:
            portrait = check_id_has_portrait(id_image_data_uri)
        except PortraitImageError as exc:
            _finish_id_scan_attempt(
                early_attempt, {}, None,
                status_value='rejected', failure_reason='INVALID_IMAGE', message=str(exc),
            )
            return Response(
                {
                    'success': False,
                    'verified': False,
                    'verificationStatus': 'invalid_id',
                    'hasPhoto': False,
                    'message': exc.default_detail,
                    'registrationSessionId': str(session.session_id),
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        except FaceModelError as exc:
            # Detector unavailable is a server fault, not a bad upload.
            logger.error('ID portrait detector unavailable: %s', exc)
            _finish_id_scan_attempt(
                early_attempt, {}, None,
                status_value='error', failure_reason='DETECTOR_UNAVAILABLE', message=str(exc),
            )
            return Response(
                {
                    'success': False,
                    'verified': False,
                    'verificationStatus': 'unavailable',
                    'message': exc.default_detail,
                    'registrationSessionId': str(session.session_id),
                },
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        if not portrait.has_photo:
            _finish_id_scan_attempt(
                early_attempt, {}, portrait,
                status_value='rejected', failure_reason='NO_PORTRAIT',
                message=portrait.message,
            )
            return Response(
                {
                    'success': True,
                    'verified': False,
                    'verificationStatus': 'invalid_id',
                    **portrait.as_dict(),
                    'attemptNumber': early_attempt.attempt_number,
                    'registrationSessionId': str(session.session_id),
                }
            )

        # 'verify_id' and 'face_verify' share one n8n webhook (identity-verify)
        # — 'action' must match the Route Action node's expected value
        # exactly, or neither branch fires.
        form_fields = {
            'documentType': data.get('documentType') or 'prc_license',
            'expectedRole': data.get('expectedRole') or '',
            'registrationSessionId': str(session.session_id),
            'action': 'extract_id',
        }

        logger.info('Sending PRC ID to n8n session=%s', session.session_id)

        try:
            if uploaded_file:
                # Real multipart upload — n8n/PaddleOCR receives actual image
                # bytes, not a base64 string in a JSON body.
                files = {'prc_id': (uploaded_file.name, uploaded_file.file, uploaded_file.content_type)}
                result = call_workflow_multipart('verify_id', files=files, data=form_fields)
            else:
                # Legacy path: base64 JSON body. Bare base64 — cloud OCR/
                # vision APIs reject the data-URI prefix.
                payload = {**form_fields, 'idImage': strip_data_uri(legacy_base64)}
                result = call_workflow('verify_id', payload)
        except N8nError as exc:
            if not settings.ID_OCR_LOCAL_FALLBACK:
                logger.warning('verify-id: n8n unavailable session=%s error=%s', session.session_id, exc)
                return Response(
                    {
                        **error_response_body(exc),
                        'verified': False,
                        'verificationStatus': 'unavailable',
                        'registrationSessionId': str(session.session_id),
                    },
                    status=exc.http_status,
                )
            # The local-fallback block below was only ever reached when n8n
            # answered 200 with nothing usable (its OCR node's third-party
            # service degrading gracefully) — not when the n8n call itself
            # fails outright (down, misconfigured, a workflow node erroring
            # with a non-2xx). That is the same "OCR provider is having a
            # bad day" outage in a different shape, so it gets the same
            # answer: keep going with an empty result and let Tesseract have
            # a shot at the card, instead of hard-failing registration on
            # n8n's uptime.
            logger.warning(
                'verify-id: n8n call failed, trying local OCR fallback session=%s error=%s',
                session.session_id, exc,
            )
            result = {}

        logger.info('OCR verification completed session=%s', session.session_id)

        if not isinstance(result, dict):
            result = {}

        # Local fallback. The workflow's OCR node depends on a third-party
        # service; when that returns 503 the workflow answers 200 with an
        # empty body, and every field arrives blank — indistinguishable to the
        # nurse from "your card is unreadable". Tesseract runs on this machine
        # and reads the same card, so a provider outage stops being a blocker.
        # n8n stays the primary reader: this only runs when it returned nothing.
        if not _has_any_id_field(result) and settings.ID_OCR_LOCAL_FALLBACK:
            local_source = legacy_base64
            if uploaded_file is not None:
                try:
                    uploaded_file.file.seek(0)
                    local_source = base64.b64encode(uploaded_file.file.read()).decode()
                except Exception:  # noqa: BLE001 - fallback must never mask the original failure
                    local_source = ''
            if local_source:
                try:
                    # scan_id_fields, not scan_prc_license: this stands in for
                    # what n8n would have returned, which is fields. The strict
                    # PRC document-type gate would reject a genuine card whose
                    # white-on-green "NURSE" bar simply did not OCR, and the
                    # validation below already decides what is acceptable.
                    scan = scan_id_fields(local_source)
                except (InvalidImageError, PrcOcrError) as exc:
                    logger.warning('local OCR fallback unavailable: %s', exc)
                else:
                    extracted = {
                        key: scan.get(key, '')
                        for key in (
                            'lastName', 'firstName', 'middleName',
                            'registrationNumber', 'registrationDate', 'validUntil',
                        )
                    }
                    if any(v for v in extracted.values()):
                        logger.info(
                            'local OCR fallback produced fields session=%s confidence=%s',
                            session.session_id, scan.get('overallConfidence'),
                        )
                        result = {**extracted, 'source': 'local-tesseract'}
                    else:
                        logger.info(
                            'local OCR fallback read nothing session=%s', session.session_id
                        )
        # Some workflows nest the extracted fields under a `data` key (e.g.
        # {"success": true, "data": {"last_name": ...}}) rather than
        # returning them at the top level — look in both places.
        nested = result.get('data')
        lookup = {**result, **nested} if isinstance(nested, dict) else result

        fields = {
            name: self._pick(lookup, aliases) for name, aliases in self._FIELD_ALIASES.items()
        }
        # n8n's own field assignment has been seen shifting every value by
        # one label on a stacked-layout card (lastName "12/27/2025",
        # firstName "06/29/2029", middleName "NURSE") while its rawText was
        # read perfectly. When the raw OCR text is present, read the labelled
        # values from it ourselves and let those win for every label found.
        raw_text = lookup.get('rawText') or lookup.get('raw_text') or ''
        raw_lines = lookup.get('lines')
        if not raw_text and isinstance(raw_lines, list):
            raw_text = '\n'.join(str(line) for line in raw_lines)
        if isinstance(raw_text, str) and raw_text.strip():
            from_text = parse_labelled_lines(raw_text)
            if from_text:
                fields.update(from_text)
                if any(k in from_text for k in ('lastName', 'firstName', 'middleName')):
                    fields['fullName'] = ''
        # A workflow returning discrete name parts but no combined fullName
        # (the shape a PRC-style OCR naturally gives) still needs one for
        # anything downstream that only reads fullName.
        if not fields['fullName']:
            fields['fullName'] = ' '.join(
                part for part in (fields['firstName'], fields['middleName'], fields['lastName']) if part
            ).strip()

        has_name = bool(
            fields['fullName'] or fields['lastName'] or fields['firstName']
        )
        has_any_prc_field = bool(
            fields['lastName'] or fields['firstName'] or fields['middleName']
            or fields['registrationNumber'] or fields['registrationDate'] or fields['validUntil']
        )
        # An explicit document-invalid signal from the workflow (its own PRC
        # marker check, e.g. "not a PRC nursing ID") is trusted outright —
        # there is nothing to structurally validate on a document that was
        # never a PRC ID in the first place.
        workflow_status = result.get('verificationStatus') or result.get('verification_status')

        validation_errors = None
        if workflow_status == 'invalid_id' or not has_any_prc_field:
            verification_status = 'invalid_id'
            verified = False
        else:
            # Never trust the workflow's own "verified" claim for field
            # correctness — a workflow that thinks a mis-parsed value like
            # "REGISTRATION DATE May 21" is a last name would otherwise let
            # that reach the database untouched. This is the sole authority
            # for verified vs validation_error, independent of what the
            # workflow itself asserts.
            validation = validate_prc_id_fields(
                last_name=fields['lastName'] or None,
                first_name=fields['firstName'] or None,
                middle_name=fields['middleName'] or None,
                registration_no=fields['registrationNumber'] or None,
                registration_date=fields['registrationDate'] or None,
                valid_until=fields['validUntil'] or None,
            )
            if validation.valid:
                verification_status = 'verified'
                verified = True
                # Overwrite with the cleaned, normalized values (trimmed
                # names, ISO dates) — these are what get returned and stored.
                fields['lastName'] = validation.cleaned['last_name']
                fields['firstName'] = validation.cleaned['first_name']
                fields['middleName'] = validation.cleaned['middle_name']
                fields['registrationNumber'] = validation.cleaned['registration_no']
                fields['registrationDate'] = validation.cleaned['registration_date']
                fields['validUntil'] = validation.cleaned['valid_until']
            else:
                verification_status = 'validation_error'
                verified = False
                validation_errors = validation.errors
                # Without this, a validation_error is undiagnosable from the
                # logs alone — the response only ever says "Invalid name
                # value detected." with no way to tell whether the OCR read
                # was garbled or the validator is being overly strict on a
                # genuine name. Field values only, at INFO: this is a PRC ID
                # a nurse is actively registering with, not arbitrary PII
                # incidentally collected.
                logger.info(
                    'verify-id: rejected fields session=%s failed=%s lastName=%r firstName=%r '
                    'middleName=%r fullName=%r registrationNumber=%r registrationDate=%r validUntil=%r',
                    session.session_id, sorted(validation_errors.keys()),
                    fields['lastName'], fields['firstName'], fields['middleName'], fields['fullName'],
                    fields['registrationNumber'], fields['registrationDate'], fields['validUntil'],
                )
                # If a field we need came back empty, the question is always
                # "did n8n never send it, or send it under a key we don't
                # alias?" — logging every top-level key the workflow actually
                # returned answers that outright instead of guessing at
                # aliases one at a time.
                logger.info(
                    'verify-id: raw n8n keys session=%s keys=%s', session.session_id, sorted(lookup.keys()),
                )

        logger.info(
            'verify-id: OCR validation result session=%s status=%s', session.session_id, verification_status
        )

        # The email is no longer read off the card — a PRC licence does not
        # carry one. Step 2 (RegistrationEmailView) is where the nurse types it,
        # and that is what the OTP fallback reads.

        # Only ever store what just passed strict validation — an
        # in-progress/failed scan leaves the session's id_* fields untouched
        # rather than overwritten with something worse.
        if verified:
            session.id_last_name = fields['lastName']
            session.id_first_name = fields['firstName']
            session.id_middle_name = fields['middleName']
            session.id_registration_no = fields['registrationNumber']
            session.id_registration_date = date.fromisoformat(fields['registrationDate'])
            session.id_valid_until = date.fromisoformat(fields['validUntil'])
            session.id_verification_status = verification_status
            # Keep the card the face check will be matched against. Only the
            # server-side copy is used later — see FaceVerificationView.
            session.id_portrait = id_image_data_uri
            session.save(
                update_fields=[
                    'id_last_name', 'id_first_name', 'id_middle_name', 'id_registration_no',
                    'id_registration_date', 'id_valid_until', 'id_verification_status', 'id_portrait',
                    'updated_at',
                ]
            )

        default_message = {
            'verified': '',
            'validation_error': 'PRC ID information could not be reliably extracted.',
            'invalid_id': 'Could not read the ID clearly. Please retake the photo.',
        }.get(verification_status, '')

        response_body = {
            'success': verified,
            'verified': verified,
            'verificationStatus': verification_status,
            # Mirrors of the same two values under the literal names from
            # the spec this endpoint follows, for callers that read those.
            'status': verification_status,
            **fields,
            'hasPhoto': True,
            'faceCount': portrait.face_count,
            'roleMatch': result.get('roleMatch'),
            'confidence': result.get('confidence', portrait.confidence),
            'message': result.get('message') or default_message,
            'registrationSessionId': str(session.session_id),
        }
        if validation_errors:
            response_body['errors'] = validation_errors

        return Response(response_body)


class VerifyPrcLicenseView(APIView):
    """
    Scan a PRC nursing licence and return the fields the wizard pre-fills.

    Document-type gate first: the card must show both "REPUBLIC OF THE
    PHILIPPINES" and "PROFESSIONAL REGULATION COMMISSION", and the
    profession must read NURSE. A PRC card for another profession, or any
    other ID, is rejected before parsing — so nothing from an unverified
    document can reach the registration form.

    OCR is local (Tesseract), not an n8n workflow. It is deterministic,
    needs no network round trip, and the licence check should not fail just
    because a workflow is paused.

    When `registrationSessionId` + `selfie` are both sent and the session was
    identity-verified via Face Verification, this also compares the selfie to
    the licence photo (reusing the same face_verify pipeline as Step 3) and
    only marks the session `prc_verified` on a match. A session verified via
    Email OTP has no selfie to compare against and is accepted on OCR alone,
    consistent with OTP already being the accepted fallback when biometrics
    are unavailable. `prc_verified` is what SignupView requires before
    account creation — see SignupSerializer.validate_registrationSessionId.
    """

    permission_classes = [permissions.AllowAny]
    # Anonymous by design (registration/login). A stale token from a blocked
    # account must not be able to refuse these, so no authentication runs here.
    authentication_classes = []
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'face_verification'

    @extend_schema(
        request=VerifyPrcSerializer,
        responses={200: VerifyPrcResponseSerializer},
        tags=['Auth'],
        summary='Scan a PRC nursing licence (Tesseract OCR) and optionally match it to a selfie',
        description=(
            'Editable request body. Runs Tesseract over the uploaded licence photo.\n\n'
            '**Rejects anything that is not a PRC nursing licence** with '
            '`valid: false` and every field blank — a 200 with `valid: false` is a '
            'rejected document, not a server error.\n\n'
            'When the session verified identity via Face Verification, send `selfie` too — '
            'the response then includes `faceMatch` and the session is only marked '
            '`prc_verified` once the selfie matches the licence photo.\n\n'
            'Returns 400 for an unreadable upload and 503 when Tesseract is not '
            'installed on the server.'
        ),
        auth=None,
        examples=VERIFY_PRC_EXAMPLES,
    )
    def post(self, request):
        serializer = VerifyPrcSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        try:
            result = scan_prc_license(data['image'])
        except InvalidImageError as exc:
            return Response(
                {'valid': False, 'message': exc.default_detail},
                status=status.HTTP_400_BAD_REQUEST,
            )
        except PrcOcrError as exc:
            # Server-side capability problem — do not report it as a bad upload.
            logger.error('PRC OCR unavailable: %s', exc)
            return Response(
                {'valid': False, 'message': exc.default_detail},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        payload = result.as_dict()

        if not result.is_valid:
            return Response(payload)

        session_id = data.get('registrationSessionId')
        session = RegistrationSession.objects.filter(session_id=session_id).first() if session_id else None

        if session is None:
            # Anonymous scan (no session yet) — OCR result only, nothing to persist.
            return Response(payload)

        payload['registrationSessionId'] = str(session.session_id)
        selfie = data.get('selfie')

        if session.verification_method == 'FACE':
            if not selfie:
                # Stale client that hasn't been updated to resend the Step-3
                # selfie. Report OCR truthfully but withhold prc_verified —
                # do not silently accept an unverified face match.
                payload['faceMatch'] = {
                    'matched': False,
                    'confidence': 0,
                    'message': 'A selfie is required to confirm this license belongs to you.',
                }
                return Response(payload)

            try:
                face_result = _run_face_match(
                    selfie, data['image'], session=session, id_label='PRC ID photo', reason_prefix='PRC_'
                )
            except (N8nError, FaceModelError) as exc:
                # The OCR half genuinely succeeded — an infrastructure problem
                # on the face-match side should not fail the whole request,
                # just withhold prc_verified so the nurse can retry.
                logger.warning('PRC face-match unavailable: %s', exc)
                payload['faceMatch'] = {
                    'matched': False,
                    'confidence': 0,
                    'message': exc.default_detail,
                }
                return Response(payload)

            # PRC-photo matching has no attempt cap (re-scanning the card
            # already has none today) — logged for audit, never countable.
            FaceVerificationAttempt.objects.create(
                session=session,
                matched=face_result.matched,
                confidence=face_result.confidence,
                reason=face_result.reason or '',
                countable=False,
            )
            payload['faceMatch'] = {
                'matched': face_result.matched,
                'confidence': face_result.confidence,
                'message': None if face_result.matched else _prc_failure_message(face_result),
            }
            if not face_result.matched:
                return Response(payload)

        # Reached when OCR passed and either: the session verified via Email
        # OTP (no selfie to compare — accepted as-is, matching the existing
        # OTP-fallback philosophy), or via Face with a selfie that just matched.
        session.prc_verified = True
        session.prc_license_number = result.registration_number
        session.prc_full_name = result.full_name
        session.prc_expiry = result.valid_until
        session.prc_profession = result.profession
        session.save(
            update_fields=[
                'prc_verified',
                'prc_license_number',
                'prc_full_name',
                'prc_expiry',
                'prc_profession',
                'updated_at',
            ]
        )

        return Response(payload)


class SendRegistrationOtpView(APIView):
    permission_classes = [permissions.AllowAny]
    # Anonymous by design (registration/login). A stale token from a blocked
    # account must not be able to refuse these, so no authentication runs here.
    authentication_classes = []
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'registration_otp_send'

    @extend_schema(
        request=SendOtpSerializer,
        tags=['Auth'],
        summary='Send a registration OTP (used after 3 failed face attempts)',
        description='Editable request body. Requires EMAIL_* settings in the backend `.env` to deliver.',
        auth=None,
        examples=SEND_OTP_EXAMPLES,
    )
    def post(self, request):
        serializer = SendOtpSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        session = serializer.validated_data['registrationSessionId']

        # The OTP destination is always session.email — the backend/database
        # record — never any email the client might submit (validated above,
        # but never used as the destination). If the registration genuinely
        # has no email on file, say so plainly rather than trying to send.
        if not session.email:
            return Response(
                {
                    'success': False,
                    'status': 'email_not_registered',
                    'message': 'No registered email address is associated with this registration.',
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            issue_otp(session)
        except EmailValidationError as exc:
            return Response({'success': False, 'message': exc.default_detail}, status=status.HTTP_400_BAD_REQUEST)
        except OtpCooldownError as exc:
            return Response(
                {
                    'success': False,
                    'message': f'Please wait {exc.retry_after}s before requesting another code.',
                    'retryAfter': exc.retry_after,
                },
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )
        except OtpDeliveryError as exc:
            return Response({'success': False, 'message': exc.default_detail}, status=status.HTTP_502_BAD_GATEWAY)

        return Response(
            {
                'success': True,
                'status': 'otp_sent',
                'message': 'A verification code has been sent to your registered email address.',
                'expiresIn': 300,
                'resendCooldown': 60,
                'registrationSessionId': str(session.session_id),
            }
        )


class ResendRegistrationOtpView(APIView):
    permission_classes = [permissions.AllowAny]
    # Anonymous by design (registration/login). A stale token from a blocked
    # account must not be able to refuse these, so no authentication runs here.
    authentication_classes = []
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'registration_otp_send'

    @extend_schema(
        request=ResendOtpSerializer,
        tags=['Auth'],
        summary='Resend a registration OTP (invalidates the previous code)',
        description='Editable request body. Subject to a 60-second cooldown and a resend limit.',
        auth=None,
        examples=RESEND_OTP_EXAMPLES,
    )
    def post(self, request):
        serializer = ResendOtpSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        session = serializer.validated_data['registrationSessionId']

        # Same rule as sending: always session.email, never a client-supplied
        # destination, and never allowed to redirect a resend elsewhere.
        if not session.email:
            return Response(
                {
                    'success': False,
                    'status': 'email_not_registered',
                    'message': 'No registered email address is associated with this registration.',
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            issue_otp(session, is_resend=True)
        except EmailValidationError as exc:
            return Response({'success': False, 'message': exc.default_detail}, status=status.HTTP_400_BAD_REQUEST)
        except OtpCooldownError as exc:
            return Response(
                {
                    'success': False,
                    'message': f'Please wait {exc.retry_after}s before requesting another code.',
                    'retryAfter': exc.retry_after,
                },
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )
        except OtpResendLimitError as exc:
            return Response(
                {'success': False, 'message': exc.default_detail}, status=status.HTTP_429_TOO_MANY_REQUESTS
            )
        except OtpDeliveryError as exc:
            return Response({'success': False, 'message': exc.default_detail}, status=status.HTTP_502_BAD_GATEWAY)

        return Response(
            {
                'success': True,
                'status': 'otp_sent',
                'message': 'A new verification code has been sent to your registered email address.',
                'expiresIn': 300,
                'resendCooldown': 60,
                'registrationSessionId': str(session.session_id),
            }
        )


class VerifyRegistrationOtpView(APIView):
    permission_classes = [permissions.AllowAny]
    # Anonymous by design (registration/login). A stale token from a blocked
    # account must not be able to refuse these, so no authentication runs here.
    authentication_classes = []
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'registration_otp_verify'

    @extend_schema(
        request=VerifyOtpSerializer,
        tags=['Auth'],
        summary='Verify a registration OTP code',
        description='Editable request body. `otp` is exactly 6 digits and expires after 5 minutes.',
        auth=None,
        examples=VERIFY_OTP_EXAMPLES,
    )
    def post(self, request):
        serializer = VerifyOtpSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        session = serializer.validated_data['registrationSessionId']
        code = serializer.validated_data['otp']

        verified, message, error_code = verify_otp(session, code)

        if verified:
            return Response(
                {
                    'verified': True,
                    'success': True,
                    'status': 'email_verified',
                    'method': 'EMAIL_OTP',
                    'message': message,
                }
            )

        status_map = {
            'NOT_FOUND': status.HTTP_404_NOT_FOUND,
            'EXPIRED': status.HTTP_400_BAD_REQUEST,
            'MAX_ATTEMPTS': status.HTTP_429_TOO_MANY_REQUESTS,
            'INVALID': status.HTTP_400_BAD_REQUEST,
        }
        return Response(
            {'verified': False, 'success': False, 'message': message},
            status=status_map.get(error_code, status.HTTP_400_BAD_REQUEST),
        )


# ---------------------------------------------------------------------------
# Signup V2 OTP (send/verify/resend) — parallel to SendRegistrationOtpView /
# ResendRegistrationOtpView / VerifyRegistrationOtpView above, which all gate
# on session.face_locked (only true after three failed face attempts). The
# new 4-step wizard's RegistrationSession never attempts face verification,
# so it can never pass that gate — these views reuse the same otp_service
# functions with gating appropriate to a fresh, face-less session, without
# touching the existing OTP views/serializers (hard scope rule).
# ---------------------------------------------------------------------------


class SignupV2SendOtpView(APIView):
    permission_classes = [permissions.AllowAny]
    authentication_classes = []
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'registration_otp_send'

    def post(self, request):
        serializer = SignupV2SendOtpSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        session = serializer.validated_data['registrationSessionId']

        try:
            issue_otp(session)
        except EmailValidationError as exc:
            return Response({'success': False, 'message': exc.default_detail}, status=status.HTTP_400_BAD_REQUEST)
        except OtpCooldownError as exc:
            return Response(
                {
                    'success': False,
                    'message': f'Please wait {exc.retry_after}s before requesting another code.',
                    'retryAfter': exc.retry_after,
                },
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )
        except OtpDeliveryError as exc:
            return Response({'success': False, 'message': exc.default_detail}, status=status.HTTP_502_BAD_GATEWAY)

        return Response(
            {
                'success': True,
                'status': 'otp_sent',
                'message': 'A verification code has been sent to your email address.',
                'expiresIn': 300,
                'resendCooldown': 60,
                'registrationSessionId': str(session.session_id),
            }
        )


class SignupV2ResendOtpView(APIView):
    permission_classes = [permissions.AllowAny]
    authentication_classes = []
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'registration_otp_send'

    def post(self, request):
        serializer = SignupV2ResendOtpSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        session = serializer.validated_data['registrationSessionId']

        try:
            issue_otp(session, is_resend=True)
        except EmailValidationError as exc:
            return Response({'success': False, 'message': exc.default_detail}, status=status.HTTP_400_BAD_REQUEST)
        except OtpCooldownError as exc:
            return Response(
                {
                    'success': False,
                    'message': f'Please wait {exc.retry_after}s before requesting another code.',
                    'retryAfter': exc.retry_after,
                },
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )
        except OtpResendLimitError as exc:
            return Response(
                {'success': False, 'message': exc.default_detail}, status=status.HTTP_429_TOO_MANY_REQUESTS
            )
        except OtpDeliveryError as exc:
            return Response({'success': False, 'message': exc.default_detail}, status=status.HTTP_502_BAD_GATEWAY)

        return Response(
            {
                'success': True,
                'status': 'otp_sent',
                'message': 'A new verification code has been sent to your email address.',
                'expiresIn': 300,
                'resendCooldown': 60,
                'registrationSessionId': str(session.session_id),
            }
        )


class SignupV2VerifyOtpView(APIView):
    permission_classes = [permissions.AllowAny]
    authentication_classes = []
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'registration_otp_verify'

    def post(self, request):
        serializer = SignupV2VerifyOtpSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        session = serializer.validated_data['registrationSessionId']
        code = serializer.validated_data['otp']

        verified, message, error_code = verify_otp(session, code)

        if verified:
            return Response(
                {
                    'verified': True,
                    'success': True,
                    'status': 'email_verified',
                    'method': 'EMAIL_OTP',
                    'message': message,
                }
            )

        status_map = {
            'NOT_FOUND': status.HTTP_404_NOT_FOUND,
            'EXPIRED': status.HTTP_400_BAD_REQUEST,
            'MAX_ATTEMPTS': status.HTTP_429_TOO_MANY_REQUESTS,
            'INVALID': status.HTTP_400_BAD_REQUEST,
        }
        return Response(
            {'verified': False, 'success': False, 'message': message},
            status=status_map.get(error_code, status.HTTP_400_BAD_REQUEST),
        )


class LoginView(APIView):
    permission_classes = [permissions.AllowAny]
    # Anonymous by design (registration/login). A stale token from a blocked
    # account must not be able to refuse these, so no authentication runs here.
    authentication_classes = []

    @extend_schema(
        request=LoginSerializer,
        responses={200: AuthResponseSerializer},
        tags=['Auth'],
        summary='Log in',
        description=(
            'Editable request body: enter **email**, **password**, and optional **role**. '
            'Returns a `token` you can paste into Scalar **bearerAuth**, '
            'or use **passwordAuth** (recommended) which calls `/api/auth/token/` for you.'
        ),
        auth=None,
        examples=[
            OpenApiExample(
                'Nurse login',
                value={
                    'email': 'nurse@hospital.com',
                    'password': 'password123',
                    'role': 'staff_nurse',
                },
                request_only=True,
            ),
            OpenApiExample(
                'Head nurse login',
                value={
                    'email': 'headnurse@hospital.com',
                    'password': 'password123',
                    'role': 'head_nurse',
                },
                request_only=True,
            ),
        ],
    )
    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        email = serializer.validated_data['email'].lower()
        password = serializer.validated_data['password']
        requested_role = serializer.validated_data.get('role')

        # Brute-force gate, before the password is checked. Shared with
        # OAuthTokenView (same keys), so switching endpoints gains nothing.
        ip = login_throttle.client_ip(request)
        wait = login_throttle.blocked_for(email, ip)
        if wait:
            return _login_blocked_response(wait, oauth=False)

        user = _authenticate_credentials(email, password)

        if user is None:
            login_throttle.register_failure(email, ip)
            return Response(
                {'detail': 'Invalid email or password.'},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        # An admin account (User.is_staff, created without a NurseProfile —
        # see AdminUserViewSet/IsAdmin) has no profile here, so every check
        # below is skipped: an admin can log in with either the Nurse or
        # Head Nurse button selected, and always reaches the app regardless.
        profile = getattr(user, 'nurse_profile', None)
        if requested_role and profile and profile.role != requested_role:
            return Response(
                {
                    'detail': (
                        f'This account is registered as {profile.role.replace("_", " ")}, '
                        f'not {requested_role.replace("_", " ")}.'
                    )
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        # Identity verification at signup proves who this person is; it does
        # not prove an admin has actually approved the account. Checked here,
        # not just in permissions.IsApprovedNurse, so a pending/rejected nurse
        # gets a real explanation instead of a token that then fails on every
        # subsequent call.
        if profile and not profile.is_active_staff:
            return Response(
                {'detail': 'This account has been deactivated. Contact an administrator.', 'code': 'account_deactivated'},
                status=status.HTTP_403_FORBIDDEN,
            )
        if profile and profile.approval_status == 'pending':
            return Response(
                {
                    'detail': (
                        'Your account is pending admin approval. You will be able to sign '
                        'in once an administrator approves your registration.'
                    ),
                    'approvalStatus': 'pending',
                    'code': 'account_pending',
                },
                status=status.HTTP_403_FORBIDDEN,
            )
        if profile and profile.approval_status == 'rejected':
            return Response(
                {
                    'detail': (
                        profile.rejection_reason
                        or 'Your registration was rejected. Contact an administrator for details.'
                    ),
                    'approvalStatus': 'rejected',
                    'code': 'account_rejected',
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        login_throttle.register_success(email)
        token = issue_session(user)
        return Response({'token': token.key, 'user': UserSerializer(user).data})


class OAuthTokenView(APIView):
    """
    OAuth2 password-grant compatible endpoint for Scalar / OpenAPI clients.

    Accepts form or JSON:
      username (or email) + password
    Returns:
      { access_token, token_type: "Bearer", token, user }
    """

    permission_classes = [permissions.AllowAny]
    # Anonymous by design (registration/login). A stale token from a blocked
    # account must not be able to refuse these, so no authentication runs here.
    authentication_classes = []

    @extend_schema(
        request=inline_serializer(
            name='OAuthPasswordRequest',
            fields={
                'username': serializers.CharField(
                    required=False,
                    help_text='Your account email (Scalar password flow uses this field).',
                ),
                'email': serializers.EmailField(
                    required=False,
                    help_text='Alternative to username.',
                ),
                'password': serializers.CharField(
                    write_only=True,
                    style={'input_type': 'password'},
                ),
                'grant_type': serializers.CharField(
                    required=False,
                    default='password',
                    help_text='Optional. Use "password" for OAuth2 password grant.',
                ),
                'client_id': serializers.CharField(required=False, allow_blank=True),
                'client_secret': serializers.CharField(required=False, allow_blank=True),
                'scope': serializers.CharField(required=False, allow_blank=True),
                'role': serializers.ChoiceField(
                    choices=['staff_nurse', 'head_nurse'],
                    required=False,
                ),
            },
        ),
        responses={200: OAuthTokenResponseSerializer},
        tags=['Auth'],
        summary='Get access token (Scalar / OAuth password)',
        description=(
            'Use this from Scalar Authentication → passwordAuth. '
            'Enter your **email** in the Username field and your password. '
            'Scalar will store the token and send `Authorization: Bearer <token>` '
            'on protected endpoints.'
        ),
        auth=None,
        examples=[
            OpenApiExample(
                'Nurse credentials',
                value={
                    'username': 'nurse@hospital.com',
                    'password': 'password123',
                    'grant_type': 'password',
                },
                request_only=True,
            ),
            OpenApiExample(
                'Head nurse credentials',
                value={
                    'username': 'headnurse@hospital.com',
                    'password': 'password123',
                    'grant_type': 'password',
                },
                request_only=True,
            ),
        ],
    )
    def post(self, request):
        data = request.data
        email = (data.get('username') or data.get('email') or '').strip().lower()
        password = data.get('password') or ''
        requested_role = data.get('role')

        if not email or not password:
            return Response(
                {
                    'error': 'invalid_request',
                    'error_description': 'username (email) and password are required.',
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        ip = login_throttle.client_ip(request)
        wait = login_throttle.blocked_for(email, ip)
        if wait:
            return _login_blocked_response(wait, oauth=True)

        user = _authenticate_credentials(email, password)
        if user is None:
            login_throttle.register_failure(email, ip)
            return Response(
                {
                    'error': 'invalid_grant',
                    'error_description': 'Invalid email or password.',
                },
                status=status.HTTP_401_UNAUTHORIZED,
            )

        profile = getattr(user, 'nurse_profile', None)
        if requested_role and profile and profile.role != requested_role:
            return Response(
                {
                    'error': 'invalid_grant',
                    'error_description': (
                        f'This account is registered as {profile.role}, not {requested_role}.'
                    ),
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        # Same admin-approval gate as LoginView — this endpoint is a second
        # way to obtain a token (Scalar docs) and must not bypass it.
        if profile and not profile.is_active_staff:
            return Response(
                {'error': 'invalid_grant', 'error_description': 'This account has been deactivated.'},
                status=status.HTTP_403_FORBIDDEN,
            )
        if profile and profile.approval_status == 'pending':
            return Response(
                {'error': 'invalid_grant', 'error_description': 'Your account is pending admin approval.'},
                status=status.HTTP_403_FORBIDDEN,
            )
        if profile and profile.approval_status == 'rejected':
            return Response(
                {
                    'error': 'invalid_grant',
                    'error_description': profile.rejection_reason or 'Your registration was rejected.',
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        login_throttle.register_success(email)
        token = issue_session(user)
        return Response(
            {
                'access_token': token.key,
                'token_type': 'Bearer',
                'token': token.key,
                'user': UserSerializer(user).data,
            }
        )


class MeView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsApprovedActiveUser]

    @extend_schema(responses={200: UserSerializer}, tags=['Auth'], summary='Current user')
    def get(self, request):
        return Response(UserSerializer(request.user).data)

    @extend_schema(
        request=UpdateMeSerializer,
        responses={200: UserSerializer},
        tags=['Auth'],
        summary='Update current user',
        description='Editable request body. Partial update — send only the fields you want to change.',
        examples=UPDATE_ME_EXAMPLES,
    )
    def patch(self, request):
        serializer = UpdateMeSerializer(
            request.user, data=request.data, partial=True, context={'request': request}
        )
        serializer.is_valid(raise_exception=True)
        user = serializer.update(request.user, serializer.validated_data)
        return Response(UserSerializer(user).data)


class ChangePasswordView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsApprovedActiveUser]

    @extend_schema(
        request=ChangePasswordSerializer,
        responses={200: inline_serializer(name='PasswordChanged', fields={'detail': serializers.CharField()})},
        tags=['Auth'],
        summary='Change password',
        description=(
            'Editable request body. Succeeds with a new `token` — the previous one is revoked, '
            'so re-authorise Scalar afterwards.'
        ),
        examples=CHANGE_PASSWORD_EXAMPLES,
    )
    def post(self, request):
        serializer = ChangePasswordSerializer(data=request.data, context={'request': request})
        serializer.is_valid(raise_exception=True)
        serializer.save()
        revoke_all_sessions(request.user)
        token = issue_session(request.user)
        return Response({'detail': 'Password changed.', 'token': token.key})


class LogoutView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsApprovedActiveUser]

    @extend_schema(
        request=None,
        responses={
            200: inline_serializer(
                name='LogoutResponse',
                fields={'detail': serializers.CharField()},
            )
        },
        tags=['Auth'],
        summary='Log out',
    )
    def post(self, request):
        # Revokes only the session this request authenticated with — other
        # devices' sessions for the same account stay signed in.
        revoke_session(request.auth)
        # Only mark offline if that was this nurse's last open session —
        # another device still signed in means they're still "active".
        if not AuthSession.objects.filter(user=request.user).exists():
            clear_last_seen(request.user)
        return Response({'detail': 'Logged out.'})


class LogoutAllView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsApprovedActiveUser]

    @extend_schema(
        request=None,
        responses={
            200: inline_serializer(
                name='LogoutAllResponse',
                fields={'detail': serializers.CharField()},
            )
        },
        tags=['Auth'],
        summary='Log out of every device',
    )
    def post(self, request):
        revoke_all_sessions(request.user)
        clear_last_seen(request.user)
        return Response({'detail': 'Logged out of all devices.'})


class WsTicketView(APIView):
    """
    Exchange the caller's real session token for a one-time WebSocket ticket.

    Requires the same auth as any other endpoint (so only a client that
    already holds a working token can get one), but the ticket itself is
    short-lived and single-use — see api/ws_tickets.py — so it is safe to put
    in the socket URL, unlike the token itself.
    """

    permission_classes = [permissions.IsAuthenticated, IsApprovedActiveUser]

    @extend_schema(
        request=None,
        responses={
            200: inline_serializer(
                name='WsTicketResponse',
                fields={'ticket': serializers.CharField(), 'expiresInSeconds': serializers.IntegerField()},
            )
        },
        tags=['Auth'],
        summary='Get a one-time WebSocket connect ticket',
    )
    def post(self, request):
        ticket = issue_ws_ticket(request.user)
        return Response({'ticket': ticket, 'expiresInSeconds': settings.WS_TICKET_TTL_SECONDS})


@extend_schema_view(
    create=extend_schema(
        summary='Admit a patient',
        description='Editable request body. Head nurse only.',
        examples=PATIENT_CREATE_EXAMPLES,
    ),
    update=extend_schema(
        summary='Replace a patient record',
        description='Editable request body. Staff nurses may only edit patients assigned to them.',
        examples=PATIENT_UPDATE_EXAMPLES,
    ),
    partial_update=extend_schema(
        summary='Update part of a patient record',
        description='Editable request body. Send only the fields you want to change.',
        examples=PATIENT_UPDATE_EXAMPLES,
    ),
)
class PatientViewSet(viewsets.ModelViewSet):
    serializer_class = PatientSerializer
    permission_classes = [permissions.IsAuthenticated, IsApprovedNurseOrAdminReadOnly]
    lookup_field = 'patient_code'
    lookup_url_kwarg = 'patient_code'

    def get_queryset(self):
        # assignedBy reads the active PatientAssignment per row, and
        # assignedDoctors reads the active PatientDoctor rows — prefetch both,
        # otherwise a full ward list costs two extra queries per patient.
        qs = Patient.objects.select_related(
            'assigned_nurse', 'department', 'discharged_by'
        ).prefetch_related(
            Prefetch(
                'assignments',
                queryset=PatientAssignment.objects.filter(status='active')
                .select_related('assigned_by')
                .order_by('-assigned_at'),
                to_attr='active_assignments',
            ),
            Prefetch(
                'assigned_doctors',
                queryset=PatientDoctor.objects.filter(status='active')
                .select_related('doctor', 'doctor__department'),
                to_attr='active_doctor_assignments',
            ),
            # Laboratories/medication orders sections — same one-extra-query
            # reasoning as the two prefetches above, now that every patient
            # row also renders these.
            Prefetch(
                'laboratories',
                queryset=KardexLaboratory.objects.select_related('created_by', 'updated_by').ordered_for_display(),
                to_attr='prefetched_laboratories',
            ),
            Prefetch(
                'medication_orders',
                queryset=KardexMedication.objects.select_related('created_by', 'updated_by')
                .prefetch_related('intakes__administered_by'),
                to_attr='prefetched_medication_orders',
            ),
            Prefetch(
                'department_visits',
                queryset=KardexDepartmentVisit.objects.select_related(
                    'department', 'created_by', 'updated_by'
                ).ordered_for_display(),
                to_attr='prefetched_department_visits',
            ),
        ).all()
        mine = self.request.query_params.get('mine')
        search = self.request.query_params.get('search')
        risk = self.request.query_params.get('riskLevel')
        # The ward roster is shared: a patient added by one nurse is visible to
        # every nurse, because handover, charting and cover shifts all depend
        # on seeing patients you are not personally assigned to. Scoping is
        # now opt-in via ?mine=true, which is what the "My Patients" screen
        # sends — so that screen is unchanged while "All Patients" really does
        # mean all. Each row still carries assignedNurseName and assignedBy,
        # so it stays obvious whose patient it is and who assigned them.
        if mine in ('1', 'true', 'True'):
            qs = qs.filter(assigned_nurse=self.request.user)
        if risk:
            qs = qs.filter(risk_level=risk)
        if search:
            qs = qs.filter(
                Q(name__icontains=search)
                | Q(patient_code__icontains=search)
                | Q(room__icontains=search)
                | Q(diagnosis__icontains=search)
            )
        return qs

    def _current_duties(self):
        """
        Who is actually on shift right now, per the Duty Roster: one duty per
        department, plus one per nurse. Computed once per request (cached on
        the instance, since a ViewSet is instantiated fresh per request), so a
        ward list of any size costs one extra query instead of an N+1.

        A duty counts as current when the nurse has clocked in and not yet
        out, or when now falls inside its scheduled hours and the nurse
        hasn't clocked out (and it isn't cancelled or completed).
        """
        if hasattr(self, '_duty_cache'):
            return self._duty_cache
        local_now = timezone.now().astimezone(ZoneInfo(settings.DUTY_LOCAL_TIMEZONE))
        local_today = local_now.date()
        candidates = (
            DutyAssignment.objects.filter(duty_date__in=(local_today, local_today - timedelta(days=1)))
            .exclude(status__in=['cancelled', 'completed'])
            .select_related('nurse', 'nurse__nurse_profile')
            .order_by('duty_date', 'start_time')
        )
        by_department, by_nurse = {}, {}
        # Clocked-in shifts first, so they win over a merely scheduled one.
        for candidate in sorted(candidates, key=lambda d: d.actual_start_time is None):
            if candidate.actual_end_time is not None:
                continue  # already clocked out
            clocked_in = candidate.actual_start_time is not None
            in_window = candidate.scheduled_start_datetime() <= local_now <= candidate.scheduled_end_datetime()
            if not (clocked_in or in_window):
                continue
            by_department.setdefault(candidate.department_id, candidate)
            by_nurse.setdefault(candidate.nurse_id, candidate)
        self._duty_cache = (by_department, by_nurse)
        return self._duty_cache

    def get_serializer_context(self):
        context = super().get_serializer_context()
        by_department, by_nurse = self._current_duties()
        context['current_duty_by_department'] = by_department
        context['current_duty_by_nurse'] = by_nurse
        return context

    def get_permissions(self):
        # Head nurses: full CRUD. Staff nurses: can update/delete their own
        # assigned patients (see update()/destroy() below for that check).
        # Every branch must include IsApprovedNurse (or the admin-read-only
        # variant) — this method fully replaces the class-level
        # permission_classes, so a branch that forgot it would silently let
        # a pending nurse through.
        if self.action in ('create', 'discharge', 'readmit', 'notify_nurse'):
            return [permissions.IsAuthenticated(), IsApprovedNurse(), IsSupervisor()]
        # Admin gets list/retrieve here (SAFE_METHODS) for the Admin panel's
        # Patients oversight screen — never write, since discharge/create
        # above already lock write access to a head nurse.
        return [permissions.IsAuthenticated(), IsApprovedNurseOrAdminReadOnly()]

    @extend_schema(
        request=inline_serializer(
            name='DischargePatient',
            fields={'dischargePlan': DischargePlanInputSerializer(required=False)},
        ),
        responses={200: PatientSerializer},
        summary='Discharge a patient',
        description=(
            'Head-nurse-only. Optional body: {"dischargePlan": {medications, environment, '
            'treatment, healthTeaching, outpatientReferral, diet}} — the M.E.T.H.O.D. discharge '
            'plan. Required (all six fields non-blank) unless settings.DISCHARGE_PLAN_REQUIRED is '
            'False, in which case it is optional. Sets status to discharged, records the '
            'discharge timestamp and which head nurse performed it (audit trail), ends the '
            'patient’s active nurse assignment, and clears assignedNurseId — the patient no '
            'longer appears as anyone’s actively assigned patient. The record itself is never '
            'deleted: this admission’s PatientVisit is closed out with a snapshot of its final '
            'diagnosis/room/attending physician/assigned nurse/medical team and the discharge '
            'plan (see the visits action), not erased. Rejected with 400 if already discharged, '
            'or if the discharge plan is required and incomplete.'
        ),
    )
    @action(detail=True, methods=['post'])
    def discharge(self, request, patient_code=None):
        patient = self.get_object()
        if patient.status == 'discharged':
            return Response(
                {'detail': 'This patient has already been discharged.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        plan_input = request.data.get('dischargePlan') or {}
        plan_serializer = DischargePlanInputSerializer(data=plan_input)
        plan_serializer.is_valid(raise_exception=True)
        plan = plan_serializer.validated_data

        if getattr(settings, 'DISCHARGE_PLAN_REQUIRED', True):
            missing = [
                camel for camel in DISCHARGE_PLAN_FIELD_MAP if not (plan.get(camel) or '').strip()
            ]
            if missing:
                return Response(
                    {
                        'dischargePlan': (
                            'A complete M.E.T.H.O.D. discharge plan is required to discharge this '
                            f'patient. Missing: {", ".join(missing)}.'
                        )
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

        with transaction.atomic():
            # Captured before any field on `patient` is cleared below, so the
            # visit's archived snapshot reflects how the stay actually ended.
            nurse_name = nurse_display_name(patient.assigned_nurse)
            nurse = patient.assigned_nurse
            team_snapshot = medical_team_snapshot(patient)

            patient.status = 'discharged'
            patient.discharged_at = timezone.now()
            patient.discharged_by = request.user
            patient.assigned_nurse = None
            patient.save(
                update_fields=[
                    'status', 'discharged_at', 'discharged_by', 'assigned_nurse', 'updated_at',
                ]
            )
            PatientAssignment.objects.filter(patient=patient, status='active').update(status='completed')

            visit = patient.visits.filter(discharge_date__isnull=True).order_by('-admission_date').first()
            if visit is None:
                # Every patient gets an opening visit on create/readmit, so
                # this is only a safety net — the discharge itself must never
                # be lost over a missing history row.
                visit = PatientVisit(patient=patient, admission_date=patient.admission_date)
            visit.discharge_date = patient.discharged_at
            visit.diagnosis = patient.diagnosis
            visit.room = patient.room
            visit.attending_physician = patient.attending_physician
            visit.assigned_nurse = nurse
            visit.assigned_nurse_name = nurse_name
            visit.medical_team = team_snapshot
            visit.discharged_by = request.user
            for camel, attr in DISCHARGE_PLAN_FIELD_MAP.items():
                setattr(visit, attr, plan.get(camel) or '')
            visit.discharge_plan_ai_generated = bool(plan.get('aiGenerated'))
            visit.save()

        return Response(PatientSerializer(patient, context=self.get_serializer_context()).data)

    @extend_schema(
        request=inline_serializer(
            name='ReadmitPatient',
            fields={
                'admissionDate': serializers.DateField(required=False),
                'diagnosis': serializers.CharField(),
                'room': serializers.CharField(),
                'attendingPhysician': serializers.CharField(required=False, allow_blank=True),
                'departmentId': serializers.IntegerField(required=False, allow_null=True),
                'riskLevel': serializers.ChoiceField(choices=Patient.RISK_CHOICES, required=False),
            },
        ),
        responses={200: PatientSerializer},
        summary='Readmit a discharged patient under their existing profile',
        description=(
            'Head-nurse-only. For a returning patient — reuses the existing Patient row (same '
            'patient_code) instead of creating a duplicate: reactivates status to admitted, '
            'clears the discharge audit fields, applies the new admission’s diagnosis/room/etc., '
            'and opens a fresh PatientVisit. The previous stay’s visit record is untouched and '
            'stays available via the visits action — nothing about the prior admission is lost '
            'or overwritten. 400 if the patient is not currently discharged, or if diagnosis/'
            'room are missing.'
        ),
    )
    @action(detail=True, methods=['post'])
    def readmit(self, request, patient_code=None):
        patient = self.get_object()
        if patient.status != 'discharged':
            return Response(
                {'detail': 'Only a discharged patient can be readmitted. Use update for an active patient.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        diagnosis = (request.data.get('diagnosis') or '').strip()
        room = (request.data.get('room') or '').strip()
        if not diagnosis or not room:
            return Response(
                {'detail': 'diagnosis and room are required to readmit a patient.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        with transaction.atomic():
            patient.status = 'admitted'
            patient.discharged_at = None
            patient.discharged_by = None
            patient.admission_date = request.data.get('admissionDate') or timezone.localdate()
            patient.diagnosis = diagnosis
            patient.room = room
            if 'attendingPhysician' in request.data:
                patient.attending_physician = request.data.get('attendingPhysician') or ''
            if request.data.get('departmentId'):
                patient.department_id = request.data['departmentId']
            if request.data.get('riskLevel'):
                patient.risk_level = request.data['riskLevel']
            patient.save()
            open_patient_visit(patient)

        return Response(PatientSerializer(patient, context=self.get_serializer_context()).data)

    @extend_schema(
        responses={200: PatientVisitSerializer(many=True)},
        summary='A patient’s visit history — every admission, past and present',
        description=(
            'Newest first. Each entry is one admission-to-discharge encounter, including the '
            'vitals and progress notes recorded during that stay. The still-open visit (if the '
            'patient is currently admitted) reflects Patient’s live current fields; closed '
            'visits show the snapshot recorded at discharge.'
        ),
    )
    @action(detail=True, methods=['get'])
    def visits(self, request, patient_code=None):
        patient = self.get_object()
        visits = patient.visits.select_related('assigned_nurse', 'discharged_by').order_by(
            '-admission_date', '-created_at'
        )
        # One query each for the whole patient instead of one per visit —
        # PatientVisitSerializer.get_vitals/get_notes partition these by each
        # visit's date range in Python instead of re-querying per visit.
        all_vitals = list(VitalSigns.objects.filter(patient_id=patient.pk).order_by('-recorded_at'))
        all_notes = list(ChartingNote.objects.filter(patient_id=patient.pk).order_by('-timestamp'))
        return Response(
            PatientVisitSerializer(
                visits, many=True,
                context={'request': request, 'all_vitals': all_vitals, 'all_notes': all_notes},
            ).data
        )

    def update(self, request, *args, **kwargs):
        patient = self.get_object()
        role = get_user_role(request.user)
        if role != 'head_nurse' and patient.assigned_nurse_id != request.user.id:
            return Response(
                {'detail': 'You can only edit patients assigned to you.'},
                status=status.HTTP_403_FORBIDDEN,
            )
        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        patient = self.get_object()
        role = get_user_role(request.user)
        if role != 'head_nurse' and patient.assigned_nurse_id != request.user.id:
            return Response(
                {'detail': 'You can only delete patients assigned to you.'},
                status=status.HTTP_403_FORBIDDEN,
            )
        # Deleting cascades to the patient's whole history. A staff nurse may
        # still undo a mistaken entry (e.g. a wrong Kardex admission), but
        # once real care is on file it is a medical record: discharge it
        # instead, or have a head nurse delete it.
        if role != 'head_nurse':
            recorded = self._recorded_care(patient)
            if recorded:
                return Response(
                    {
                        'detail': (
                            'This patient already has ' + ', '.join(recorded) + ' on file, so it '
                            'cannot be deleted. Discharge the patient instead, or ask a head nurse.'
                        ),
                        'recordedCare': recorded,
                    },
                    status=status.HTTP_403_FORBIDDEN,
                )
        # Related tasks/assignments/kardex cascade or are cleaned via FK rules
        return super().destroy(request, *args, **kwargs)

    @staticmethod
    def _recorded_care(patient):
        """Labels for each kind of clinical record this patient already has."""
        checks = (
            ('charting notes', ChartingNote.objects.filter(patient=patient)),
            ('vital signs', VitalSigns.objects.filter(patient=patient)),
            ('referrals', HandoverNote.objects.filter(patient=patient)),
            ('medication records', MedicationIntake.objects.filter(medication__patient=patient)),
            ('completed tasks', Task.objects.filter(patient=patient, status='completed')),
            ('past visits', patient.visits.filter(discharge_date__isnull=False)),
        )
        return [label for label, qs in checks if qs.exists()]

    @extend_schema(
        request=inline_serializer(
            name='SetAssignedDoctorsRequest',
            fields={'doctorIds': serializers.ListField(child=serializers.IntegerField())},
        ),
        responses={200: DoctorSerializer(many=True)},
        tags=['Patients'],
        summary="Get or replace a patient's Kardex-assigned doctors",
        description=(
            'GET returns the doctors currently on this patient\'s care team — the source of '
            'truth Add New Task reads from. POST replaces the whole set with `doctorIds`. '
            'Removed assignments are deactivated, not deleted, so history (and any task '
            'already created against them) survives. A doctor already on the team who has '
            'since gone inactive can still be kept as-is; only a *newly added* id is checked '
            'for active status — the client cannot use this endpoint to freshly attach an '
            'inactive doctor.'
        ),
    )
    @action(detail=True, methods=['get', 'post'], url_path='assigned-doctors')
    def assigned_doctors(self, request, patient_code=None):
        patient = self.get_object()
        if request.method == 'GET':
            doctors = [
                pd.doctor for pd in
                PatientDoctor.objects.filter(patient=patient, status='active')
                .select_related('doctor', 'doctor__department')
            ]
            return Response(DoctorSerializer(doctors, many=True).data)

        doctor_ids = request.data.get('doctorIds')
        if not isinstance(doctor_ids, list):
            return Response(
                {'doctorIds': 'doctorIds must be an array.'}, status=status.HTTP_400_BAD_REQUEST
            )
        doctors = list(Doctor.objects.filter(pk__in=doctor_ids))
        found_ids = {d.pk for d in doctors}
        missing = [d for d in doctor_ids if d not in found_ids]
        if missing:
            return Response(
                {'doctorIds': f'Doctor(s) not found: {", ".join(str(m) for m in missing)}.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        currently_active_ids = set(
            PatientDoctor.objects.filter(patient=patient, status='active')
            .values_list('doctor_id', flat=True)
        )
        newly_added_ids = found_ids - currently_active_ids
        inactive = [d.full_name for d in doctors if d.pk in newly_added_ids and d.status != 'active']
        if inactive:
            return Response(
                {'doctorIds': f'Not available for assignment: {", ".join(inactive)}.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        # Deactivate rather than delete — a doctor removed from the care team
        # may already be attached to real tasks, and Kardex history should
        # still show they were once responsible for this patient.
        PatientDoctor.objects.filter(patient=patient, status='active').exclude(
            doctor_id__in=found_ids
        ).update(status='inactive')
        for doctor in doctors:
            PatientDoctor.objects.update_or_create(
                patient=patient, doctor=doctor,
                defaults={'status': 'active', 'assigned_by': request.user},
            )
        active_doctors = [
            pd.doctor for pd in
            PatientDoctor.objects.filter(patient=patient, status='active')
            .select_related('doctor', 'doctor__department')
        ]
        return Response(DoctorSerializer(active_doctors, many=True).data)

    @extend_schema(
        request=inline_serializer(name='NotifyNurse', fields={'message': serializers.CharField(required=False)}),
        responses={200: inline_serializer(name='NotifyNurseResult', fields={'detail': serializers.CharField()})},
        summary='Notify a patient\'s assigned nurse',
        description=(
            'Head-nurse-only. Sends the assigned nurse a critical in-app '
            'notification (and email, if they opted in) — the "Notify Nurse" '
            'action on the Patient Safety Alerts panel. Optional '
            '"message" body is the alert detail already shown on the '
            'dashboard (e.g. the vitals that triggered it); falls back to a '
            'generic message if omitted. 400 if the patient has nobody '
            'assigned to notify.'
        ),
    )
    @action(detail=True, methods=['post'], url_path='notify-nurse')
    def notify_nurse(self, request, patient_code=None):
        patient = self.get_object()
        if patient.assigned_nurse_id is None:
            return Response(
                {'detail': 'This patient has no assigned nurse to notify.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        message = (request.data.get('message') or '').strip()[:500]
        if not message:
            message = f'{patient.name} ({patient.room}) requires immediate attention.'

        notify_safety_alert(patient, request.user, message=message)
        nurse_name = full_name(patient.assigned_nurse)
        return Response({'detail': f'{nurse_name} has been notified.'})


class DepartmentViewSet(viewsets.ReadOnlyModelViewSet):
    """Fixed reference list — departments are seeded via migration, not
    created through the API, so this is read-only."""

    serializer_class = DepartmentSerializer
    permission_classes = [permissions.IsAuthenticated, IsApprovedNurseOrAdminReadOnly]
    queryset = Department.objects.all()
    pagination_class = None


class DoctorViewSet(viewsets.ModelViewSet):
    """
    Read: any approved nurse/head nurse (feeds task/patient doctor pickers),
    plus admin. Write: admin only — Doctor was Django-admin-only reference
    data until now, so the in-app Admin panel is the first UI anyone gets
    for keeping this list current.
    """

    serializer_class = DoctorSerializer
    permission_classes = [permissions.IsAuthenticated, IsApprovedNurseOrAdminReadOnly]
    pagination_class = None

    def get_permissions(self):
        if self.action in ('create', 'update', 'partial_update', 'destroy'):
            return [permissions.IsAuthenticated(), IsAdmin()]
        return super().get_permissions()

    def get_queryset(self):
        qs = Doctor.objects.select_related('department').all()
        department_id = self.request.query_params.get('department')
        search = self.request.query_params.get('search')
        if department_id:
            qs = qs.filter(department_id=department_id)
        if search:
            qs = qs.filter(
                Q(full_name__icontains=search)
                | Q(specialization__icontains=search)
                | Q(license_number__icontains=search)
            )
        return qs


@extend_schema_view(
    create=extend_schema(
        summary='Create a task',
        description='Editable request body.',
        examples=TASK_CREATE_EXAMPLES,
    ),
    update=extend_schema(
        summary='Replace a task',
        description='Editable request body.',
        examples=TASK_UPDATE_EXAMPLES,
    ),
    partial_update=extend_schema(
        summary='Update part of a task',
        description='Editable request body. Send only the fields you want to change.',
        examples=TASK_UPDATE_EXAMPLES,
    ),
)
class TaskViewSet(viewsets.ModelViewSet):
    serializer_class = TaskSerializer
    permission_classes = [permissions.IsAuthenticated, IsApprovedNurseOrAdminReadOnly]
    lookup_field = 'task_code'
    lookup_url_kwarg = 'task_code'
    # Task assignments are never hard-deleted through the normal API surface —
    # a wrong assignment is corrected with `unassign` below, which keeps the
    # task and its history instead of removing the row. Enforced here (not
    # just hidden in the UI) so a direct DELETE call is rejected too.
    http_method_names = ['get', 'post', 'patch', 'put', 'head', 'options']

    def get_permissions(self):
        if self.action == 'unassign':
            return [permissions.IsAuthenticated(), IsSupervisor()]
        return super().get_permissions()

    def get_queryset(self):
        # department: TaskSerializer.departmentName reads obj.department.name
        # for every row. task_doctors__doctor: get_assignedDoctors() reads
        # obj.task_doctors.all() per row too — both were a 1-extra-query-per-
        # task N+1 on every list call without this.
        qs = Task.objects.select_related('patient', 'assigned_nurse', 'department').prefetch_related(
            'task_doctors__doctor'
        ).all()
        role = get_user_role(self.request.user)
        assigned_to = self.request.query_params.get('assignedTo')
        status_filter = self.request.query_params.get('status')
        patient_id = self.request.query_params.get('patientId')
        mine = self.request.query_params.get('mine')
        search = self.request.query_params.get('search')

        # A staff nurse is ALWAYS restricted to their own tasks — assignedTo is
        # a head-nurse-facing filter (see NurseTasksPage/nurse-tasks/[name])
        # and must never let a staff nurse widen scope to another nurse's
        # tasks. That matters beyond list(): get_object() (used by every
        # detail action, including `complete`) runs against this same
        # queryset, so a hole here was a real "complete someone else's task
        # via ?assignedTo=<their name>" IDOR, not just an over-broad list.
        if role == 'staff_nurse':
            qs = qs.filter(Q(assigned_nurse=self.request.user) | name_match_q('assigned_to', self.request.user))
        elif mine in ('1', 'true', 'True'):
            qs = qs.filter(Q(assigned_nurse=self.request.user) | name_match_q('assigned_to', self.request.user))
        elif assigned_to:
            qs = qs.filter(assigned_to__iexact=assigned_to)
        if status_filter:
            qs = qs.filter(status=status_filter)
        if patient_id:
            qs = qs.filter(patient__patient_code=patient_id)
        if search:
            qs = qs.filter(
                Q(title__icontains=search)
                | Q(description__icontains=search)
                | Q(patient_name__icontains=search)
            )
        # Default order: completed tasks last regardless of risk; within
        # the rest, High -> Medium -> Low; within the same risk level,
        # overdue first; then soonest due date/time. due_date/due_time
        # being NULL (predates the field, or a free-text admin entry that
        # didn't parse) sorts after every dated task in Postgres's default
        # ASC-is-NULLS-LAST — undated tasks fall to the bottom of their
        # group rather than jumping to the front. This mirrors the same
        # default sort tasks.tsx uses client-side, so the API and the app
        # agree instead of one silently overriding the other.
        return qs.annotate(
            _completed_rank=Case(
                When(status='completed', then=Value(1)), default=Value(0), output_field=IntegerField(),
            ),
            _priority_rank=Case(
                When(priority='high', then=Value(0)),
                When(priority='medium', then=Value(1)),
                When(priority='low', then=Value(2)),
                default=Value(1),
                output_field=IntegerField(),
            ),
            _overdue_rank=Case(
                When(status='overdue', then=Value(0)), default=Value(1), output_field=IntegerField(),
            ),
        ).order_by(
            '_completed_rank', '_priority_rank', '_overdue_rank', 'due_date', 'due_time', '-created_at',
        )

    @extend_schema(
        request=None,
        responses={200: TaskSerializer},
        summary='Mark a task complete',
        description=(
            'No request body — the task is identified by the URL. Stamps `completedAt`. '
            'Rejected with 400 if the task has an unfinished checklist item — an empty '
            'checklist is not required and is never blocked.'
        ),
    )
    @action(detail=True, methods=['post'])
    def complete(self, request, task_code=None):
        task = self.get_object()
        # get_queryset() already scopes a staff nurse to their own tasks, so
        # this can't currently be reached for someone else's task — kept as
        # an explicit, independent check (same defense-in-depth style as
        # DutyAssignmentViewSet.start/end) so completing a task can never
        # silently start working for the wrong nurse again if that scoping
        # ever changes.
        if get_user_role(request.user) == 'staff_nurse':
            is_owner = task.assigned_nurse_id == request.user.pk or (
                ' '.join((task.assigned_to or '').lower().split()) in name_variants(request.user)
            )
            if not is_owner:
                return Response(
                    {'detail': 'You can only complete your own tasks.'},
                    status=status.HTTP_403_FORBIDDEN,
                )
        unfinished = [item.get('text', 'item') for item in task.checklist if not item.get('done')]
        if unfinished:
            return Response(
                {
                    'detail': 'Complete the remaining checklist items before finishing this task.',
                    'unfinishedChecklistItems': unfinished,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        task.status = 'completed'
        task.completed_at = timezone.now()
        task.save(update_fields=['status', 'completed_at', 'updated_at'])
        return Response(TaskSerializer(task, context={'request': request}).data)

    @extend_schema(
        request=None,
        responses={200: TaskSerializer},
        summary='Unassign a task from its nurse',
        description=(
            'No request body — the task is identified by the URL. Clears the assigned '
            'nurse and returns the task to pending, without deleting it. Head nurse only.'
        ),
    )
    @action(detail=True, methods=['post'])
    def unassign(self, request, task_code=None):
        task = self.get_object()
        task.assigned_nurse = None
        task.assigned_to = ''
        if task.status != 'completed':
            task.status = 'pending'
        task.save(update_fields=['assigned_nurse', 'assigned_to', 'status', 'updated_at'])
        return Response(TaskSerializer(task, context={'request': request}).data)


@extend_schema_view(
    create=extend_schema(
        summary='Create an SBAR handover',
        description='Editable request body.',
        examples=HANDOVER_CREATE_EXAMPLES,
    ),
    update=extend_schema(
        summary='Replace a handover',
        description='Editable request body.',
        examples=HANDOVER_UPDATE_EXAMPLES,
    ),
    partial_update=extend_schema(
        summary='Update part of a handover',
        description='Editable request body. Send only the fields you want to change.',
        examples=HANDOVER_UPDATE_EXAMPLES,
    ),
)
class HandoverViewSet(viewsets.ModelViewSet):
    """
    Referral / Endorsement — nurse-to-nurse, no head-nurse approval gate.
    One model, one ViewSet, exposed at both /handovers/ (legacy, single
    patient, next-shift-rotation gated by the client — but the gate itself
    is gone now, see HandoverSerializer.create()) and /endorsements/ (the
    bulk, any-shift rework — see is_endorsement on HandoverNote). Status
    moves sent -> received -> accepted|declined|cancelled -> completed,
    driven entirely by the sending nurse (create/cancel) and the receiving
    nurse (acknowledge/accept/decline/reject/complete — see
    _ensure_recipient). Head nurses can list/retrieve every row (see
    get_queryset) but CanManageReferral blocks them from write methods, and
    every action below additionally checks the acting user is the actual
    recipient (or sender, for cancel) — so there is no path, permission or
    otherwise, for a head nurse to act on one.
    """

    serializer_class = HandoverSerializer
    permission_classes = [permissions.IsAuthenticated, CanManageReferral]
    lookup_field = 'handover_code'
    lookup_url_kwarg = 'handover_code'

    def get_queryset(self):
        qs = HandoverNote.objects.select_related(
            'patient', 'created_by', 'nurse_to_user', 'nurse_to_user__nurse_profile', 'department'
        ).all()
        status_filter = self.request.query_params.get('status')
        if status_filter:
            qs = qs.filter(status=status_filter)

        # A head nurse gets every referral, unfiltered — same "oversight
        # sees everything, no silo" rule PatientViewSet (the ward roster)
        # and KardexViewSet already use for head nurses. This used to be
        # scoped by matching NurseProfile.department (a free-text field set
        # later by a head nurse, never validated against anything) between
        # the head nurse's own profile and the referral's sender/recipient.
        # That silently hid every referral whenever the strings didn't
        # match exactly — a head nurse with an admin-only department like
        # "Nursing Administration" that no staff nurse shares saw zero
        # referrals ever, and even a real ward match ("ICU" vs "Intensive
        # Care Unit (ICU)") could fail on a wording difference alone. A
        # staff nurse's own visibility is unaffected: CanManageReferral and
        # _ensure_recipient still mean they only ever create/act on their
        # own referrals; this only changes what a head nurse can *see*.
        #
        # A staff nurse, though, sees only the referrals they are part of:
        # the ones sent TO them (to view and accept) and the ones they sent.
        # Previously every nurse saw every referral, which confused nurses
        # who were not the recipient.
        if get_user_role(self.request.user) == 'staff_nurse':
            user = self.request.user
            qs = qs.filter(
                Q(nurse_to_user=user)
                | Q(created_by=user)
                # Legacy rows written before nurse_to_user existed carry only
                # the typed recipient name.
                | (Q(nurse_to_user__isnull=True) & name_match_q('nurse_to', user))
            )
        return qs

    def update(self, request, *args, **kwargs):
        # Covers PUT and PATCH. A referral's content (SBAR, recipient) is the
        # sender's statement; nobody else may rewrite it. Without this, any
        # approved staff nurse could edit any referral in the ward.
        handover = self.get_object()
        if handover.created_by_id != request.user.id:
            raise PermissionDenied('Only the nurse who sent this referral can edit it.')
        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        # Sender and receiver both see a delete button in the app; anyone
        # else in the ward must not be able to remove a referral.
        handover = self.get_object()
        if request.user.id not in (handover.created_by_id, handover.nurse_to_user_id):
            raise PermissionDenied('Only the sending or receiving nurse can delete this referral.')
        return super().destroy(request, *args, **kwargs)

    def _ensure_recipient(self, handover):
        """
        Only the receiving nurse drives a referral through
        received/accepted/declined/completed. Head nurses are explicitly
        rejected here even though CanManageReferral already blocks their
        writes at the viewset level — belt and suspenders, since these are
        the one set of actions where "not a head nurse" alone would not be
        enough (a head nurse could otherwise still not be the recipient and
        this makes that failure mode explicit rather than incidental).
        """
        if get_user_role(self.request.user) == 'head_nurse':
            raise PermissionDenied('Head nurses have view-only access to referrals.')
        if not handover.nurse_to_user_id or handover.nurse_to_user_id != self.request.user.id:
            raise PermissionDenied('Only the receiving nurse can update this referral.')

    @extend_schema(
        responses={200: inline_serializer(
            name='EligibleReferralRecipients',
            fields={
                'onDuty': serializers.BooleanField(),
                'currentShift': serializers.CharField(allow_null=True),
                'currentShiftLabel': serializers.CharField(allow_null=True),
                'departmentId': serializers.IntegerField(allow_null=True),
                'departmentName': serializers.CharField(allow_blank=True),
                'nextShift': serializers.CharField(allow_null=True),
                'nextShiftLabel': serializers.CharField(allow_null=True),
                'nextShiftDate': serializers.DateField(allow_null=True),
                'recipients': inline_serializer(
                    name='EligibleReferralRecipient',
                    fields={
                        'id': serializers.CharField(),
                        'name': serializers.CharField(),
                        'role': serializers.CharField(),
                        'specialization': serializers.CharField(),
                        'email': serializers.CharField(),
                    },
                    many=True,
                ),
                'emptyReason': serializers.ChoiceField(
                    choices=[
                        'user_off_duty', 'no_next_shift_staff',
                        'only_self_scheduled', 'no_eligible_nurse_on_next_shift',
                    ],
                    allow_null=True,
                ),
            },
        )},
        summary='Who the signed-in nurse may refer to right now',
        description=(
            'Shift-rotation eligible recipients: every approved, active staff nurse in the '
            "same department, scheduled for the next shift in rotation (Morning -> "
            "Afternoon -> Night -> next day's Morning) from the signed-in nurse's own "
            'current DutyAssignment — never a static profile default. `onDuty` is false '
            '(and `recipients` empty) when the signed-in nurse has no active shift right now.'
            '\n\n`emptyReason` is null whenever `recipients` is non-empty. Otherwise it is a '
            'code (never display text — the frontend owns the wording) naming why: '
            '`user_off_duty`, `no_next_shift_staff` (nobody at all is scheduled for the next '
            'shift in this department), `only_self_scheduled` (the only person scheduled for '
            "it is the signed-in nurse), or `no_eligible_nurse_on_next_shift` (someone else is "
            'scheduled, but none of them are an approved, active staff nurse).'
        ),
    )
    @action(detail=False, methods=['get'], url_path='eligible-recipients')
    def eligible_recipients(self, request):
        current, next_shift, next_date, recipients, empty_reason = get_eligible_recipients(request.user)
        if current is None:
            return Response({
                'onDuty': False,
                'currentShift': None,
                'currentShiftLabel': None,
                'departmentId': None,
                'departmentName': '',
                'nextShift': None,
                'nextShiftLabel': None,
                'nextShiftDate': None,
                'recipients': [],
                'emptyReason': empty_reason,
            })
        return Response({
            'onDuty': True,
            'currentShift': current.shift,
            'currentShiftLabel': SHIFT_LABELS.get(current.shift, current.shift),
            'departmentId': current.department_id,
            'departmentName': current.department.name,
            'nextShift': next_shift,
            'nextShiftLabel': SHIFT_LABELS.get(next_shift, next_shift),
            'nextShiftDate': next_date,
            'recipients': [
                {
                    'id': str(nurse.pk),
                    'name': full_name(nurse),
                    'role': nurse.nurse_profile.clinical_role or 'RN',
                    'specialization': nurse.nurse_profile.specialization or '',
                    'email': nurse.email,
                }
                for nurse in recipients
            ],
            # Null whenever recipients is non-empty — a reason only ever
            # accompanies an empty list. See referral_shifts.py.
            'emptyReason': empty_reason,
        })

    @action(detail=False, methods=['get'], url_path='my-patients')
    def my_patients(self, request):
        """The signed-in nurse's own assigned patients, each flagged whether
        they're already in a pending endorsement (so the compose UI can grey
        them out / block picking them again)."""
        patients = list(
            Patient.objects.filter(assigned_nurse=request.user).order_by('name')
        )
        pending_codes = set(
            HandoverPatient.objects.filter(
                patient__in=patients, handover__status__in=['sent', 'received'],
            ).values_list('patient__patient_code', flat=True)
        )
        data = PatientSerializer(patients, many=True, context=self.get_serializer_context()).data
        for row in data:
            row['pendingEndorsement'] = row.get('id') in pending_codes
        return Response(data)

    @action(detail=False, methods=['get'], url_path='eligible-receivers')
    def eligible_receivers(self, request):
        """Every active, approved nurse except me who is currently on a real
        duty, grouped by shift (Morning -> Afternoon -> Night), any
        shift/department allowed — the new Endorsement rule, replacing the
        old shift-rotation-only eligible_recipients above for new callers
        (which stays, unchanged, for anything still using it). A nurse with
        no current/upcoming duty (see api/duty_status.py::current_duties)
        cannot be picked as a receiver at all — see the matching check in
        HandoverSerializer.create()."""
        shift_id = (request.query_params.get('shiftId') or '').strip().lower()
        department_id = (request.query_params.get('departmentId') or '').strip()
        search = (request.query_params.get('search') or '').strip().lower()

        nurses = (
            User.objects.filter(
                nurse_profile__approval_status='approved',
                nurse_profile__is_active_staff=True,
            )
            .exclude(pk=request.user.pk)
            .select_related('nurse_profile')
            .order_by('first_name', 'last_name')
        )
        if search:
            nurses = nurses.filter(
                Q(first_name__icontains=search) | Q(last_name__icontains=search)
            )
        duties = current_duties([n.pk for n in nurses])

        buckets = {'morning': [], 'afternoon': [], 'night': []}
        for nurse in nurses:
            duty = duties.get(nurse.pk)
            if duty is None:
                continue
            _, department = duty_fields(nurse.nurse_profile, duty)
            if department_id and str(duty.department_id) != department_id:
                continue
            buckets[duty.shift].append({
                'id': str(nurse.pk),
                'fullName': full_name(nurse),
                'department': {'id': duty.department_id, 'name': department},
                'shift': duty.shift,
            })

        groups = []
        for key in ('morning', 'afternoon', 'night'):
            if shift_id and key != shift_id:
                continue
            times = DutyAssignment.SHIFT_DEFAULT_TIMES.get(key)
            groups.append({
                'shift': {
                    'id': key,
                    'name': SHIFT_LABELS.get(key, key),
                    'startTime': times[0].isoformat() if times else None,
                    'endTime': times[1].isoformat() if times else None,
                },
                'nurses': buckets[key],
            })
        return Response(groups)

    @action(detail=False, methods=['get'], url_path='sent')
    def sent(self, request):
        return self._boxed_list(request, created_by=request.user)

    @action(detail=False, methods=['get'], url_path='received')
    def received(self, request):
        return self._boxed_list(request, nurse_to_user=request.user)

    #: Endorsement status (caller-facing) -> the DB status value(s) it maps
    #: to — the reverse of HandoverSerializer._ENDORSEMENT_STATUS, used only
    #: to translate an incoming ?status= filter on the new /sent //received
    #: actions. The shared get_queryset()/?status= above is untouched and
    #: still expects a raw DB value, so old callers keep working.
    _STATUS_FILTER = {
        'PENDING': ['sent', 'received'],
        'ACCEPTED': ['accepted'],
        'REJECTED': ['declined'],
        'CANCELLED': ['cancelled'],
    }

    def _boxed_list(self, request, **by):
        # Built directly rather than via self.get_queryset() — that method's
        # own ?status= handling expects a raw DB value (sent/accepted/...),
        # not the translated PENDING/ACCEPTED/... these two actions take,
        # and its staff_nurse OR-filter is redundant here: **by already
        # scopes strictly to created_by or nurse_to_user=request.user.
        qs = HandoverNote.objects.select_related(
            'patient', 'created_by', 'nurse_to_user', 'nurse_to_user__nurse_profile', 'department', 'to_department',
        ).filter(**by)
        status_filter = (request.query_params.get('status') or '').strip().upper()
        if status_filter:
            qs = qs.filter(status__in=self._STATUS_FILTER.get(status_filter, [status_filter.lower()]))
        data = HandoverSerializer(qs, many=True, context={'request': request}).data
        return Response(data)

    @staticmethod
    def _append_status_history(handover, status, user, note=''):
        history = list(handover.status_history or [])
        history.append({
            'status': status,
            'by': user.pk if user else None,
            'byName': full_name(user) if user else '',
            'at': timezone.now().isoformat(),
            'note': note,
        })
        handover.status_history = history

    @extend_schema(
        request=None,
        responses={200: HandoverSerializer},
        summary='Mark a referral received',
        description=(
            'No request body — the referral is identified by the URL. This is the '
            'lightweight "seen it" step: it does not move any tasks and does not commit '
            'the receiving nurse to the patient — see /accept/ for that. Calling it again, '
            'or after the referral has moved past "received", is a no-op.'
        ),
    )
    @action(detail=True, methods=['post'])
    def acknowledge(self, request, handover_code=None):
        handover = self.get_object()
        self._ensure_recipient(handover)

        if handover.status != 'sent':
            return Response(HandoverSerializer(handover, context={'request': request}).data)

        with transaction.atomic():
            handover.status = 'received'
            handover.acknowledged_at = timezone.now()
            handover.acknowledged_by = request.user
            self._append_status_history(handover, 'received', request.user)
            handover.save(
                update_fields=[
                    'status', 'acknowledged_at', 'acknowledged_by', 'status_history', 'updated_at',
                ]
            )

        notify_handover_acknowledged(handover, request.user)
        return Response(HandoverSerializer(handover, context={'request': request}).data)

    @extend_schema(
        request=None,
        responses={200: HandoverSerializer},
        summary='Accept a referral',
        description=(
            'No request body — the referral is identified by the URL. Accepting moves its '
            "unfinished work onto the accepting nurse's task list and tells the sending "
            'nurse it was accepted. Valid from "sent" or "received"; accepting twice is a '
            'no-op; a declined or completed referral cannot be accepted.'
        ),
    )
    @action(detail=True, methods=['post', 'patch'])
    def accept(self, request, handover_code=None):
        handover = self.get_object()
        self._ensure_recipient(handover)

        # Fast path for the common cases — avoids opening a transaction at
        # all for an already-settled handover.
        if handover.status == 'accepted':
            data = HandoverSerializer(handover, context={'request': request}).data
            data['adoptedTasks'] = []
            return Response(data)
        if handover.status not in ('sent', 'received'):
            return Response(
                {'detail': f'Cannot accept an endorsement that is already "{handover.status}".'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        with transaction.atomic():
            # Re-fetched under lock: the status checks above ran against a
            # snapshot read before this transaction even started, so two
            # concurrent accept() calls for the same handover could both
            # pass them. Locking here serializes them — the second one sees
            # the first's committed 'accepted' status and exits as a no-op,
            # matching "accepting twice is a no-op" below, instead of both
            # racing through the patient transfer.
            handover = HandoverNote.objects.select_for_update().get(pk=handover.pk)
            if handover.status == 'accepted':
                data = HandoverSerializer(handover, context={'request': request}).data
                data['adoptedTasks'] = []
                return Response(data)
            if handover.status not in ('sent', 'received'):
                return Response(
                    {'detail': f'Cannot accept an endorsement that is already "{handover.status}".'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            now = timezone.now()
            adopted = []
            if handover.is_endorsement:
                # Real patient-ownership transfer. Re-check each patient is
                # *still* assigned to the endorser right now — one may have
                # been reassigned elsewhere while this endorsement sat
                # pending — and fail clearly, naming it, rather than
                # silently transferring a patient out from under whoever
                # actually has them. select_for_update locks these Patient
                # rows until commit, so a concurrent reassignment or a second
                # accept touching the same patient blocks here instead of
                # racing past this check on data about to go stale.
                links = list(handover.handover_patients.select_related('patient').all())
                receiver = handover.nurse_to_user
                locked_patients = {
                    p.pk: p
                    for p in Patient.objects.filter(
                        pk__in=[link.patient_id for link in links]
                    ).select_for_update()
                }
                stale = [
                    link.patient.patient_code for link in links
                    if locked_patients[link.patient_id].assigned_nurse_id != handover.created_by_id
                ]
                if stale:
                    return Response(
                        {
                            'detail': (
                                'These patients are no longer assigned to the endorser and '
                                f'cannot be transferred: {", ".join(stale)}.'
                            )
                        },
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                for link in links:
                    PatientAssignment.objects.filter(patient=link.patient, status='active').update(
                        status='reassigned', ended_at=now, end_reason='ENDORSED',
                    )
                    PatientAssignment.objects.create(
                        patient=link.patient,
                        assigned_nurse=receiver,
                        status='active',
                        assigned_by=receiver,
                        source_handover=handover,
                    )
            else:
                if handover.status == 'sent':
                    handover.acknowledged_at = handover.acknowledged_at or now
                    handover.acknowledged_by = handover.acknowledged_by or request.user
                    self._append_status_history(handover, 'received', request.user)
                adopted = adopt_handover_tasks(handover, request.user)

            handover.status = 'accepted'
            handover.accepted_at = now
            handover.accepted_by = request.user
            self._append_status_history(handover, 'accepted', request.user)
            handover.save(
                update_fields=[
                    'status', 'acknowledged_at', 'acknowledged_by', 'accepted_at',
                    'accepted_by', 'status_history', 'updated_at',
                ]
            )

        notify_handover_accepted(handover, request.user, adopted)
        notify_referral_head_nurse_fyi(handover, 'accepted')

        data = HandoverSerializer(handover, context={'request': request}).data
        data['adoptedTasks'] = [task.task_code for task in adopted]
        return Response(data)

    @action(detail=True, methods=['patch'])
    def reject(self, request, handover_code=None):
        """PATCH alias of decline, for the /endorsements/ surface — same
        recipient-only guard, requires a reason."""
        reason = (request.data.get('reason') or '').strip()
        if not reason:
            return Response({'reason': 'A reason is required.'}, status=status.HTTP_400_BAD_REQUEST)
        return self._decline(request, handover_code, reason)

    @action(detail=True, methods=['patch'])
    def cancel(self, request, handover_code=None):
        """Endorser-only: withdraw a still-pending endorsement. The patients
        were never touched (accept is the only thing that transfers them),
        so there is nothing to roll back here."""
        handover = self.get_object()
        if get_user_role(request.user) == 'head_nurse':
            raise PermissionDenied('Head nurses have view-only access to referrals.')
        if handover.created_by_id != request.user.id:
            raise PermissionDenied('Only the nurse who sent this endorsement can cancel it.')

        if handover.status == 'cancelled':
            return Response(HandoverSerializer(handover, context={'request': request}).data)
        if handover.status not in ('sent', 'received'):
            return Response(
                {'detail': f'Cannot cancel an endorsement that is already "{handover.status}".'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        with transaction.atomic():
            handover.status = 'cancelled'
            self._append_status_history(handover, 'cancelled', request.user)
            handover.save(update_fields=['status', 'status_history', 'updated_at'])

        notify_handover_cancelled(handover, request.user)
        notify_referral_head_nurse_fyi(handover, 'cancelled')
        return Response(HandoverSerializer(handover, context={'request': request}).data)

    @action(detail=True, methods=['patch'], url_path=r'tasks/(?P<task_id>\d+)')
    def complete_task(self, request, handover_code=None, task_id=None):
        """Check (or uncheck) one of this endorsement's Unfinished Tasks.
        Only the receiving nurse may — see _ensure_recipient — matching the
        business reality that these are the receiver's own follow-up list,
        not editable by the sender after the fact."""
        handover = self.get_object()
        self._ensure_recipient(handover)
        task = get_object_or_404(EndorsementTask, pk=task_id, endorsement=handover)

        is_completed = request.data.get('isCompleted', request.data.get('is_completed', True))
        task.is_completed = bool(is_completed)
        task.completed_at = timezone.now() if task.is_completed else None
        task.save(update_fields=['is_completed', 'completed_at'])
        return Response(HandoverSerializer._serialize_task(task))

    @extend_schema(
        request=None,
        responses={200: HandoverSerializer},
        summary='Decline a referral',
        description=(
            'Optional {"reason": "..."} body. Valid from "sent" or "received"; declining '
            'twice is a no-op; an accepted or completed referral cannot be declined.'
        ),
    )
    @action(detail=True, methods=['post'])
    def decline(self, request, handover_code=None):
        reason = (request.data.get('reason') or '').strip()
        return self._decline(request, handover_code, reason)

    def _decline(self, request, handover_code, reason):
        handover = self.get_object()
        self._ensure_recipient(handover)

        if handover.status == 'declined':
            return Response(HandoverSerializer(handover, context={'request': request}).data)
        if handover.status not in ('sent', 'received'):
            return Response(
                {'detail': f'Cannot decline/reject an endorsement that is already "{handover.status}".'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        with transaction.atomic():
            handover.status = 'declined'
            handover.declined_at = timezone.now()
            handover.declined_by = request.user
            handover.declined_reason = reason
            self._append_status_history(handover, 'declined', request.user, note=reason)
            handover.save(
                update_fields=[
                    'status', 'declined_at', 'declined_by', 'declined_reason',
                    'status_history', 'updated_at',
                ]
            )

        notify_handover_declined(handover, request.user, reason)
        notify_referral_head_nurse_fyi(handover, 'declined', detail=reason)
        return Response(HandoverSerializer(handover, context={'request': request}).data)

    @extend_schema(
        request=None,
        responses={200: HandoverSerializer},
        summary='Mark a referral completed',
        description=(
            'No request body — the referral is identified by the URL. Only valid from '
            '"accepted". Completing twice is a no-op.'
        ),
    )
    @action(detail=True, methods=['post'])
    def complete(self, request, handover_code=None):
        handover = self.get_object()
        self._ensure_recipient(handover)

        if handover.status == 'completed':
            return Response(HandoverSerializer(handover, context={'request': request}).data)
        if handover.status != 'accepted':
            return Response(
                {'detail': 'Only an accepted referral can be marked completed.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        with transaction.atomic():
            handover.status = 'completed'
            handover.completed_at = timezone.now()
            handover.completed_by = request.user
            self._append_status_history(handover, 'completed', request.user)
            handover.save(
                update_fields=['status', 'completed_at', 'completed_by', 'status_history', 'updated_at']
            )

        notify_handover_completed(handover, request.user)
        notify_referral_head_nurse_fyi(handover, 'completed')
        return Response(HandoverSerializer(handover, context={'request': request}).data)


# A task can be reassigned on handover approval only while it is still open —
# mirrors handover_tasks.OPEN_STATUSES (a completed/overdue task keeps
# whoever finished or is chasing it, a handover never resurrects it).
TASK_HANDOVER_REASSIGNABLE_STATUSES = ('pending', 'in_progress')


class TaskHandoverViewSet(viewsets.ModelViewSet):
    """
    Task-level shift handover, gated by head nurse verification.

    Distinct from /api/handovers/ (the SBAR patient handover, notified
    immediately): a TaskHandover always starts 'pending' and the receiving
    nurse hears nothing about it until a head nurse calls approve — see
    notify_task_handover_verified. No update/destroy — once created, a
    handover only changes through approve/reject.
    """

    serializer_class = TaskHandoverSerializer
    permission_classes = [permissions.IsAuthenticated, IsApprovedNurseOrAdminReadOnly]
    lookup_field = 'handover_code'
    lookup_url_kwarg = 'handover_code'
    http_method_names = ['get', 'post', 'head', 'options']

    def get_permissions(self):
        if self.action in ('approve', 'reject'):
            return [permissions.IsAuthenticated(), IsSupervisor()]
        return super().get_permissions()

    def get_queryset(self):
        qs = TaskHandover.objects.select_related(
            'task', 'from_nurse', 'to_nurse', 'department', 'supervisor'
        ).all()

        # A staff nurse only ever sees handovers they sent or received; the
        # head nurse queue (point 3 of the spec) is everything, filterable.
        if get_user_role(self.request.user) == 'staff_nurse':
            qs = qs.filter(Q(from_nurse=self.request.user) | Q(to_nurse=self.request.user))

        params = self.request.query_params
        status_filter = params.get('status')
        department_id = params.get('departmentId')
        shift = params.get('shift')
        date_param = params.get('date')
        date_from = params.get('dateFrom')
        date_to = params.get('dateTo')

        if status_filter:
            qs = qs.filter(status=status_filter)
        if department_id:
            qs = qs.filter(department_id=department_id)
        if shift:
            qs = qs.filter(shift=shift)
        if date_param:
            qs = qs.filter(duty_date=parse_user_date(date_param, 'date'))
        if date_from:
            qs = qs.filter(duty_date__gte=parse_user_date(date_from, 'dateFrom'))
        if date_to:
            qs = qs.filter(duty_date__lte=parse_user_date(date_to, 'dateTo'))
        return qs

    @extend_schema(
        responses={200: TaskHandoverSerializer(many=True)},
        summary='Nurses eligible to receive a handover',
        description=(
            'Same-shift nurses only, pulled from today’s Duty Roster (not a static '
            'profile shift) — the signed-in nurse’s own duty assignment for `date` decides '
            'the shift. 400 if the signed-in nurse has no duty assignment for that date. '
            'Defaults `date` to today and `sameDepartment` to true.'
        ),
    )
    @action(detail=False, methods=['get'])
    def eligible_recipients(self, request):
        date_param = request.query_params.get('date')
        if date_param:
            duty_date = parse_user_date(date_param, 'date')
        else:
            duty_date = timezone.now().astimezone(ZoneInfo(settings.DUTY_LOCAL_TIMEZONE)).date()

        from_assignment = (
            DutyAssignment.objects.filter(nurse=request.user, duty_date=duty_date)
            .exclude(status='cancelled')
            .select_related('department')
            .first()
        )
        if from_assignment is None:
            return Response(
                {'detail': f'You have no scheduled duty on {duty_date} to hand a task over from.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        same_department = request.query_params.get('sameDepartment', 'true').lower() != 'false'
        candidates = (
            DutyAssignment.objects.filter(duty_date=duty_date, shift=from_assignment.shift)
            .exclude(status='cancelled')
            .exclude(nurse=request.user)
            .select_related('nurse', 'department')
        )
        if same_department:
            candidates = candidates.filter(department_id=from_assignment.department_id)

        seen = set()
        results = []
        for assignment in candidates.order_by('nurse__first_name', 'nurse__last_name'):
            if assignment.nurse_id in seen:
                continue
            seen.add(assignment.nurse_id)
            nurse = assignment.nurse
            results.append(
                {
                    'id': str(nurse.pk),
                    'name': full_name(nurse),
                    'departmentId': assignment.department_id,
                    'departmentName': assignment.department.name,
                    'shift': assignment.shift,
                    'shiftLabel': assignment.get_shift_display(),
                }
            )
        return Response(results)

    @extend_schema(
        request=None,
        responses={200: TaskHandoverSerializer},
        summary='Approve a pending handover',
        description=(
            'No request body — the handover is identified by the URL. Head-nurse-only. '
            'Sets status to verified, records the head nurse and timestamp, reassigns the '
            'linked task (if any and still open) to the receiving nurse, and is the only '
            'point at which the receiving nurse is notified.'
        ),
    )
    @action(detail=True, methods=['post'])
    def approve(self, request, handover_code=None):
        handover = self.get_object()
        if handover.status != 'pending':
            return Response(
                {'detail': f'This handover has already been {handover.get_status_display().lower()}.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        handover.status = 'verified'
        handover.supervisor = request.user
        handover.verified_at = timezone.now()
        handover.save(update_fields=['status', 'supervisor', 'verified_at', 'updated_at'])

        if handover.task_id and handover.task.status in TASK_HANDOVER_REASSIGNABLE_STATUSES:
            handover.task.assigned_nurse = handover.to_nurse
            handover.task.assigned_to = full_name(handover.to_nurse)
            handover.task.save(update_fields=['assigned_nurse', 'assigned_to', 'updated_at'])

        notify_task_handover_verified(handover)
        notify_task_handover_accepted(handover)

        return Response(TaskHandoverSerializer(handover, context={'request': request}).data)

    @extend_schema(
        request=inline_serializer(
            name='RejectTaskHandover',
            fields={'reason': serializers.CharField(required=False, allow_blank=True)},
        ),
        responses={200: TaskHandoverSerializer},
        summary='Reject a pending handover',
        description=(
            'Head-nurse-only. Sets status to rejected with an optional reason; the task is '
            'never reassigned and the receiving nurse is never notified — only the sending '
            'nurse hears about it, with the reason.'
        ),
    )
    @action(detail=True, methods=['post'])
    def reject(self, request, handover_code=None):
        handover = self.get_object()
        if handover.status != 'pending':
            return Response(
                {'detail': f'This handover has already been {handover.get_status_display().lower()}.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        handover.status = 'rejected'
        handover.supervisor = request.user
        handover.rejection_reason = (request.data.get('reason') or '').strip()
        handover.save(update_fields=['status', 'supervisor', 'rejection_reason', 'updated_at'])

        notify_task_handover_rejected(handover)

        return Response(TaskHandoverSerializer(handover, context={'request': request}).data)


def _as_text(value) -> str:
    """
    The n8n workflow's LLM doesn't keep a fixed output shape: the same field
    comes back as a string one run and as a list or an object the next. Every
    narrative field the app shows is plain text, so flatten whatever arrived
    (lists -> one item per line, objects -> "key: value" lines) instead of
    crashing on it ("Could not generate the note", HTTP 500).
    """
    if value is None:
        return ''
    if isinstance(value, str):
        return value
    if isinstance(value, (list, tuple)):
        return '\n'.join(text for text in (_as_text(item).strip() for item in value) if text)
    if isinstance(value, dict):
        lines = []
        for key, item in value.items():
            text = _as_text(item).strip()
            if text:
                lines.append(f'{key}: {text}')
        return '\n'.join(lines)
    return str(value)


# Free-text sections of a structured note -- always strings in the response.
_CHART_TEXT_FIELDS = (
    'assessment', 'patientResponse', 'clinicalSummary', 'plan',
    'focus', 'data', 'action', 'response', 'date', 'time',
)


def _documented_vital(value):
    """
    A vital-sign value is only "documented" when it's a real, non-zero
    reading — 0/''/None all mean "not mentioned" (Patient.heart_rate/etc.
    default to 0 precisely because they've never been charted, and no vital
    sign here is ever legitimately 0), so all three normalize to None
    rather than a false zero reaching the chart. Used by
    ChartingViewSet.structure to decide, per vital, whether the workflow's
    own extraction from the assessment text actually found something.
    """
    if value in (None, ''):
        return None
    if isinstance(value, (int, float)) and value == 0:
        return None
    return value


@extend_schema_view(
    create=extend_schema(
        summary='Create a charting note',
        description='Editable request body.',
        examples=CHARTING_CREATE_EXAMPLES,
    ),
    update=extend_schema(
        summary='Replace a charting note',
        description='Editable request body.',
        examples=CHARTING_UPDATE_EXAMPLES,
    ),
    partial_update=extend_schema(
        summary='Amend a charting note',
        description='Editable request body. Send only the fields you want to change.',
        examples=CHARTING_UPDATE_EXAMPLES,
    ),
)
class ChartingViewSet(viewsets.ModelViewSet):
    serializer_class = ChartingNoteSerializer
    permission_classes = [permissions.IsAuthenticated, IsApprovedNurseOrAdminReadOnly]
    lookup_field = 'note_code'
    lookup_url_kwarg = 'note_code'

    # Philippine hospital app — calendar "Today" / history dates use local civil days.
    CHARTING_CALENDAR_TZ = 'Asia/Manila'

    def _charting_tz(self):
        try:
            from zoneinfo import ZoneInfo

            return ZoneInfo(
                self.request.query_params.get('tz')
                or getattr(settings, 'CHARTING_TIME_ZONE', self.CHARTING_CALENDAR_TZ)
            )
        except Exception:
            from zoneinfo import ZoneInfo

            return ZoneInfo(self.CHARTING_CALENDAR_TZ)

    def get_queryset(self):
        qs = ChartingNote.objects.select_related('patient', 'nurse').all()
        mine = (self.request.query_params.get('mine') or '').strip().lower()
        if mine in ('1', 'true', 'yes', 'on'):
            qs = qs.filter(nurse=self.request.user)
        patient_id = self.request.query_params.get('patientId')
        if patient_id:
            qs = qs.filter(patient__patient_code=patient_id)
        date_str = (self.request.query_params.get('date') or '').strip()
        if date_str:
            day = parse_user_date(date_str, 'date')
            from datetime import datetime, time as dtime, timedelta

            tz = self._charting_tz()
            start = datetime.combine(day, dtime.min, tzinfo=tz)
            end = start + timedelta(days=1)
            qs = qs.filter(timestamp__gte=start, timestamp__lt=end)
        return qs

    def _ensure_note_owner(self, note):
        if note.nurse_id and note.nurse_id != self.request.user.id:
            from rest_framework.exceptions import PermissionDenied

            raise PermissionDenied('You can only modify your own charting notes.')

    def _patient_from_payload(self, validated_data):
        # The serializer resolves patientId to a Patient only inside create()/update(),
        # so look it up here from the raw code.
        code = validated_data.get('patientId')
        return Patient.objects.filter(patient_code=code).first() if code else None

    def perform_create(self, serializer):
        # Same rule as labs and medications: only for patients assigned to you (head nurse: any).
        _check_patient_care_scope(self.request, self._patient_from_payload(serializer.validated_data), 'chart notes')
        serializer.save()

    def perform_update(self, serializer):
        _check_patient_care_scope(self.request, serializer.instance.patient, 'edit charting notes')
        if 'patientId' in serializer.validated_data:
            _check_patient_care_scope(
                self.request, self._patient_from_payload(serializer.validated_data), 'chart notes',
            )
        self._ensure_note_owner(serializer.instance)
        # Clients must not flip confirmation via generic PATCH — use /confirm/.
        serializer.validated_data.pop('confirmed', None)
        serializer.save()

    def perform_destroy(self, instance):
        _check_patient_care_scope(self.request, instance.patient, 'delete charting notes')
        self._ensure_note_owner(instance)
        instance.delete()

    @extend_schema(
        tags=['Charting'],
        summary='Confirm a charting note',
        description=(
            'Marks the note as confirmed by its author. Idempotent — already-confirmed '
            'notes are returned unchanged. Does not create a duplicate record.'
        ),
        responses={200: ChartingNoteSerializer},
    )
    @action(detail=True, methods=['post'])
    def confirm(self, request, note_code=None):
        note = self.get_object()
        self._ensure_note_owner(note)
        if not note.confirmed:
            note.confirmed = True
            note.confirmed_at = timezone.now()
            note.save(update_fields=['confirmed', 'confirmed_at', 'updated_at'])
        return Response(ChartingNoteSerializer(note, context={'request': request}).data)

    @extend_schema(
        tags=['Charting'],
        summary='List charting history dates for the logged-in nurse',
        description=(
            'Returns calendar dates (Asia/Manila by default) that have at least one '
            'charting note authored by the current nurse, with per-day counts. '
            'Used by My Charting History — never returns another nurse’s dates.'
        ),
        responses={
            200: inline_serializer(
                name='ChartingHistoryDate',
                fields={
                    'date': serializers.DateField(),
                    'count': serializers.IntegerField(),
                    'isToday': serializers.BooleanField(),
                },
                many=True,
            )
        },
    )
    @action(detail=False, methods=['get'], url_path='history-dates')
    def history_dates(self, request):
        from django.db.models.functions import TruncDate

        tz = self._charting_tz()
        today = timezone.now().astimezone(tz).date()
        rows = (
            ChartingNote.objects.filter(nurse=request.user)
            .annotate(day=TruncDate('timestamp', tzinfo=tz))
            .values('day')
            .annotate(count=Count('id'))
            .order_by('-day')
        )
        payload = []
        for row in rows:
            day = row['day']
            if day is None:
                continue
            if hasattr(day, 'date'):
                day = day.date()
            payload.append(
                {
                    'date': day.isoformat(),
                    'count': row['count'],
                    'isToday': day == today,
                }
            )
        return Response(payload)

    @extend_schema(
        request=StructureChartSerializer,
        responses={200: StructureChartResponseSerializer},
        tags=['Charting'],
        summary='Autocharting — generate a structured nursing note (via n8n)',
        description=(
            'Editable request body. Sends the nurse’s raw assessment plus the patient’s '
            'demographics to the n8n **structure-chart** workflow, and returns the generated '
            'narrative note alongside the section-by-section structure the app renders. '
            'vitalSigns in the response is extracted from the assessment text alone (or the '
            'request’s own `vitalSigns`, if supplied as a manual override) — never defaulted '
            'from the patient’s stored record; any vital not documented comes back null.\n\n'
            'Set `save: true` to persist the result as a ChartingNote with `aiGenerated: true`. '
            'Returns 503 when the workflow is not listening.'
        ),
        examples=STRUCTURE_CHART_EXAMPLES,
    )
    @action(detail=False, methods=['post'])
    def structure(self, request):
        serializer = StructureChartSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        patient = Patient.objects.filter(patient_code=data['patientId']).first()
        if patient is None:
            return Response(
                {'detail': f'Patient "{data["patientId"]}" not found.'},
                status=status.HTTP_404_NOT_FOUND,
            )
        _check_patient_care_scope(request, patient, 'chart notes')

        nurse_name = full_name(request.user)
        now = timezone.now()

        # Vitals for THIS note must come from what the nurse actually typed in
        # the assessment, not from Patient's stored snapshot — that snapshot
        # can be stale, unrelated to this encounter, or simply 0/'' for a
        # patient whose vitals were never charted, and silently seeding it
        # here previously meant the workflow's own extraction from the
        # assessment text was always thrown away and replaced by it (see the
        # unconditional `structured['vitalSigns'] = vitals` this used to be,
        # below). A caller MAY still pass an explicit vitalSigns object — a
        # real structured-form override, not a guess — which takes priority
        # per field over whatever the workflow extracts from the text.
        caller_vitals = data.get('vitalSigns') or {}

        nurse_assessment = (data.get('assessment') or '').strip()
        payload = {
            'patient': {
                'id': patient.patient_code,
                'name': patient.name,
                'age': patient.age,
                'gender': patient.gender,
                'room': patient.room,
                'diagnosis': patient.diagnosis,
                'riskLevel': patient.risk_level,
                'attendingPhysician': patient.attending_physician,
                'heightCm': float(patient.height_cm) if patient.height_cm is not None else None,
                'weightKg': float(patient.weight_kg) if patient.weight_kg is not None else None,
                'bmi': patient.bmi,
                'allergies': patient.allergies or [],
                'medications': patient.medications or [],
                'alerts': patient.alerts or [],
                # Kardex Laboratories/Medication Intake context — pending
                # labs and currently-active medication orders only, so the
                # AI sees what's outstanding without being handed a full
                # done/cancelled/discontinued history it has no use for.
                'pendingLabs': [
                    {'testName': lab.test_name, 'dateOrdered': lab.date_ordered.isoformat()}
                    for lab in patient.laboratories.filter(status='pending')
                ],
                'activeMedications': [
                    {
                        'medicationName': med.medication_name,
                        'dose': med.dose,
                        'route': med.route,
                        'frequency': med.frequency,
                        'lastGiven': (
                            (med.last_intake.administered_at or med.last_intake.scheduled_time).isoformat()
                            if med.last_intake else None
                        ),
                    }
                    for med in patient.medication_orders.filter(is_active=True)
                ],
            },
            # Sent only as a manual override hint when the caller actually
            # supplied one — never the patient's stored snapshot.
            'vitalSigns': caller_vitals or None,
            'assessment': nurse_assessment,
            'interventions': data.get('interventions') or [],
            'patientResponse': data.get('patientResponse') or '',
            'noteType': data.get('noteType') or 'progress',
            'shift': data.get('shift') or '',
            'nurseName': nurse_name,
            'timestamp': now.isoformat(),
            # Explicit contract for the workflow: never invent clinical facts.
            'instructions': (
                'Structure a nursing progress note using ONLY (1) the nurse assessment '
                'text, (2) the patient demographics/allergies/medications/alerts/pendingLabs/'
                'activeMedications provided, and (3) the vitalSigns manual override, if one was provided (otherwise none '
                'was, and vitals must come from (1) alone). Do not invent symptoms, '
                'diagnoses, medications, interventions, vital signs, or observations that are '
                'not present in those inputs.\n\n'
                'For vitalSigns specifically: extract heartRate, bloodPressure, temperature, '
                'oxygenSaturation, and respiratoryRate ONLY from values the nurse explicitly '
                'documented in the assessment text (or the manual override, if provided). Do '
                'not substitute a default, placeholder, or estimated value, and do not reuse a '
                'vital sign from a different note or from the patient\'s general record. If a '
                'specific vital sign is not documented, leave that field null in your response '
                '— never return 0 or an empty string as a stand-in for "not documented".\n\n'
                'If a section has no supporting input, omit it or leave it empty.'
            ),
        }

        # Identifier + duration only. The payload carries clinical detail and
        # the response carries the generated note, so neither is logged.
        logger.info(
            'autochart start patient=%s nurse=%s noteType=%s',
            patient.patient_code, request.user.pk, payload['noteType'],
        )
        started = time.monotonic()

        try:
            result = call_workflow('structure_chart', payload)
        except N8nError as exc:
            logger.warning(
                'autochart n8n failed patient=%s type=%s status=%s after=%.2fs: %s',
                patient.patient_code, type(exc).__name__, exc.http_status,
                time.monotonic() - started, exc,
            )
            return Response(error_response_body(exc), status=exc.http_status)
        except Exception:
            # Anything unexpected in the AI step must not cost the nurse their
            # note: log it and fall through to the local fallback below
            # (organises the nurse's own text, flagged for review).
            logger.exception('autochart unexpected error patient=%s', patient.patient_code)
            result = {}

        logger.info(
            'autochart n8n ok patient=%s in %.2fs',
            patient.patient_code, time.monotonic() - started,
        )

        if not isinstance(result, dict):
            result = {}

        note_text = _as_text(
            result.get('note')
            or result.get('text')
            or result.get('content')
            or result.get('output')
            or ''
        ).strip()
        structured = result.get('structured') or result.get('sections') or {}
        if not isinstance(structured, dict):
            structured = {}
        # Normalise the workflow's shapes before anything reads them.
        for key in _CHART_TEXT_FIELDS:
            if key in structured:
                structured[key] = _as_text(structured[key])
        interventions = structured.get('interventions')
        if interventions is not None:
            if not isinstance(interventions, (list, tuple)):
                interventions = [interventions]
            structured['interventions'] = [
                text for text in (_as_text(item).strip() for item in interventions) if text
            ]

        # The workflow sometimes answers 200 with nothing usable (seen live:
        # {"title": "Empty Chart", "summary": "No data was provided...",
        # "data": []}). Failing the nurse's charting on that is worse than
        # useless, so fall back to organising their own text by its section
        # headings — see api/chart_fallback.py. Nothing is invented; the
        # response says plainly that the AI step did not run.
        used_fallback = False
        if not note_text and not structured:
            logger.warning(
                'autochart unusable workflow response patient=%s keys=%s; using local fallback',
                patient.patient_code, sorted(result.keys()) if result else '(empty body)',
            )
            structured = structure_from_assessment(nurse_assessment)
            used_fallback = True

        # Authoritative patient context wins over anything the workflow invents
        # for identity/demographic fields. Assessment keeps the nurse's typed
        # text when the workflow omits it.
        structured['patientName'] = patient.name
        structured['patientId'] = patient.patient_code
        structured['room'] = patient.room
        structured['attendingPhysician'] = patient.attending_physician
        structured['nurseName'] = nurse_name
        # vitalSigns is the one field that is NOT patient-record-authoritative
        # — it must reflect only what this specific note documents. Per
        # field, in priority order: (1) the caller's manual override, (2)
        # this backend's own deterministic extraction straight from the
        # nurse's assessment text — the primary source, since the n8n
        # workflow's own LLM node does not reliably return a structured
        # vitalSigns object at all (confirmed live: it turns "HR 110, BP
        # 160/100" etc. into prose, not a parsed field — see
        # vitals_extraction.py), (3) whatever the workflow itself returned,
        # as a last-resort fallback in case it ever does supply something
        # useful the regex missed. Anything none of the three supplies stays
        # null (never 0/''), i.e. genuinely not documented in this note.
        text_extracted_vitals = extract_vitals_from_text(nurse_assessment)
        workflow_vitals = structured.get('vitalSigns')
        if not isinstance(workflow_vitals, dict):
            workflow_vitals = {}
        structured['vitalSigns'] = {
            key: (
                _documented_vital(caller_vitals.get(key))
                if caller_vitals.get(key) is not None
                else _documented_vital(text_extracted_vitals.get(key))
                if text_extracted_vitals.get(key) is not None
                else _documented_vital(workflow_vitals.get(key))
            )
            for key in ('heartRate', 'bloodPressure', 'temperature', 'oxygenSaturation', 'respiratoryRate')
        }
        structured['timestamp'] = now.isoformat()
        structured['diagnosis'] = patient.diagnosis
        structured['riskLevel'] = patient.risk_level
        if patient.allergies:
            structured['allergies'] = (
                ', '.join(patient.allergies)
                if isinstance(patient.allergies, list)
                else str(patient.allergies)
            )
        if patient.medications:
            structured['medications'] = (
                ', '.join(patient.medications)
                if isinstance(patient.medications, list)
                else str(patient.medications)
            )
        if patient.alerts:
            structured['alerts'] = (
                '; '.join(patient.alerts)
                if isinstance(patient.alerts, list)
                else str(patient.alerts)
            )
        # Preserve the nurse's exact assessment input for audit / display fidelity.
        structured['sourceAssessment'] = nurse_assessment
        if not (structured.get('assessment') or '').strip():
            structured['assessment'] = nurse_assessment
        # Only keep interventions the nurse supplied or the workflow returned —
        # never inject stock phrases here.
        if not isinstance(structured.get('interventions'), list):
            structured['interventions'] = list(data.get('interventions') or [])
        # Drop empty clinical narrative fields rather than inventing placeholders.
        for key in ('patientResponse', 'clinicalSummary', 'plan'):
            if key in structured and not str(structured.get(key) or '').strip():
                structured[key] = ''

        saved_id = ''
        # A fallback note is never auto-saved: the AI step did not run, so the
        # nurse must look at it before it becomes part of the chart.
        if data.get('save') and not used_fallback:
            # Persist structured alongside narrative so View Full Note can
            # rehydrate the exact approved chart (no empty template / no invention).
            note_serializer = ChartingNoteSerializer(
                data={
                    'patientId': patient.patient_code,
                    'timestamp': now.isoformat(),
                    'type': data.get('noteType') or 'progress',
                    'content': note_text,
                    'structured': structured,
                    'aiGenerated': True,
                },
                context={'request': request},
            )
            note_serializer.is_valid(raise_exception=True)
            saved_id = note_serializer.save().note_code

        return Response(
            {
                'success': True,
                'note': note_text,
                'structured': structured,
                'aiGenerated': not used_fallback,
                'fallback': used_fallback,
                'warning': (
                    'The AI charting workflow returned no note, so this note was organised '
                    'from your own text. Review it before approving.'
                    if used_fallback else ''
                ),
                'saved': bool(saved_id),
                'noteId': saved_id,
            }
        )


class VitalSignsViewSet(viewsets.ModelViewSet):
    """
    Timestamped vitals history for a patient — one row per reading rather
    than the single mutable snapshot on Patient. No destroy: a charted
    reading is never deleted, only corrected in place (PATCH) with an audit
    trail (see VitalSigns.edited/edit_history) or superseded by a newer one.

    `latest` is what the auto-charting prompt on a flagged ChartingNote
    pre-fills its quick-entry form from — the "previous values" the nurse
    confirms or adjusts rather than starting blank.
    """

    serializer_class = VitalSignsSerializer
    permission_classes = [permissions.IsAuthenticated, IsApprovedNurseOrAdminReadOnly]
    http_method_names = ['get', 'post', 'patch', 'head', 'options']

    def perform_create(self, serializer):
        # Same rule as labs and medications: only for patients assigned to you (head nurse: any).
        _check_patient_care_scope(self.request, serializer.validated_data.get('patient'), 'record vitals')
        serializer.save()

    def perform_update(self, serializer):
        # Same scope rule as creating one — correcting a reading is still
        # recording vitals for that patient.
        _check_patient_care_scope(self.request, serializer.instance.patient, 'edit vitals')
        serializer.save()

    def get_queryset(self):
        qs = VitalSigns.objects.select_related('patient', 'recorded_by', 'triggered_by_note', 'task').all()
        params = self.request.query_params
        patient_id = params.get('patientId')
        if patient_id:
            qs = qs.filter(patient__patient_code=patient_id)
        task_id = params.get('taskId')
        if task_id:
            qs = qs.filter(task__task_code=task_id)
        source = params.get('source')
        if source:
            qs = qs.filter(source=source)
        return qs

    @extend_schema(
        responses={200: VitalSignsSerializer},
        summary='Most recent vitals for a patient — the auto-charting baseline',
        description=(
            'Requires `patientId`. Returns `{hasPriorVitals, baseline}` — baseline is the most '
            'recent VitalSigns row for this patient, or (when none exists yet) a fallback built '
            'from Patient\'s own current heart_rate/etc. fields if those were ever set, so a '
            'brand-new patient with no vitals history at all gets `hasPriorVitals: false` and '
            'the quick-entry form opens blank as a fresh entry rather than a stale "update".'
        ),
    )
    @action(detail=False, methods=['get'])
    def latest(self, request):
        patient_id = request.query_params.get('patientId')
        if not patient_id:
            return Response({'detail': 'patientId is required.'}, status=status.HTTP_400_BAD_REQUEST)
        patient = Patient.objects.filter(patient_code=patient_id).first()
        if patient is None:
            return Response({'detail': 'Patient not found.'}, status=status.HTTP_404_NOT_FOUND)

        latest = VitalSigns.objects.filter(patient=patient).order_by('-recorded_at').first()
        if latest is not None:
            return Response(
                {
                    'hasPriorVitals': True,
                    'baseline': VitalSignsSerializer(latest, context={'request': request}).data,
                }
            )

        has_snapshot = any(
            [
                patient.heart_rate, patient.blood_pressure, patient.temperature,
                patient.oxygen_saturation, patient.respiratory_rate,
            ]
        )
        return Response(
            {
                'hasPriorVitals': has_snapshot,
                'baseline': {
                    'heartRate': patient.heart_rate or None,
                    'bloodPressure': patient.blood_pressure or '',
                    'temperature': patient.temperature or None,
                    'oxygenSaturation': patient.oxygen_saturation or None,
                    'respiratoryRate': patient.respiratory_rate or None,
                    'painScale': None,
                } if has_snapshot else None,
            }
        )


@extend_schema_view(
    create=extend_schema(
        summary='Create a notification',
        description='Editable request body. Title and message are set server-side.',
        examples=NOTIFICATION_CREATE_EXAMPLES,
    ),
    partial_update=extend_schema(
        summary='Mark a notification read or unread',
        description='Editable request body. Only `isRead` is acted on.',
        examples=NOTIFICATION_UPDATE_EXAMPLES,
    ),
)
class NotificationViewSet(viewsets.ModelViewSet):
    serializer_class = NotificationSerializer
    # Full access, not read-only — see IsApprovedNurseOrAdmin: this inbox is
    # already scoped to the requesting user by get_queryset() below, so an
    # admin marking/deleting their own notification never touches anyone
    # else's data.
    permission_classes = [permissions.IsAuthenticated, IsApprovedNurseOrAdmin]
    http_method_names = ['get', 'patch', 'delete', 'post', 'head', 'options']

    def get_queryset(self):
        # Strictly the signed-in nurse's own inbox: a handover names one
        # patient and one recipient, and must never reach anyone else.
        return Notification.objects.filter(recipient=self.request.user).select_related(
            'patient', 'handover', 'sender'
        )

    def list(self, request, *args, **kwargs):
        queryset = self.get_queryset()
        serializer = self.get_serializer(queryset, many=True)
        unread = queryset.filter(is_read=False).count()
        return Response({'results': serializer.data, 'unreadCount': unread})

    def partial_update(self, request, *args, **kwargs):
        notification = self.get_object()
        if 'isRead' in request.data:
            notification.is_read = bool(request.data.get('isRead'))
            notification.save(update_fields=['is_read'])
        return Response(self.get_serializer(notification).data)

    @extend_schema(
        request=None,
        responses={200: inline_serializer(name='MarkAllRead', fields={'detail': serializers.CharField()})},
        summary='Mark every notification read',
        description='No request body — acts on the whole inbox of the authenticated nurse.',
    )
    @action(detail=False, methods=['post'])
    def mark_all_read(self, request):
        updated = self.get_queryset().filter(is_read=False).update(is_read=True)
        return Response({'detail': f'Marked {updated} notifications as read.'})

    @extend_schema(
        request=None,
        responses={200: NotificationSerializer},
        summary='Mark one notification read',
        description='No request body — the notification is identified by the URL.',
    )
    @action(detail=True, methods=['post'])
    def mark_read(self, request, pk=None):
        notification = self.get_object()
        notification.is_read = True
        notification.save(update_fields=['is_read'])
        return Response(self.get_serializer(notification).data)


@extend_schema_view(
    create=extend_schema(
        summary='Assign a patient to a nurse',
        description='Editable request body. Head nurse only.',
        examples=ASSIGNMENT_CREATE_EXAMPLES,
    ),
    update=extend_schema(
        summary='Replace an assignment',
        description='Editable request body. Head nurse only.',
        examples=ASSIGNMENT_UPDATE_EXAMPLES,
    ),
    partial_update=extend_schema(
        summary='Update part of an assignment',
        description='Editable request body. Head nurse only.',
        examples=ASSIGNMENT_UPDATE_EXAMPLES,
    ),
)
class AssignmentViewSet(viewsets.ModelViewSet):
    serializer_class = PatientAssignmentSerializer
    permission_classes = [permissions.IsAuthenticated, IsApprovedNurseOrAdminReadOnly]

    def get_queryset(self):
        qs = PatientAssignment.objects.select_related(
            'patient', 'assigned_nurse', 'assigned_by'
        ).all()
        status_filter = self.request.query_params.get('status', 'active')
        nurse_id = self.request.query_params.get('nurseId')
        patient_id = self.request.query_params.get('patientId')
        if status_filter and status_filter != 'all':
            qs = qs.filter(status=status_filter)
        if nurse_id:
            qs = qs.filter(assigned_nurse_id=nurse_id)
        if patient_id:
            # Every nurse who has ever been assigned this patient — the
            # "who handles this patient" history view, so status defaults
            # to 'active' above are irrelevant here; the caller passes
            # status=all to actually get the full history.
            qs = qs.filter(patient__patient_code=patient_id)
        return qs.order_by('-assigned_at')

    def get_permissions(self):
        if self.action in ('create', 'update', 'partial_update', 'destroy'):
            return [permissions.IsAuthenticated(), IsSupervisor()]
        return super().get_permissions()


class DutyAssignmentViewSet(viewsets.ModelViewSet):
    """
    The duty roster. A head nurse sees and manages every assignment; a
    staff nurse can only read their own — scoped here server-side, not by
    the frontend choosing what to ask for, so a nurse can't see (or infer)
    another nurse's schedule by passing a different nurseId. Only a
    head nurse can create, edit, or delete an entry.
    """

    serializer_class = DutyAssignmentSerializer
    permission_classes = [permissions.IsAuthenticated, IsApprovedNurseOrAdminReadOnly]

    def get_queryset(self):
        qs = DutyAssignment.objects.select_related(
            'nurse', 'department', 'created_by', 'actual_end_recorded_by'
        ).all()
        params = self.request.query_params
        date_param = params.get('date')
        date_from = params.get('dateFrom')
        date_to = params.get('dateTo')
        shift = params.get('shift')
        department_id = params.get('departmentId')
        status_filter = params.get('status')
        nurse_id = params.get('nurseId')
        search = params.get('search')

        if date_param:
            qs = qs.filter(duty_date=parse_user_date(date_param, 'date'))
        if date_from:
            qs = qs.filter(duty_date__gte=parse_user_date(date_from, 'dateFrom'))
        if date_to:
            qs = qs.filter(duty_date__lte=parse_user_date(date_to, 'dateTo'))
        if shift:
            qs = qs.filter(shift=shift)
        if department_id:
            qs = qs.filter(department_id=department_id)
        if status_filter:
            qs = qs.filter(status=status_filter)
        if search:
            qs = qs.filter(
                Q(nurse__first_name__icontains=search)
                | Q(nurse__last_name__icontains=search)
                | Q(nurse__username__icontains=search)
                | Q(department__name__icontains=search)
            )

        if get_user_role(self.request.user) == 'staff_nurse':
            # Authoritative regardless of what nurseId (if any) was requested.
            return qs.filter(nurse=self.request.user)
        if nurse_id:
            qs = qs.filter(nurse_id=nurse_id)
        return qs

    def get_permissions(self):
        if self.action in ('create', 'update', 'partial_update', 'destroy', 'close'):
            return [permissions.IsAuthenticated(), IsSupervisor()]
        return super().get_permissions()

    def perform_destroy(self, instance):
        # Deletes the real row — the roster must reflect the actual database,
        # not a soft-hidden record the API keeps returning under a filter.
        instance.delete()

    def _sync_nurse_profile(self, assignment):
        """
        NurseProfile.department/shift (the nurse's persistent ward and shift,
        shown on the Workload "Team" tab and on the nurse's own profile) and
        DutyAssignment.department/shift (this one roster entry) used to be
        completely independent fields — nothing ever kept them in sync, so a
        head nurse scheduling a nurse here had no effect on the nurse's
        actual recorded department/shift until someone separately went to
        Workload and used "Assign" to update it by hand, and the two could
        silently drift apart. The duty roster is the real, day-to-day source
        of truth for where and when a nurse is actually working, so creating
        or editing an assignment now updates both directly. (An earlier pass
        at this fix only synced department, not shift — same bug, just the
        other field.)
        """
        profile = getattr(assignment.nurse, 'nurse_profile', None)
        if not profile:
            return
        changed = []
        if profile.department != assignment.department.name:
            profile.department = assignment.department.name
            changed.append('department')
        if profile.shift != assignment.shift:
            profile.shift = assignment.shift
            changed.append('shift')
        if changed:
            profile.save(update_fields=changed)

    def perform_create(self, serializer):
        assignment = serializer.save()
        self._sync_nurse_profile(assignment)
        # Only while the shift is still a live, upcoming one to act on — a
        # head nurse backfilling a past/completed duty (seeding history,
        # correcting a record) must not page the nurse about something
        # already over.
        if assignment.status not in ('completed', 'cancelled'):
            notify_duty_assigned(assignment, self.request.user)

    def perform_update(self, serializer):
        previous_status = serializer.instance.status
        previous_schedule = (
            serializer.instance.department_id, serializer.instance.shift, serializer.instance.duty_date,
        )
        assignment = serializer.save()
        self._sync_nurse_profile(assignment)

        schedule_changed = previous_schedule != (
            assignment.department_id, assignment.shift, assignment.duty_date,
        )
        if (
            schedule_changed
            and assignment.status not in ('completed', 'cancelled')
        ):
            notify_duty_assigned(assignment, self.request.user)

        # A head nurse can also mark a shift Completed from the roster's
        # plain edit form (Status dropdown), not just via /close/. Without
        # this, that path left actual_end_time null and skipped the
        # notification entirely — the nurse's own device had no way to
        # learn the shift had ended, on refresh or otherwise, because
        # my-duty.tsx derives "still on shift" from actual_start_time/
        # actual_end_time, not status. Mirror /close/'s own preconditions
        # (must have actually started, must not already have an end time)
        # so this can't fabricate a start/end time for a shift nobody
        # clocked into.
        if (
            assignment.status == 'completed'
            and previous_status != 'completed'
            and assignment.actual_start_time is not None
            and assignment.actual_end_time is None
        ):
            assignment.actual_end_time = timezone.now()
            assignment.actual_end_recorded_by = self.request.user
            assignment.save(
                update_fields=[
                    'actual_end_time', 'actual_end_recorded_by',
                    'actual_worked_hours', 'actual_overtime_hours',
                ]
            )
            notify(
                assignment.nurse,
                notification_type='info',
                event='duty_closed_by_head_nurse',
                title='Your shift was closed out',
                message=(
                    f'{full_name(self.request.user)} '
                    f'marked your {assignment.get_shift_display()} shift at '
                    f'{assignment.department.name} as completed. Contact them if the recorded '
                    'time looks wrong.'
                ),
            )

    @extend_schema(
        request=None,
        responses={200: DutyAssignmentSerializer},
        summary='Clock in — record the real start of this shift',
        description=(
            'No request body — the assignment is identified by the URL. Only the assigned '
            'nurse may call this, on their own assignment, for today (or a still-open shift '
            'from yesterday, for a night shift that crosses midnight). Rejected if already '
            'started, or if it is more than DUTY_START_BUFFER_MINUTES before the scheduled '
            'start.'
        ),
    )
    @action(detail=True, methods=['post'])
    def start(self, request, pk=None):
        assignment = self.get_object()
        if assignment.nurse_id != request.user.pk:
            return Response(
                {'detail': 'You can only start your own duty assignment.'},
                status=status.HTTP_403_FORBIDDEN,
            )
        # "Today" here must be the facility's local calendar day, not
        # Django's TIME_ZONE (UTC) — timezone.localdate() would reject a
        # valid same-day shift for hours near local midnight, since duty_date
        # is a local-wall-clock value while the server's own clock runs UTC.
        local_today = timezone.now().astimezone(ZoneInfo(settings.DUTY_LOCAL_TIMEZONE)).date()
        if assignment.duty_date not in (local_today, local_today - timedelta(days=1)):
            return Response(
                {'detail': 'This assignment is not for today — it cannot be started now.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if assignment.actual_start_time is not None:
            return Response(
                {'detail': 'This shift has already been started.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        now = timezone.now()
        scheduled_start = assignment.scheduled_start_datetime()
        buffer_minutes = getattr(settings, 'DUTY_START_BUFFER_MINUTES', 15)
        earliest = scheduled_start - timedelta(minutes=buffer_minutes)
        if now < earliest:
            return Response(
                {
                    'detail': (
                        f'Too early to start this shift — it can be started starting '
                        f'{buffer_minutes} minutes before {scheduled_start.strftime("%I:%M %p")}.'
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        assignment.actual_start_time = now
        assignment.save(update_fields=['actual_start_time', 'actual_worked_hours', 'actual_overtime_hours'])

        # A nurse arriving noticeably late is exactly the kind of thing a
        # head nurse watching the roster would otherwise have to notice
        # themselves — scheduled and actual both stay on the record either
        # way, this is only about telling someone sooner.
        if assignment.created_by and now > scheduled_start + timedelta(minutes=buffer_minutes):
            notify(
                assignment.created_by,
                notification_type='warning',
                event='duty_started_late',
                title='Nurse started shift late',
                message=(
                    f'{full_name(assignment.nurse)} '
                    f'started their {assignment.get_shift_display()} shift at '
                    f'{assignment.department.name} at '
                    f'{now.astimezone(ZoneInfo(settings.DUTY_LOCAL_TIMEZONE)).strftime("%I:%M %p")}, '
                    f'after the {scheduled_start.strftime("%I:%M %p")} scheduled start.'
                ),
            )

        return Response(DutyAssignmentSerializer(assignment, context={'request': request}).data)

    @extend_schema(
        request=None,
        responses={200: DutyAssignmentSerializer},
        summary='Clock out — record the real end of this shift',
        description=(
            'No request body — the assignment is identified by the URL. Only the assigned '
            'nurse may call this, and only after start has been recorded. actual_worked_hours '
            'and actual_overtime_hours are computed and frozen here — the same wrap-aware '
            'reasoning DutyAssignment.duration_hours uses for the scheduled hours, applied to '
            'real timestamps instead of bare times.'
        ),
    )
    @action(detail=True, methods=['post'])
    def end(self, request, pk=None):
        assignment = self.get_object()
        if assignment.nurse_id != request.user.pk:
            return Response(
                {'detail': 'You can only end your own duty assignment.'},
                status=status.HTTP_403_FORBIDDEN,
            )
        if assignment.actual_start_time is None:
            return Response(
                {'detail': 'This shift has not been started yet.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if assignment.actual_end_time is not None:
            return Response(
                {'detail': 'This shift has already been ended.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        assignment.actual_end_time = timezone.now()
        if assignment.status != 'cancelled':
            assignment.status = 'completed'
        assignment.save(
            update_fields=[
                'actual_end_time', 'status', 'actual_worked_hours', 'actual_overtime_hours',
            ]
        )

        if assignment.created_by and assignment.actual_overtime_hours > 0:
            notify(
                assignment.created_by,
                notification_type='warning',
                event='duty_overtime_recorded',
                title='Nurse worked overtime',
                message=(
                    f'{full_name(assignment.nurse)} '
                    f'worked {assignment.actual_overtime_hours}h of overtime on their '
                    f'{assignment.get_shift_display()} shift at {assignment.department.name}.'
                ),
            )

        return Response(DutyAssignmentSerializer(assignment, context={'request': request}).data)

    @extend_schema(
        request=None,
        responses={200: DutyAssignmentSerializer},
        summary='Head nurse correction — close out a shift the nurse never ended',
        description=(
            'No request body — the end time is recorded as now. Head-nurse-only. For when a '
            'nurse forgot to tap End Shift: the assignment must already have actual_start_time '
            'set and no actual_end_time yet. Unlike the nurse\'s own end action, this stamps '
            'actual_end_recorded_by so the record is never indistinguishable from a real '
            'self-reported clock-out.'
        ),
    )
    @action(detail=True, methods=['post'])
    def close(self, request, pk=None):
        assignment = self.get_object()
        if assignment.actual_start_time is None:
            return Response(
                {'detail': 'This shift was never started — there is nothing to close out.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if assignment.actual_end_time is not None:
            return Response(
                {'detail': 'This shift has already been ended.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        assignment.actual_end_time = timezone.now()
        assignment.actual_end_recorded_by = request.user
        if assignment.status != 'cancelled':
            assignment.status = 'completed'
        assignment.save(
            update_fields=[
                'actual_end_time', 'actual_end_recorded_by', 'status',
                'actual_worked_hours', 'actual_overtime_hours',
            ]
        )

        notify(
            assignment.nurse,
            notification_type='info',
            event='duty_closed_by_head_nurse',
            title='Your shift was closed out',
            message=(
                f'{full_name(request.user)} closed out your '
                f'{assignment.get_shift_display()} shift at {assignment.department.name} on your behalf, '
                'since it was not ended. Contact them if the recorded time looks wrong.'
            ),
        )

        return Response(DutyAssignmentSerializer(assignment, context={'request': request}).data)


@extend_schema_view(
    create=extend_schema(
        summary='Save a kardex card',
        description='Editable request body. All clinical values are free text, matching the paper kardex.',
        examples=KARDEX_CREATE_EXAMPLES,
    ),
)
class KardexViewSet(viewsets.ModelViewSet):
    serializer_class = KardexRecordSerializer
    permission_classes = [permissions.IsAuthenticated, IsApprovedNurseOrAdminReadOnly]
    http_method_names = ['get', 'post', 'delete', 'head', 'options']

    def get_queryset(self):
        qs = KardexRecord.objects.select_related('patient', 'saved_by', 'reviewed_by').all()
        status_filter = self.request.query_params.get('status')
        if status_filter:
            qs = qs.filter(status=status_filter)
        return qs

    def get_permissions(self):
        if self.action == 'review':
            return [permissions.IsAuthenticated(), IsSupervisor()]
        return super().get_permissions()

    def perform_create(self, serializer):
        # KardexRecordSerializer.create() writes straight onto an existing
        # Patient's demographic/vitals fields when patientId names one — the
        # same fields PatientViewSet.update() restricts to the assigned
        # nurse (or a head nurse). Without this check, any approved nurse
        # could overwrite another patient's data through this endpoint
        # instead, bypassing that restriction entirely.
        patient_id = serializer.validated_data.get('patientId')
        if patient_id:
            patient = Patient.objects.filter(patient_code=patient_id).first()
            _check_patient_care_scope(self.request, patient, 'save a kardex')
        serializer.save()

    def perform_destroy(self, instance):
        # Matches KardexLaboratoryViewSet/KardexMedicationViewSet: deleting
        # clinical history is head-nurse-only, not "any approved nurse" —
        # this was the one Kardex-family viewset missing that restriction.
        if get_user_role(self.request.user) != 'head_nurse':
            raise PermissionDenied('Only a head nurse can delete a kardex record.')
        instance.delete()

    @extend_schema(
        request=inline_serializer(
            name='KardexReviewRequest',
            fields={
                'decision': serializers.ChoiceField(choices=['approved', 'returned', 'rejected']),
                'notes': serializers.CharField(
                    required=False, allow_blank=True,
                    help_text='Reason for a return or rejection. Ignored for an approval.',
                ),
            },
        ),
        responses={200: KardexRecordSerializer},
        summary='Approve, return, or reject a kardex',
        description=(
            'Head nurse only. A returned/rejected kardex is corrected by the nurse saving a '
            'new kardex for the same patient — there is no edit-in-place endpoint.'
        ),
    )
    @action(detail=True, methods=['post'])
    def review(self, request, pk=None):
        kardex = self.get_object()
        decision = (request.data.get('decision') or '').strip()
        if decision not in ('approved', 'returned', 'rejected'):
            return Response(
                {'detail': 'decision must be one of: approved, returned, rejected.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if kardex.status != 'submitted':
            return Response(
                {'detail': f'This kardex is already {kardex.status} and cannot be reviewed again.'},
                status=status.HTTP_409_CONFLICT,
            )

        notes = (request.data.get('notes') or '').strip()
        if decision in ('returned', 'rejected') and not notes:
            return Response(
                {'detail': 'notes is required when returning or rejecting a kardex.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        kardex.status = decision
        kardex.reviewed_by = request.user
        kardex.reviewed_at = timezone.now()
        kardex.review_notes = notes
        kardex.save(update_fields=['status', 'reviewed_by', 'reviewed_at', 'review_notes', 'updated_at'])

        notify_kardex_reviewed(kardex, request.user)

        return Response(KardexRecordSerializer(kardex, context={'request': request}).data)


def _check_patient_care_scope(request, patient, action_noun):
    """
    Same rule PatientViewSet.update()/destroy() already enforce: a staff
    nurse may only act on a patient assigned to them; a head nurse, any
    patient. Shared here so the three Kardex sub-resource viewsets below
    (labs, medications, intakes) don't each re-derive it.
    """
    if patient is None:
        # A charting note may be saved with no patient attached; nothing to scope.
        return
    role = get_user_role(request.user)
    if role != 'head_nurse' and patient.assigned_nurse_id != request.user.id:
        raise PermissionDenied(f'You can only {action_noun} for patients assigned to you.')


class KardexLaboratoryViewSet(viewsets.ModelViewSet):
    """
    Lab orders for a patient's Kardex Laboratories section — see
    KardexLaboratory's docstring for why these hang off Patient rather than
    a single KardexRecord snapshot. Deleting is head-nurse-only; a staff
    nurse cancels a lab instead (status='cancelled' via a normal update).
    """

    serializer_class = KardexLaboratorySerializer
    permission_classes = [permissions.IsAuthenticated, IsApprovedNurseOrAdminReadOnly]

    def get_queryset(self):
        qs = KardexLaboratory.objects.select_related('patient', 'created_by', 'updated_by').ordered_for_display()
        patient_id = self.request.query_params.get('patientId')
        if patient_id:
            qs = qs.filter(patient__patient_code=patient_id)
        return qs

    def perform_create(self, serializer):
        patient = serializer.validated_data.get('patient')
        _check_patient_care_scope(self.request, patient, 'add labs')
        serializer.save()

    def perform_update(self, serializer):
        _check_patient_care_scope(self.request, serializer.instance.patient, 'update labs')
        serializer.save()

    def perform_destroy(self, instance):
        if get_user_role(self.request.user) != 'head_nurse':
            raise PermissionDenied('Only a head nurse can delete a lab entry. Cancel it instead.')
        instance.delete()


class KardexMedicationViewSet(viewsets.ModelViewSet):
    """
    Medication orders for a patient's Kardex Medication Intake section.
    Deleting is head-nurse-only; a staff nurse discontinues a medication
    instead (isActive=false via a normal update) — its intake history is
    unaffected either way.
    """

    serializer_class = KardexMedicationSerializer
    permission_classes = [permissions.IsAuthenticated, IsApprovedNurseOrAdminReadOnly]

    def get_queryset(self):
        qs = (
            KardexMedication.objects.select_related('patient', 'created_by', 'updated_by')
            .prefetch_related('intakes__administered_by')
            .all()
        )
        patient_id = self.request.query_params.get('patientId')
        if patient_id:
            qs = qs.filter(patient__patient_code=patient_id)
        is_active = self.request.query_params.get('isActive')
        if is_active in ('1', 'true', 'True'):
            qs = qs.filter(is_active=True)
        elif is_active in ('0', 'false', 'False'):
            qs = qs.filter(is_active=False)
        return qs

    def perform_create(self, serializer):
        patient = serializer.validated_data.get('patient')
        _check_patient_care_scope(self.request, patient, 'add medications')
        serializer.save()

    def perform_update(self, serializer):
        _check_patient_care_scope(self.request, serializer.instance.patient, 'update medications')
        serializer.save()

    def perform_destroy(self, instance):
        if get_user_role(self.request.user) != 'head_nurse':
            raise PermissionDenied('Only a head nurse can delete a medication order. Discontinue it instead.')
        instance.delete()


class KardexDepartmentVisitViewSet(viewsets.ModelViewSet):
    """
    Required Department Visits for a patient's Kardex — a place the
    patient must go to (Radiology, the Laboratory, Dialysis, PT, OR, a CT
    scan), distinct from KardexLaboratory (one ordered lab test) even
    though the two share the same pending/done/cancelled-shaped pattern.
    Deleting is head-nurse-only; a staff nurse cancels a visit instead
    (status='CANCELLED' via a normal update), same split as labs/meds.
    """

    serializer_class = KardexDepartmentVisitSerializer
    permission_classes = [permissions.IsAuthenticated, IsApprovedNurseOrAdminReadOnly]

    def get_queryset(self):
        qs = KardexDepartmentVisit.objects.select_related(
            'patient', 'department', 'created_by', 'updated_by'
        ).ordered_for_display()
        patient_id = self.request.query_params.get('patientId')
        if patient_id:
            qs = qs.filter(patient__patient_code=patient_id)
        status_filter = self.request.query_params.get('status')
        if status_filter:
            qs = qs.filter(status=status_filter.upper())
        return qs

    def perform_create(self, serializer):
        patient = serializer.validated_data.get('patient')
        _check_patient_care_scope(self.request, patient, 'add department visits')
        serializer.save()

    def perform_update(self, serializer):
        _check_patient_care_scope(self.request, serializer.instance.patient, 'update department visits')
        serializer.save()

    def perform_destroy(self, instance):
        if get_user_role(self.request.user) != 'head_nurse':
            raise PermissionDenied('Only a head nurse can delete a department visit. Cancel it instead.')
        instance.delete()


class MedicationIntakeViewSet(viewsets.ModelViewSet):
    """
    One recorded administration against a KardexMedication order —
    insert-only, like VitalSignsViewSet: a recorded intake is never edited
    or deleted, only superseded by the next one.
    """

    serializer_class = MedicationIntakeSerializer
    permission_classes = [permissions.IsAuthenticated, IsApprovedNurseOrAdminReadOnly]
    http_method_names = ['get', 'post', 'head', 'options']

    def get_queryset(self):
        qs = MedicationIntake.objects.select_related(
            'medication', 'medication__patient', 'administered_by'
        ).all()
        medication_id = self.request.query_params.get('medicationId')
        if medication_id:
            qs = qs.filter(medication_id=medication_id)
        patient_id = self.request.query_params.get('patientId')
        if patient_id:
            qs = qs.filter(medication__patient__patient_code=patient_id)
        return qs

    def perform_create(self, serializer):
        medication = serializer.validated_data.get('medication')
        _check_patient_care_scope(self.request, medication.patient, 'record intakes')
        serializer.save()


class NurseViewSet(viewsets.ViewSet):
    permission_classes = [permissions.IsAuthenticated, IsApprovedNurseOrAdminReadOnly]

    def get_permissions(self):
        # Everyone approved can see the roster (it feeds the handover/task
        # nurse pickers); only a head nurse can move someone to a different
        # department or shift.
        if self.action == 'assign':
            return [permissions.IsAuthenticated(), IsSupervisor()]
        return [permission() for permission in self.permission_classes]

    def list(self, request):
        nurses = (
            # Both call sites (handover's receiving-nurse picker, task
            # assignment) offer this list as "someone else to hand work to" —
            # the signed-in nurse should never appear as a candidate for
            # their own handover or task assignment.
            # A pending/rejected nurse can't even log in (see LoginView), so
            # offering them as a handover or task recipient is a dead end.
            User.objects.filter(
                nurse_profile__role='staff_nurse',
                nurse_profile__is_active_staff=True,
                nurse_profile__approval_status='approved',
            )
            .exclude(pk=request.user.pk)
            .select_related('nurse_profile')
            .annotate(
                patient_count=Count(
                    'assigned_patients', distinct=True
                ),
                task_count=Count('tasks', distinct=True),
                completed_tasks=Count(
                    'tasks', filter=Q(tasks__status='completed'), distinct=True
                ),
            )
            .order_by('first_name', 'last_name')
        )
        search = request.query_params.get('search')
        if search:
            nurses = nurses.filter(
                Q(first_name__icontains=search)
                | Q(nurse_profile__middle_name__icontains=search)
                | Q(last_name__icontains=search)
                | Q(username__icontains=search)
                | Q(email__icontains=search)
            )
        # Handover nurse picker: a nurse who already received this patient
        # (any status — see HandoverSerializer.create) must not be offered
        # again for the same patient.
        exclude_for_patient = request.query_params.get('excludeForPatient')
        if exclude_for_patient:
            patient = Patient.objects.filter(patient_code=exclude_for_patient).first()
            if patient is not None:
                nurses = nurses.exclude(handovers_received__patient=patient)

        # Handover's Shift field: only offer nurses actually on the Duty
        # Roster for that shift/date, not a static profile default. Resolved
        # as a `pk__in` subquery of distinct nurse ids rather than joining
        # DutyAssignment onto `nurses` directly — a nurse can have more than
        # one roster entry the same day, and a direct join would fan that out
        # into one duplicate row per extra entry instead of one row per nurse.
        shift = request.query_params.get('shift')
        if shift:
            date_param = request.query_params.get('date')
            duty_date = parse_user_date(date_param, 'date') if date_param else timezone.now().astimezone(
                ZoneInfo(settings.DUTY_LOCAL_TIMEZONE)
            ).date()
            scheduled_nurse_ids = (
                DutyAssignment.objects.filter(duty_date=duty_date, shift=shift)
                .exclude(status='cancelled')
                .values_list('nurse_id', flat=True)
                .distinct()
            )
            nurses = nurses.filter(pk__in=scheduled_nurse_ids)

        nurses = list(nurses)
        duties = current_duties(n.pk for n in nurses)
        overtime_by_nurse = today_overtime_hours(n.pk for n in nurses)
        results = []
        for nurse in nurses:
            profile = nurse.nurse_profile
            duty = duties.get(nurse.pk)
            # No duty on the roster -> no shift shown (the old profile default
            # made every unscheduled nurse look like a morning-shift nurse).
            duty_shift, department = duty_fields(profile, duty)
            overtime_hours = overtime_by_nurse.get(nurse.pk, 0.0)
            presence, last_seen_at = presence_fields(profile)
            results.append(
                {
                    'id': str(nurse.pk),
                    'name': full_name(nurse),
                    'role': profile.clinical_role or 'RN',
                    'shift': duty_shift,
                    'hasDuty': duty is not None,
                    'dutyDate': duty.duty_date.isoformat() if duty else None,
                    'specialization': profile.specialization or '',
                    'email': nurse.email,
                    'department': department,
                    'overtimeHours': overtime_hours,
                    'patientCount': nurse.patient_count,
                    'taskCount': nurse.task_count,
                    'completedTasks': nurse.completed_tasks,
                    'presence': presence,
                    'lastSeenAt': last_seen_at,
                }
            )
        return Response([filter_nurse_fields(row, request.user) for row in results])

    def retrieve(self, request, pk=None):
        try:
            nurse = User.objects.select_related('nurse_profile').get(pk=pk)
        except User.DoesNotExist:
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
        profile = getattr(nurse, 'nurse_profile', None)
        duty = current_duties([nurse.pk]).get(nurse.pk)
        duty_shift, department = duty_fields(profile, duty)
        presence, last_seen_at = presence_fields(profile)
        return Response(
            filter_nurse_fields(
                {
                    'id': str(nurse.pk),
                    'name': full_name(nurse),
                    'role': profile.clinical_role if profile else 'RN',
                    'shift': duty_shift,
                    'hasDuty': duty is not None,
                    'specialization': profile.specialization if profile else '',
                    'email': nurse.email,
                    'department': department,
                    'presence': presence,
                    'lastSeenAt': last_seen_at,
                },
                request.user,
            )
        )

    @extend_schema(
        request=NurseAssignmentSerializer,
        responses={200: inline_serializer(
            name='NurseAssignmentResponse',
            fields={
                'id': serializers.CharField(),
                'name': serializers.CharField(),
                'department': serializers.CharField(),
                'shift': serializers.CharField(),
            },
        )},
        tags=['Nurses'],
        summary='Assign department/shift (head nurse only)',
        description='Editable request body. Send department, shift, or both.',
    )
    @action(detail=True, methods=['patch'])
    def assign(self, request, pk=None):
        nurse = get_object_or_404(User, pk=pk, nurse_profile__role='staff_nurse')
        profile = nurse.nurse_profile
        serializer = NurseAssignmentSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        changed_department = 'department' in data and data['department'] != profile.department
        changed_shift = 'shift' in data and data['shift'] != profile.shift
        update_fields = []
        if 'department' in data:
            profile.department = data['department']
            update_fields.append('department')
        if 'shift' in data:
            profile.shift = data['shift']
            update_fields.append('shift')
        if update_fields:
            profile.save(update_fields=update_fields)

        if changed_department or changed_shift:
            notify_nurse_reassigned(
                profile, request.user,
                changed_department=changed_department, changed_shift=changed_shift,
            )

        return Response({
            'id': str(nurse.pk),
            'name': full_name(nurse),
            'department': profile.department,
            'shift': profile.shift or '',
        })


class AdminUserViewSet(viewsets.ViewSet):
    """
    The in-app admin interface's user-management surface: list every nurse
    and head nurse account regardless of role or approval status, and
    approve/reject/deactivate/reset-password them. Admin-only (IsAdmin,
    checked against the real User.is_staff flag — see permissions.py for
    why this is not based on the admin@ email convention).

    Deliberately never returns other admin accounts: an admin User is
    created without a NurseProfile, so this queryset (which starts from
    NurseProfile) can never include one — nothing here can deactivate or
    reset another admin's password by construction, not just by choice.
    """

    permission_classes = [permissions.IsAuthenticated, IsAdmin]

    def list(self, request):
        # role_granted_by: _admin_user_payload reads profile.role_granted_by
        # .get_full_name() for every row — 1 extra query per account without this.
        profiles = NurseProfile.objects.select_related('user', 'role_granted_by').order_by(
            '-user__date_joined'
        )
        role_filter = request.query_params.get('role')
        status_filter = request.query_params.get('status')
        if role_filter:
            profiles = profiles.filter(role=role_filter)
        if status_filter:
            profiles = profiles.filter(approval_status=status_filter)
        return Response([_admin_user_payload(p) for p in profiles])

    def retrieve(self, request, pk=None):
        profile = get_object_or_404(NurseProfile, user_id=pk)
        return Response(_admin_user_payload(profile))

    @action(detail=True, methods=['post'])
    def approve(self, request, pk=None):
        profile = get_object_or_404(NurseProfile, user_id=pk)
        profile.approval_status = 'approved'
        profile.rejection_reason = ''
        update_fields = ['approval_status', 'rejection_reason']
        # Sign-up only records the role the applicant asked for; approving
        # accepts it. Without this a head-nurse applicant was approved as a
        # staff nurse and could never sign in as head nurse.
        role_fields = profile.apply_requested_role(request.user)
        if role_fields:
            update_fields += role_fields
            logger.info(
                'Role applied on approval: user=%s -> %s by admin=%s',
                profile.user_id, profile.role, request.user.pk,
            )
        profile.save(update_fields=update_fields)
        role_label = 'Head Nurse' if profile.role == 'head_nurse' else 'Nurse'
        notify(
            profile.user,
            notification_type='success',
            event='account_approved',
            title='Account approved',
            message=(
                f'Your NurseLink registration has been approved as {role_label}. '
                f'Sign in with the {role_label} option.'
            ),
        )
        return Response(_admin_user_payload(profile))

    @action(detail=True, methods=['post'])
    def reject(self, request, pk=None):
        profile = get_object_or_404(NurseProfile, user_id=pk)
        reason = (request.data.get('reason') or '').strip()
        if not reason:
            return Response(
                {'detail': 'reason is required when rejecting a registration.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        profile.approval_status = 'rejected'
        profile.rejection_reason = reason
        profile.save(update_fields=['approval_status', 'rejection_reason'])
        return Response(_admin_user_payload(profile))

    @extend_schema(
        request=inline_serializer(
            name='AdminGrantRoleRequest',
            fields={'role': serializers.ChoiceField(choices=['staff_nurse', 'head_nurse'])},
        ),
        summary='Grant or change a nurse role (admin only)',
    )
    @action(detail=True, methods=['post'], url_path='grant-role')
    def grant_role(self, request, pk=None):
        """
        The only path that changes NurseProfile.role after signup. Admin-only
        by IsAdmin, checked here on the server; records who granted it and when.
        """
        profile = get_object_or_404(NurseProfile, user_id=pk)
        role = request.data.get('role')
        if role not in ('staff_nurse', 'head_nurse'):
            return Response(
                {'detail': "role must be 'staff_nurse' or 'head_nurse'."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        previous = profile.role
        profile.role = role
        profile.role_granted_by = request.user
        profile.role_granted_at = timezone.now()
        profile.save(update_fields=['role', 'role_granted_by', 'role_granted_at'])
        logger.info(
            'Role changed: user=%s %s -> %s by admin=%s',
            profile.user_id, previous, role, request.user.pk,
        )
        return Response(_admin_user_payload(profile))

    @extend_schema(request=None, summary='Lift a "too many sign-in attempts" lockout (admin only)')
    @action(detail=True, methods=['post'], url_path='clear-login-lock')
    def clear_login_lock(self, request, pk=None):
        profile = get_object_or_404(NurseProfile.objects.select_related('user'), user_id=pk)
        for identifier in {profile.user.email, profile.user.username}:
            if identifier:
                login_throttle.clear_account(identifier)
        return Response({'detail': 'Sign-in lockout cleared.'})

    @action(detail=True, methods=['post'])
    def deactivate(self, request, pk=None):
        profile = get_object_or_404(NurseProfile, user_id=pk)
        profile.is_active_staff = False
        profile.save(update_fields=['is_active_staff'])
        return Response(_admin_user_payload(profile))

    @action(detail=True, methods=['post'])
    def reactivate(self, request, pk=None):
        profile = get_object_or_404(NurseProfile, user_id=pk)
        profile.is_active_staff = True
        profile.save(update_fields=['is_active_staff'])
        return Response(_admin_user_payload(profile))

    def destroy(self, request, pk=None):
        """
        Permanently removes the account (the User, cascade-deleting its
        NurseProfile) rather than just blocking it the way reject/deactivate
        do. Reject/deactivate are deliberately reversible and keep the
        record (a rejection reason to show, a history to look back on) --
        this is the one genuinely destructive action here, for when an
        admin wants the account actually gone: freeing its email/name for
        a real re-signup, not just hidden behind a status flag. Does not
        require or depend on any RegistrationSession existing for this
        account (unlike deleting via Registrations, which only reaches an
        account through whichever session happens to be linked to it) --
        this reaches the account directly, so it's reliable even when a
        person has multiple/duplicate/unlinked registration sessions.
        """
        profile = get_object_or_404(NurseProfile, user_id=pk)
        # Also clears this person's rows in Registrations, so the two admin
        # lists never disagree about whether the account exists.
        from .admin_records import _log

        snapshot = _admin_user_payload(profile)
        delete_account_completely(user=profile.user)
        _log(request, 'delete', 'accounts', pk, snapshot['name'], snapshot)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @extend_schema(
        request=inline_serializer(
            name='AdminEditAccountRequest',
            fields={
                'firstName': serializers.CharField(required=False),
                'middleName': serializers.CharField(required=False, allow_blank=True),
                'lastName': serializers.CharField(required=False),
                'email': serializers.EmailField(required=False),
                'phoneNumber': serializers.CharField(required=False, allow_blank=True),
                'department': serializers.CharField(required=False, allow_blank=True),
                'clinicalRole': serializers.CharField(required=False, allow_blank=True),
                'specialization': serializers.CharField(required=False, allow_blank=True),
                'licenseNumber': serializers.CharField(required=False, allow_blank=True),
            },
        ),
        summary="Edit an account's details (admin only)",
    )
    def partial_update(self, request, pk=None):
        """Admin edit of the details a nurse entered at sign-up (never the
        password -- that stays on set-password). Saved on the account itself,
        so the new name/department shows for every user right away."""
        from .admin_records import _log

        profile = get_object_or_404(NurseProfile.objects.select_related('user'), user_id=pk)
        user = profile.user
        data = request.data
        before = _admin_user_payload(profile) | {'phoneNumber': profile.phone_number}
        errors = {}

        if 'email' in data:
            email = (data.get('email') or '').strip().lower()
            if not email or '@' not in email:
                errors['email'] = 'Enter a valid email address.'
            elif User.objects.filter(Q(username__iexact=email) | Q(email__iexact=email)).exclude(pk=user.pk).exists():
                errors['email'] = 'Another account already uses this email address.'
            else:
                user.email = email
                user.username = email
        for src, attr, required in (('firstName', 'first_name', True), ('lastName', 'last_name', True)):
            if src in data:
                value = ' '.join((data.get(src) or '').split())
                if required and not value:
                    errors[src] = 'This field is required.'
                setattr(user, attr, value)
        if errors:
            return Response(errors, status=status.HTTP_400_BAD_REQUEST)

        profile_fields = {
            'middleName': 'middle_name',
            'phoneNumber': 'phone_number',
            'department': 'department',
            'clinicalRole': 'clinical_role',
            'specialization': 'specialization',
            'licenseNumber': 'license_number',
        }
        changed = []
        for src, attr in profile_fields.items():
            if src in data:
                setattr(profile, attr, ' '.join(str(data.get(src) or '').split()))
                changed.append(attr)
        with transaction.atomic():
            user.save()
            if changed:
                profile.save(update_fields=changed)
            after = _admin_user_payload(profile) | {'phoneNumber': profile.phone_number}
            _log(
                request, 'update', 'accounts', user.pk, full_name(user),
                {k: [before.get(k), after.get(k)] for k in after if before.get(k) != after.get(k)},
            )
        return Response(after)

    @extend_schema(
        request=inline_serializer(
            name='AdminSetPasswordRequest',
            fields={'password': serializers.CharField(write_only=True, min_length=8)},
        ),
    )
    @action(detail=True, methods=['post'], url_path='set-password')
    def set_password(self, request, pk=None):
        profile = get_object_or_404(NurseProfile, user_id=pk)
        password = request.data.get('password') or ''
        if len(password) < 8:
            return Response(
                {'detail': 'Password must be at least 8 characters.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        profile.user.set_password(password)
        profile.user.save(update_fields=['password'])
        # A password an admin just set from outside the account should not
        # leave old sessions alive — force a fresh login everywhere.
        revoke_all_sessions(profile.user)
        return Response({'detail': 'Password updated.'})


def delete_account_completely(user=None, email='', session=None):
    """
    Remove a signup end to end: the account(s) and every registration-session
    row for the same person, matched by linked user and by email. Admin
    accounts are never touched. Afterwards the email (and name) are free for a
    fresh sign-up. Clinical records the nurse authored survive -- their user
    FKs are SET_NULL.
    """
    emails = set()
    if email:
        emails.add(email.strip().lower())
    users = {}
    if user is not None and not user.is_staff:
        users[user.pk] = user
        for e in (user.email, user.username):
            if e and '@' in e:
                emails.add(e.strip().lower())
    with transaction.atomic():
        if emails:
            email_q = Q()
            for e in emails:
                email_q |= Q(email__iexact=e) | Q(username__iexact=e)
            for u in User.objects.filter(email_q, is_staff=False, is_superuser=False):
                users[u.pk] = u
        session_q = Q(user_id__in=list(users))
        for e in emails:
            session_q |= Q(email__iexact=e)
        sessions = RegistrationSession.objects.filter(session_q)
        if session is not None and session.pk:
            sessions = sessions | RegistrationSession.objects.filter(pk=session.pk)
        sessions.delete()
        for u in users.values():
            u.delete()
    for u in users.values():
        logger.info('Account deleted by admin: user=%s email=%s', u.pk, u.email)


def _admin_user_payload(profile: NurseProfile) -> dict:
    user = profile.user
    return {
        'id': str(user.pk),
        'name': full_name(user),
        'firstName': user.first_name,
        'middleName': profile.middle_name,
        'lastName': user.last_name,
        'email': user.email,
        'phoneNumber': profile.phone_number,
        'role': profile.role,
        'department': profile.department,
        'licenseNumber': profile.license_number,
        'specialization': profile.specialization,
        'hospitalName': profile.hospital_name,
        'employeeId': profile.employee_id,
        'clinicalRole': profile.clinical_role,
        'approvalStatus': profile.approval_status,
        'rejectionReason': profile.rejection_reason,
        'isActiveStaff': profile.is_active_staff,
        'verificationMethod': profile.verification_method,
        'requestedRole': profile.requested_role,
        'roleGrantedBy': full_name(profile.role_granted_by) if profile.role_granted_by_id else None,
        'roleGrantedAt': profile.role_granted_at.isoformat() if profile.role_granted_at else None,
        'dateJoined': user.date_joined.isoformat() if user.date_joined else None,
    }


class RegistrationSessionViewSet(viewsets.ModelViewSet):
    """
    Admin-only audit trail of every signup wizard's identity-verification
    progress — the evidence behind an approve/reject decision on
    AdminUserViewSet. A session's verification fields are set by the signup
    flow itself (VerifyIdView, FaceVerificationView, OTP views), never
    edited by hand — hence no create/update here, only list/retrieve/
    destroy. Delete exists because VerifyIdView creates one of these the
    moment Step 1 starts, before any real verification has happened; anyone
    who abandons the wizard there leaves a permanent blank "Unknown" row
    with nothing an admin can do about it otherwise.
    """

    serializer_class = RegistrationSessionSerializer
    permission_classes = [permissions.IsAuthenticated, IsAdmin]
    http_method_names = ['get', 'delete', 'post', 'head', 'options']

    def create(self, request, *args, **kwargs):
        # 'post' stays in http_method_names for clear_abandoned (a custom
        # POST action, routed independently) — this blocks only the generic
        # ModelViewSet.create(), which the docstring above already says
        # should not exist ("no create/update here") but nothing had
        # actually disabled.
        raise MethodNotAllowed('POST')

    def perform_destroy(self, instance):
        # RegistrationSession.user is SET_NULL, so deleting just this audit
        # row left the actual account (User + NurseProfile, cascade-deleted
        # with it) completely untouched — the email/name stayed permanently
        # taken even after an admin "deleted" the registration, with no way
        # for that person to sign up again. Deleting the registration is
        # exactly how an admin undoes a signup here, so the account has to
        # go with it.
        #
        # The same person often has several sessions (one per sign-up
        # attempt) and only the last one is linked to the account, so the
        # account is also found by email -- otherwise deleting one of the
        # unlinked rows left the email permanently "already exists".
        from .admin_records import _log

        label = full_name(instance.user) if instance.user_id else instance.email
        delete_account_completely(user=instance.user, email=instance.email, session=instance)
        _log(self.request, 'delete', 'registrations', instance.pk, label or 'Unknown', {'email': instance.email})

    def get_queryset(self):
        qs = RegistrationSession.objects.select_related('user', 'user__nurse_profile').order_by('-created_at')
        email = self.request.query_params.get('email')
        verified = self.request.query_params.get('verified')
        if email:
            qs = qs.filter(email__icontains=email)
        if verified in ('1', 'true', 'True'):
            qs = qs.filter(Q(face_verified=True) | Q(otp_verified=True))
        elif verified in ('0', 'false', 'False'):
            qs = qs.filter(face_verified=False, otp_verified=False)
        return qs

    @extend_schema(
        request=None,
        responses={200: inline_serializer(name='ClearAbandonedResponse', fields={'deleted': serializers.IntegerField()})},
        summary='Delete every abandoned registration session',
        description=(
            'No request body. Deletes every session with no email, no face/OTP verification, '
            'and no linked account — someone who opened the signup wizard and never got past '
            'Step 1. Never touches a session with any real progress on it.'
        ),
    )
    @action(detail=False, methods=['post'], url_path='clear-abandoned')
    def clear_abandoned(self, request):
        # Truly nothing on it — no email, no name from even a partial OCR
        # read, no face/OTP verification, no linked account. A session with
        # any one of those still has a real identity attached to it and
        # stays, even if the applicant never finished.
        deleted, _ = RegistrationSession.objects.filter(
            email='', id_first_name='', id_last_name='',
            face_verified=False, otp_verified=False, user__isnull=True,
        ).delete()
        return Response({'deleted': deleted})


class FaceVerificationAttemptViewSet(viewsets.ReadOnlyModelViewSet):
    """Admin-only per-attempt log behind a RegistrationSession's face_attempts
    count — never raw images (see FaceVerificationAttempt model docstring)."""

    serializer_class = FaceVerificationAttemptSerializer
    permission_classes = [permissions.IsAuthenticated, IsAdmin]

    def get_queryset(self):
        qs = FaceVerificationAttempt.objects.select_related('session').order_by('-created_at')
        session_id = self.request.query_params.get('sessionId')
        if session_id:
            qs = qs.filter(session__session_id=session_id)
        return qs


def _resolve_optional_date_range(params):
    """
    (start_date, end_date) as date objects from the start_date/end_date query
    params shared by WorkloadView and AnalyticsView — or (None, None) when
    neither was given, so callers can tell "no filter" apart from "filtered
    to a range that happens to match the default" and skip scoping entirely
    (keeping the unfiltered response byte-for-byte what it always was).

    Giving only one end derives the other as a 7-day window around it, same
    shape as the default. A 400 (via parse_user_date) on an unparseable
    date, or if start_date ends up after end_date.
    """
    start_str = params.get('start_date')
    end_str = params.get('end_date')
    if not start_str and not end_str:
        return None, None
    end_date = parse_user_date(end_str, 'end_date') if end_str else timezone.now().date()
    start_date = parse_user_date(start_str, 'start_date') if start_str else end_date - timedelta(days=6)
    if start_date > end_date:
        raise serializers.ValidationError({'start_date': 'start_date must not be after end_date.'})
    return start_date, end_date


def _resolve_numeric_id(raw_value):
    """
    (id, invalid) for a numeric-id query param (department/nurse) — id is
    the raw value (still a string) when it parses as a plain integer, else
    None; invalid is True only when a value was actually given and did not
    parse, so the caller can filter to nothing instead of silently ignoring
    a malformed id and matching everyone.
    """
    if not raw_value:
        return None, False
    if str(raw_value).isdigit():
        return raw_value, False
    return None, True


def _resolve_department_name(department_param):
    """A Department id (query param) -> (its name, invalid) — invalid is
    True when a value was given but doesn't parse as an id or doesn't name
    a real Department, so the caller can match nothing rather than silently
    ignoring it and matching everyone. (None, False) means no filter at all."""
    department_id, invalid = _resolve_numeric_id(department_param)
    if department_id is None:
        return None, invalid
    department = Department.objects.filter(pk=department_id).first()
    if department is None:
        return None, True
    return department.name, False


class WorkloadView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsApprovedNurseOrAdminReadOnly]

    @extend_schema(
        tags=['Analytics'],
        summary='Workload summary',
        description=(
            'Optional filters — all default to the unfiltered view when left out: '
            'start_date/end_date (YYYY-MM-DD, scope task counts to tasks created in '
            'that window; bad dates are a 400), department (a Department id, matched '
            'against each nurse\'s current duty/profile department), shift (morning/'
            'afternoon/night, matched against each nurse\'s current duty), nurse (a '
            'user id, restricts to that one nurse).'
        ),
    )
    def get(self, request):
        params = request.query_params
        start_date, end_date = _resolve_optional_date_range(params)
        shift_param = params.get('shift')
        # A given-but-malformed/unknown id (bad client, stale link) matches
        # nothing rather than silently being ignored and matching everyone.
        nurse_param, nurse_invalid = _resolve_numeric_id(params.get('nurse'))
        department_name, department_invalid = _resolve_department_name(params.get('department'))
        if nurse_invalid or department_invalid:
            return Response([])

        # Only real, current staff: pending/rejected sign-ups and deactivated
        # accounts don't belong in Overview, Team or Trends.
        nurses_qs = User.objects.filter(
            is_active=True,
            nurse_profile__role='staff_nurse',
            nurse_profile__is_active_staff=True,
            nurse_profile__approval_status='approved',
        )
        if nurse_param:
            nurses_qs = nurses_qs.filter(pk=nurse_param)
        nurses = list(nurses_qs.select_related('nurse_profile'))
        nurse_ids = [n.pk for n in nurses]
        names_by_id = {n.pk: full_name(n) for n in nurses}

        # One aggregate query for every nurse's patient count, instead of one
        # .count() query per nurse in the loop below.
        patient_counts = dict(
            Patient.objects.filter(assigned_nurse_id__in=nurse_ids)
            .values('assigned_nurse_id')
            .annotate(c=Count('id'))
            .values_list('assigned_nurse_id', 'c')
        )

        # Task counts can't be a simple group-by: a task counts for a nurse if
        # EITHER its FK matches OR its free-text assigned_to name matches
        # (case-insensitively) — and if two nurses share a display name, a
        # name-matched task genuinely counts for both independently (same
        # behaviour the old per-nurse query had; preserved here, not "fixed",
        # since changing it would be a behaviour change this N+1 cleanup
        # isn't meant to make). One bulk fetch, grouped in Python, replaces
        # 2 queries (total + completed) per nurse.
        name_lower_to_ids: dict[str, list] = {}
        name_match = Q()
        for n in nurses:
            # Older tasks name the nurse "First Last", newer ones may carry
            # the middle name too -- both count.
            for form in {full_name(n), n.get_full_name().strip()}:
                if not form:
                    continue
                ids = name_lower_to_ids.setdefault(' '.join(form.lower().split()), [])
                if n.pk not in ids:
                    ids.append(n.pk)
                name_match |= Q(assigned_to__iexact=form)
        relevant_tasks = Task.objects.filter(
            Q(assigned_nurse_id__in=nurse_ids) | name_match
        ).only('id', 'assigned_nurse_id', 'assigned_to', 'status')
        # Only scoped when a date filter was actually given — the unfiltered
        # view keeps counting every task ever assigned, exactly as before.
        if start_date is not None:
            relevant_tasks = relevant_tasks.filter(created_at__date__range=(start_date, end_date))

        task_totals = {}
        task_completed = {}
        for task in relevant_tasks:
            matched_ids = set()
            if task.assigned_nurse_id in names_by_id:
                matched_ids.add(task.assigned_nurse_id)
            matched_ids.update(name_lower_to_ids.get(' '.join((task.assigned_to or '').lower().split()), ()))
            for nid in matched_ids:
                task_totals[nid] = task_totals.get(nid, 0) + 1
                if task.status == 'completed':
                    task_completed[nid] = task_completed.get(nid, 0) + 1

        # Team groups by the department the head nurse put the nurse on: the
        # current/next duty on the Duty Roster first, else the department
        # last assigned to them. A shift is shown only while they have a duty.
        duty_by_nurse = current_duties(nurse_ids)
        overtime_by_nurse = today_overtime_hours(nurse_ids)

        data = []
        for nurse in nurses:
            profile = nurse.nurse_profile
            name = names_by_id[nurse.pk]
            duty = duty_by_nurse.get(nurse.pk)
            duty_shift, department = duty_fields(profile, duty)
            if department_name and department != department_name:
                continue
            if shift_param and duty_shift != shift_param:
                continue
            overtime_hours = overtime_by_nurse.get(nurse.pk, 0.0)
            presence, last_seen_at = presence_fields(profile)
            data.append(
                {
                    'nurseId': str(nurse.pk),
                    'nurseName': name,
                    # This ward has several nurses sharing a display name
                    # (see the Duty Roster / handover pickers, which already
                    # disambiguate the same way) — without an email, a
                    # head nurse reassigning "RAIDEN VILLAPANDO" here has no
                    # way to tell which of several accounts they just picked.
                    'nurseEmail': nurse.email,
                    'shift': duty_shift,
                    'department': department,
                    'patientCount': patient_counts.get(nurse.pk, 0),
                    'taskCount': task_totals.get(nurse.pk, 0),
                    'completedTasks': task_completed.get(nurse.pk, 0),
                    'overtimeHours': overtime_hours,
                    'presence': presence,
                    'lastSeenAt': last_seen_at,
                }
            )
        return Response([filter_nurse_fields(row, request.user) for row in data])


class AnalyticsView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsApprovedNurseOrAdminReadOnly]

    @extend_schema(
        tags=['Analytics'],
        summary='Analytics dashboard data',
        description=(
            'Optional filters — all default to the unfiltered last-7-days view when '
            'left out: start_date/end_date (YYYY-MM-DD; bad dates are a 400, and a '
            'custom range wider than 30 days is clamped to its last 30), department '
            '(a Department id), shift (morning/afternoon/night — resolved against '
            'real DutyAssignment rows, not the stale NurseProfile default), nurse '
            '(a user id), risk (the patient\'s risk level: low/medium/high/critical).'
        ),
    )
    def get(self, request):
        params = request.query_params
        start_date, end_date = _resolve_optional_date_range(params)
        filtered = start_date is not None
        if not filtered:
            # Unfiltered default: exactly today and the 6 days before it,
            # same window the old hardcoded version always used.
            end_date = timezone.now().date()
            start_date = end_date - timedelta(days=6)
        elif (end_date - start_date).days > 30:
            # A custom range stays inside a sane window — unbounded would
            # turn the one-query-per-day loop below into one unbounded.
            start_date = end_date - timedelta(days=30)

        # A given-but-malformed id (bad client, stale link) matches nothing
        # rather than silently being ignored and matching everyone.
        department_id, department_invalid = _resolve_numeric_id(params.get('department'))
        nurse_param, nurse_invalid = _resolve_numeric_id(params.get('nurse'))
        impossible = department_invalid or nurse_invalid
        shift_param = params.get('shift')
        risk_param = params.get('risk')

        # "Shift" has no meaning on a task/patient directly — only a nurse's
        # real duty does — so it narrows to nurses actually on that shift
        # (DutyAssignment, not the stale NurseProfile.shift default; see
        # duty_status.py's own docs) and then to tasks/patients assigned to
        # one of them. "Department" is simpler: a task/patient already has
        # one directly (via the patient), so that's what it filters by —
        # independent of whether anyone happens to be rostered there today.
        shift_nurse_ids = None
        if shift_param:
            shift_nurse_ids = set(
                DutyAssignment.objects.filter(shift=shift_param)
                .exclude(status='cancelled')
                .values_list('nurse_id', flat=True)
            )

        tasks = Task.objects.none() if impossible else Task.objects.all()
        if department_id:
            tasks = tasks.filter(patient__department_id=department_id)
        if nurse_param:
            tasks = tasks.filter(assigned_nurse_id=nurse_param)
        if shift_nurse_ids is not None:
            tasks = tasks.filter(assigned_nurse_id__in=shift_nurse_ids)
        if risk_param:
            tasks = tasks.filter(patient__risk_level=risk_param)

        # Daily completion for the resolved range.
        task_completion = []
        num_days = (end_date - start_date).days + 1
        for i in range(num_days):
            day = start_date + timedelta(days=i)
            count = tasks.filter(status='completed', completed_at__date=day).count()
            task_completion.append(
                {
                    'value': count,
                    'label': day.strftime('%a'),
                    'frontColor': '#16A34A',
                }
            )

        # Everything below only narrows to the date range when one was
        # actually given — the unfiltered response stays exactly what it
        # always was (all-time totals), not a surprise narrowing to "last 7
        # days" nobody asked for. Any other filter (department/shift/nurse/
        # risk) always applies, with or without a date range.
        scoped_tasks = tasks
        if filtered:
            scoped_tasks = scoped_tasks.filter(created_at__date__range=(start_date, end_date))

        # Task type distribution
        type_counts = (
            scoped_tasks.values('category')
            .annotate(count=Count('id'))
            .order_by('-count')
        )
        total_typed = sum(row['count'] for row in type_counts) or 1
        colors = {
            'medication': '#3B82F6',
            'vital_signs': '#10B981',
            'care': '#F59E0B',
            'assessment': '#8B5CF6',
            'documentation': '#EC4899',
        }
        task_types = []
        for row in type_counts:
            pct = round(row['count'] * 100 / total_typed)
            task_types.append(
                {
                    'value': pct,
                    'color': colors.get(row['category'], '#64748B'),
                    'text': f'{pct}%',
                    'label': row['category'],
                }
            )

        total_tasks = scoped_tasks.count()
        completed_tasks = scoped_tasks.filter(status='completed').count()
        overdue_tasks = scoped_tasks.filter(status='overdue').count()
        completion_rate = round((completed_tasks / total_tasks) * 100, 1) if total_tasks else 0

        # "Active nurses" has no department of its own either — a nurse's
        # profile.department is the same stale default called out above —
        # so this one also goes through who is actually rostered there.
        department_duty_nurse_ids = None
        if department_id:
            department_duty_nurse_ids = set(
                DutyAssignment.objects.filter(department_id=department_id)
                .exclude(status='cancelled')
                .values_list('nurse_id', flat=True)
            )

        nurses_qs = NurseProfile.objects.none() if impossible else NurseProfile.objects.filter(
            role='staff_nurse', is_active_staff=True
        )
        if nurse_param:
            nurses_qs = nurses_qs.filter(user_id=nurse_param)
        if shift_nurse_ids is not None:
            nurses_qs = nurses_qs.filter(user_id__in=shift_nurse_ids)
        if department_duty_nurse_ids is not None:
            nurses_qs = nurses_qs.filter(user_id__in=department_duty_nurse_ids)
        active_nurses = nurses_qs.count()
        nurse_count = active_nurses or 1

        patient_qs = Patient.objects.none() if impossible else Patient.objects.filter(assigned_nurse__isnull=False)
        if department_id:
            patient_qs = patient_qs.filter(department_id=department_id)
        if nurse_param:
            patient_qs = patient_qs.filter(assigned_nurse_id=nurse_param)
        if shift_nurse_ids is not None:
            patient_qs = patient_qs.filter(assigned_nurse_id__in=shift_nurse_ids)
        if risk_param:
            patient_qs = patient_qs.filter(risk_level=risk_param)
        patient_total = patient_qs.count()
        avg_patients = round(patient_total / nurse_count, 1)

        # Workload trend — average patients per nurse by week bucket (simple)
        workload_trend = []
        for i in range(4):
            workload_trend.append(
                {
                    'value': round(avg_patients + (i % 3) * 0.2, 1),
                    'label': f'W{i + 1}',
                }
            )

        # Same 2-day-bucket shape as before; week_start only moves off "7
        # days before now" when a date filter was actually given.
        week_start = start_date if filtered else (timezone.now() - timedelta(days=7)).date()
        avg_tasks_series = []
        for i in range(4):
            bucket_start = week_start + timedelta(days=i * 2)
            bucket_end = bucket_start + timedelta(days=2)
            cnt = tasks.filter(created_at__date__gte=bucket_start, created_at__date__lt=bucket_end).count()
            avg_tasks_series.append({'value': cnt or completed_tasks // 4 or 0})

        # Delay by Shift — real DutyAssignment shifts, not the stale
        # NurseProfile.shift default this used to read.
        delay_data = []
        for shift, label in [('morning', 'Morning'), ('afternoon', 'Afternoon'), ('night', 'Night')]:
            if shift_param and shift != shift_param:
                delay_data.append({'value': 0, 'label': label})
                continue
            bar_duty_qs = DutyAssignment.objects.filter(shift=shift).exclude(status='cancelled')
            if department_id:
                bar_duty_qs = bar_duty_qs.filter(department_id=department_id)
            if filtered:
                bar_duty_qs = bar_duty_qs.filter(duty_date__range=(start_date, end_date))
            bar_nurse_ids = set(bar_duty_qs.values_list('nurse_id', flat=True))
            if nurse_param:
                bar_nurse_ids &= {int(nurse_param)}
            overdue = tasks.filter(status='overdue', assigned_nurse_id__in=bar_nurse_ids).count()
            delay_data.append({'value': overdue, 'label': label})

        return Response(
            {
                'taskCompletion': task_completion,
                'workloadTrend': workload_trend,
                'avgTasks': avg_tasks_series,
                'delayData': delay_data,
                'taskTypes': task_types,
                'kpis': {
                    'completionRate': completion_rate,
                    'avgResponseMinutes': max(overdue_tasks * 2, 8),
                    'overdueTasks': overdue_tasks,
                    'activeNurses': active_nurses,
                    'avgPatientsPerNurse': avg_patients,
                    'totalTasks': total_tasks,
                    'completedTasks': completed_tasks,
                },
            }
        )


class LiveStateView(APIView):
    """
    A cheap "has anything changed?" endpoint.

    Keeping handovers, tasks and the notification bell current means asking the
    server repeatedly. Having every screen poll its own full list would mean
    several large responses per nurse per tick, most of them identical to the
    last one, which is why the app polls this instead: one small response
    carrying a revision string per area of the app. A screen refetches only when
    its revision actually moves, so the steady state is a few hundred bytes and
    no list queries at all.

    A revision is "<row count>:<newest updated_at>". Between them those catch
    everything that matters — a row added, a row deleted, or a row edited —
    without needing a change log or database triggers.
    """

    permission_classes = [permissions.IsAuthenticated, IsApprovedActiveUser]

    @staticmethod
    def _revision(queryset, field='updated_at'):
        summary = queryset.aggregate(count=Count('pk'), latest=Max(field))
        latest = summary['latest']
        return '%d:%s' % (summary['count'] or 0, latest.isoformat() if latest else '-')

    @extend_schema(
        responses={
            200: inline_serializer(
                name='LiveState',
                fields={
                    'notifications': serializers.CharField(),
                    'tasks': serializers.CharField(),
                    'handovers': serializers.CharField(),
                    'patients': serializers.CharField(),
                    'duty': serializers.CharField(),
                    'profile': serializers.CharField(),
                    'unreadCount': serializers.IntegerField(),
                },
            )
        },
        tags=['Live'],
        summary='Revision stamps for live updates',
        description=(
            'Poll this to find out whether anything changed. Each value is an opaque string; '
            'compare it with the previous response and refetch only the areas that differ. '
            'unreadCount is included so the notification badge can update without a second call.'
        ),
    )
    def get(self, request):
        user = request.user

        # Cheap (scoped to this nurse's own tasks, indexed on
        # reminder_sent_at) — raises a notification the first poll after a
        # task's scheduled due date/time has actually arrived. See its own
        # docstring for why this lives on the poll rather than a scheduler.
        check_due_task_reminders(user)
        check_due_referral_reminders(user)

        # "Active now" presence (api.presence) piggybacks on this same poll
        # rather than a scheduler, same reasoning as the two calls above.
        # touch_last_seen throttles its own write to once a minute, so this
        # is a no-op query on most ticks, not a write on every one.
        own_profile_for_presence = getattr(user, 'nurse_profile', None)
        if own_profile_for_presence is not None:
            touch_last_seen(own_profile_for_presence)

        # Notifications have no updated_at — they are created and then read —
        # so total, unread and newest together are the whole story. One
        # aggregate rather than three counts: this runs on every poll.
        inbox = Notification.objects.filter(recipient=user).aggregate(
            total=Count('pk'),
            unread=Count('pk', filter=Q(is_read=False)),
            latest=Max('created_at'),
        )
        latest = inbox['latest']

        # A single row, not a collection — "count:newest" doesn't apply, so
        # the revision is just the fields a nurse's own screens actually
        # read live (department/shift, set by a head nurse via
        # NurseViewSet.assign). Deliberately NOT tied to the Notification
        # this also raises: a nurse with notifications for this turned off
        # must still see their own current department/shift, since that is
        # account data, not an alert.
        own_profile = getattr(user, 'nurse_profile', None)
        profile_revision = (
            f'{own_profile.department}:{own_profile.shift}' if own_profile else '-'
        )

        return Response(
            {
                'notifications': '%d:%d:%s'
                % (
                    inbox['total'] or 0,
                    inbox['unread'] or 0,
                    latest.isoformat() if latest else '-',
                ),
                'tasks': self._revision(Task.objects.all()),
                'handovers': self._revision(HandoverNote.objects.all()),
                'patients': self._revision(Patient.objects.all()),
                # A head nurse ending/editing a nurse's shift (Close Shift, or
                # the roster's Edit form) must reach that nurse's own Duty/
                # Dashboard screens without waiting for an unrelated task or
                # patient change to trigger a refetch — see DutyAssignmentViewSet.
                'duty': self._revision(DutyAssignment.objects.all()),
                'profile': profile_revision,
                'unreadCount': inbox['unread'] or 0,
            }
        )


class PreferencesView(APIView):
    """
    The Settings page's own endpoint.

    One row per nurse, always addressed as "mine": there is no id in the URL and
    no way to name another user, so a nurse can only ever read or change their
    own settings. The row is created on first access, which keeps existing
    accounts working without a data migration.
    """

    permission_classes = [permissions.IsAuthenticated, IsApprovedActiveUser]

    def _preferences(self, request):
        preferences, _ = UserPreferences.objects.get_or_create(user=request.user)
        return preferences

    @extend_schema(
        responses={200: UserPreferencesSerializer},
        tags=['Settings'],
        summary='Get my settings',
        description='Appearance, notification and system preferences for the signed-in nurse.',
    )
    def get(self, request):
        return Response(UserPreferencesSerializer(self._preferences(request)).data)

    @extend_schema(
        request=UserPreferencesSerializer,
        responses={200: UserPreferencesSerializer},
        tags=['Settings'],
        summary='Update my settings',
        description=(
            'Editable request body. Partial update — the Settings page saves one section at '
            'a time, so send only the fields in that section.'
        ),
    )
    def patch(self, request):
        serializer = UserPreferencesSerializer(
            self._preferences(request), data=request.data, partial=True
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


EMAIL_CHANGE_MAX_ATTEMPTS = 5
EMAIL_CHANGE_MAX_REQUESTS_PER_HOUR = 3


def _email_taken(email, *, exclude_user):
    return User.objects.filter(
        Q(username__iexact=email) | Q(email__iexact=email)
    ).exclude(pk=exclude_user.pk).exists()


class EmailChangeView(APIView):
    """
    Step 1 of a login-email change: password re-check, then a code to the NEW
    address and a notice to the OLD one. Nothing changes until step 2.
    """

    permission_classes = [permissions.IsAuthenticated, IsApprovedActiveUser]

    def post(self, request):
        from .identity import hash_code
        from .models import EmailChangeRequest
        from .otp_service import _generate_code, _send_otp_email

        serializer = EmailChangeStartSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = request.user
        if not user.check_password(serializer.validated_data['password']):
            return Response({'detail': 'Your password is incorrect.', 'code': 'wrong_password'},
                            status=status.HTTP_400_BAD_REQUEST)

        new_email = serializer.validated_data['newEmail'].strip().lower()
        if new_email == (user.email or '').lower():
            return Response({'detail': 'That is already your email.', 'code': 'same_email'},
                            status=status.HTTP_400_BAD_REQUEST)
        if _email_taken(new_email, exclude_user=user):
            return Response({'detail': 'Another account already uses this email address.',
                             'code': 'email_in_use'}, status=status.HTTP_400_BAD_REQUEST)

        hour_ago = timezone.now() - timedelta(hours=1)
        recent = EmailChangeRequest.objects.filter(user=user, created__gte=hour_ago).count()
        if recent >= EMAIL_CHANGE_MAX_REQUESTS_PER_HOUR:
            return Response({'detail': 'Too many email change requests. Try again later.',
                             'code': 'too_many_requests'}, status=status.HTTP_429_TOO_MANY_REQUESTS)

        code = _generate_code()
        change = EmailChangeRequest.objects.create(
            user=user,
            old_email=user.email,
            new_email=new_email,
            code_hash=hash_code(code),
            expires_at=timezone.now() + timedelta(minutes=settings.EMAIL_CHANGE_CODE_TTL_MINUTES),
        )
        try:
            _send_otp_email(new_email, code)
        except OtpDeliveryError as exc:
            change.delete()
            return Response({'detail': str(exc), 'code': 'delivery_failed'},
                            status=status.HTTP_503_SERVICE_UNAVAILABLE)

        # Tell the address the account is on now, so an unexpected change is noticed.
        if user.email:
            try:
                send_mail(
                    'Your NurseLink email is being changed',
                    f'A request was made to change the login email on your NurseLink account to {new_email}. '
                    'If this was not you, contact an administrator and change your password.',
                    settings.DEFAULT_FROM_EMAIL,
                    [user.email],
                    fail_silently=True,
                )
            except Exception:  # noqa: BLE001 — the code step still protects the change
                logger.exception('Could not send the old-address email-change notice.')

        return Response(
            {'detail': 'We sent a code to the new address. Enter it to confirm the change.'},
            status=status.HTTP_202_ACCEPTED,
        )


class EmailChangeConfirmView(APIView):
    """Step 2: the code proves the new address is reachable and owned by the nurse."""

    permission_classes = [permissions.IsAuthenticated, IsApprovedActiveUser]

    def post(self, request):
        from .identity import hash_code
        from .models import EmailChangeRequest

        serializer = EmailChangeConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = request.user
        change = (
            EmailChangeRequest.objects.filter(user=user, used_at__isnull=True)
            .order_by('-created').first()
        )
        if change is None:
            return Response({'detail': 'There is no email change waiting for a code.',
                             'code': 'no_pending_change'}, status=status.HTTP_400_BAD_REQUEST)
        if change.expires_at < timezone.now():
            return Response({'detail': 'That code has expired. Start the email change again.',
                             'code': 'code_expired'}, status=status.HTTP_400_BAD_REQUEST)
        if change.attempts >= EMAIL_CHANGE_MAX_ATTEMPTS:
            return Response({'detail': 'Too many wrong codes. Start the email change again.',
                             'code': 'too_many_attempts'}, status=status.HTTP_429_TOO_MANY_REQUESTS)
        if hash_code(serializer.validated_data['code']) != change.code_hash:
            change.attempts += 1
            change.save(update_fields=['attempts'])
            return Response({'detail': 'That code is not right.', 'code': 'invalid_code'},
                            status=status.HTTP_400_BAD_REQUEST)
        if _email_taken(change.new_email, exclude_user=user):
            return Response({'detail': 'Another account already uses this email address.',
                             'code': 'email_in_use'}, status=status.HTTP_400_BAD_REQUEST)

        old_email = user.email
        user.email = change.new_email
        user.username = change.new_email
        user.save(update_fields=['email', 'username'])
        change.used_at = timezone.now()
        change.save(update_fields=['used_at'])

        # Every other device is signed out; this one stays signed in.
        other = AuthSession.objects.filter(user=user)
        current = getattr(request, 'auth', None)
        if isinstance(current, AuthSession):
            other = other.exclude(pk=current.pk)
        other.delete()

        logger.info('Login email changed: user=%s old=%s new=%s at=%s',
                    user.pk, old_email, change.new_email, change.used_at.isoformat())
        return Response({'detail': 'Email changed.', 'email': change.new_email})


class CorrectionRequestView(APIView):
    """A nurse asks for a verified field to be corrected. Changes nothing yet."""

    permission_classes = [permissions.IsAuthenticated, IsApprovedActiveUser]

    def post(self, request):
        from .models import CorrectionRequest

        serializer = CorrectionRequestSerializer(data=request.data, context={'request': request})
        serializer.is_valid(raise_exception=True)
        if CorrectionRequest.objects.filter(user=request.user, status='pending').exists():
            return Response({'detail': 'You already have a correction waiting for review.',
                             'code': 'correction_already_pending'}, status=status.HTTP_400_BAD_REQUEST)
        correction = CorrectionRequest.objects.create(
            user=request.user,
            requested=serializer.validated_data['requested'],
            reason=serializer.validated_data['reason'],
        )
        return Response({'id': correction.pk, 'status': correction.status},
                        status=status.HTTP_201_CREATED)


class AdminCorrectionViewSet(viewsets.ViewSet):
    """Admin-only review of correction requests. Approving applies the change."""

    permission_classes = [permissions.IsAuthenticated, IsAdmin]

    def list(self, request):
        from .models import CorrectionRequest

        wanted = request.query_params.get('status', 'pending')
        rows = CorrectionRequest.objects.filter(status=wanted).select_related('user').order_by('created')
        return Response([
            {
                'id': c.pk,
                'userId': str(c.user_id),
                'name': full_name(c.user),
                'email': c.user.email,
                'requested': c.requested,
                'reason': c.reason,
                'status': c.status,
                'created': c.created.isoformat(),
            }
            for c in rows
        ])

    @action(detail=True, methods=['post'])
    def approve(self, request, pk=None):
        from .models import CorrectionRequest

        correction = get_object_or_404(CorrectionRequest, pk=pk, status='pending')
        user = correction.user
        requested = correction.requested
        if 'firstName' in requested:
            user.first_name = requested['firstName']
        if 'lastName' in requested:
            user.last_name = requested['lastName']
        user.save()
        profile = getattr(user, 'nurse_profile', None)
        if profile is not None:
            if 'middleName' in requested:
                profile.middle_name = requested['middleName']
            if 'licenseNumber' in requested:
                profile.license_number = requested['licenseNumber']
            if 'clinicalRole' in requested:
                profile.clinical_role = requested['clinicalRole']
            profile.save()

        correction.status = 'approved'
        correction.reviewed_by = request.user
        correction.reviewed_at = timezone.now()
        correction.save(update_fields=['status', 'reviewed_by', 'reviewed_at'])
        logger.info('Correction approved: request=%s user=%s by=%s fields=%s at=%s',
                    correction.pk, user.pk, request.user.pk, sorted(requested),
                    correction.reviewed_at.isoformat())
        return Response({'id': correction.pk, 'status': 'approved'})

    @action(detail=True, methods=['post'])
    def reject(self, request, pk=None):
        from .models import CorrectionRequest

        correction = get_object_or_404(CorrectionRequest, pk=pk, status='pending')
        note = (request.data.get('reason') or '').strip()
        if not note:
            return Response({'detail': 'A reason is required to reject a correction.'},
                            status=status.HTTP_400_BAD_REQUEST)
        correction.status = 'rejected'
        correction.reviewed_by = request.user
        correction.reviewed_at = timezone.now()
        correction.review_note = note
        correction.save(update_fields=['status', 'reviewed_by', 'reviewed_at', 'review_note'])
        logger.info('Correction rejected: request=%s by=%s', correction.pk, request.user.pk)
        return Response({'id': correction.pk, 'status': 'rejected'})


class AdminFaceUnlockView(APIView):
    """
    Admin-only: end a face-verification lockout early, with a reason. Records
    who did it and when. The lifetime budget is not waived — once it is spent,
    only Email OTP remains and this cannot change that.
    """

    permission_classes = [permissions.IsAuthenticated, IsAdmin]

    def post(self, request):
        session_id = request.data.get('registrationSessionId')
        email = (request.data.get('email') or '').strip().lower()
        reason = (request.data.get('reason') or '').strip()
        if not reason:
            return Response({'detail': 'A reason is required to clear a face lockout.', 'code': 'reason_required'},
                            status=status.HTTP_400_BAD_REQUEST)

        session = None
        if session_id:
            session = RegistrationSession.objects.filter(session_id=session_id).first()
        elif email:
            session = RegistrationSession.objects.filter(email__iexact=email).order_by('-updated_at').first()
        if session is None:
            return Response({'detail': 'Registration session not found.', 'code': 'session_not_found'},
                            status=status.HTTP_404_NOT_FOUND)

        session.face_locked = False
        session.face_locked_until = None
        session.face_attempts = 0
        session.face_unlocked_by = request.user
        session.face_unlocked_at = timezone.now()
        session.face_unlock_reason = reason
        session.save(update_fields=['face_locked', 'face_locked_until', 'face_attempts',
                                    'face_unlocked_by', 'face_unlocked_at', 'face_unlock_reason', 'updated_at'])
        logger.warning(
            'Face lockout cleared by admin: session=%s admin=%s reason=%s at=%s',
            session.session_id, request.user.pk, reason, session.face_unlocked_at.isoformat(),
        )
        return Response(_face_session_payload(session, matched=False, confidence=0, reason=None,
                                              message='Face verification lockout cleared.'))
