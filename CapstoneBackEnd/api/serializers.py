# I change this by rai
import random
from datetime import timedelta

from django.contrib.auth.models import User
from django.contrib.auth.password_validation import validate_password
from django.core.mail import send_mail
from django.conf import settings
from django.utils import timezone
from rest_framework import serializers

from .face_verification import verify_face_images
from .id_ocr import extract_id_fields
from .models import EmailOTP, FaceVerification, IDDocument, NurseProfile, Patient


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


class IDDocumentUploadSerializer(serializers.Serializer):
    document_type = serializers.ChoiceField(choices=IDDocument.DOCUMENT_CHOICES, default='hospital_id')
    id_image = serializers.FileField(write_only=True)

    def create(self, validated_data):
        user = self.context['request'].user if self.context['request'].user.is_authenticated else None
        document = IDDocument.objects.create(
            user=user,
            document_type=validated_data['document_type'],
            image=validated_data['id_image'],
        )
        # I change this by rai
        try:
            document.extracted_text = extract_id_fields(document.image.path)
        except Exception:
            # OCR is a best-effort convenience — a failure here shouldn't
            # block the upload itself, the user can still proceed manually.
            document.extracted_text = {}
        document.save(update_fields=['extracted_text'])
        return document


class FaceVerificationSerializer(serializers.Serializer):
    id_document_id = serializers.IntegerField()
    images = serializers.ListField(child=serializers.FileField(write_only=True), min_length=1)

    def validate_id_document_id(self, value):
        try:
            return IDDocument.objects.get(pk=value)
        except IDDocument.DoesNotExist:
            raise serializers.ValidationError('ID document not found.')

    def create(self, validated_data):
        id_document = validated_data['id_document_id']
        images = validated_data['images']

        live_image_bytes = [image.read() for image in images]
        verification_result = verify_face_images(str(id_document.image.path), live_image_bytes)

        verification = FaceVerification.objects.create(
            user=None,
            id_document=id_document,
            match_score=verification_result['match_score'],
            confidence=verification_result['confidence'],
            status=verification_result['status'],
            message=verification_result['message'],
            face_images=[image.name for image in images],
        )
        return verification


# I change this by rai
class RequestOtpSerializer(serializers.Serializer):
    email = serializers.EmailField()

    def validate_email(self, value):
        return value.lower()

    def create(self, validated_data):
        email = validated_data['email']
        code = f'{random.randint(0, 999999):06d}'
        otp = EmailOTP.objects.create(
            email=email,
            code=code,
            expires_at=timezone.now() + timedelta(minutes=EmailOTP.EXPIRY_MINUTES),
        )
        send_mail(
            subject='Your NurseLink verification code',
            message=(
                f'Your NurseLink verification code is {code}. '
                f'It expires in {EmailOTP.EXPIRY_MINUTES} minutes. '
                'If you did not request this, you can ignore this email.'
            ),
            from_email=settings.DEFAULT_FROM_EMAIL or None,
            recipient_list=[email],
            fail_silently=False,
        )
        return otp


