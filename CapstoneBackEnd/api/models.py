from django.conf import settings
from django.db import models
from django.utils import timezone  # I change this by rai


class NurseProfile(models.Model):
    """Extra nurse info linked 1-to-1 with Django's built-in User."""

    ROLE_CHOICES = [
        ('staff_nurse', 'Staff Nurse'),
        ('supervisor', 'Supervisor'),
    ]

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='nurse_profile',
    )
    role = models.CharField(max_length=20, choices=ROLE_CHOICES, default='staff_nurse')
    department = models.CharField(max_length=120, blank=True, default='')
    license_number = models.CharField(max_length=50, blank=True, default='')
    middle_name = models.CharField(max_length=100, blank=True, default='')
    avatar = models.URLField(blank=True, default='')

    def __str__(self):
        return f'{self.user.get_full_name() or self.user.username} ({self.role})'


class IDDocument(models.Model):
    DOCUMENT_CHOICES = [
        ('hospital_id', 'Hospital ID'),
        ('national_id', 'National ID'),
        ('drivers_license', 'Driver\'s License'),
        ('passport', 'Passport'),
        ('umid', 'UMID'),
        ('philhealth', 'PhilHealth ID'),
    ]

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='id_documents',
    )
    document_type = models.CharField(max_length=30, choices=DOCUMENT_CHOICES, default='hospital_id')
    image = models.ImageField(upload_to='id_documents/')
    extracted_text = models.JSONField(blank=True, default=dict)
    verified = models.BooleanField(default=False)
    uploaded_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        owner = self.user.get_full_name() if self.user else 'Anonymous'
        return f'{self.get_document_type_display()} for {owner}'


class FaceVerification(models.Model):
    VERIFICATION_STATUS = [
        ('verified', 'Verified'),
        ('retry', 'Retry'),
        ('failed', 'Failed'),
    ]
    CONFIDENCE_CHOICES = [
        ('Low', 'Low'),
        ('Medium', 'Medium'),
        ('High', 'High'),
    ]

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='face_verifications',
    )
    id_document = models.ForeignKey(
        IDDocument,
        on_delete=models.CASCADE,
        related_name='face_verifications',
    )
    match_score = models.FloatField()
    confidence = models.CharField(max_length=10, choices=CONFIDENCE_CHOICES)
    status = models.CharField(max_length=10, choices=VERIFICATION_STATUS)
    message = models.CharField(max_length=256, blank=True)
    face_images = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f'Face verification {self.status} ({self.match_score}%)'


class VerificationLog(models.Model):
    EVENT_CHOICES = [
        ('id_upload', 'ID Upload'),
        ('face_verification', 'Face Verification'),
        ('registration', 'Registration'),
    ]

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='verification_logs',
    )
    face_verification = models.ForeignKey(
        FaceVerification,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='logs',
    )
    event_type = models.CharField(max_length=32, choices=EVENT_CHOICES)
    detail = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f'{self.event_type} at {self.created_at:%Y-%m-%d %H:%M}'


# I change this by rai
class EmailOTP(models.Model):
    """One-time email code used as a fallback identity check when face
    verification fails repeatedly during signup."""

    MAX_ATTEMPTS = 5
    CODE_LENGTH = 6
    EXPIRY_MINUTES = 10

    email = models.EmailField()
    code = models.CharField(max_length=CODE_LENGTH)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    verified_at = models.DateTimeField(null=True, blank=True)
    attempts = models.PositiveSmallIntegerField(default=0)

    def is_expired(self) -> bool:
        return timezone.now() >= self.expires_at

    def is_verified(self) -> bool:
        return self.verified_at is not None

    def __str__(self):
        return f'OTP for {self.email} ({"verified" if self.is_verified() else "pending"})'


class Patient(models.Model):
    """Patient record matching the frontend Patient shape."""

    GENDER_CHOICES = [
        ('Male', 'Male'),
        ('Female', 'Female'),
    ]
    RISK_CHOICES = [
        ('low', 'Low'),
        ('medium', 'Medium'),
        ('high', 'High'),
    ]

    patient_code = models.CharField(max_length=20, unique=True)
    name = models.CharField(max_length=200)
    age = models.PositiveIntegerField()
    gender = models.CharField(max_length=10, choices=GENDER_CHOICES)
    room = models.CharField(max_length=50)
    diagnosis = models.CharField(max_length=255)
    admission_date = models.DateField()
    risk_level = models.CharField(max_length=10, choices=RISK_CHOICES, default='low')

    heart_rate = models.PositiveIntegerField(default=0)
    blood_pressure = models.CharField(max_length=20, default='')
    temperature = models.FloatField(default=0)
    oxygen_saturation = models.PositiveIntegerField(default=0)
    respiratory_rate = models.PositiveIntegerField(default=0)

    allergies = models.JSONField(default=list, blank=True)
    medications = models.JSONField(default=list, blank=True)
    alerts = models.JSONField(default=list, blank=True)

    assigned_nurse = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='assigned_patients',
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['patient_code']

    def __str__(self):
        return f'{self.patient_code} — {self.name}'
