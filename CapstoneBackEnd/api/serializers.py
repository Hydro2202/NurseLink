from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from django.conf import settings
from django.contrib.auth.models import User
from django.contrib.auth.password_validation import validate_password
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework import serializers

from .models import (
    ChartingNote,
    Department,
    Doctor,
    DutyAssignment,
    FaceVerificationAttempt,
    HandoverNote,
    KardexRecord,
    Notification,
    NurseProfile,
    Patient,
    PatientAssignment,
    PatientDoctor,
    PatientVisit,
    RegistrationSession,
    Task,
    TaskDoctor,
    TaskHandover,
    UserPreferences,
    VitalSigns,
)
from .avatar import AvatarError, normalize_avatar
from .id_field_validation import validate_prc_id_fields
from .handover_tasks import create_handover_tasks
from .notifications import notify_handover_created, notify_task_assigned, resolve_nurse
from .utils import next_code
from .vitals_detection import detect_vital_mentions


class UserSerializer(serializers.ModelSerializer):
    """Shapes a User + NurseProfile into the frontend User object."""

    id = serializers.SerializerMethodField()
    name = serializers.SerializerMethodField()
    firstName = serializers.CharField(source='first_name', required=False)
    middleName = serializers.SerializerMethodField()
    lastName = serializers.CharField(source='last_name', required=False)
    role = serializers.SerializerMethodField()
    department = serializers.SerializerMethodField()
    licenseNumber = serializers.SerializerMethodField()
    avatar = serializers.SerializerMethodField()
    shift = serializers.SerializerMethodField()
    clinicalRole = serializers.SerializerMethodField()
    specialization = serializers.SerializerMethodField()
    isAdmin = serializers.BooleanField(source='is_staff', read_only=True)

    class Meta:
        model = User
        fields = [
            'id',
            'name',
            'firstName',
            'middleName',
            'lastName',
            'email',
            'role',
            'department',
            'licenseNumber',
            'avatar',
            'shift',
            'clinicalRole',
            'specialization',
            'isAdmin',
        ]

    def get_id(self, obj):
        return str(obj.pk)

    def get_name(self, obj):
        full = obj.get_full_name().strip()
        return full or obj.username

    def get_middleName(self, obj):
        profile = getattr(obj, 'nurse_profile', None)
        return profile.middle_name if profile else ''

    def get_role(self, obj):
        if obj.is_staff:
            return 'admin'
        profile = getattr(obj, 'nurse_profile', None)
        return profile.role if profile else 'staff_nurse'

    def get_department(self, obj):
        profile = getattr(obj, 'nurse_profile', None)
        return profile.department if profile else ''

    def get_licenseNumber(self, obj):
        profile = getattr(obj, 'nurse_profile', None)
        return profile.license_number if profile else ''

    def get_avatar(self, obj):
        profile = getattr(obj, 'nurse_profile', None)
        return profile.avatar if profile else ''

    def get_shift(self, obj):
        profile = getattr(obj, 'nurse_profile', None)
        return profile.shift if profile else ''

    def get_clinicalRole(self, obj):
        profile = getattr(obj, 'nurse_profile', None)
        return profile.clinical_role if profile else 'RN'

    def get_specialization(self, obj):
        profile = getattr(obj, 'nurse_profile', None)
        return profile.specialization if profile else ''


class NurseListSerializer(serializers.Serializer):
    """Matches frontend Nurse / workload nurse list shape."""

    id = serializers.CharField()
    name = serializers.CharField()
    role = serializers.CharField()
    shift = serializers.CharField()
    specialization = serializers.CharField(required=False, allow_blank=True)
    email = serializers.EmailField(required=False)
    department = serializers.CharField(required=False, allow_blank=True)
    burnoutRisk = serializers.CharField(required=False)
    overtimeHours = serializers.FloatField(required=False)
    patientCount = serializers.IntegerField(required=False)
    taskCount = serializers.IntegerField(required=False)
    completedTasks = serializers.IntegerField(required=False)


class SignupSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True, min_length=6)
    firstName = serializers.CharField(required=False, allow_blank=True, default='')
    middleName = serializers.CharField(required=False, allow_blank=True, default='')
    lastName = serializers.CharField(required=False, allow_blank=True, default='')
    name = serializers.CharField(required=False, allow_blank=True, default='')
    role = serializers.ChoiceField(
        choices=['staff_nurse', 'supervisor'],
        default='staff_nurse',
    )
    department = serializers.CharField(required=False, allow_blank=True, default='')
    licenseNumber = serializers.CharField(required=False, allow_blank=True, default='')
    registrationSessionId = serializers.UUIDField(
        help_text='Session id returned by /auth/face-verification/, proving Face or Email OTP verification passed.',
    )

    def validate_email(self, value):
        if User.objects.filter(username=value).exists() or User.objects.filter(email=value).exists():
            raise serializers.ValidationError('A user with this email already exists.')
        return value.lower()

    def validate_password(self, value):
        validate_password(value)
        return value

    def validate_registrationSessionId(self, value):
        session = RegistrationSession.objects.filter(session_id=value).first()
        if not session:
            raise serializers.ValidationError('Registration session not found. Please restart verification.')
        if session.user_id:
            raise serializers.ValidationError('This registration session has already been used.')
        if not session.is_verified:
            raise serializers.ValidationError(
                'Identity verification has not been completed. Please pass Face Verification or Email OTP first.'
            )
        if session.id_verification_status != 'verified':
            raise serializers.ValidationError(
                'PRC ID verification has not been completed. Please scan your PRC nursing license first.'
            )
        return session

    def create(self, validated_data):
        email = validated_data['email']
        first_name = validated_data.get('firstName') or ''
        last_name = validated_data.get('lastName') or ''
        name = validated_data.get('name') or ''
        session = validated_data['registrationSessionId']

        if not first_name and name:
            parts = name.split(' ', 1)
            first_name = parts[0]
            if len(parts) > 1 and not last_name:
                last_name = parts[1]

        role = validated_data.get('role', 'staff_nurse')
        # Left blank unless the signup form explicitly supplied one — a new
        # account has no real ward assignment yet, and silently defaulting
        # to a made-up department ("Medical-Surgical Unit") looked like a
        # real assignment nobody had actually made. A supervisor sets the
        # real one via PATCH /api/nurses/{id}/assign/ (NurseViewSet.assign).
        department = validated_data.get('department') or ''

        with transaction.atomic():
            user = User.objects.create_user(
                username=email,
                email=email,
                password=validated_data['password'],
                first_name=first_name,
                last_name=last_name,
            )
            NurseProfile.objects.create(
                user=user,
                role=role,
                department=department,
                # Same reasoning as department above: the signup form never
                # asks for a shift, so defaulting to 'morning' here made an
                # unassigned account look scheduled. Left blank until a
                # supervisor sets a real one via the assign action.
                shift='',
                license_number=validated_data.get('licenseNumber') or '',
                middle_name=validated_data.get('middleName') or '',
                # Identity is established by the time we get here — the
                # Hospital ID was scanned and OCR'd, a portrait was confirmed
                # on it, and the applicant passed either face matching against
                # that portrait or email OTP. That proves *who* signed up, not
                # that an admin has actually reviewed and approved the
                # registration, so the account starts pending. Enforced
                # server-side in LoginView / OAuthTokenView / IsApprovedNurse —
                # not just left as an inert field — see api/admin.py for the
                # approve/reject review screen.
                approval_status='pending',
                verification_method=session.verification_method,
                prc_verified_at=timezone.now(),
                prc_license_expiry=(
                    session.id_valid_until.strftime('%m/%d/%Y') if session.id_valid_until else ''
                ),
            )
            session.user = user
            session.save(update_fields=['user', 'updated_at'])
        return user


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField(
        help_text='Account email, e.g. nurse@hospital.com',
    )
    password = serializers.CharField(
        write_only=True,
        style={'input_type': 'password'},
        help_text='Account password',
        min_length=1,
    )
    role = serializers.ChoiceField(
        choices=['staff_nurse', 'supervisor'],
        required=False,
        help_text='Optional. Must match the account role if provided.',
    )

    class Meta:
        # Helps OpenAPI / Scalar show editable body fields
        ref_name = 'LoginRequest'


class FaceVerificationSerializer(serializers.Serializer):
    image = serializers.CharField(
        required=False,
        allow_blank=True,
        help_text='Base64 (optionally data-URI prefixed) JPEG/PNG selfie capture. Required unless reset=true.',
    )
    idImage = serializers.CharField(
        required=False,
        allow_blank=True,
        help_text='Base64 (optionally data-URI prefixed) Hospital ID photo to match against. Required unless reset=true.',
    )
    registrationSessionId = serializers.UUIDField(required=False)
    registeredEmail = serializers.EmailField(
        required=False,
        help_text='The immutable registration email captured during Step 1. Required only when creating a session.',
    )
    reset = serializers.BooleanField(
        required=False,
        default=False,
        help_text='Set true to reset the 3-attempt counter after the user chooses "Retake Face Verification".',
    )

    def validate(self, attrs):
        if not attrs.get('reset'):
            if not attrs.get('image'):
                raise serializers.ValidationError({'image': 'This field is required.'})
            if not attrs.get('idImage'):
                raise serializers.ValidationError({'idImage': 'This field is required.'})
            if not attrs.get('registrationSessionId') and not attrs.get('registeredEmail'):
                raise serializers.ValidationError({'registeredEmail': 'The registered email is required to start verification.'})
        return attrs


class FaceVerificationStatusSerializer(serializers.Serializer):
    registrationSessionId = serializers.UUIDField(required=False)
    registeredEmail = serializers.EmailField(required=False)

    def validate(self, attrs):
        if not attrs.get('registrationSessionId') and not attrs.get('registeredEmail'):
            raise serializers.ValidationError(
                {'registrationSessionId': 'Provide registrationSessionId or registeredEmail.'}
            )
        return attrs


class RegistrationEmailSerializer(serializers.Serializer):
    """
    What Step 2 (ID Review) sends when the nurse presses Continue.

    Two jobs, one round trip. The registered email is persisted to
    RegistrationSession.email — the address every later step (OTP fallback,
    account creation) reads back, and the only place it is captured, since OCR
    never yields an email from a PRC card.

    The six ID fields are optional and carry the nurse's *reviewed* values. OCR
    misreads names and digits, so the fields are editable and whatever the nurse
    confirms is what gets stored. They are re-validated here by exactly the same
    gate the OCR output passed through — a corrected value earns no more trust
    than a scanned one.
    """

    registrationSessionId = serializers.UUIDField()
    email = serializers.EmailField()

    # Optional so older clients, and any caller that only wants to save the
    # email, keep working unchanged.
    lastName = serializers.CharField(required=False, allow_blank=True, max_length=100)
    firstName = serializers.CharField(required=False, allow_blank=True, max_length=100)
    middleName = serializers.CharField(required=False, allow_blank=True, max_length=100)
    registrationNumber = serializers.CharField(required=False, allow_blank=True, max_length=50)
    registrationDate = serializers.CharField(required=False, allow_blank=True, max_length=40)
    validUntil = serializers.CharField(required=False, allow_blank=True, max_length=40)

    ID_FIELDS = (
        'lastName',
        'firstName',
        'middleName',
        'registrationNumber',
        'registrationDate',
        'validUntil',
    )

    # Field names as the validator reports them, mapped back to what the client
    # sent, so an error lands on the input the nurse actually has to fix.
    ERROR_FIELD_MAP = {
        'last_name': 'lastName',
        'first_name': 'firstName',
        'middle_name': 'middleName',
        'registration_no': 'registrationNumber',
        'registration_date': 'registrationDate',
        'valid_until': 'validUntil',
    }

    def validate(self, attrs):
        # Nothing to check unless the client actually sent reviewed fields.
        if not any(attrs.get(name) for name in self.ID_FIELDS):
            return attrs

        result = validate_prc_id_fields(
            last_name=attrs.get('lastName'),
            first_name=attrs.get('firstName'),
            middle_name=attrs.get('middleName'),
            registration_no=attrs.get('registrationNumber'),
            registration_date=attrs.get('registrationDate'),
            valid_until=attrs.get('validUntil'),
        )
        if not result.valid:
            raise serializers.ValidationError(
                {
                    self.ERROR_FIELD_MAP.get(field, field): message
                    for field, message in (result.errors or {}).items()
                }
            )

        # Normalised on the way through: dates as ISO, registration number
        # stripped to digits — so the session stores one canonical shape however
        # the nurse typed it.
        attrs['cleanedIdFields'] = result.cleaned
        return attrs


class SendOtpSerializer(serializers.Serializer):
    registrationSessionId = serializers.UUIDField()
    # Optional — the OTP always goes to session.email (the backend/database
    # record), never to this value. If present, it's only cross-checked as a
    # confirmation the client is showing the nurse the right address; it is
    # NEVER used as the send destination. Session identity alone is
    # sufficient to send the OTP.
    email = serializers.EmailField(
        required=False,
        help_text='Optional confirmation only — the OTP is always sent to the registration’s stored email.',
    )

    def validate(self, attrs):
        session = RegistrationSession.objects.filter(session_id=attrs['registrationSessionId']).first()
        if not session:
            raise serializers.ValidationError(
                {'registrationSessionId': 'Registration session not found. Please restart verification.'}
            )
        if not session.face_locked:
            raise serializers.ValidationError(
                {'registrationSessionId': 'Email OTP is available only after three failed face verification attempts.'}
            )
        submitted = attrs.get('email')
        if submitted and session.email and submitted.strip().lower() != session.email.strip().lower():
            raise serializers.ValidationError(
                {
                    'email': (
                        'Email Not Found. This email is not associated with your registration. '
                        'Please enter your registered email.'
                    )
                }
            )
        attrs['registrationSessionId'] = session
        attrs['email'] = submitted
        return attrs