# I change this by rai
class VerifyOtpSerializer(serializers.Serializer):
    email = serializers.EmailField()
    code = serializers.CharField(max_length=EmailOTP.CODE_LENGTH)

    def validate(self, attrs):
        email = attrs['email'].lower()
        otp = (
            EmailOTP.objects.filter(email=email, verified_at__isnull=True)
            .order_by('-created_at')
            .first()
        )
        if otp is None:
            raise serializers.ValidationError('No pending verification code for this email. Request a new one.')
        if otp.is_expired():
            raise serializers.ValidationError('This verification code has expired. Request a new one.')
        if otp.attempts >= EmailOTP.MAX_ATTEMPTS:
            raise serializers.ValidationError('Too many incorrect attempts. Request a new code.')
        if otp.code != attrs['code']:
            otp.attempts += 1
            otp.save(update_fields=['attempts'])
            raise serializers.ValidationError('Incorrect code. Please try again.')

        attrs['otp'] = otp
        attrs['email'] = email
        return attrs

    def save(self, **kwargs):
        otp = self.validated_data['otp']
        otp.verified_at = timezone.now()
        otp.save(update_fields=['verified_at'])
        return otp


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
    idDocumentId = serializers.IntegerField(required=False, allow_null=True)
    faceVerificationId = serializers.IntegerField(required=False, allow_null=True)
    otpVerificationId = serializers.IntegerField(required=False, allow_null=True)  # I change this by rai

    def validate_email(self, value):
        if User.objects.filter(username=value).exists() or User.objects.filter(email=value).exists():
            raise serializers.ValidationError('A user with this email already exists.')
        return value.lower()

    def validate_password(self, value):
        validate_password(value)
        return value

    # I change this by rai — moved face/OTP verification checks into validate()
    # (they used to run inside create(), after the User row was already
    # written, which left orphan accounts behind on a validation failure)
    def validate(self, attrs):
        face_verification_id = attrs.get('faceVerificationId')
        if face_verification_id:
            try:
                face_verification = FaceVerification.objects.get(pk=face_verification_id)
            except FaceVerification.DoesNotExist:
                raise serializers.ValidationError({'faceVerificationId': 'Face verification not found.'})
            if face_verification.status != 'verified':
                raise serializers.ValidationError(
                    {'faceVerificationId': 'Face verification must have a verified status to complete registration.'}
                )
            attrs['_face_verification'] = face_verification

        otp_verification_id = attrs.get('otpVerificationId')
        if otp_verification_id:
            try:
                otp = EmailOTP.objects.get(pk=otp_verification_id)
            except EmailOTP.DoesNotExist:
                raise serializers.ValidationError({'otpVerificationId': 'Verification code session not found.'})
            if not otp.is_verified():
                raise serializers.ValidationError({'otpVerificationId': 'This email has not completed OTP verification.'})
            if otp.email != attrs['email']:
                raise serializers.ValidationError({'otpVerificationId': 'The verified email does not match the signup email.'})
            if timezone.now() - otp.verified_at > timedelta(minutes=30):
                raise serializers.ValidationError({'otpVerificationId': 'OTP verification has expired. Please verify again.'})
            attrs['_otp'] = otp

        return attrs

    def create(self, validated_data):
        email = validated_data['email']
        first_name = validated_data.get('firstName') or ''
        last_name = validated_data.get('lastName') or ''
        name = validated_data.get('name') or ''

        if not first_name and name:
            parts = name.split(' ', 1)
            first_name = parts[0]
            if len(parts) > 1 and not last_name:
                last_name = parts[1]

        role = validated_data.get('role', 'staff_nurse')
        department = validated_data.get('department') or (
            'Nursing Administration' if role == 'supervisor' else 'Medical-Surgical Unit'
        )

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
        )

        id_document_id = validated_data.get('idDocumentId')

        if id_document_id:
            try:
                id_document = IDDocument.objects.get(pk=id_document_id)
                id_document.user = user
                id_document.verified = True
                id_document.save()
            except IDDocument.DoesNotExist:
                pass

        face_verification = validated_data.get('_face_verification')
        if face_verification:
            face_verification.user = user
            face_verification.save()

        return user


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField(help_text='Account email, e.g. nurse@hospital.com')
    password = serializers.CharField(
        write_only=True,
        style={'input_type': 'password'},
        help_text='Account password',
    )
    role = serializers.ChoiceField(
        choices=['staff_nurse', 'supervisor'],
        required=False,
        help_text='Optional. Must match the account role if provided.',
    )


class PatientSerializer(serializers.ModelSerializer):
    """Matches CapstoneFrontEnd mock Patient interface."""

    id = serializers.CharField(source='patient_code', read_only=True)
    admissionDate = serializers.DateField(source='admission_date')
    riskLevel = serializers.CharField(source='risk_level')
    vitalSigns = serializers.SerializerMethodField()

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
            'vitalSigns',
            'allergies',
            'medications',
            'alerts',
        ]

    def get_vitalSigns(self, obj):
        return {
            'heartRate': obj.heart_rate,
            'bloodPressure': obj.blood_pressure,
            'temperature': obj.temperature,
            'oxygenSaturation': obj.oxygen_saturation,
            'respiratoryRate': obj.respiratory_rate,
        }
