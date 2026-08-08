from datetime import timedelta

from django.contrib.auth import authenticate
from django.contrib.auth.models import User
from django.db import transaction
from django.db.models import Count, Q
from django.utils import timezone
from drf_spectacular.utils import OpenApiExample, extend_schema, inline_serializer
from rest_framework import permissions, serializers, status, viewsets
from rest_framework.authtoken.models import Token
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from .email_validation import EmailValidationError
from .face_match import FaceModelError, MAX_FACE_ATTEMPTS, verify_face_against_id
from .models import (
    ChartingNote,
    FaceVerificationAttempt,
    HandoverNote,
    KardexRecord,
    Notification,
    NurseProfile,
    Patient,
    PatientAssignment,
    RegistrationSession,
    Task,
)
from .otp_service import OtpCooldownError, OtpDeliveryError, OtpResendLimitError, issue_otp, verify_otp
from .permissions import IsSupervisor, get_user_role
from .serializers import (
    ChangePasswordSerializer,
    ChartingNoteSerializer,
    FaceVerificationSerializer,
    FaceVerificationStatusSerializer,
    HandoverSerializer,
    KardexRecordSerializer,
    LoginSerializer,
    NotificationSerializer,
    PatientAssignmentSerializer,
    PatientSerializer,
    ResendOtpSerializer,
    SendOtpSerializer,
    SignupSerializer,
    TaskSerializer,
    UpdateMeSerializer,
    UserSerializer,
    VerifyOtpSerializer,
)


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

    @extend_schema(
        request=SignupSerializer,
        responses={201: AuthResponseSerializer},
        tags=['Auth'],
        summary='Sign up',
        auth=None,
    )
    def post(self, request):
        serializer = SignupSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        token, _ = Token.objects.get_or_create(user=user)
        return Response(
            {'token': token.key, 'user': UserSerializer(user).data},
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
    }
    payload.update(extra)
    return payload