class ResendOtpSerializer(SendOtpSerializer):
    pass


class VerifyOtpSerializer(serializers.Serializer):
    otp = serializers.RegexField(r'^\d{6}$', error_messages={'invalid': 'OTP must be exactly 6 digits.'})
    registrationSessionId = serializers.UUIDField()

    def validate_registrationSessionId(self, value):
        session = RegistrationSession.objects.filter(session_id=value).first()
        if not session:
            raise serializers.ValidationError('Registration session not found. Please restart verification.')
        if not session.face_locked and not session.otp_verified:
            raise serializers.ValidationError(
                'Email OTP is available only after three failed face verification attempts.'
            )
        return session


class ChangePasswordSerializer(serializers.Serializer):
    currentPassword = serializers.CharField(write_only=True)
    newPassword = serializers.CharField(write_only=True, min_length=6)

    def validate_newPassword(self, value):
        validate_password(value, user=self.context['request'].user)
        return value

    def validate(self, attrs):
        user = self.context['request'].user
        if not user.check_password(attrs['currentPassword']):
            raise serializers.ValidationError({'currentPassword': 'Current password is incorrect.'})
        return attrs

    def save(self, **kwargs):
        user = self.context['request'].user
        user.set_password(self.validated_data['newPassword'])
        user.save(update_fields=['password'])
        return user


class UpdateMeSerializer(serializers.Serializer):
    # The Settings dialog edits one "Full Name" box rather than separate first
    # and last name fields, so accept that too and split it. Without this the
    # server quietly ignored the name and the UI appeared to revert on save.
    name = serializers.CharField(required=False, allow_blank=True, max_length=300)
    email = serializers.EmailField(required=False)
    firstName = serializers.CharField(required=False, allow_blank=True, max_length=150)
    middleName = serializers.CharField(required=False, allow_blank=True, max_length=100)
    lastName = serializers.CharField(required=False, allow_blank=True, max_length=150)
    licenseNumber = serializers.CharField(required=False, allow_blank=True, max_length=50)
    # Not a URLField any more: this now also carries an uploaded photo as a
    # data: URI, which URLValidator rejects. validate_avatar re-encodes it.
    avatar = serializers.CharField(required=False, allow_blank=True, trim_whitespace=False)
    # department and shift are deliberately NOT here: a nurse choosing their
    # own department/shift would make supervisor-controlled staffing
    # assignment (NurseViewSet.assign, supervisor-only) meaningless. Both are
    # now set exclusively by a supervisor.
    clinicalRole = serializers.CharField(required=False, allow_blank=True, max_length=40)
    specialization = serializers.CharField(required=False, allow_blank=True, max_length=120)

    def validate_avatar(self, value):
        try:
            return normalize_avatar(value)
        except AvatarError as exc:
            raise serializers.ValidationError(str(exc))

    def validate_email(self, value):
        value = (value or '').strip().lower()
        if not value:
            return value
        # Email doubles as the login username, so it has to stay unique across
        # accounts — otherwise two nurses could end up unable to sign in.
        user = self.instance or (self.context.get('request').user if self.context.get('request') else None)
        clash = User.objects.filter(Q(username__iexact=value) | Q(email__iexact=value))
        if user is not None:
            clash = clash.exclude(pk=user.pk)
        if clash.exists():
            raise serializers.ValidationError('Another account already uses this email address.')
        return value

    def update(self, instance, validated_data):
        first_name = validated_data.get('firstName')
        last_name = validated_data.get('lastName')

        # A single "Full Name" box: first word is the first name, the rest is
        # the surname. Explicit firstName/lastName still win when both are sent.
        if 'name' in validated_data and first_name is None and last_name is None:
            parts = (validated_data['name'] or '').strip().split()
            if parts:
                first_name = parts[0]
                last_name = ' '.join(parts[1:])

        if first_name is not None:
            instance.first_name = first_name or ''
        if last_name is not None:
            instance.last_name = last_name or ''

        if 'email' in validated_data and validated_data['email']:
            # Kept in step with username, which is what authentication matches on.
            instance.email = validated_data['email']
            instance.username = validated_data['email']

        instance.save()

        # An admin (is_staff) account is deliberately created without a
        # NurseProfile — AdminUserViewSet's queryset starts from NurseProfile,
        # so that absence is what keeps every admin account out of the
        # Accounts list and un-touchable by another admin (see its
        # docstring). get_or_create-ing one here the first time an admin
        # edits their own name/avatar would silently undo that guarantee —
        # so admin fields (avatar/clinicalRole/specialization/licenseNumber,
        # all clinical-role concepts anyway) are simply not saved for them.
        if not instance.is_staff:
            profile, _ = NurseProfile.objects.get_or_create(user=instance)
            mapping = {
                'middleName': 'middle_name',
                'licenseNumber': 'license_number',
                'avatar': 'avatar',
                'clinicalRole': 'clinical_role',
                'specialization': 'specialization',
            }
            changed = False
            for src, dest in mapping.items():
                if src in validated_data:
                    setattr(profile, dest, validated_data[src] or '')
                    changed = True
            if changed:
                profile.save()
            # get_or_create hands back a different Python object than the one
            # already cached on instance.nurse_profile by authentication, so
            # without this the caller serializes the pre-edit profile and the
            # change looks like it silently reverted — even though it is
            # safely in the database.
            instance.nurse_profile = profile
        return instance


class NurseAssignmentSerializer(serializers.Serializer):
    """
    Supervisor-only: change a nurse's department and/or shift. Used by
    NurseViewSet's `assign` action, never by a nurse editing their own
    profile (see UpdateMeSerializer, which deliberately omits both fields).
    """

    department = serializers.CharField(required=False, allow_blank=True, max_length=120)
    shift = serializers.ChoiceField(
        choices=['morning', 'afternoon', 'night'], required=False, allow_blank=True
    )

    def validate(self, attrs):
        if not attrs:
            raise serializers.ValidationError('Send at least one of department or shift.')
        return attrs

    def validate_department(self, value):
        value = (value or '').strip()
        if not value:
            raise serializers.ValidationError('Department cannot be blank.')
        return value


def find_possible_duplicate_patients(name, age, *, exclude_patient_code=None):
    """
    Two patients sharing a name is not a coincidence worth ignoring — it is
    exactly the wrong-patient mixup this system exists to prevent (see
    Patient.patient_code, the actual identifier every workflow should use
    instead of a typed name). Matched on name + age since Patient has no
    date-of-birth field to match on; exact age (not a range) keeps this
    conservative, so it flags real matches rather than nagging on every
    similarly-aged patient with a common surname.
    """
    name = (name or '').strip()
    if not name:
        return []
    qs = Patient.objects.filter(name__iexact=name)
    if age not in (None, ''):
        qs = qs.filter(age=age)
    if exclude_patient_code:
        qs = qs.exclude(patient_code=exclude_patient_code)
    return list(qs[:5])


def duplicate_patient_payload(matches):
    return {
        'detail': (
            'A patient with similar information already exists. Please verify before '
            'creating a new patient.'
        ),
        'possibleDuplicates': [
            {
                'patientId': p.patient_code,
                'name': p.name,
                'age': p.age,
                'gender': p.gender,
                'room': p.room,
                'admissionDate': p.admission_date.isoformat() if p.admission_date else None,
                # A discharged match is a readmission candidate (use
                # PatientViewSet.readmit, not a fresh create) rather than a
                # true duplicate — the caller needs status to tell the two
                # apart, since both look identical otherwise.
                'status': p.status,
                'statusLabel': p.get_status_display(),
            }
            for p in matches
        ],
    }


def medical_team_snapshot(patient):
    """
    [{name, specialization, departmentName}, ...] — a point-in-time copy of
    a patient's active Kardex care team, for PatientVisit.medical_team.

    Not a live PatientDoctor join at read time: PatientDoctor is unique on
    (patient, doctor), so a doctor reassigned on a later visit reactivates
    the same row rather than creating a new one, and a live date-range
    query would misattribute it. See PatientVisit's docstring.
    """
    assignments = patient.assigned_doctors.filter(status='active').select_related(
        'doctor', 'doctor__department'
    )
    return [
        {
            'name': pd.doctor.full_name,
            'specialization': pd.doctor.specialization,
            'departmentName': pd.doctor.department.name,
        }
        for pd in assignments
    ]


def nurse_display_name(user):
    if not user:
        return ''
    return user.get_full_name().strip() or user.username


def open_patient_visit(patient):
    """A fresh PatientVisit for `patient`'s current admission, seeded from
    its current fields — called on Patient.create and PatientViewSet.readmit."""
    return PatientVisit.objects.create(
        patient=patient,
        admission_date=patient.admission_date,
        diagnosis=patient.diagnosis,
        room=patient.room,
        attending_physician=patient.attending_physician,
        assigned_nurse=patient.assigned_nurse,
        assigned_nurse_name=nurse_display_name(patient.assigned_nurse),
    )


# Fields worth naming in Patient.edit_history when they actually change —
# demographic/clinical facts a supervisor might correct, not bookkeeping
# columns like updated_at. Keys are validated_data/model attribute names
# (post-`source=` resolution), values are what a human reads in the log.
PATIENT_EDIT_LOG_LABELS = {
    'name': 'Name',
    'age': 'Age',
    'gender': 'Sex',
    'room': 'Room',
    'diagnosis': 'Diagnosis',
    'risk_level': 'Risk Level',
    'attending_physician': 'Attending Physician',
    'department': 'Department',
    'admission_date': 'Admission Date',
    'heart_rate': 'Heart Rate',
    'blood_pressure': 'Blood Pressure',
    'temperature': 'Temperature',
    'oxygen_saturation': 'Oxygen Saturation',
    'respiratory_rate': 'Respiratory Rate',
}


