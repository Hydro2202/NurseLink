from django.contrib.auth.models import User
from django.contrib.auth.password_validation import validate_password
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework import serializers

from .models import (
    ChartingNote,
    HandoverNote,
    KardexRecord,
    Notification,
    NurseProfile,
    Patient,
    PatientAssignment,
    RegistrationSession,
    Task,
    UserPreferences,
)
from .avatar import AvatarError, normalize_avatar
from .id_field_validation import validate_prc_id_fields
from .handover_tasks import create_handover_tasks
from .notifications import notify_handover_created, notify_task_assigned, resolve_nurse
from .utils import next_code


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
        return profile.shift if profile else 'morning'

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
        department = validated_data.get('department') or (
            'Nursing Administration' if role == 'supervisor' else 'Medical-Surgical Unit'
        )

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
        # get_or_create hands back a different Python object than the one already
        # cached on instance.nurse_profile by authentication, so without this the
        # caller serializes the pre-edit profile and the change looks like it
        # silently reverted — even though it is safely in the database.
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
            }
            for p in matches
        ],
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
            'attendingPhysician',
            'vitalSigns',
            'allergies',
            'medications',
            'alerts',
            'assignedNurseId',
            'assignedNurseName',
            'assignedBy',
            'confirmDuplicate',
        ]

    def get_assignedNurseId(self, obj):
        return str(obj.assigned_nurse_id) if obj.assigned_nurse_id else None

    def get_assignedNurseName(self, obj):
        if not obj.assigned_nurse:
            return None
        return obj.assigned_nurse.get_full_name().strip() or obj.assigned_nurse.username

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
        return Patient.objects.create(**validated_data)

    def update(self, instance, validated_data):
        validated_data.pop('patient_code', None)
        self._apply_vitals(validated_data)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()

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


class TaskSerializer(serializers.ModelSerializer):
    id = serializers.CharField(source='task_code', required=False)
    patientId = serializers.CharField(required=False, allow_blank=True)
    patientName = serializers.CharField(source='patient_name', required=False, allow_blank=True)
    dueTime = serializers.CharField(source='due_time', required=False, allow_blank=True)
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

    def create(self, validated_data):
        patient_id = validated_data.pop('patientId', None)
        self._resolve_patient(validated_data, patient_id)
        code = validated_data.pop('task_code', None) or next_code(Task, 'task_code', 'T')
        validated_data['task_code'] = code
        request = self.context.get('request')
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
        task = Task.objects.create(**validated_data)
        notify_task_assigned(task, actor=request.user if request else None)
        return task

    def update(self, instance, validated_data):
        patient_id = validated_data.pop('patientId', serializers.empty)
        if patient_id is not serializers.empty:
            self._resolve_patient(validated_data, patient_id)
        validated_data.pop('task_code', None)
        if 'assigned_to' in validated_data:
            assigned_to = validated_data.get('assigned_to') or ''
            for user in User.objects.select_related('nurse_profile').all():
                full = user.get_full_name().strip()
                if full == assigned_to or user.username == assigned_to:
                    validated_data['assigned_nurse'] = user
                    break
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        if instance.status == 'completed' and not instance.completed_at:
            instance.completed_at = timezone.now()
            instance.priority = 'completed'
        instance.save()
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

        # A patient can only be mid-handover to one nurse at a time. Once the
        # receiving nurse acknowledges it, responsibility has genuinely moved
        # and a later handover (next shift, say) is legitimate — so this only
        # blocks a *second* handover while the first is still unacknowledged,
        # not every handover a patient will ever have.
        patient = validated_data.get('patient')
        if patient is not None:
            existing = (
                HandoverNote.objects.filter(patient=patient, status='pending')
                .order_by('-created_at')
                .first()
            )
            if existing is not None:
                raise serializers.ValidationError(
                    {
                        'patientId': (
                            f'{patient.name} already has a pending handover to '
                            f'{existing.nurse_to} ({existing.handover_code}). It must be '
                            'acknowledged before another handover can be created for this patient.'
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
        self._resolve_recipient(validated_data)
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
        # on it, which resolves to nobody when the name is ambiguous.
        name = validated_data.get('nurse_to')
        if name:
            validated_data['nurse_to_user'] = resolve_nurse(name)

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
    content = serializers.CharField()

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
            'aiGenerated',
            'edited',
            'attendingPhysician',
            'editHistory',
        ]

    def get_nurseId(self, obj):
        return str(obj.nurse_id) if obj.nurse_id else ''

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data['patientId'] = instance.patient.patient_code if instance.patient_id else ''
        return data

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
        return ChartingNote.objects.create(**validated_data)

    def update(self, instance, validated_data):
        patient_id = validated_data.pop('patientId', serializers.empty)
        if patient_id is not serializers.empty:
            self._resolve_patient(validated_data, patient_id)
        validated_data.pop('note_code', None)
        request = self.context.get('request')
        if 'content' in validated_data and validated_data['content'] != instance.content:
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
        return instance


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
    'high'/'medium'/'low' from whichever vitals were actually filled in —
    never from ones that were left blank, so an incomplete kardex is not
    mistaken for a stable one and a mostly-empty kardex does not get flagged
    high risk on the strength of a single field.

    Threshold-based, not a clinical judgment — a nurse's own assessment
    always takes precedence; this exists so an obviously abnormal vital sign
    is not silently defaulted to 'low' the way risk_level='low' used to be
    hardcoded for every kardex-created patient regardless of their vitals.
    """
    severities = []

    temp = _parse_float(temperature)
    if temp is not None:
        if temp < 35.0 or temp >= 39.0:
            severities.append('high')
        elif temp < 36.1 or temp >= 37.6:
            severities.append('medium')

    pulse = _parse_float(pulse_rate)
    if pulse is not None:
        if pulse < 50 or pulse > 130:
            severities.append('high')
        elif pulse < 60 or pulse > 100:
            severities.append('medium')

    resp = _parse_float(respiratory_rate)
    if resp is not None:
        if resp < 10 or resp > 28:
            severities.append('high')
        elif resp < 12 or resp > 20:
            severities.append('medium')

    spo2 = _parse_float(oxygen_saturation)
    if spo2 is not None:
        if spo2 < 90:
            severities.append('high')
        elif spo2 < 95:
            severities.append('medium')

    systolic, diastolic = _parse_blood_pressure(blood_pressure)
    if systolic is not None and diastolic is not None:
        if systolic >= 180 or systolic < 90 or diastolic >= 120 or diastolic < 60:
            severities.append('high')
        elif systolic >= 140 or diastolic >= 90:
            severities.append('medium')

    if 'high' in severities:
        return 'high'
    if 'medium' in severities:
        return 'medium'
    return 'low'


class KardexRecordSerializer(serializers.ModelSerializer):
    id = serializers.SerializerMethodField()
    patientName = serializers.SerializerMethodField()
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
        help_text='Patient code, e.g. P-1042. Vitals and demographics are attached server-side.',
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
        help_text='Overrides the vitals on record. Omit to use the patient\u2019s current vitals.',
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
