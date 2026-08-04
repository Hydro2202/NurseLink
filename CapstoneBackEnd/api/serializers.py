from django.contrib.auth.models import User
from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers

from .models import NurseProfile, Patient


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

    def validate_email(self, value):
        if User.objects.filter(username=value).exists() or User.objects.filter(email=value).exists():
            raise serializers.ValidationError('A user with this email already exists.')
        return value.lower()

    def validate_password(self, value):
        validate_password(value)
        return value

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