class PatientSerializer(serializers.ModelSerializer):
    """Matches CapstoneFrontEnd Patient interface."""

    id = serializers.CharField(source='patient_code', required=False)
    # Write-only escape hatch: set true once the caller has shown the possible
    # duplicates below and a human has actually confirmed this is a new
    # patient. Never merges or overwrites automatically — see Problem #2.
    confirmDuplicate = serializers.BooleanField(write_only=True, required=False, default=False)
    admissionDate = serializers.DateField(source='admission_date')
    riskLevel = serializers.CharField(source='risk_level')
    attendingPhysician = serializers.CharField(
        source='attending_physician', required=False, allow_blank=True
    )
    vitalSigns = serializers.DictField(required=False)
    assignedNurseId = serializers.SerializerMethodField(read_only=True)
    assignedNurseName = serializers.SerializerMethodField(read_only=True)
    assignedBy = serializers.SerializerMethodField(read_only=True)
    assignedDoctors = serializers.SerializerMethodField(read_only=True)
    status = serializers.ChoiceField(choices=Patient.STATUS_CHOICES, required=False)
    statusLabel = serializers.CharField(source='get_status_display', read_only=True)
    departmentId = serializers.PrimaryKeyRelatedField(
        source='department', queryset=Department.objects.all(), required=False, allow_null=True
    )
    departmentName = serializers.CharField(source='department.name', read_only=True, default='')
    dischargedAt = serializers.DateTimeField(source='discharged_at', read_only=True)
    dischargedByName = serializers.SerializerMethodField(read_only=True)
    # The nurse actually on shift right now for this patient's department,
    # per the Duty Roster — distinct from assignedNurseId/assignedNurseName
    # above (the static day-to-day care assignment). See
    # PatientViewSet.get_serializer_context for how current_duty_by_department
    # is computed once per request rather than per row.
    onDutyNurseId = serializers.SerializerMethodField(read_only=True)
    onDutyNurseName = serializers.SerializerMethodField(read_only=True)
    # {editedBy, editedAt, changes} entries — see update() below. Read-only:
    # this is only ever appended to server-side, never written directly.
    editHistory = serializers.ListField(source='edit_history', read_only=True)
    lastEditedAt = serializers.SerializerMethodField(read_only=True)
    lastEditedByName = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = Patient
        fields = [
            'id',
            'name',
            'age',
            'gender',
            'room',
            'diagnosis',
            'admissionDate',
            'riskLevel',
            'status',
            'statusLabel',
            'attendingPhysician',
            'departmentId',
            'departmentName',
            'dischargedAt',
            'dischargedByName',
            'vitalSigns',
            'allergies',
            'medications',
            'alerts',
            'assignedNurseId',
            'assignedNurseName',
            'assignedBy',
            'assignedDoctors',
            'onDutyNurseId',
            'onDutyNurseName',
            'editHistory',
            'lastEditedAt',
            'lastEditedByName',
            'confirmDuplicate',
        ]

    def get_lastEditedAt(self, obj):
        history = obj.edit_history or []
        return history[-1]['editedAt'] if history else None

    def get_lastEditedByName(self, obj):
        history = obj.edit_history or []
        return history[-1]['editedBy'] if history else None

    def get_dischargedByName(self, obj):
        if not obj.discharged_by_id:
            return None
        return obj.discharged_by.get_full_name().strip() or obj.discharged_by.username

    def _current_duty_assignment(self, obj):
        if not obj.department_id:
            return None
        lookup = self.context.get('current_duty_by_department') or {}
        return lookup.get(obj.department_id)

    def get_onDutyNurseId(self, obj):
        assignment = self._current_duty_assignment(obj)
        return str(assignment.nurse_id) if assignment else None

    def get_onDutyNurseName(self, obj):
        assignment = self._current_duty_assignment(obj)
        if not assignment:
            return None
        nurse = assignment.nurse
        return nurse.get_full_name().strip() or nurse.username

    def validate_status(self, value):
        # Discharging is a distinct, audited action (PatientViewSet.discharge)
        # — never a side effect of an ordinary field edit. Already-discharged
        # staying discharged (no-op) is fine; anything else transitioning
        # *to* discharged through this path is not.
        if value == 'discharged' and (self.instance is None or self.instance.status != 'discharged'):
            raise serializers.ValidationError(
                'Use the discharge action to discharge a patient, not a direct status update.'
            )
        return value

    def get_assignedDoctors(self, obj):
        """The patient's Kardex care team — see PatientDoctor. Reads the
        prefetch set up in PatientViewSet.get_queryset() when present (list/
        retrieve), so this never costs an extra query per patient card; falls
        back to a direct query for any other path that serializes a Patient
        without that prefetch."""
        prefetched = getattr(obj, 'active_doctor_assignments', None)
        if prefetched is not None:
            assignments = prefetched
        else:
            assignments = obj.assigned_doctors.filter(status='active').select_related(
                'doctor', 'doctor__department'
            )
        return [
            {
                'id': pd.doctor_id,
                'name': pd.doctor.full_name,
                'specialization': pd.doctor.specialization,
                'departmentName': pd.doctor.department.name,
            }
            for pd in assignments
        ]

    def _last_closed_visit(self, obj):
        return obj.visits.filter(discharge_date__isnull=False).order_by('-discharge_date').first()

    def get_assignedNurseId(self, obj):
        if obj.assigned_nurse_id:
            return str(obj.assigned_nurse_id)
        # discharge clears assigned_nurse (nobody is *actively* assigned to a
        # discharged patient) — fall back to who the last closed visit's
        # snapshot named, so a discharged card can still show "Last Assigned
        # Nurse" instead of just going blank.
        if obj.status == 'discharged':
            visit = self._last_closed_visit(obj)
            if visit and visit.assigned_nurse_id:
                return str(visit.assigned_nurse_id)
        return None

    def get_assignedNurseName(self, obj):
        if obj.assigned_nurse:
            return obj.assigned_nurse.get_full_name().strip() or obj.assigned_nurse.username
        if obj.status == 'discharged':
            visit = self._last_closed_visit(obj)
            if visit and visit.assigned_nurse_name:
                return visit.assigned_nurse_name
        return None

    def get_assignedBy(self, obj):
        """
        Who put this patient on the current nurse's list.

        Now that the roster is shared, every nurse sees patients they are not
        responsible for — so the row has to say who assigned them, not just
        who they are assigned to. Read from the active PatientAssignment,
        which is where that decision is actually recorded.
        """
        prefetched = getattr(obj, 'active_assignments', None)
        if prefetched is not None:
            assignment = prefetched[0] if prefetched else None
        else:
            assignment = (
                obj.assignments.filter(status='active')
                .select_related('assigned_by')
                .order_by('-assigned_at')
                .first()
            )
        if assignment is None or assignment.assigned_by is None:
            return None
        user = assignment.assigned_by
        return user.get_full_name().strip() or user.username

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data['vitalSigns'] = {
            'heartRate': instance.heart_rate,
            'bloodPressure': instance.blood_pressure,
            'temperature': instance.temperature,
            'oxygenSaturation': instance.oxygen_saturation,
            'respiratoryRate': instance.respiratory_rate,
        }
        return data

    def _apply_vitals(self, validated_data):
        vitals = validated_data.pop('vitalSigns', None)
        if not vitals:
            return
        mapping = {
            'heartRate': 'heart_rate',
            'bloodPressure': 'blood_pressure',
            'temperature': 'temperature',
            'oxygenSaturation': 'oxygen_saturation',
            'respiratoryRate': 'respiratory_rate',
        }
        for src, dest in mapping.items():
            if src in vitals and vitals[src] is not None:
                validated_data[dest] = vitals[src]

    def create(self, validated_data):
        confirm_duplicate = validated_data.pop('confirmDuplicate', False)
        if not confirm_duplicate:
            matches = find_possible_duplicate_patients(
                validated_data.get('name'), validated_data.get('age')
            )
            if matches:
                raise serializers.ValidationError(duplicate_patient_payload(matches))

        self._apply_vitals(validated_data)
        code = validated_data.pop('patient_code', None) or next_code(Patient, 'patient_code', 'P')
        validated_data['patient_code'] = code
        request = self.context.get('request')
        if request and request.user.is_authenticated and not validated_data.get('assigned_nurse'):
            validated_data['assigned_nurse'] = request.user
        patient = Patient.objects.create(**validated_data)
        open_patient_visit(patient)
        return patient

    def update(self, instance, validated_data):
        validated_data.pop('patient_code', None)
        self._apply_vitals(validated_data)

        changed_labels = []
        for attr, value in validated_data.items():
            label = PATIENT_EDIT_LOG_LABELS.get(attr)
            if label and getattr(instance, attr) != value:
                changed_labels.append(label)
            setattr(instance, attr, value)

        if changed_labels:
            request = self.context.get('request')
            editor = (
                nurse_display_name(request.user)
                if request and request.user.is_authenticated
                else ''
            )
            history = list(instance.edit_history or [])
            history.append(
                {
                    'editedBy': editor,
                    'editedAt': timezone.now().isoformat(),
                    'changes': changed_labels,
                }
            )
            instance.edit_history = history

        instance.save()

        # A discharged patient's current fields are what the card shows as
        # "Last Diagnosis"/"Last Room"/etc. — correcting them (e.g. a
        # misrecorded diagnosis) must also correct the closed visit's own
        # snapshot, or the visit history still shows the old, wrong value
        # even though the card itself now looks right. Status is never
        # touched here — editing a discharged patient's record never
        # readmits them; that's PatientViewSet.readmit's job alone.
        if instance.status == 'discharged' and changed_labels:
            visit = instance.visits.filter(discharge_date__isnull=False).order_by('-discharge_date').first()
            if visit is not None:
                visit.diagnosis = instance.diagnosis
                visit.room = instance.room
                visit.attending_physician = instance.attending_physician
                visit.save(update_fields=['diagnosis', 'room', 'attending_physician', 'updated_at'])

        # Keep linked kardex demographics in sync with the patient record
        name_parts = (instance.name or '').split()
        first = name_parts[0] if name_parts else ''
        last = name_parts[-1] if len(name_parts) > 1 else ''
        middle = ' '.join(name_parts[1:-1]) if len(name_parts) > 2 else ''
        for kardex in instance.kardex_records.all():
            kardex.first_name = first or kardex.first_name
            kardex.last_name = last or kardex.last_name
            kardex.middle_name = middle
            kardex.age = str(instance.age)
            kardex.gender = instance.gender or kardex.gender
            kardex.room = instance.room or kardex.room
            kardex.admission_date = (
                instance.admission_date.isoformat() if instance.admission_date else kardex.admission_date
            )
            kardex.attending_physician = instance.attending_physician or kardex.attending_physician
            kardex.admitting_diagnosis = instance.diagnosis or kardex.admitting_diagnosis
            if instance.heart_rate:
                kardex.pulse_rate = str(instance.heart_rate)
            if instance.blood_pressure:
                kardex.blood_pressure = instance.blood_pressure
            if instance.temperature:
                kardex.temperature = str(instance.temperature)
            if instance.oxygen_saturation:
                kardex.oxygen_saturation = str(instance.oxygen_saturation)
            if instance.respiratory_rate:
                kardex.respiratory_rate = str(instance.respiratory_rate)
            kardex.save()
        return instance


class PatientVisitSerializer(serializers.ModelSerializer):
    """
    One admission-to-discharge encounter — read-only, always nested under a
    Patient (see PatientViewSet.visits). The still-open visit (discharge_date
    is null) shows Patient's live current fields rather than its own snapshot,
    since that snapshot is only written at discharge (see
    PatientViewSet.discharge) — otherwise the active stay would show
    whatever it looked like at admission, not now.
    """

    id = serializers.IntegerField(read_only=True)
    admissionDate = serializers.DateField(source='admission_date', read_only=True)
    dischargeDate = serializers.DateTimeField(source='discharge_date', read_only=True)
    isActive = serializers.SerializerMethodField()
    diagnosis = serializers.SerializerMethodField()
    room = serializers.SerializerMethodField()
    attendingPhysician = serializers.SerializerMethodField()
    assignedNurseName = serializers.SerializerMethodField()
    medicalTeam = serializers.SerializerMethodField()
    dischargedByName = serializers.SerializerMethodField()
    vitals = serializers.SerializerMethodField()
    notes = serializers.SerializerMethodField()

    class Meta:
        model = PatientVisit
        fields = [
            'id', 'admissionDate', 'dischargeDate', 'isActive', 'diagnosis', 'room',
            'attendingPhysician', 'assignedNurseName', 'medicalTeam', 'dischargedByName',
            'vitals', 'notes',
        ]

    def _is_open(self, obj):
        return obj.discharge_date is None

    def get_isActive(self, obj):
        return self._is_open(obj)

    def get_diagnosis(self, obj):
        return obj.patient.diagnosis if self._is_open(obj) else obj.diagnosis

    def get_room(self, obj):
        return obj.patient.room if self._is_open(obj) else obj.room

    def get_attendingPhysician(self, obj):
        return obj.patient.attending_physician if self._is_open(obj) else obj.attending_physician

    def get_assignedNurseName(self, obj):
        if self._is_open(obj):
            return nurse_display_name(obj.patient.assigned_nurse) or None
        return obj.assigned_nurse_name or None

    def get_medicalTeam(self, obj):
        if self._is_open(obj):
            return medical_team_snapshot(obj.patient)
        return obj.medical_team or []

    def get_dischargedByName(self, obj):
        return nurse_display_name(obj.discharged_by) or None

    def get_vitals(self, obj):
        qs = VitalSigns.objects.filter(patient_id=obj.patient_id, recorded_at__date__gte=obj.admission_date)
        if obj.discharge_date:
            qs = qs.filter(recorded_at__lte=obj.discharge_date)
        return [
            {
                'id': v.id,
                'recordedAt': v.recorded_at.isoformat(),
                'heartRate': v.heart_rate,
                'bloodPressure': v.blood_pressure,
                'temperature': v.temperature,
                'oxygenSaturation': v.oxygen_saturation,
                'respiratoryRate': v.respiratory_rate,
                'painScale': v.pain_scale,
                'source': v.source,
            }
            for v in qs.order_by('-recorded_at')[:50]
        ]

    def get_notes(self, obj):
        qs = ChartingNote.objects.filter(patient_id=obj.patient_id, timestamp__date__gte=obj.admission_date)
        if obj.discharge_date:
            qs = qs.filter(timestamp__lte=obj.discharge_date)
        return [
            {
                'id': n.note_code,
                'timestamp': n.timestamp.isoformat(),
                'type': n.note_type,
                'content': (n.content or '')[:300],
            }
            for n in qs.order_by('-timestamp')[:50]
        ]


class DepartmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Department
        fields = ['id', 'name']


class DoctorSerializer(serializers.ModelSerializer):
    departmentId = serializers.PrimaryKeyRelatedField(
        source='department', queryset=Department.objects.all()
    )
    departmentName = serializers.CharField(source='department.name', read_only=True)
    fullName = serializers.CharField(source='full_name')
    licenseNumber = serializers.CharField(
        source='license_number', required=False, allow_blank=True
    )

    class Meta:
        model = Doctor
        fields = [
            'id', 'fullName', 'specialization', 'departmentId', 'departmentName',
            'licenseNumber', 'status',
        ]


