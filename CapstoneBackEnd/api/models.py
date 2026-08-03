from django.conf import settings
from django.db import models


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