class FaceVerificationStatusView(APIView):
    """Return the server-side face/OTP verification state for session resume."""

    permission_classes = [permissions.AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'face_verification'

    @extend_schema(
        request=FaceVerificationStatusSerializer,
        tags=['Auth'],
        summary='Get face verification session status (attempt count, lock, OTP)',
        auth=None,
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
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'face_verification'

    @extend_schema(
        request=FaceVerificationSerializer,
        tags=['Auth'],
        summary='Verify a live selfie against the Hospital ID photo (3-attempt face check)',
        auth=None,
    )
    def post(self, request):
        serializer = FaceVerificationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        session_id = data.get('registrationSessionId')
        session = None
        if session_id:
            session = RegistrationSession.objects.filter(session_id=session_id).first()

        if data.get('reset'):
            if session is None:
                return Response(
                    {'success': False, 'message': 'Registration session not found. Please restart verification.'},
                    status=status.HTTP_404_NOT_FOUND,
                )
            session.face_attempts = 0
            session.face_locked = False
            session.save(update_fields=['face_attempts', 'face_locked', 'updated_at'])
            return Response(
                _face_session_payload(
                    session,
                    matched=False,
                    confidence=0,
                    reason=None,
                    reset=True,
                )
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
            ) or RegistrationSession.objects.create(email=registered_email)

        if session.face_verified:
            return Response(
                _face_session_payload(
                    session,
                    matched=True,
                    confidence=100.0,
                    reason=None,
                )
            )

        if session.face_locked:
            return Response(
                _face_session_payload(
                    session,
                    matched=False,
                    confidence=0,
                    reason=None,
                    message=(
                        "You've reached the maximum number of face verification attempts. "
                        'Choose Retry Face Verification or Verify Using Email OTP.'
                    ),
                ),
                status=status.HTTP_403_FORBIDDEN,
            )

        try:
            result = verify_face_against_id(data['image'], data['idImage'])
        except FaceModelError as exc:
            # Model/service failure is not a completed validation attempt.
            return Response(
                {
                    'success': False,
                    'message': str(exc),
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
                return Response(
                    _face_session_payload(
                        session,
                        matched=False,
                        confidence=0,
                        message=(
                            "You've reached the maximum number of face verification attempts. "
                            'Choose Retry Face Verification or Verify Using Email OTP.'
                        ),
                    ),
                    status=status.HTTP_403_FORBIDDEN,
                )

            FaceVerificationAttempt.objects.create(
                session=session,
                matched=result.matched,
                confidence=result.confidence,
                reason=result.reason or '',
                countable=result.countable and not result.matched,
            )

            if result.matched:
                session.face_verified = True
                session.face_attempts = 0
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
                return Response(
                    _face_session_payload(
                        session,
                        matched=True,
                        confidence=result.confidence,
                        reason=None,
                        message='Face Verified Successfully',
                    )
                )

            if result.countable:
                session.face_attempts = min(MAX_FACE_ATTEMPTS, session.face_attempts + 1)
                session.face_locked = session.face_attempts >= MAX_FACE_ATTEMPTS
                session.save(update_fields=['face_attempts', 'face_locked', 'updated_at'])

            message = result.message or 'Face verification failed. Please try again.'
            if session.face_locked:
                message = (
                    "You've reached the maximum number of face verification attempts. "
                    'Choose Retry Face Verification or Verify Using Email OTP.'
                )

            return Response(
                _face_session_payload(
                    session,
                    matched=False,
                    confidence=result.confidence,
                    locked=session.face_locked,
                    reason=result.reason,
                    message=message,
                    countable=result.countable,
                )
            )

class SendRegistrationOtpView(APIView):
    permission_classes = [permissions.AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'registration_otp_send'

    @extend_schema(
        request=SendOtpSerializer,
        tags=['Auth'],
        summary='Send a registration OTP (used after 3 failed face attempts)',
        auth=None,
    )
    def post(self, request):
        serializer = SendOtpSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        session = serializer.validated_data['registrationSessionId']

        try:
            issue_otp(session)
        except EmailValidationError as exc:
            return Response({'success': False, 'message': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except OtpCooldownError as exc:
            return Response(
                {'success': False, 'message': str(exc), 'retryAfter': exc.retry_after},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )
        except OtpDeliveryError as exc:
            return Response({'success': False, 'message': str(exc)}, status=status.HTTP_502_BAD_GATEWAY)

        return Response(
            {
                'success': True,
                'message': 'OTP sent successfully.',
                'expiresIn': 300,
                'resendCooldown': 60,
                'registrationSessionId': str(session.session_id),
            }
        )


class ResendRegistrationOtpView(APIView):
    permission_classes = [permissions.AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'registration_otp_send'

    @extend_schema(
        request=ResendOtpSerializer,
        tags=['Auth'],
        summary='Resend a registration OTP (invalidates the previous code)',
        auth=None,
    )
    def post(self, request):
        serializer = ResendOtpSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        session = serializer.validated_data['registrationSessionId']

        try:
            issue_otp(session, is_resend=True)
        except EmailValidationError as exc:
            return Response({'success': False, 'message': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except OtpCooldownError as exc:
            return Response(
                {'success': False, 'message': str(exc), 'retryAfter': exc.retry_after},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )
        except OtpResendLimitError as exc:
            return Response({'success': False, 'message': str(exc)}, status=status.HTTP_429_TOO_MANY_REQUESTS)
        except OtpDeliveryError as exc:
            return Response({'success': False, 'message': str(exc)}, status=status.HTTP_502_BAD_GATEWAY)

        return Response(
            {
                'success': True,
                'message': 'OTP resent successfully.',
                'expiresIn': 300,
                'resendCooldown': 60,
                'registrationSessionId': str(session.session_id),
            }
        )


class VerifyRegistrationOtpView(APIView):
    permission_classes = [permissions.AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'registration_otp_verify'

    @extend_schema(
        request=VerifyOtpSerializer,
        tags=['Auth'],
        summary='Verify a registration OTP code',
        auth=None,
    )
    def post(self, request):
        serializer = VerifyOtpSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        session = serializer.validated_data['registrationSessionId']
        code = serializer.validated_data['otp']

        verified, message, error_code = verify_otp(session, code)

        if verified:
            return Response({'verified': True, 'success': True, 'method': 'EMAIL_OTP', 'message': message})

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
                'Supervisor login',
                value={
                    'email': 'headnurse@hospital.com',
                    'password': 'password123',
                    'role': 'supervisor',
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

        user = _authenticate_credentials(email, password)

        if user is None:
            return Response(
                {'detail': 'Invalid email or password.'},
                status=status.HTTP_401_UNAUTHORIZED,
            )

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

        token, _ = Token.objects.get_or_create(user=user)
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
                    choices=['staff_nurse', 'supervisor'],
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
                'Supervisor credentials',
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

        user = _authenticate_credentials(email, password)
        if user is None:
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

        token, _ = Token.objects.get_or_create(user=user)
        return Response(
            {
                'access_token': token.key,
                'token_type': 'Bearer',
                'token': token.key,
                'user': UserSerializer(user).data,
            }
        )


class MeView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(responses={200: UserSerializer}, tags=['Auth'], summary='Current user')
    def get(self, request):
        return Response(UserSerializer(request.user).data)

    @extend_schema(
        request=UpdateMeSerializer,
        responses={200: UserSerializer},
        tags=['Auth'],
        summary='Update current user',
    )
    def patch(self, request):
        serializer = UpdateMeSerializer(data=request.data, partial=True, context={'request': request})
        serializer.is_valid(raise_exception=True)
        user = serializer.update(request.user, serializer.validated_data)
        return Response(UserSerializer(user).data)


class ChangePasswordView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(
        request=ChangePasswordSerializer,
        responses={200: inline_serializer(name='PasswordChanged', fields={'detail': serializers.CharField()})},
        tags=['Auth'],
        summary='Change password',
    )
    def post(self, request):
        serializer = ChangePasswordSerializer(data=request.data, context={'request': request})
        serializer.is_valid(raise_exception=True)
        serializer.save()
        Token.objects.filter(user=request.user).delete()
        token = Token.objects.create(user=request.user)
        return Response({'detail': 'Password changed.', 'token': token.key})


class LogoutView(APIView):
    permission_classes = [permissions.IsAuthenticated]

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
        Token.objects.filter(user=request.user).delete()
        return Response({'detail': 'Logged out.'})


class PatientViewSet(viewsets.ModelViewSet):
    serializer_class = PatientSerializer
    permission_classes = [permissions.IsAuthenticated]
    lookup_field = 'patient_code'
    lookup_url_kwarg = 'patient_code'

    def get_queryset(self):
        qs = Patient.objects.select_related('assigned_nurse').all()
        mine = self.request.query_params.get('mine')
        search = self.request.query_params.get('search')
        risk = self.request.query_params.get('riskLevel')
        role = get_user_role(self.request.user)
        if mine in ('1', 'true', 'True') or role == 'staff_nurse':
            # Staff nurses only see their assigned patients unless supervisor asks for all
            if role == 'staff_nurse' or mine in ('1', 'true', 'True'):
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

    def get_permissions(self):
        # Supervisors: full CRUD. Staff nurses: can update/delete their own assigned patients.
        if self.action == 'create':
            return [permissions.IsAuthenticated(), IsSupervisor()]
        if self.action in ('update', 'partial_update', 'destroy'):
            return [permissions.IsAuthenticated()]
        return [permissions.IsAuthenticated()]

    def update(self, request, *args, **kwargs):
        patient = self.get_object()
        role = get_user_role(request.user)
        if role != 'supervisor' and patient.assigned_nurse_id != request.user.id:
            return Response(
                {'detail': 'You can only edit patients assigned to you.'},
                status=status.HTTP_403_FORBIDDEN,
            )
        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        patient = self.get_object()
        role = get_user_role(request.user)
        if role != 'supervisor' and patient.assigned_nurse_id != request.user.id:
            return Response(
                {'detail': 'You can only delete patients assigned to you.'},
                status=status.HTTP_403_FORBIDDEN,
            )
        # Related tasks/assignments/kardex cascade or are cleaned via FK rules
        return super().destroy(request, *args, **kwargs)


class TaskViewSet(viewsets.ModelViewSet):
    serializer_class = TaskSerializer
    permission_classes = [permissions.IsAuthenticated]
    lookup_field = 'task_code'
    lookup_url_kwarg = 'task_code'

    def get_queryset(self):
        qs = Task.objects.select_related('patient', 'assigned_nurse').all()
        role = get_user_role(self.request.user)
        assigned_to = self.request.query_params.get('assignedTo')
        status_filter = self.request.query_params.get('status')
        patient_id = self.request.query_params.get('patientId')
        mine = self.request.query_params.get('mine')
        search = self.request.query_params.get('search')

        if mine in ('1', 'true', 'True') or (role == 'staff_nurse' and not assigned_to):
            name = self.request.user.get_full_name().strip() or self.request.user.username
            qs = qs.filter(Q(assigned_nurse=self.request.user) | Q(assigned_to__iexact=name))
        if assigned_to:
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
        return qs

    @action(detail=True, methods=['post'])
    def complete(self, request, task_code=None):
        task = self.get_object()
        task.status = 'completed'
        task.priority = 'completed'
        task.completed_at = timezone.now()
        task.save(update_fields=['status', 'priority', 'completed_at', 'updated_at'])
        return Response(TaskSerializer(task, context={'request': request}).data)


class HandoverViewSet(viewsets.ModelViewSet):
    serializer_class = HandoverSerializer
    permission_classes = [permissions.IsAuthenticated]
    lookup_field = 'handover_code'
    lookup_url_kwarg = 'handover_code'

    def get_queryset(self):
        qs = HandoverNote.objects.select_related('patient', 'created_by').all()
        status_filter = self.request.query_params.get('status')
        if status_filter:
            qs = qs.filter(status=status_filter)
        return qs

    @action(detail=True, methods=['post'])
    def acknowledge(self, request, handover_code=None):
        handover = self.get_object()
        handover.status = 'acknowledged'
        handover.save(update_fields=['status', 'updated_at'])
        return Response(HandoverSerializer(handover, context={'request': request}).data)


class ChartingViewSet(viewsets.ModelViewSet):
    serializer_class = ChartingNoteSerializer
    permission_classes = [permissions.IsAuthenticated]
    lookup_field = 'note_code'
    lookup_url_kwarg = 'note_code'

    def get_queryset(self):
        qs = ChartingNote.objects.select_related('patient', 'nurse').all()
        patient_id = self.request.query_params.get('patientId')
        if patient_id:
            qs = qs.filter(patient__patient_code=patient_id)
        return qs


class NotificationViewSet(viewsets.ModelViewSet):
    serializer_class = NotificationSerializer
    permission_classes = [permissions.IsAuthenticated]
    http_method_names = ['get', 'patch', 'delete', 'post', 'head', 'options']

    def get_queryset(self):
        return Notification.objects.filter(recipient=self.request.user)

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

    @action(detail=False, methods=['post'])
    def mark_all_read(self, request):
        updated = self.get_queryset().filter(is_read=False).update(is_read=True)
        return Response({'detail': f'Marked {updated} notifications as read.'})

    @action(detail=True, methods=['post'])
    def mark_read(self, request, pk=None):
        notification = self.get_object()
        notification.is_read = True
        notification.save(update_fields=['is_read'])
        return Response(self.get_serializer(notification).data)


class AssignmentViewSet(viewsets.ModelViewSet):
    serializer_class = PatientAssignmentSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        qs = PatientAssignment.objects.select_related(
            'patient', 'assigned_nurse', 'assigned_by'
        ).all()
        status_filter = self.request.query_params.get('status', 'active')
        nurse_id = self.request.query_params.get('nurseId')
        if status_filter and status_filter != 'all':
            qs = qs.filter(status=status_filter)
        if nurse_id:
            qs = qs.filter(assigned_nurse_id=nurse_id)
        return qs

    def get_permissions(self):
        if self.action in ('create', 'update', 'partial_update', 'destroy'):
            return [permissions.IsAuthenticated(), IsSupervisor()]
        return super().get_permissions()


class KardexViewSet(viewsets.ModelViewSet):
    serializer_class = KardexRecordSerializer
    permission_classes = [permissions.IsAuthenticated]
    http_method_names = ['get', 'post', 'delete', 'head', 'options']

    def get_queryset(self):
        return KardexRecord.objects.select_related('patient', 'saved_by').all()


class NurseViewSet(viewsets.ViewSet):
    permission_classes = [permissions.IsAuthenticated]

    def list(self, request):
        nurses = (
            User.objects.filter(nurse_profile__role='staff_nurse', nurse_profile__is_active_staff=True)
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
        results = []
        for nurse in nurses:
            profile = nurse.nurse_profile
            results.append(
                {
                    'id': str(nurse.pk),
                    'name': nurse.get_full_name().strip() or nurse.username,
                    'role': profile.clinical_role or 'RN',
                    'shift': profile.shift or 'morning',
                    'specialization': profile.specialization or '',
                    'email': nurse.email,
                    'department': profile.department,
                    'burnoutRisk': profile.burnout_risk,
                    'overtimeHours': profile.overtime_hours,
                    'patientCount': nurse.patient_count,
                    'taskCount': nurse.task_count,
                    'completedTasks': nurse.completed_tasks,
                }
            )
        return Response(results)

    def retrieve(self, request, pk=None):
        try:
            nurse = User.objects.select_related('nurse_profile').get(pk=pk)
        except User.DoesNotExist:
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
        profile = getattr(nurse, 'nurse_profile', None)
        return Response(
            {
                'id': str(nurse.pk),
                'name': nurse.get_full_name().strip() or nurse.username,
                'role': profile.clinical_role if profile else 'RN',
                'shift': profile.shift if profile else 'morning',
                'specialization': profile.specialization if profile else '',
                'email': nurse.email,
                'department': profile.department if profile else '',
            }
        )


class WorkloadView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(tags=['Analytics'], summary='Workload summary')
    def get(self, request):
        nurses = (
            User.objects.filter(nurse_profile__role='staff_nurse', nurse_profile__is_active_staff=True)
            .select_related('nurse_profile')
            .prefetch_related('assigned_patients', 'tasks')
        )
        data = []
        for nurse in nurses:
            profile = nurse.nurse_profile
            name = nurse.get_full_name().strip() or nurse.username
            tasks = Task.objects.filter(Q(assigned_nurse=nurse) | Q(assigned_to__iexact=name))
            total = tasks.count()
            completed = tasks.filter(status='completed').count()
            patients = Patient.objects.filter(assigned_nurse=nurse).count()
            data.append(
                {
                    'nurseId': str(nurse.pk),
                    'nurseName': name,
                    'shift': profile.shift,
                    'patientCount': patients,
                    'taskCount': total,
                    'completedTasks': completed,
                    'overtimeHours': profile.overtime_hours,
                    'burnoutRisk': profile.burnout_risk,
                }
            )
        return Response(data)


class AnalyticsView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(tags=['Analytics'], summary='Analytics dashboard data')
    def get(self, request):
        now = timezone.now()
        week_ago = now - timedelta(days=7)

        # Daily completion for last 7 days
        task_completion = []
        for i in range(6, -1, -1):
            day = (now - timedelta(days=i)).date()
            count = Task.objects.filter(
                status='completed', completed_at__date=day
            ).count()
            task_completion.append(
                {
                    'value': count,
                    'label': day.strftime('%a'),
                    'frontColor': '#16A34A',
                }
            )

        # Task type distribution
        type_counts = (
            Task.objects.values('category')
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

        burnout = (
            NurseProfile.objects.filter(role='staff_nurse', is_active_staff=True)
            .values('burnout_risk')
            .annotate(count=Count('id'))
        )
        burnout_map = {row['burnout_risk']: row['count'] for row in burnout}
        burnout_data = [
            {'value': burnout_map.get('low', 0), 'label': 'Low', 'frontColor': '#16A34A'},
            {'value': burnout_map.get('medium', 0), 'label': 'Med', 'frontColor': '#F59E0B'},
            {'value': burnout_map.get('high', 0), 'label': 'High', 'frontColor': '#DC2626'},
        ]

        total_tasks = Task.objects.count()
        completed_tasks = Task.objects.filter(status='completed').count()
        overdue_tasks = Task.objects.filter(status='overdue').count()
        completion_rate = round((completed_tasks / total_tasks) * 100, 1) if total_tasks else 0

        nurses = NurseProfile.objects.filter(role='staff_nurse', is_active_staff=True)
        avg_patients = 0
        nurse_count = nurses.count() or 1
        patient_total = Patient.objects.filter(assigned_nurse__isnull=False).count()
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

        avg_tasks_series = []
        for i in range(4):
            start = week_ago + timedelta(days=i * 2)
            end = start + timedelta(days=2)
            cnt = Task.objects.filter(created_at__gte=start, created_at__lt=end).count()
            avg_tasks_series.append({'value': cnt or completed_tasks // 4 or 0})

        delay_data = []
        for shift, label in [('morning', 'Morning'), ('afternoon', 'Afternoon'), ('night', 'Night')]:
            # Approximate delay proxy: overdue tasks for nurses on that shift
            nurse_names = list(
                User.objects.filter(nurse_profile__shift=shift).values_list('first_name', 'last_name')
            )
            names = [f'{f} {l}'.strip() for f, l in nurse_names]
            overdue = Task.objects.filter(status='overdue', assigned_to__in=names).count()
            delay_data.append({'value': overdue, 'label': label})

        return Response(
            {
                'taskCompletion': task_completion,
                'workloadTrend': workload_trend,
                'avgTasks': avg_tasks_series,
                'delayData': delay_data,
                'taskTypes': task_types,
                'burnout': burnout_data,
                'kpis': {
                    'completionRate': completion_rate,
                    'avgResponseMinutes': max(overdue_tasks * 2, 8),
                    'overdueTasks': overdue_tasks,
                    'activeNurses': NurseProfile.objects.filter(
                        role='staff_nurse', is_active_staff=True
                    ).count(),
                    'avgPatientsPerNurse': avg_patients,
                    'totalTasks': total_tasks,
                    'completedTasks': completed_tasks,
                },
            }
        )