class TaskSerializer(serializers.ModelSerializer):
    id = serializers.CharField(source='task_code', required=False)
    patientId = serializers.CharField(required=False, allow_blank=True)
    patientName = serializers.CharField(source='patient_name', required=False, allow_blank=True)
    dueTime = serializers.CharField(source='due_time', required=False, allow_blank=True)
    departmentId = serializers.PrimaryKeyRelatedField(
        source='department', queryset=Department.objects.all(), required=False, allow_null=True
    )
    departmentName = serializers.CharField(source='department.name', read_only=True, default='')
    # Write-only: the set of doctor accounts to attach via TaskDoctor. Kept
    # separate from the read-only assignedDoctors below because creating a
    # Task needs raw IDs in, while every other consumer of this serializer
    # wants full {id, name, specialization} objects out.
    doctorIds = serializers.ListField(
        child=serializers.IntegerField(), required=False, write_only=True, allow_empty=True
    )
    assignedDoctors = serializers.SerializerMethodField()
    assignedTo = serializers.CharField(
        source='assigned_to', required=False, allow_blank=True, default=''
    )
    createdAt = serializers.DateTimeField(source='created_at', read_only=True)
    completedAt = serializers.DateTimeField(source='completed_at', required=False, allow_null=True)
    attendingPhysician = serializers.CharField(
        source='attending_physician', required=False, allow_blank=True
    )
    patientRoom = serializers.CharField(source='patient_room', required=False, allow_blank=True)
    doctorOrder = serializers.CharField(source='doctor_order', required=False, allow_blank=True)
    checklist = serializers.ListField(child=serializers.DictField(), required=False)

    class Meta:
        model = Task
        fields = [
            'id',
            'patientId',
            'patientName',
            'title',
            'description',
            'priority',
            'dueTime',
            'departmentId',
            'departmentName',
            'doctorIds',
            'assignedDoctors',
            'assignedTo',
            'status',
            'category',
            'createdAt',
            'completedAt',
            'attendingPhysician',
            'patientRoom',
            'doctorOrder',
            'checklist',
        ]

    def get_assignedDoctors(self, obj):
        return [
            {
                'id': td.doctor_id,
                'name': td.doctor.full_name,
                'specialization': td.doctor.specialization,
            }
            for td in obj.task_doctors.select_related('doctor').all()
        ]

    def _validate_doctor_ids(self, patient, department, doctor_ids):
        """Never trust the frontend: re-check every doctor id against the
        department it claims to belong to, that it's active, and — the
        important one — that this doctor is actually on the selected
        patient's Kardex care team. A doctor who is real, active, and in the
        right department but assigned to a *different* patient must still be
        rejected; task assignment is not a hospital-wide doctor picker."""
        if not doctor_ids:
            raise serializers.ValidationError(
                {'doctorIds': 'Please select at least one doctor.'}
            )
        doctors = list(Doctor.objects.filter(pk__in=doctor_ids).select_related('department'))
        found_ids = {d.pk for d in doctors}
        missing = [d for d in doctor_ids if d not in found_ids]
        if missing:
            raise serializers.ValidationError(
                {'doctorIds': f'Doctor(s) not found: {", ".join(str(m) for m in missing)}.'}
            )
        assigned_ids = set(
            PatientDoctor.objects.filter(
                patient=patient, doctor_id__in=doctor_ids, status='active'
            ).values_list('doctor_id', flat=True)
        ) if patient is not None else set()
        for doctor in doctors:
            if doctor.status != 'active':
                raise serializers.ValidationError(
                    {'doctorIds': f'{doctor.full_name} is not available and cannot be assigned.'}
                )
            if doctor.department_id != department.pk:
                raise serializers.ValidationError(
                    {
                        'doctorIds': (
                            f'{doctor.full_name} does not belong to the selected department.'
                        )
                    }
                )
            if patient is None or doctor.pk not in assigned_ids:
                raise serializers.ValidationError(
                    {'doctorIds': 'The selected doctor is not assigned to this patient.'}
                )
        return doctors

    def _sync_doctors(self, task, doctors, actor):
        TaskDoctor.objects.filter(task=task).exclude(
            doctor_id__in=[d.pk for d in doctors]
        ).delete()
        existing_ids = set(
            TaskDoctor.objects.filter(task=task).values_list('doctor_id', flat=True)
        )
        TaskDoctor.objects.bulk_create(
            [
                TaskDoctor(task=task, doctor=doctor, assigned_by=actor)
                for doctor in doctors
                if doctor.pk not in existing_ids
            ]
        )

    def validate_checklist(self, value):
        for item in value:
            if 'text' not in item or 'done' not in item:
                raise serializers.ValidationError(
                    'Each checklist item needs "text" and "done".'
                )
        return value

    def validate_patientId(self, value):
        if not value:
            return value
        if not Patient.objects.filter(patient_code=value).exists():
            raise serializers.ValidationError('Patient not found.')
        return value

    def _resolve_patient(self, validated_data, patient_id):
        if not patient_id:
            validated_data['patient'] = None
            return
        patient = Patient.objects.filter(patient_code=patient_id).first()
        validated_data['patient'] = patient
        if patient:
            validated_data.setdefault('patient_name', patient.name)
            validated_data.setdefault('patient_room', patient.room)
            validated_data.setdefault('attending_physician', patient.attending_physician)

    def _pop_doctor_selection(self, validated_data, patient, department):
        """Doctors are only validated/attached when a department was actually
        sent — callers that don't touch department/doctors at all (e.g. the
        nurse-assignment flow) are left exactly as before."""
        doctor_ids = validated_data.pop('doctorIds', None)
        if doctor_ids is None:
            return None
        if department is None:
            raise serializers.ValidationError(
                {'departmentId': 'Select a department before assigning doctors.'}
            )
        return self._validate_doctor_ids(patient, department, doctor_ids)

    def create(self, validated_data):
        patient_id = validated_data.pop('patientId', None)
        self._resolve_patient(validated_data, patient_id)
        doctors = self._pop_doctor_selection(
            validated_data, validated_data.get('patient'), validated_data.get('department')
        )
        code = validated_data.pop('task_code', None) or next_code(Task, 'task_code', 'T')
        validated_data['task_code'] = code
        request = self.context.get('request')
        actor = request.user if request and request.user.is_authenticated else None
        assigned_to = validated_data.get('assigned_to') or ''
        assigned_nurse = None
        if assigned_to:
            for user in User.objects.select_related('nurse_profile').all():
                full = user.get_full_name().strip()
                if full == assigned_to or user.username == assigned_to:
                    assigned_nurse = user
                    break
        if not assigned_nurse and request and request.user.is_authenticated:
            assigned_nurse = request.user
            if not (validated_data.get('assigned_to') or '').strip():
                validated_data['assigned_to'] = (
                    request.user.get_full_name().strip() or request.user.username
                )
        if assigned_nurse:
            validated_data['assigned_nurse'] = assigned_nurse
        if doctors:
            # Keep the plain-text display field (shown across patient/task
            # cards elsewhere in the app) in sync rather than leaving it
            # blank now that the real doctor list lives in TaskDoctor.
            validated_data['attending_physician'] = ', '.join(d.full_name for d in doctors)
        task = Task.objects.create(**validated_data)
        if doctors:
            self._sync_doctors(task, doctors, actor)
        notify_task_assigned(task, actor=request.user if request else None)
        return task

    def update(self, instance, validated_data):
        patient_id = validated_data.pop('patientId', serializers.empty)
        if patient_id is not serializers.empty:
            self._resolve_patient(validated_data, patient_id)
        patient = validated_data.get('patient', instance.patient)
        department = validated_data.get('department', instance.department)
        doctors = self._pop_doctor_selection(validated_data, patient, department)
        validated_data.pop('task_code', None)
        if 'assigned_to' in validated_data:
            assigned_to = validated_data.get('assigned_to') or ''
            for user in User.objects.select_related('nurse_profile').all():
                full = user.get_full_name().strip()
                if full == assigned_to or user.username == assigned_to:
                    validated_data['assigned_nurse'] = user
                    break
        if doctors is not None:
            validated_data['attending_physician'] = (
                ', '.join(d.full_name for d in doctors) if doctors else ''
            )
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        if instance.status == 'completed' and not instance.completed_at:
            instance.completed_at = timezone.now()
            instance.priority = 'completed'
        instance.save()
        if doctors is not None:
            request = self.context.get('request')
            actor = request.user if request and request.user.is_authenticated else None
            self._sync_doctors(instance, doctors, actor)
        return instance


class HandoverSerializer(serializers.ModelSerializer):
    id = serializers.CharField(source='handover_code', required=False)
    patientId = serializers.CharField(required=False, allow_blank=True)
    patientName = serializers.CharField(source='patient_name', required=False, allow_blank=True)
    nurseFrom = serializers.CharField(source='nurse_from')
    nurseTo = serializers.CharField(source='nurse_to')
    # The account behind nurseTo. The handover form picks a nurse from a list,
    # so it already knows this; sending it means notifications reach exactly one
    # inbox instead of guessing from a display name several nurses share.
    nurseToId = serializers.CharField(required=False, allow_blank=True, write_only=True)
    sbar = serializers.DictField(required=False)
    unfinishedTasks = serializers.ListField(
        child=serializers.CharField(), source='unfinished_tasks', required=False
    )
    photos = serializers.ListField(required=False)
    status = serializers.CharField(required=False)
    date = serializers.DateField()

    class Meta:
        model = HandoverNote
        fields = [
            'id',
            'patientId',
            'patientName',
            'shift',
            'date',
            'nurseFrom',
            'nurseTo',
            'nurseToId',
            'sbar',
            'unfinishedTasks',
            'photos',
            'status',
        ]

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data['sbar'] = {
            'situation': instance.situation,
            'background': instance.background,
            'assessment': instance.assessment,
            'recommendation': instance.recommendation,
        }
        data['patientId'] = instance.patient.patient_code if instance.patient_id else ''
        return data

    def _apply_sbar(self, validated_data):
        sbar = validated_data.pop('sbar', None)
        if not sbar:
            return
        validated_data['situation'] = sbar.get('situation', '')
        validated_data['background'] = sbar.get('background', '')
        validated_data['assessment'] = sbar.get('assessment', '')
        validated_data['recommendation'] = sbar.get('recommendation', '')

    def _resolve_patient(self, validated_data, patient_id):
        if not patient_id:
            validated_data['patient'] = None
            return
        patient = Patient.objects.filter(patient_code=patient_id).first()
        if not patient:
            raise serializers.ValidationError({'patientId': 'Patient not found.'})
        validated_data['patient'] = patient
        validated_data.setdefault('patient_name', patient.name)

    def create(self, validated_data):
        patient_id = validated_data.pop('patientId', None)
        self._resolve_patient(validated_data, patient_id)
        # Resolved before the duplicate check below needs to know which
        # account is being targeted.
        self._resolve_recipient(validated_data)

        # A given nurse can only receive one handover for a given patient —
        # once Nurse X has been handed Patient Y, Nurse X is done with that
        # patient's handover history and must not be offered (or accepted)
        # for Patient Y again. This is scoped to the (patient, nurse) pair,
        # not the patient alone, so a different nurse can still receive the
        # same patient concurrently — see NurseViewSet.list's excludeForPatient
        # for the matching frontend-facing query.
        patient = validated_data.get('patient')
        recipient = validated_data.get('nurse_to_user')
        if patient is not None:
            existing_qs = HandoverNote.objects.filter(patient=patient)
            existing_qs = (
                existing_qs.filter(nurse_to_user=recipient)
                if recipient is not None
                # No resolved account (unrecognized/ambiguous name) — fall back
                # to matching on the typed name so this check still does something.
                else existing_qs.filter(nurse_to=validated_data.get('nurse_to'))
            )
            existing = existing_qs.order_by('-created_at').first()
            if existing is not None:
                raise serializers.ValidationError(
                    {
                        'nurseToId': (
                            f'{patient.name} has already been handed over to '
                            f'{existing.nurse_to} ({existing.handover_code}). Choose a '
                            'different nurse for this patient.'
                        )
                    }
                )

        self._apply_sbar(validated_data)
        code = validated_data.pop('handover_code', None) or next_code(
            HandoverNote, 'handover_code', 'H'
        )
        validated_data['handover_code'] = code
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            validated_data['created_by'] = request.user
        handover = HandoverNote.objects.create(**validated_data)
        # The work is the sender's until somebody accepts it, so it goes on
        # their task list now rather than existing only as text on a card.
        create_handover_tasks(handover)
        notify_handover_created(handover)
        return handover

    def _resolve_recipient(self, validated_data):
        """Attach the receiving nurse's account, by id when given, else by name."""
        nurse_to_id = (validated_data.pop('nurseToId', '') or '').strip()
        if nurse_to_id:
            recipient = User.objects.filter(pk=nurse_to_id).first()
            if recipient is None:
                raise serializers.ValidationError({'nurseToId': 'Nurse not found.'})
            validated_data['nurse_to_user'] = recipient
            validated_data.setdefault(
                'nurse_to', recipient.get_full_name().strip() or recipient.username
            )
            return
        # Older clients and the API docs send only a name; fall back to matching
        # on it. A handover that saves but resolves to nobody looks identical
        # to a working one from the sender's side — it appears in their list —
        # so the only symptom is a popup that never arrives. Reject it instead:
        # this ward has several nurses sharing a display name, so "ambiguous"
        # is a routine outcome here, not a rare edge case worth staying quiet
        # about.
        name = validated_data.get('nurse_to')
        if name:
            recipient = resolve_nurse(name)
            if recipient is None:
                raise serializers.ValidationError(
                    {
                        'nurseToId': (
                            f'Could not determine a single account for "{name}" — no match, or '
                            'more than one nurse has this name. Select the nurse from the list.'
                        )
                    }
                )
            validated_data['nurse_to_user'] = recipient

    def update(self, instance, validated_data):
        patient_id = validated_data.pop('patientId', serializers.empty)
        if patient_id is not serializers.empty:
            self._resolve_patient(validated_data, patient_id)
        self._apply_sbar(validated_data)
        validated_data.pop('handover_code', None)
        if 'nurseToId' in validated_data or 'nurse_to' in validated_data:
            self._resolve_recipient(validated_data)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        return instance


