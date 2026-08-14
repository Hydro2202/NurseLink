from django.contrib.auth.models import User
from django.contrib.auth.password_validation import validate_password
from django.db import transaction
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
)
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
        if not session.prc_verified:
            raise serializers.ValidationError(
                'PRC license verification has not been completed. Please scan and verify your PRC nursing license first.'
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
                approval_status='pending' if role == 'staff_nurse' else 'approved',
                verification_method=session.verification_method,
                prc_verified_at=timezone.now(),
                prc_license_expiry=session.prc_expiry,
                prc_profession=session.prc_profession,
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
    firstName = serializers.CharField(required=False, allow_blank=True, max_length=150)
    middleName = serializers.CharField(required=False, allow_blank=True, max_length=100)
    lastName = serializers.CharField(required=False, allow_blank=True, max_length=150)
    department = serializers.CharField(required=False, allow_blank=True, max_length=120)
    licenseNumber = serializers.CharField(required=False, allow_blank=True, max_length=50)
    avatar = serializers.URLField(required=False, allow_blank=True)
    shift = serializers.ChoiceField(
        choices=['morning', 'afternoon', 'night'], required=False, allow_blank=True
    )
    clinicalRole = serializers.CharField(required=False, allow_blank=True, max_length=40)
    specialization = serializers.CharField(required=False, allow_blank=True, max_length=120)

    def update(self, instance, validated_data):
        if 'firstName' in validated_data:
            instance.first_name = validated_data['firstName'] or ''
        if 'lastName' in validated_data:
            instance.last_name = validated_data['lastName'] or ''
        instance.save()

        profile, _ = NurseProfile.objects.get_or_create(user=instance)
        mapping = {
            'middleName': 'middle_name',
            'department': 'department',
            'licenseNumber': 'license_number',
            'avatar': 'avatar',
            'shift': 'shift',
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
        return instance


class PatientSerializer(serializers.ModelSerializer):
    """Matches CapstoneFrontEnd Patient interface."""

    id = serializers.CharField(source='patient_code', required=False)
    admissionDate = serializers.DateField(source='admission_date')
    riskLevel = serializers.CharField(source='risk_level')
    attendingPhysician = serializers.CharField(
        source='attending_physician', required=False, allow_blank=True
    )
    vitalSigns = serializers.DictField(required=False)
    assignedNurseId = serializers.SerializerMethodField(read_only=True)
    assignedNurseName = serializers.SerializerMethodField(read_only=True)

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
        ]

    def get_assignedNurseId(self, obj):
        return str(obj.assigned_nurse_id) if obj.assigned_nurse_id else None

    def get_assignedNurseName(self, obj):
        if not obj.assigned_nurse:
            return None
        return obj.assigned_nurse.get_full_name().strip() or obj.assigned_nurse.username

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
        ]

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
        return Task.objects.create(**validated_data)

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
        self._apply_sbar(validated_data)
        code = validated_data.pop('handover_code', None) or next_code(
            HandoverNote, 'handover_code', 'H'
        )
        validated_data['handover_code'] = code
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            validated_data['created_by'] = request.user
        return HandoverNote.objects.create(**validated_data)

    def update(self, instance, validated_data):
        patient_id = validated_data.pop('patientId', serializers.empty)
        if patient_id is not serializers.empty:
            self._resolve_patient(validated_data, patient_id)
        self._apply_sbar(validated_data)
        validated_data.pop('handover_code', None)
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

    class Meta:
        model = Notification
        fields = [
            'id',
            'type',
            'title',
            'message',
            'patient',
            'time',
            'isRead',
            'action',
        ]
        read_only_fields = fields

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
    specialEndorsements = serializers.CharField(
        source='special_endorsements', required=False, allow_blank=True
    )
    savedAt = serializers.DateTimeField(source='saved_at', read_only=True)
    savedBy = serializers.CharField(source='saved_by_name', read_only=True)
    patientId = serializers.CharField(write_only=True, required=False, allow_blank=True)

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
            'specialEndorsements',
            'savedAt',
            'savedBy',
        ]

    def get_id(self, obj):
        return str(obj.pk)

    def get_patientName(self, obj):
        return obj.patient_name

    def create(self, validated_data):
        """
        Save kardex AND ensure a Patient exists in the patient list.
        - If patientId is provided, update that patient from kardex fields.
        - Otherwise create a new Patient from the kardex demographics.
        Never leaves orphan kardex identity data disconnected from Patients.
        """
        from datetime import datetime

        patient_id = validated_data.pop('patientId', None)
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
                    risk_level='low',
                    attending_physician=attending,
                    assigned_nurse=user,
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