def content_from_structured(structured: dict) -> str:
    """Build a readable narrative from structured sections when note text is empty."""
    if not isinstance(structured, dict) or not structured:
        return ''
    lines: list[str] = []
    name = structured.get('patientName') or ''
    pid = structured.get('patientId') or ''
    room = structured.get('room') or ''
    if name or pid or room:
        lines.append('NURSING PROGRESS NOTE')
        if name:
            lines.append(f'Patient Name: {name}')
        if pid:
            lines.append(f'Patient ID: {pid}')
        if room:
            lines.append(f'Room: {room}')
        if structured.get('date'):
            lines.append(f'Date: {structured["date"]}')
        if structured.get('time'):
            lines.append(f'Time: {structured["time"]}')
        if structured.get('attendingPhysician'):
            lines.append(f'Attending Physician: {structured["attendingPhysician"]}')
        if structured.get('nurseName'):
            lines.append(f'Nurse: {structured["nurseName"]}')
        lines.append('')
    vitals = structured.get('vitalSigns') or {}
    if isinstance(vitals, dict) and any(str(v).strip() for v in vitals.values() if v is not None):
        lines.append('VITAL SIGNS')
        for key, label in (
            ('heartRate', 'Heart Rate'),
            ('bloodPressure', 'Blood Pressure'),
            ('temperature', 'Temperature'),
            ('oxygenSaturation', 'Oxygen Saturation'),
            ('respiratoryRate', 'Respiratory Rate'),
        ):
            val = vitals.get(key)
            if val is not None and str(val).strip():
                lines.append(f'{label}: {val}')
        lines.append('')
    assessment = (structured.get('assessment') or '').strip()
    if assessment:
        lines.append('ASSESSMENT & OBSERVATIONS')
        lines.append(assessment)
        lines.append('')
    for key, label in (
        ('diagnosis', 'Current Diagnosis'),
        ('riskLevel', 'Risk Level'),
        ('allergies', 'Allergies'),
        ('medications', 'Active Medications'),
        ('alerts', 'Alerts'),
    ):
        val = structured.get(key)
        if val is not None and str(val).strip():
            lines.append(f'{label}: {val}')
    interventions = structured.get('interventions') or []
    if isinstance(interventions, list) and interventions:
        lines.append('')
        lines.append('INTERVENTIONS')
        for item in interventions:
            text = str(item).strip()
            if text:
                lines.append(f'- {text}')
    response = (structured.get('patientResponse') or '').strip()
    if response:
        lines.append('')
        lines.append('PATIENT RESPONSE')
        lines.append(response)
    summary = (structured.get('clinicalSummary') or '').strip()
    if summary:
        lines.append('')
        lines.append('CLINICAL SUMMARY')
        lines.append(summary)
    plan = (structured.get('plan') or '').strip()
    if plan:
        lines.append('')
        lines.append(f'Plan: {plan}')
    return '\n'.join(lines).strip()


def structured_has_clinical_content(structured: dict | None) -> bool:
    if not isinstance(structured, dict) or not structured:
        return False
    if (structured.get('assessment') or '').strip():
        return True
    if (structured.get('patientResponse') or '').strip():
        return True
    if (structured.get('clinicalSummary') or '').strip():
        return True
    if (structured.get('plan') or '').strip():
        return True
    interventions = structured.get('interventions') or []
    if isinstance(interventions, list) and any(str(i).strip() for i in interventions):
        return True
    vitals = structured.get('vitalSigns') or {}
    if isinstance(vitals, dict) and any(
        v is not None and str(v).strip() for v in vitals.values()
    ):
        return True
    for key in ('diagnosis', 'allergies', 'medications', 'alerts'):
        if structured.get(key) is not None and str(structured.get(key)).strip():
            return True
    return False


class ChartingNoteSerializer(serializers.ModelSerializer):
    id = serializers.CharField(source='note_code', required=False)
    patientId = serializers.CharField(required=False, allow_blank=True)
    patientName = serializers.CharField(source='patient_name', required=False, allow_blank=True)
    nurseId = serializers.SerializerMethodField()
    nurseName = serializers.CharField(source='nurse_name', required=False, allow_blank=True)
    timestamp = serializers.DateTimeField()
    type = serializers.CharField(source='note_type')
    aiGenerated = serializers.BooleanField(source='ai_generated', required=False)
    edited = serializers.BooleanField(required=False)
    attendingPhysician = serializers.CharField(
        source='attending_physician', required=False, allow_blank=True
    )
    editHistory = serializers.ListField(source='edit_history', required=False)
    content = serializers.CharField(allow_blank=True)
    structured = serializers.JSONField(source='structured_data', required=False)
    confirmed = serializers.BooleanField(required=False)
    confirmedAt = serializers.DateTimeField(source='confirmed_at', required=False, allow_null=True, read_only=True)
    # Auto-charting — never client-writable, always derived server-side from
    # the note's own text (see _apply_vitals_flag). 'vitalSignChangeNoted' /
    # 'vitalSignsAffected' inside `structured` are the nurse-facing explicit
    # alternative to keyword detection; both feed the same two fields here.
    vitalsUpdateStatus = serializers.CharField(source='vitals_update_status', read_only=True)
    flaggedVitals = serializers.ListField(source='flagged_vitals', read_only=True)
    createdAt = serializers.DateTimeField(source='created_at', read_only=True)
    updatedAt = serializers.DateTimeField(source='updated_at', read_only=True)

    class Meta:
        model = ChartingNote
        fields = [
            'id',
            'patientId',
            'patientName',
            'nurseId',
            'nurseName',
            'timestamp',
            'type',
            'content',
            'structured',
            'vitalsUpdateStatus',
            'flaggedVitals',
            'aiGenerated',
            'edited',
            'confirmed',
            'confirmedAt',
            'attendingPhysician',
            'editHistory',
            'createdAt',
            'updatedAt',
        ]

    def get_nurseId(self, obj):
        return str(obj.nurse_id) if obj.nurse_id else ''

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data['patientId'] = instance.patient.patient_code if instance.patient_id else ''
        data['structured'] = instance.structured_data or {}
        return data

    def validate(self, attrs):
        content = (attrs.get('content') if 'content' in attrs else None)
        structured = attrs.get('structured_data') if 'structured_data' in attrs else None

        if self.instance is None:
            # Create: refuse empty charts that would show as successful saves.
            content_text = (content or '').strip()
            structured_payload = structured if isinstance(structured, dict) else {}
            if not content_text and not structured_has_clinical_content(structured_payload):
                raise serializers.ValidationError(
                    {
                        'content': (
                            'Cannot save an empty charting note. Provide note content '
                            'or structured chart data.'
                        )
                    }
                )
            if not content_text and structured_payload:
                attrs['content'] = content_from_structured(structured_payload)
            attrs.setdefault('structured_data', structured_payload)
        else:
            # Update: if content cleared with no structured clinical body, reject.
            next_content = (
                content if content is not None else (self.instance.content or '')
            )
            next_structured = (
                structured
                if structured is not None
                else (self.instance.structured_data or {})
            )
            if not (next_content or '').strip() and not structured_has_clinical_content(
                next_structured if isinstance(next_structured, dict) else {}
            ):
                raise serializers.ValidationError(
                    {'content': 'Cannot clear a charting note to an empty record.'}
                )
            if content is not None and not (content or '').strip() and isinstance(
                next_structured, dict
            ):
                attrs['content'] = content_from_structured(next_structured)
        return attrs

    def _resolve_patient(self, validated_data, patient_id):
        if not patient_id:
            validated_data['patient'] = None
            return
        patient = Patient.objects.filter(patient_code=patient_id).first()
        if not patient:
            raise serializers.ValidationError({'patientId': 'Patient not found.'})
        validated_data['patient'] = patient
        validated_data.setdefault('patient_name', patient.name)
        validated_data.setdefault('attending_physician', patient.attending_physician)

    def create(self, validated_data):
        patient_id = validated_data.pop('patientId', None)
        self._resolve_patient(validated_data, patient_id)
        code = validated_data.pop('note_code', None) or next_code(ChartingNote, 'note_code', 'C')
        validated_data['note_code'] = code
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            validated_data['nurse'] = request.user
            validated_data.setdefault(
                'nurse_name',
                request.user.get_full_name().strip() or request.user.username,
            )
        validated_data.setdefault('structured_data', {})
        validated_data['confirmed'] = False
        validated_data['confirmed_at'] = None
        instance = ChartingNote.objects.create(**validated_data)
        self._apply_vitals_flag(instance)
        return instance

    def update(self, instance, validated_data):
        patient_id = validated_data.pop('patientId', serializers.empty)
        if patient_id is not serializers.empty:
            self._resolve_patient(validated_data, patient_id)
        validated_data.pop('note_code', None)
        request = self.context.get('request')
        content_changed = (
            'content' in validated_data and validated_data['content'] != instance.content
        )
        structured_changed = (
            'structured_data' in validated_data
            and validated_data['structured_data'] != (instance.structured_data or {})
        )
        if content_changed or structured_changed:
            history = list(instance.edit_history or [])
            editor = ''
            if request and request.user.is_authenticated:
                editor = request.user.get_full_name().strip() or request.user.username
            history.append(
                {
                    'editedBy': editor,
                    'editedAt': timezone.now().isoformat(),
                    'changes': 'Content updated',
                }
            )
            validated_data['edit_history'] = history
            validated_data['edited'] = True
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        if content_changed or structured_changed:
            self._apply_vitals_flag(instance)
        return instance

    def _apply_vitals_flag(self, note):
        """
        Auto-charting trigger detection — run after every create/content-
        changing update. Only ever moves a note from 'none' to 'pending':
        never re-flags a note a nurse has already resolved (confirmed a new
        VitalSigns entry) or one already sitting pending, so re-saving an
        already-addressed note can't resurrect a stale prompt.
        """
        if note.vitals_update_status != 'none':
            return

        structured = note.structured_data if isinstance(note.structured_data, dict) else {}
        explicit_flag = bool(structured.get('vitalSignChangeNoted'))
        explicit_vitals = structured.get('vitalSignsAffected') or []
        text = ' '.join(filter(None, [note.content or '', structured.get('assessment') or '']))

        detected = set(detect_vital_mentions(text))
        if explicit_flag:
            detected |= {v for v in explicit_vitals if v}

        if not detected:
            return

        note.flagged_vitals = sorted(detected)
        note.vitals_update_status = 'pending'
        note.save(update_fields=['flagged_vitals', 'vitals_update_status'])


class VitalSignsSerializer(serializers.ModelSerializer):
    """
    One timestamped vitals reading — insert-only (VitalSignsViewSet has no
    update/destroy), so this serializer only ever creates new rows. Creating
    one also syncs Patient's own heart_rate/etc. "current snapshot" fields,
    which every existing reader (Kardex, handover SBAR autofill, dashboards)
    still uses — see create() below.
    """

    id = serializers.IntegerField(read_only=True)
    patientId = serializers.SlugRelatedField(
        source='patient', slug_field='patient_code', queryset=Patient.objects.all()
    )
    heartRate = serializers.IntegerField(source='heart_rate', required=False, allow_null=True)
    bloodPressure = serializers.CharField(source='blood_pressure', required=False, allow_blank=True)
    temperature = serializers.FloatField(required=False, allow_null=True)
    oxygenSaturation = serializers.IntegerField(source='oxygen_saturation', required=False, allow_null=True)
    respiratoryRate = serializers.IntegerField(source='respiratory_rate', required=False, allow_null=True)
    painScale = serializers.IntegerField(source='pain_scale', required=False, allow_null=True)
    source = serializers.ChoiceField(choices=VitalSigns.SOURCE_CHOICES, required=False)
    # Set from this, not accepted directly from the client — a reading is
    # only "assessment-triggered" because a real note triggered it.
    triggeredByNoteId = serializers.SlugRelatedField(
        source='triggered_by_note', slug_field='note_code',
        queryset=ChartingNote.objects.all(), required=False, allow_null=True,
    )
    recordedById = serializers.IntegerField(source='recorded_by_id', read_only=True)
    recordedByName = serializers.SerializerMethodField()
    notes = serializers.CharField(required=False, allow_blank=True)
    recordedAt = serializers.DateTimeField(source='recorded_at', required=False)
    createdAt = serializers.DateTimeField(source='created_at', read_only=True)

    class Meta:
        model = VitalSigns
        fields = [
            'id', 'patientId', 'heartRate', 'bloodPressure', 'temperature',
            'oxygenSaturation', 'respiratoryRate', 'painScale', 'source',
            'triggeredByNoteId', 'recordedById', 'recordedByName', 'notes',
            'recordedAt', 'createdAt',
        ]

    def get_recordedByName(self, obj):
        if not obj.recorded_by_id:
            return None
        return obj.recorded_by.get_full_name().strip() or obj.recorded_by.username

    def create(self, validated_data):
        request = self.context.get('request')
        validated_data['recorded_by'] = request.user if request else None
        validated_data.setdefault(
            'source', 'assessment_triggered' if validated_data.get('triggered_by_note') else 'scheduled'
        )
        instance = super().create(validated_data)
        self._sync_patient_snapshot(instance)
        note = instance.triggered_by_note
        if note is not None:
            note.vitals_update_status = 'resolved'
            note.save(update_fields=['vitals_update_status'])
        return instance

    def _sync_patient_snapshot(self, instance):
        patient = instance.patient
        if instance.heart_rate is not None:
            patient.heart_rate = instance.heart_rate
        if instance.blood_pressure:
            patient.blood_pressure = instance.blood_pressure
        if instance.temperature is not None:
            patient.temperature = instance.temperature
        if instance.oxygen_saturation is not None:
            patient.oxygen_saturation = instance.oxygen_saturation
        if instance.respiratory_rate is not None:
            patient.respiratory_rate = instance.respiratory_rate
        patient.save(
            update_fields=[
                'heart_rate', 'blood_pressure', 'temperature',
                'oxygen_saturation', 'respiratory_rate', 'updated_at',
            ]
        )


class NotificationSerializer(serializers.ModelSerializer):
    id = serializers.SerializerMethodField()
    type = serializers.CharField(source='notification_type')
    patient = serializers.CharField(source='patient_label', required=False, allow_blank=True)
    time = serializers.SerializerMethodField()
    isRead = serializers.BooleanField(source='is_read')
    action = serializers.SerializerMethodField()
    # What happened, as opposed to how severe it looks. The app raises a popup
    # for a patient handover and only a bell entry for everything else.
    event = serializers.CharField(read_only=True)
    patientId = serializers.SerializerMethodField()
    handoverId = serializers.SerializerMethodField()
    senderName = serializers.SerializerMethodField()
    # Exact timestamp alongside the human 'time' string, so a popup can show a
    # clock time rather than "3 mins ago".
    createdAt = serializers.DateTimeField(source='created_at', read_only=True)

    class Meta:
        model = Notification
        fields = [
            'id',
            'type',
            'event',
            'title',
            'message',
            'patient',
            'patientId',
            'handoverId',
            'senderName',
            'time',
            'createdAt',
            'isRead',
            'action',
        ]
        read_only_fields = fields

    def get_patientId(self, obj):
        return obj.patient.patient_code if obj.patient_id else None

    def get_handoverId(self, obj):
        return obj.handover.handover_code if obj.handover_id else None

    def get_senderName(self, obj):
        if not obj.sender_id:
            return None
        return obj.sender.get_full_name().strip() or obj.sender.username

    def get_id(self, obj):
        return str(obj.pk)

    def get_time(self, obj):
        delta = timezone.now() - obj.created_at
        minutes = int(delta.total_seconds() // 60)
        if minutes < 1:
            return 'Just now'
        if minutes < 60:
            return f'{minutes} min{"s" if minutes != 1 else ""} ago'
        hours = minutes // 60
        if hours < 24:
            return f'{hours} hour{"s" if hours != 1 else ""} ago'
        days = hours // 24
        return f'{days} day{"s" if days != 1 else ""} ago'

    def get_action(self, obj):
        if not obj.action_label or not obj.action_path:
            return None
        action = {'label': obj.action_label, 'path': obj.action_path}
        if obj.action_highlight_id:
            action['highlightId'] = obj.action_highlight_id
        return action


class PatientAssignmentSerializer(serializers.ModelSerializer):
    id = serializers.SerializerMethodField()
    patientId = serializers.CharField(write_only=True)
    patientName = serializers.SerializerMethodField()
    room = serializers.SerializerMethodField()
    ward = serializers.CharField(required=False, allow_blank=True)
    diagnosis = serializers.SerializerMethodField()
    assignedNurse = serializers.CharField(source='assigned_nurse_name', required=False)
    assignedNurseId = serializers.CharField(write_only=True, required=False)
    nurseId = serializers.CharField(write_only=True, required=False)
    nurseName = serializers.CharField(write_only=True, required=False)
    priority = serializers.CharField(required=False)
    notes = serializers.CharField(required=False, allow_blank=True)
    status = serializers.CharField(required=False)
    assignedAt = serializers.DateTimeField(source='assigned_at', read_only=True)
    updatedAt = serializers.DateTimeField(source='updated_at', read_only=True)
    attendingPhysician = serializers.SerializerMethodField()

    class Meta:
        model = PatientAssignment
        fields = [
            'id',
            'patientId',
            'patientName',
            'room',
            'ward',
            'diagnosis',
            'assignedNurse',
            'assignedNurseId',
            'nurseId',
            'nurseName',
            'priority',
            'notes',
            'status',
            'assignedAt',
            'updatedAt',
            'attendingPhysician',
        ]

    def get_id(self, obj):
        return str(obj.pk)

    def get_patientName(self, obj):
        return obj.patient.name

    def get_room(self, obj):
        return obj.patient.room

    def get_diagnosis(self, obj):
        return obj.patient.diagnosis

    def get_attendingPhysician(self, obj):
        return obj.patient.attending_physician

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data['patientId'] = instance.patient.patient_code
        data['assignedNurseId'] = str(instance.assigned_nurse_id)
        return data

    def create(self, validated_data):
        patient_id = validated_data.pop('patientId')
        nurse_id = validated_data.pop('assignedNurseId', None) or validated_data.pop('nurseId', None)
        nurse_name = validated_data.pop('nurseName', None)
        patient = Patient.objects.filter(patient_code=patient_id).first()
        if not patient:
            raise serializers.ValidationError({'patientId': 'Patient not found.'})

        nurse = None
        if nurse_id:
            nurse = User.objects.filter(pk=nurse_id).first()
        if not nurse and nurse_name:
            for user in User.objects.select_related('nurse_profile').all():
                full = user.get_full_name().strip()
                if full == nurse_name or user.username == nurse_name:
                    nurse = user
                    break
        if not nurse:
            raise serializers.ValidationError({'assignedNurseId': 'Nurse not found.'})

        # Close previous active assignment
        PatientAssignment.objects.filter(patient=patient, status='active').update(
            status='reassigned'
        )

        request = self.context.get('request')
        assignment = PatientAssignment.objects.create(
            patient=patient,
            assigned_nurse=nurse,
            assigned_nurse_name=nurse.get_full_name().strip() or nurse.username,
            ward=validated_data.get('ward') or '',
            priority=validated_data.get('priority') or 'routine',
            notes=validated_data.get('notes') or '',
            status=validated_data.get('status') or 'active',
            assigned_by=request.user if request else None,
        )
        patient.assigned_nurse = nurse
        patient.save(update_fields=['assigned_nurse'])
        return assignment

    def update(self, instance, validated_data):
        patient_id = validated_data.pop('patientId', None)
        nurse_id = validated_data.pop('assignedNurseId', None) or validated_data.pop('nurseId', None)
        nurse_name = validated_data.pop('nurseName', None) or validated_data.pop(
            'assigned_nurse_name', None
        )

        if patient_id:
            patient = Patient.objects.filter(patient_code=patient_id).first()
            if not patient:
                raise serializers.ValidationError({'patientId': 'Patient not found.'})
            instance.patient = patient

        nurse = None
        if nurse_id:
            nurse = User.objects.filter(pk=nurse_id).first()
        if not nurse and nurse_name:
            for user in User.objects.select_related('nurse_profile').all():
                full = user.get_full_name().strip()
                if full == nurse_name or user.username == nurse_name:
                    nurse = user
                    break
        if nurse_id or nurse_name:
            if not nurse:
                raise serializers.ValidationError({'assignedNurseId': 'Nurse not found.'})
            instance.assigned_nurse = nurse
            instance.assigned_nurse_name = nurse.get_full_name().strip() or nurse.username
            instance.patient.assigned_nurse = nurse
            instance.patient.save(update_fields=['assigned_nurse'])

        for attr in ('ward', 'priority', 'notes', 'status'):
            if attr in validated_data:
                setattr(instance, attr, validated_data[attr])
        instance.save()
        return instance


class DutyAssignmentSerializer(serializers.ModelSerializer):
    """
    A duty-roster entry. Hours are never accepted from the client — they're
    read-only here because DutyAssignment.save() derives regular/overtime/
    total hours from the stored times every time, which is the backend's
    single source of truth for those numbers (see models.py).
    """

    nurseId = serializers.PrimaryKeyRelatedField(
        source='nurse', queryset=User.objects.filter(nurse_profile__role='staff_nurse')
    )
    nurseName = serializers.SerializerMethodField()
    departmentId = serializers.PrimaryKeyRelatedField(
        source='department', queryset=Department.objects.all()
    )
    departmentName = serializers.CharField(source='department.name', read_only=True)
    dutyDate = serializers.DateField(source='duty_date')
    shift = serializers.ChoiceField(choices=DutyAssignment.SHIFT_CHOICES)
    shiftLabel = serializers.CharField(source='get_shift_display', read_only=True)
    startTime = serializers.TimeField(source='start_time')
    endTime = serializers.TimeField(source='end_time')
    regularHours = serializers.FloatField(source='regular_hours', read_only=True)
    overtimeStart = serializers.TimeField(source='overtime_start', required=False, allow_null=True)
    overtimeEnd = serializers.TimeField(source='overtime_end', required=False, allow_null=True)
    overtimeHours = serializers.FloatField(source='overtime_hours', read_only=True)
    totalHours = serializers.FloatField(source='total_hours', read_only=True)
    status = serializers.ChoiceField(choices=DutyAssignment.STATUS_CHOICES, required=False)
    statusLabel = serializers.CharField(source='get_status_display', read_only=True)
    notes = serializers.CharField(required=False, allow_blank=True)
    createdBy = serializers.SerializerMethodField()
    createdAt = serializers.DateTimeField(source='created_at', read_only=True)
    updatedAt = serializers.DateTimeField(source='updated_at', read_only=True)
    # Real attendance — set only through the start/end actions below, never
    # accepted on create/update, so a client can't fabricate a clock time.
    actualStartTime = serializers.DateTimeField(source='actual_start_time', read_only=True)
    actualEndTime = serializers.DateTimeField(source='actual_end_time', read_only=True)
    actualWorkedHours = serializers.FloatField(source='actual_worked_hours', read_only=True)
    actualOvertimeHours = serializers.FloatField(source='actual_overtime_hours', read_only=True)
    # Present only when a supervisor closed this shift out rather than the
    # nurse ending it themselves — see DutyAssignmentViewSet.close.
    actualEndRecordedBy = serializers.SerializerMethodField()

    class Meta:
        model = DutyAssignment
        fields = [
            'id', 'nurseId', 'nurseName', 'departmentId', 'departmentName',
            'dutyDate', 'shift', 'shiftLabel', 'startTime', 'endTime',
            'regularHours', 'overtimeStart', 'overtimeEnd', 'overtimeHours',
            'totalHours', 'status', 'statusLabel', 'notes',
            'actualStartTime', 'actualEndTime', 'actualWorkedHours', 'actualOvertimeHours',
            'actualEndRecordedBy',
            'createdBy', 'createdAt', 'updatedAt',
        ]

    def get_nurseName(self, obj):
        return obj.nurse.get_full_name().strip() or obj.nurse.username

    def get_actualEndRecordedBy(self, obj):
        if not obj.actual_end_recorded_by_id:
            return None
        user = obj.actual_end_recorded_by
        return user.get_full_name().strip() or user.username

    def get_createdBy(self, obj):
        if not obj.created_by:
            return ''
        return obj.created_by.get_full_name().strip() or obj.created_by.username

    def validate(self, attrs):
        nurse = attrs.get('nurse', getattr(self.instance, 'nurse', None))
        duty_date = attrs.get('duty_date', getattr(self.instance, 'duty_date', None))
        start_time = attrs.get('start_time', getattr(self.instance, 'start_time', None))
        end_time = attrs.get('end_time', getattr(self.instance, 'end_time', None))
        status_value = attrs.get('status', getattr(self.instance, 'status', 'scheduled'))

        if nurse and duty_date and start_time and end_time and status_value != 'cancelled':
            start_dt = datetime.combine(duty_date, start_time)
            end_dt = datetime.combine(duty_date, end_time)
            if end_time <= start_time:
                end_dt += timedelta(days=1)

            # A night shift crosses midnight, so a same-nurse conflict can sit
            # on the day before or after — widen the candidate window rather
            # than comparing duty_date to duty_date directly.
            candidates = DutyAssignment.objects.filter(
                nurse=nurse,
                duty_date__range=(duty_date - timedelta(days=1), duty_date + timedelta(days=1)),
            ).exclude(status='cancelled')
            if self.instance is not None:
                candidates = candidates.exclude(pk=self.instance.pk)

            for other in candidates:
                other_start = datetime.combine(other.duty_date, other.start_time)
                other_end = datetime.combine(other.duty_date, other.end_time)
                if other.end_time <= other.start_time:
                    other_end += timedelta(days=1)
                if start_dt < other_end and other_start < end_dt:
                    raise serializers.ValidationError(
                        'This nurse already has a conflicting duty assignment during this time.'
                    )
        return attrs

    def create(self, validated_data):
        request = self.context.get('request')
        validated_data['created_by'] = request.user if request else None
        return super().create(validated_data)


class TaskHandoverSerializer(serializers.ModelSerializer):
    """
    A single task/duty item handed to another nurse on the same shift,
    pending a supervisor's verification.

    shift/department are read-only here on purpose — they are derived in
    validate() from the sending nurse's own DutyAssignment for dutyDate, the
    same "never trust the client for roster facts" rule DutyAssignmentSerializer
    already follows for hours. status/supervisor/verifiedAt/rejectionReason are
    likewise read-only; they only change through the approve/reject actions on
    TaskHandoverViewSet, never through a direct PATCH.
    """

    id = serializers.CharField(source='handover_code', read_only=True)
    taskId = serializers.PrimaryKeyRelatedField(
        source='task', queryset=Task.objects.all(), required=False, allow_null=True
    )
    taskTitle = serializers.SerializerMethodField()
    taskDescription = serializers.CharField(
        source='task_description', required=False, allow_blank=True
    )
    fromNurseId = serializers.IntegerField(source='from_nurse_id', read_only=True)
    fromNurseName = serializers.SerializerMethodField()
    toNurseId = serializers.PrimaryKeyRelatedField(source='to_nurse', queryset=User.objects.all())
    toNurseName = serializers.SerializerMethodField()
    departmentId = serializers.IntegerField(source='department_id', read_only=True)
    departmentName = serializers.CharField(source='department.name', read_only=True, default='')
    shift = serializers.CharField(read_only=True)
    shiftLabel = serializers.CharField(source='get_shift_display', read_only=True)
    dutyDate = serializers.DateField(source='duty_date', required=False)
    notes = serializers.CharField(required=False, allow_blank=True)
    status = serializers.CharField(read_only=True)
    statusLabel = serializers.CharField(source='get_status_display', read_only=True)
    supervisorId = serializers.IntegerField(source='supervisor_id', read_only=True)
    supervisorName = serializers.SerializerMethodField()
    verifiedAt = serializers.DateTimeField(source='verified_at', read_only=True)
    rejectionReason = serializers.CharField(source='rejection_reason', read_only=True)
    createdAt = serializers.DateTimeField(source='created_at', read_only=True)
    updatedAt = serializers.DateTimeField(source='updated_at', read_only=True)

    class Meta:
        model = TaskHandover
        fields = [
            'id', 'taskId', 'taskTitle', 'taskDescription',
            'fromNurseId', 'fromNurseName', 'toNurseId', 'toNurseName',
            'departmentId', 'departmentName', 'shift', 'shiftLabel',
            'dutyDate', 'notes', 'status', 'statusLabel',
            'supervisorId', 'supervisorName', 'verifiedAt', 'rejectionReason',
            'createdAt', 'updatedAt',
        ]

    def get_taskTitle(self, obj):
        return obj.task.title if obj.task_id else ''

    def get_fromNurseName(self, obj):
        return obj.from_nurse.get_full_name().strip() or obj.from_nurse.username

    def get_toNurseName(self, obj):
        return obj.to_nurse.get_full_name().strip() or obj.to_nurse.username

    def get_supervisorName(self, obj):
        if not obj.supervisor_id:
            return None
        return obj.supervisor.get_full_name().strip() or obj.supervisor.username

    def validate(self, attrs):
        request = self.context.get('request')
        from_nurse = request.user if request else None
        to_nurse = attrs.get('to_nurse')
        task = attrs.get('task')
        task_description = (attrs.get('task_description') or '').strip()

        if to_nurse and from_nurse and to_nurse.pk == from_nurse.pk:
            raise serializers.ValidationError(
                {'toNurseId': 'You cannot hand a task over to yourself.'}
            )
        if not task and not task_description:
            raise serializers.ValidationError(
                {'taskDescription': 'Describe the task being handed over, or select an existing task.'}
            )

        duty_date = attrs.get('duty_date') or timezone.now().astimezone(
            ZoneInfo(settings.DUTY_LOCAL_TIMEZONE)
        ).date()

        # The sending nurse's own roster entry for that day is what decides
        # the shift/department this handover happens on — never accepted from
        # the client, so a nurse can't claim a shift they aren't actually on.
        from_assignment = (
            DutyAssignment.objects.filter(nurse=from_nurse, duty_date=duty_date)
            .exclude(status='cancelled')
            .first()
        )
        if from_assignment is None:
            raise serializers.ValidationError(
                {'dutyDate': f'You have no scheduled duty on {duty_date} to hand this task over from.'}
            )

        to_assignment = (
            DutyAssignment.objects.filter(
                nurse=to_nurse, duty_date=duty_date, shift=from_assignment.shift
            )
            .exclude(status='cancelled')
            .first()
        )
        if to_assignment is None:
            raise serializers.ValidationError(
                {'toNurseId': 'That nurse is not scheduled on the same shift on this date.'}
            )

        attrs['duty_date'] = duty_date
        attrs['shift'] = from_assignment.shift
        attrs['department'] = from_assignment.department
        return attrs

    def create(self, validated_data):
        request = self.context.get('request')
        validated_data['from_nurse'] = request.user if request else None
        validated_data['handover_code'] = next_code(TaskHandover, 'handover_code', 'TH')
        if validated_data.get('task') and not (validated_data.get('task_description') or '').strip():
            validated_data['task_description'] = validated_data['task'].title
        return super().create(validated_data)


def _parse_float(value):
    try:
        if value is None or str(value).strip() == '':
            return None
        return float(str(value).strip())
    except (TypeError, ValueError):
        return None


def _parse_blood_pressure(value):
    """'120/80' -> (120.0, 80.0), or (None, None) if it doesn't parse."""
    text = (value or '').strip()
    if '/' not in text:
        return None, None
    systolic_raw, _, diastolic_raw = text.partition('/')
    return _parse_float(systolic_raw), _parse_float(diastolic_raw)


def assess_risk_level(*, temperature=None, pulse_rate=None, respiratory_rate=None,
                       blood_pressure=None, oxygen_saturation=None):
    """
    'critical'/'high'/'medium'/'low' from whichever vitals were actually
    filled in — never from ones that were left blank, so an incomplete
    kardex is not mistaken for a stable one and a mostly-empty kardex does
    not get flagged high risk on the strength of a single field.

    Threshold-based, not a clinical judgment — a nurse's own assessment
    always takes precedence; this exists so an obviously abnormal vital sign
    is not silently defaulted to 'low' the way risk_level='low' used to be
    hardcoded for every kardex-created patient regardless of their vitals.

    'critical' is a wider band outside 'high', for vitals so far out of
    range they warrant immediate attention rather than just closer
    monitoring — mirrored on the frontend in utils/riskLevel.ts.
    """
    severities = []

    temp = _parse_float(temperature)
    if temp is not None:
        if temp < 34.0 or temp >= 40.0:
            severities.append('critical')
        elif temp < 35.0 or temp >= 39.0:
            severities.append('high')
        elif temp < 36.1 or temp >= 37.6:
            severities.append('medium')

    pulse = _parse_float(pulse_rate)
    if pulse is not None:
        if pulse < 40 or pulse > 150:
            severities.append('critical')
        elif pulse < 50 or pulse > 130:
            severities.append('high')
        elif pulse < 60 or pulse > 100:
            severities.append('medium')

    resp = _parse_float(respiratory_rate)
    if resp is not None:
        if resp < 8 or resp > 30:
            severities.append('critical')
        elif resp < 10 or resp > 28:
            severities.append('high')
        elif resp < 12 or resp > 20:
            severities.append('medium')

    spo2 = _parse_float(oxygen_saturation)
    if spo2 is not None:
        if spo2 < 85:
            severities.append('critical')
        elif spo2 < 90:
            severities.append('high')
        elif spo2 < 95:
            severities.append('medium')

    systolic, diastolic = _parse_blood_pressure(blood_pressure)
    if systolic is not None and diastolic is not None:
        if systolic >= 200 or systolic < 80 or diastolic >= 130 or diastolic < 50:
            severities.append('critical')
        elif systolic >= 180 or systolic < 90 or diastolic >= 120 or diastolic < 60:
            severities.append('high')
        elif systolic >= 140 or diastolic >= 90:
            severities.append('medium')

    if 'critical' in severities:
        return 'critical'
    if 'high' in severities:
        return 'high'
    if 'medium' in severities:
        return 'medium'
    return 'low'


class KardexRecordSerializer(serializers.ModelSerializer):
    id = serializers.SerializerMethodField()
    patientName = serializers.SerializerMethodField()
    # Read-only: the code of the Patient this kardex is linked to (created
    # fresh when patientId was blank). Lets the caller act on that patient —
    # e.g. assigning Kardex doctors — right after this submission returns.
    patientCode = serializers.SerializerMethodField()
    lastName = serializers.CharField(source='last_name')
    firstName = serializers.CharField(source='first_name')
    middleName = serializers.CharField(source='middle_name', required=False, allow_blank=True)
    age = serializers.CharField(required=False, allow_blank=True)
    gender = serializers.CharField(required=False, allow_blank=True)
    religion = serializers.CharField(required=False, allow_blank=True)
    room = serializers.CharField(required=False, allow_blank=True)
    bedNumber = serializers.CharField(source='bed_number', required=False, allow_blank=True)
    admissionDate = serializers.CharField(source='admission_date', required=False, allow_blank=True)
    attendingPhysician = serializers.CharField(
        source='attending_physician', required=False, allow_blank=True
    )
    chiefComplaint = serializers.CharField(source='chief_complaint', required=False, allow_blank=True)
    admittingDiagnosis = serializers.CharField(
        source='admitting_diagnosis', required=False, allow_blank=True
    )
    finalDiagnosis = serializers.CharField(source='final_diagnosis', required=False, allow_blank=True)
    diet = serializers.CharField(required=False, allow_blank=True)
    temperature = serializers.CharField(required=False, allow_blank=True)
    pulseRate = serializers.CharField(source='pulse_rate', required=False, allow_blank=True)
    respiratoryRate = serializers.CharField(
        source='respiratory_rate', required=False, allow_blank=True
    )
    bloodPressure = serializers.CharField(source='blood_pressure', required=False, allow_blank=True)
    oxygenSaturation = serializers.CharField(
        source='oxygen_saturation', required=False, allow_blank=True
    )
    allergies = serializers.ListField(child=serializers.CharField(), required=False)
    specialEndorsements = serializers.CharField(
        source='special_endorsements', required=False, allow_blank=True
    )
    savedAt = serializers.DateTimeField(source='saved_at', read_only=True)
    savedBy = serializers.CharField(source='saved_by_name', read_only=True)
    patientId = serializers.CharField(write_only=True, required=False, allow_blank=True)
    # Only meaningful when patientId is blank (this Kardex is registering a
    # new patient rather than updating one). See PatientSerializer for the
    # same field — never merges or overwrites automatically.
    confirmDuplicate = serializers.BooleanField(write_only=True, required=False, default=False)
    status = serializers.ChoiceField(choices=KardexRecord.STATUS_CHOICES, read_only=True)
    reviewedBy = serializers.SerializerMethodField()
    reviewedAt = serializers.DateTimeField(source='reviewed_at', read_only=True)
    reviewNotes = serializers.CharField(source='review_notes', read_only=True)

    class Meta:
        model = KardexRecord
        fields = [
            'id',
            'patientId',
            'patientCode',
            'patientName',
            'lastName',
            'firstName',
            'middleName',
            'age',
            'gender',
            'religion',
            'room',
            'bedNumber',
            'admissionDate',
            'attendingPhysician',
            'chiefComplaint',
            'admittingDiagnosis',
            'finalDiagnosis',
            'diet',
            'temperature',
            'pulseRate',
            'respiratoryRate',
            'bloodPressure',
            'oxygenSaturation',
            'allergies',
            'specialEndorsements',
            'savedAt',
            'savedBy',
            'confirmDuplicate',
            'status',
            'reviewedBy',
            'reviewedAt',
            'reviewNotes',
        ]

    def get_id(self, obj):
        return str(obj.pk)

    def get_patientName(self, obj):
        return obj.patient_name

    def get_patientCode(self, obj):
        return obj.patient.patient_code if obj.patient_id else None

    def get_reviewedBy(self, obj):
        if obj.reviewed_by_id is None:
            return None
        return obj.reviewed_by.get_full_name().strip() or obj.reviewed_by.username

    def create(self, validated_data):
        """
        Save kardex AND ensure a Patient exists in the patient list.
        - If patientId is provided, update that patient from kardex fields.
        - Otherwise create a new Patient from the kardex demographics.
        Never leaves orphan kardex identity data disconnected from Patients.
        """
        from datetime import datetime

        patient_id = validated_data.pop('patientId', None)
        confirm_duplicate = validated_data.pop('confirmDuplicate', False)
        request = self.context.get('request')
        user = request.user if request and request.user.is_authenticated else None

        first = (validated_data.get('first_name') or '').strip()
        last = (validated_data.get('last_name') or '').strip()
        middle = (validated_data.get('middle_name') or '').strip()
        full_name = ' '.join(p for p in [first, middle, last] if p).strip() or 'Unknown Patient'

        age_raw = validated_data.get('age') or '0'
        try:
            age = max(0, min(150, int(float(str(age_raw).strip() or '0'))))
        except (TypeError, ValueError):
            age = 0

        gender = validated_data.get('gender') or 'Male'
        if gender not in ('Male', 'Female'):
            gender = 'Male'

        room = (validated_data.get('room') or '').strip() or 'TBD'
        diagnosis = (
            (validated_data.get('admitting_diagnosis') or '').strip()
            or (validated_data.get('chief_complaint') or '').strip()
            or 'Pending diagnosis'
        )
        attending = (validated_data.get('attending_physician') or '').strip()

        admission_raw = (validated_data.get('admission_date') or '').strip()
        admission_date = timezone.now().date()
        if admission_raw:
            for fmt in ('%Y-%m-%d', '%m/%d/%Y', '%d/%m/%Y'):
                try:
                    admission_date = datetime.strptime(admission_raw, fmt).date()
                    break
                except ValueError:
                    continue

        def _num(value, cast=int, default=0):
            try:
                if value is None or str(value).strip() == '':
                    return default
                return cast(str(value).strip())
            except (TypeError, ValueError):
                return default

        vitals = {
            'heart_rate': _num(validated_data.get('pulse_rate'), int, 0),
            'blood_pressure': (validated_data.get('blood_pressure') or '').strip(),
            'temperature': _num(validated_data.get('temperature'), float, 0.0),
            'oxygen_saturation': _num(validated_data.get('oxygen_saturation'), int, 0),
            'respiratory_rate': _num(validated_data.get('respiratory_rate'), int, 0),
        }
        # From whatever vitals were actually filled in on this kardex — not
        # hardcoded, and not touched for fields the nurse left blank.
        risk_level = assess_risk_level(
            temperature=validated_data.get('temperature'),
            pulse_rate=validated_data.get('pulse_rate'),
            respiratory_rate=validated_data.get('respiratory_rate'),
            blood_pressure=validated_data.get('blood_pressure'),
            oxygen_saturation=validated_data.get('oxygen_saturation'),
        )
        allergies = validated_data.get('allergies') or []

        # Only a risk when this kardex is registering a brand-new patient —
        # patientId means it is explicitly updating one that already exists.
        if not patient_id and not confirm_duplicate:
            matches = find_possible_duplicate_patients(full_name, age)
            if matches:
                raise serializers.ValidationError(duplicate_patient_payload(matches))

        with transaction.atomic():
            if patient_id:
                patient = Patient.objects.filter(patient_code=patient_id).first()
                if not patient:
                    raise serializers.ValidationError({'patientId': 'Patient not found.'})
                patient.name = full_name
                patient.age = age or patient.age
                patient.gender = gender
                patient.room = room
                patient.diagnosis = diagnosis
                patient.admission_date = admission_date
                patient.attending_physician = attending
                patient.risk_level = risk_level
                patient.allergies = allergies
                for k, v in vitals.items():
                    setattr(patient, k, v)
                patient.save()
            else:
                patient = Patient.objects.create(
                    patient_code=next_code(Patient, 'patient_code', 'P'),
                    name=full_name,
                    age=age,
                    gender=gender,
                    room=room,
                    diagnosis=diagnosis,
                    admission_date=admission_date,
                    risk_level=risk_level,
                    attending_physician=attending,
                    assigned_nurse=user,
                    allergies=allergies,
                    **vitals,
                )
                if user:
                    PatientAssignment.objects.filter(patient=patient, status='active').update(
                        status='reassigned'
                    )
                    PatientAssignment.objects.create(
                        patient=patient,
                        assigned_nurse=user,
                        assigned_nurse_name=user.get_full_name().strip() or user.username,
                        ward='',
                        priority='routine',
                        notes='Created from Kardex submission',
                        status='active',
                        assigned_by=user,
                    )

            validated_data['patient'] = patient
            if user:
                validated_data['saved_by'] = user
                validated_data['saved_by_name'] = user.get_full_name().strip() or user.username

            return KardexRecord.objects.create(**validated_data)


# --- n8n-backed features ------------------------------------------------
# Request/response contracts for the three workflows. The response
# serializers exist for the API docs — the views return whatever n8n sends
# merged with server-owned fields, so they document the shape rather than
# constrain it.


class VerifyIdSerializer(serializers.Serializer):
    """
    Persona steps 1 & 2 — read a PRC ID photo via the n8n identity-verify
    workflow (extract_id branch).

    Accepts the image two ways: multipart/form-data with the file under
    `prc_id` (preferred — sends real bytes to n8n), or a JSON body with
    `idImage` as base64 (legacy path, kept for backward compatibility).
    Exactly one must be present; enforced in `validate()` since DRF fields
    can't see `request.FILES` on their own.
    """

    idImage = serializers.CharField(
        required=False,
        allow_blank=True,
        help_text='Base64 (optionally data-URI prefixed) photo of the PRC ID. Omit when sending `prc_id` as a file.',
    )
    registrationSessionId = serializers.UUIDField(
        required=False,
        help_text='Existing signup session. Omit on the first call — one is created and returned.',
    )
    documentType = serializers.ChoiceField(
        choices=['hospital_id', 'prc_license'],
        required=False,
        default='hospital_id',
        help_text='Which document is being read.',
    )
    expectedRole = serializers.ChoiceField(
        choices=['staff_nurse', 'supervisor'],
        required=False,
        allow_blank=True,
        help_text='Optional. The workflow flags a mismatch against the position it reads.',
    )

    class Meta:
        ref_name = 'VerifyIdRequest'


class VerifyIdResponseSerializer(serializers.Serializer):
    success = serializers.BooleanField()
    verified = serializers.BooleanField(help_text='True when the workflow could read the document.')
    verificationStatus = serializers.ChoiceField(
        choices=['verified', 'ocr_incomplete', 'invalid_id', 'unavailable'],
        required=False,
        help_text='Machine-readable outcome. Respects the workflow\'s own value if it sends one.',
    )
    hasPhoto = serializers.BooleanField(
        required=False,
        help_text='False when no portrait was found on the ID — the upload is rejected before OCR.',
    )
    faceCount = serializers.IntegerField(required=False)
    fullName = serializers.CharField(allow_blank=True)
    lastName = serializers.CharField(allow_blank=True)
    firstName = serializers.CharField(allow_blank=True)
    middleName = serializers.CharField(allow_blank=True)
    registrationNumber = serializers.CharField(allow_blank=True, help_text='PRC registration/licence number.')
    registrationDate = serializers.CharField(allow_blank=True, help_text='Date the licence was issued/registered.')
    validUntil = serializers.CharField(allow_blank=True, help_text='Licence expiry date, as read from the ID.')
    employeeId = serializers.CharField(allow_blank=True)
    department = serializers.CharField(allow_blank=True)
    position = serializers.CharField(allow_blank=True)
    hospitalName = serializers.CharField(allow_blank=True)
    email = serializers.CharField(allow_blank=True)
    roleMatch = serializers.BooleanField(required=False)
    confidence = serializers.FloatField(required=False)
    message = serializers.CharField(required=False, allow_blank=True)
    registrationSessionId = serializers.CharField()

    class Meta:
        ref_name = 'VerifyIdResponse'


class StructureChartSerializer(serializers.Serializer):
    """Autocharting — raw assessment in, structured nursing note out via n8n."""

    patientId = serializers.CharField(
        help_text='Patient code, e.g. P-1042. Demographics are attached server-side; vitals are not.',
    )
    assessment = serializers.CharField(
        help_text='Free-text assessment the nurse typed. This is what the workflow structures.',
    )
    interventions = serializers.ListField(
        child=serializers.CharField(),
        required=False,
        help_text='Interventions performed this shift.',
    )
    patientResponse = serializers.CharField(
        required=False, allow_blank=True, help_text='How the patient responded to those interventions.'
    )
    noteType = serializers.ChoiceField(
        choices=['progress', 'assessment', 'medication', 'vital_signs'],
        required=False,
        default='progress',
    )
    shift = serializers.ChoiceField(
        choices=['morning', 'afternoon', 'night'], required=False, allow_blank=True
    )
    vitalSigns = serializers.DictField(
        required=False,
        help_text=(
            'Optional manual override (e.g. a structured vitals form filled out alongside the '
            'assessment). Omit to have vitals extracted from `assessment` alone \u2014 never '
            'defaulted from the patient\u2019s stored record.'
        ),
    )
    save = serializers.BooleanField(
        required=False,
        default=False,
        help_text='True also persists the generated note as a ChartingNote with aiGenerated=true.',
    )

    class Meta:
        ref_name = 'StructureChartRequest'


class StructureChartResponseSerializer(serializers.Serializer):
    success = serializers.BooleanField()
    note = serializers.CharField(help_text='The generated narrative note.')
    structured = serializers.DictField(help_text='Section-by-section note, as the app renders it.')
    aiGenerated = serializers.BooleanField()
    saved = serializers.BooleanField(help_text='True when save=true persisted a ChartingNote.')
    noteId = serializers.CharField(required=False, allow_blank=True)

    class Meta:
        ref_name = 'StructureChartResponse'


class VerifyPrcSerializer(serializers.Serializer):
    """Scan a PRC nursing licence with Tesseract OCR."""

    image = serializers.CharField(
        help_text='Base64 (optionally data-URI prefixed) JPEG/PNG photo of the PRC licence.',
    )
    registrationSessionId = serializers.UUIDField(
        required=False,
        help_text='Signup session to attach the result to. Optional.',
    )
    selfie = serializers.CharField(
        required=False,
        allow_blank=True,
        help_text=(
            'Base64 (optionally data-URI prefixed) selfie captured in Step 3. When the session '
            'was verified via Face Verification, this is compared against the licence photo and '
            'is required for `prc_verified` to be set on the session. Omit for Email OTP sessions.'
        ),
    )

    class Meta:
        ref_name = 'VerifyPrcRequest'


class VerifyPrcResponseSerializer(serializers.Serializer):
    valid = serializers.BooleanField(
        help_text='False when the upload is not a PRC nursing licence. All fields are blank then.'
    )
    message = serializers.CharField(allow_blank=True)
    lastName = serializers.CharField(allow_blank=True)
    firstName = serializers.CharField(allow_blank=True)
    middleName = serializers.CharField(allow_blank=True)
    fullName = serializers.CharField(allow_blank=True)
    registrationNumber = serializers.CharField(
        allow_blank=True, help_text='7 digits, or blank if it could not be read confidently.'
    )
    licenseNumber = serializers.CharField(
        allow_blank=True, help_text='Alias of registrationNumber, for the signup form.'
    )
    validUntil = serializers.CharField(allow_blank=True, help_text='MM/DD/YYYY.')
    profession = serializers.CharField(allow_blank=True)
    registrationSessionId = serializers.CharField(required=False, allow_blank=True)
    faceMatch = serializers.DictField(
        required=False,
        allow_null=True,
        help_text=(
            'Present only when a selfie was compared against the licence photo: '
            '{matched: bool, confidence: number 0-100, message: string|null}. '
            'Null/absent when not required (Email OTP session) or not attempted (no selfie sent).'
        ),
    )

    class Meta:
        ref_name = 'VerifyPrcResponse'


class UserPreferencesSerializer(serializers.ModelSerializer):
    """
    The Settings page, in the camelCase the app speaks.

    Every field is optional: the Settings page saves one section at a time, so a
    PATCH carries only that section and must leave the rest untouched.
    """

    fontSize = serializers.ChoiceField(
        source='font_size', choices=['small', 'medium', 'large'], required=False
    )
    compactView = serializers.BooleanField(source='compact_view', required=False)

    taskNotifications = serializers.BooleanField(source='task_notifications', required=False)
    handoverNotifications = serializers.BooleanField(
        source='handover_notifications', required=False
    )
    criticalAlerts = serializers.BooleanField(source='critical_alerts', required=False)
    emailNotifications = serializers.BooleanField(source='email_notifications', required=False)
    soundAlerts = serializers.BooleanField(source='sound_alerts', required=False)

    autoRefresh = serializers.BooleanField(source='auto_refresh', required=False)
    showCharts = serializers.BooleanField(source='show_charts', required=False)
    backgroundSync = serializers.BooleanField(source='background_sync', required=False)

    class Meta:
        model = UserPreferences
        fields = [
            'fontSize',
            'compactView',
            'taskNotifications',
            'handoverNotifications',
            'criticalAlerts',
            'emailNotifications',
            'soundAlerts',
            'autoRefresh',
            'showCharts',
            'backgroundSync',
        ]


class FaceVerificationAttemptSerializer(serializers.ModelSerializer):
    """
    Admin-only read view of the verification history feeding a signup's
    identity check. Never carries raw images/biometrics — the model itself
    only ever stores the outcome (see FaceVerificationAttempt docstring).
    """

    id = serializers.IntegerField(read_only=True)
    sessionId = serializers.UUIDField(source='session.session_id', read_only=True)
    reasonLabel = serializers.CharField(source='get_reason_display', read_only=True)
    createdAt = serializers.DateTimeField(source='created_at', read_only=True)

    class Meta:
        model = FaceVerificationAttempt
        fields = [
            'id', 'sessionId', 'matched', 'confidence', 'reason', 'reasonLabel',
            'countable', 'createdAt',
        ]


class RegistrationSessionSerializer(serializers.ModelSerializer):
    """Admin-only read view of a signup's identity-verification progress —
    the audit trail behind every account approve/reject decision."""

    id = serializers.IntegerField(read_only=True)
    sessionId = serializers.UUIDField(source='session_id', read_only=True)
    faceAttempts = serializers.IntegerField(source='face_attempts', read_only=True)
    faceVerified = serializers.BooleanField(source='face_verified', read_only=True)
    faceLocked = serializers.BooleanField(source='face_locked', read_only=True)
    otpVerified = serializers.BooleanField(source='otp_verified', read_only=True)
    verificationMethod = serializers.CharField(source='verification_method', read_only=True)
    prcVerified = serializers.BooleanField(source='prc_verified', read_only=True)
    prcLicenseNumber = serializers.CharField(source='prc_license_number', read_only=True)
    prcFullName = serializers.CharField(source='prc_full_name', read_only=True)
    prcProfession = serializers.CharField(source='prc_profession', read_only=True)
    idLastName = serializers.CharField(source='id_last_name', read_only=True)
    idFirstName = serializers.CharField(source='id_first_name', read_only=True)
    idMiddleName = serializers.CharField(source='id_middle_name', read_only=True)
    idRegistrationNo = serializers.CharField(source='id_registration_no', read_only=True)
    idVerificationStatus = serializers.CharField(source='id_verification_status', read_only=True)
    isVerified = serializers.BooleanField(source='is_verified', read_only=True)
    userId = serializers.SerializerMethodField()
    userEmail = serializers.SerializerMethodField()
    createdAt = serializers.DateTimeField(source='created_at', read_only=True)
    updatedAt = serializers.DateTimeField(source='updated_at', read_only=True)

    class Meta:
        model = RegistrationSession
        fields = [
            'id', 'sessionId', 'email', 'faceAttempts', 'faceVerified', 'faceLocked',
            'otpVerified', 'verificationMethod', 'prcVerified', 'prcLicenseNumber',
            'prcFullName', 'prcProfession', 'idLastName', 'idFirstName', 'idMiddleName',
            'idRegistrationNo', 'idVerificationStatus', 'isVerified', 'userId', 'userEmail',
            'createdAt', 'updatedAt',
        ]

    def get_userId(self, obj):
        return str(obj.user_id) if obj.user_id else None

    def get_userEmail(self, obj):
        return obj.user.email if obj.user_id else ''
