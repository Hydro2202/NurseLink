from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models


class NurseProfile(models.Model):
    """Extra nurse info linked 1-to-1 with Django's built-in User."""

    ROLE_CHOICES = [
        ('staff_nurse', 'Staff Nurse'),
        ('supervisor', 'Supervisor'),
    ]
    CLINICAL_ROLE_CHOICES = [
        ('RN', 'RN'),
        ('LPN', 'LPN'),
        ('Charge Nurse', 'Charge Nurse'),
        ('Clinical Nurse Specialist', 'Clinical Nurse Specialist'),
    ]
    SHIFT_CHOICES = [
        ('morning', 'Morning'),
        ('afternoon', 'Afternoon'),
        ('night', 'Night'),
    ]
    BURNOUT_CHOICES = [
        ('low', 'Low'),
        ('medium', 'Medium'),
        ('high', 'High'),
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
    clinical_role = models.CharField(
        max_length=40, choices=CLINICAL_ROLE_CHOICES, default='RN', blank=True
    )
    shift = models.CharField(max_length=20, choices=SHIFT_CHOICES, default='morning', blank=True)
    specialization = models.CharField(max_length=120, blank=True, default='')
    overtime_hours = models.FloatField(default=0, validators=[MinValueValidator(0)])
    burnout_risk = models.CharField(max_length=10, choices=BURNOUT_CHOICES, default='low')
    is_active_staff = models.BooleanField(default=True)
    approval_status = models.CharField(
        max_length=20,
        choices=[
            ('pending', 'Pending'),
            ('approved', 'Approved'),
            ('rejected', 'Rejected'),
        ],
        default='approved',
    )
    # Signup / verification metadata (kept for compatibility with existing DB)
    account_status = models.CharField(max_length=40, blank=True, default='active')
    employee_id = models.CharField(max_length=50, blank=True, default='')
    hospital_name = models.CharField(max_length=200, blank=True, default='')
    ocr_position = models.CharField(max_length=120, blank=True, default='')
    rejection_reason = models.TextField(blank=True, default='')

    class Meta:
        indexes = [
            models.Index(fields=['role']),
            models.Index(fields=['shift']),
            models.Index(fields=['is_active_staff']),
        ]

    def __str__(self):
        return f'{self.user.get_full_name() or self.user.username} ({self.role})'

    @property
    def display_name(self):
        return self.user.get_full_name().strip() or self.user.username


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

    patient_code = models.CharField(max_length=20, unique=True, db_index=True)
    name = models.CharField(max_length=200)
    age = models.PositiveIntegerField(validators=[MaxValueValidator(150)])
    gender = models.CharField(max_length=10, choices=GENDER_CHOICES)
    room = models.CharField(max_length=50, db_index=True)
    diagnosis = models.CharField(max_length=255)
    admission_date = models.DateField()
    risk_level = models.CharField(max_length=10, choices=RISK_CHOICES, default='low', db_index=True)
    attending_physician = models.CharField(max_length=200, blank=True, default='')

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
        indexes = [
            models.Index(fields=['assigned_nurse', 'risk_level']),
            models.Index(fields=['admission_date']),
        ]

    def __str__(self):
        return f'{self.patient_code} — {self.name}'


class Task(models.Model):
    PRIORITY_CHOICES = [
        ('urgent', 'Urgent'),
        ('routine', 'Routine'),
        ('completed', 'Completed'),
    ]
    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('in_progress', 'In Progress'),
        ('completed', 'Completed'),
        ('overdue', 'Overdue'),
    ]
    CATEGORY_CHOICES = [
        ('medication', 'Medication'),
        ('vital_signs', 'Vital Signs'),
        ('care', 'Care'),
        ('assessment', 'Assessment'),
        ('documentation', 'Documentation'),
    ]

    task_code = models.CharField(max_length=30, unique=True, db_index=True)
    patient = models.ForeignKey(
        Patient,
        on_delete=models.CASCADE,
        related_name='tasks',
        null=True,
        blank=True,
    )
    patient_name = models.CharField(max_length=200, blank=True, default='')
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True, default='')
    priority = models.CharField(max_length=20, choices=PRIORITY_CHOICES, default='routine', db_index=True)
    due_time = models.CharField(max_length=20, blank=True, default='')
    assigned_to = models.CharField(max_length=200, db_index=True)
    assigned_nurse = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='tasks',
    )
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending', db_index=True)
    category = models.CharField(max_length=30, choices=CATEGORY_CHOICES, default='care')
    attending_physician = models.CharField(max_length=200, blank=True, default='')
    patient_room = models.CharField(max_length=50, blank=True, default='')
    doctor_order = models.TextField(blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['assigned_to', 'status']),
            models.Index(fields=['status', 'priority']),
            models.Index(fields=['created_at']),
        ]

    def __str__(self):
        return f'{self.task_code} — {self.title}'

    def save(self, *args, **kwargs):
        if self.patient and not self.patient_name:
            self.patient_name = self.patient.name
        if self.patient and not self.patient_room:
            self.patient_room = self.patient.room
        if self.patient and not self.attending_physician:
            self.attending_physician = self.patient.attending_physician
        super().save(*args, **kwargs)


class HandoverNote(models.Model):
    SHIFT_CHOICES = [
        ('morning', 'Morning'),
        ('afternoon', 'Afternoon'),
        ('night', 'Night'),
    ]
    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('acknowledged', 'Acknowledged'),
        ('completed', 'Completed'),
    ]

    handover_code = models.CharField(max_length=30, unique=True, db_index=True)
    patient = models.ForeignKey(
        Patient,
        on_delete=models.CASCADE,
        related_name='handovers',
        null=True,
        blank=True,
    )
    patient_name = models.CharField(max_length=200, blank=True, default='')
    shift = models.CharField(max_length=20, choices=SHIFT_CHOICES, default='morning')
    date = models.DateField()
    nurse_from = models.CharField(max_length=200)
    nurse_to = models.CharField(max_length=200)
    situation = models.TextField(blank=True, default='')
    background = models.TextField(blank=True, default='')
    assessment = models.TextField(blank=True, default='')
    recommendation = models.TextField(blank=True, default='')
    unfinished_tasks = models.JSONField(default=list, blank=True)
    photos = models.JSONField(default=list, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending', db_index=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='handovers_created',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-date', '-created_at']
        indexes = [
            models.Index(fields=['date', 'shift']),
            models.Index(fields=['nurse_from']),
            models.Index(fields=['nurse_to']),
        ]

    def __str__(self):
        return f'{self.handover_code} — {self.patient_name}'


class ChartingNote(models.Model):
    TYPE_CHOICES = [
        ('progress', 'Progress'),
        ('assessment', 'Assessment'),
        ('medication', 'Medication'),
        ('vital_signs', 'Vital Signs'),
    ]

    note_code = models.CharField(max_length=30, unique=True, db_index=True)
    patient = models.ForeignKey(
        Patient,
        on_delete=models.CASCADE,
        related_name='charting_notes',
        null=True,
        blank=True,
    )
    patient_name = models.CharField(max_length=200, blank=True, default='')
    nurse = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='charting_notes',
    )
    nurse_name = models.CharField(max_length=200, blank=True, default='')
    timestamp = models.DateTimeField()
    note_type = models.CharField(max_length=30, choices=TYPE_CHOICES, default='progress')
    content = models.TextField()
    ai_generated = models.BooleanField(default=False)
    edited = models.BooleanField(default=False)
    attending_physician = models.CharField(max_length=200, blank=True, default='')
    edit_history = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-timestamp']
        indexes = [
            models.Index(fields=['timestamp']),
            models.Index(fields=['note_type']),
        ]

    def __str__(self):
        return f'{self.note_code} — {self.patient_name}'


class Notification(models.Model):
    TYPE_CHOICES = [
        ('critical', 'Critical'),
        ('warning', 'Warning'),
        ('info', 'Info'),
        ('success', 'Success'),
    ]

    recipient = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='notifications',
    )
    notification_type = models.CharField(max_length=20, choices=TYPE_CHOICES, default='info')
    title = models.CharField(max_length=200)
    message = models.TextField()
    patient_label = models.CharField(max_length=100, blank=True, default='')
    is_read = models.BooleanField(default=False, db_index=True)
    action_label = models.CharField(max_length=100, blank=True, default='')
    action_path = models.CharField(max_length=200, blank=True, default='')
    action_highlight_id = models.CharField(max_length=50, blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['recipient', 'is_read', '-created_at']),
        ]

    def __str__(self):
        return f'{self.title} → {self.recipient_id}'


class PatientAssignment(models.Model):
    PRIORITY_CHOICES = [
        ('urgent', 'Urgent'),
        ('routine', 'Routine'),
    ]
    STATUS_CHOICES = [
        ('active', 'Active'),
        ('completed', 'Completed'),
        ('reassigned', 'Reassigned'),
    ]

    patient = models.ForeignKey(
        Patient,
        on_delete=models.CASCADE,
        related_name='assignments',
    )
    assigned_nurse = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='patient_assignments',
    )
    assigned_nurse_name = models.CharField(max_length=200, blank=True, default='')
    ward = models.CharField(max_length=100, blank=True, default='')
    priority = models.CharField(max_length=20, choices=PRIORITY_CHOICES, default='routine')
    notes = models.TextField(blank=True, default='')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='active', db_index=True)
    assigned_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='assignments_made',
    )
    assigned_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-assigned_at']
        constraints = [
            models.UniqueConstraint(
                fields=['patient'],
                condition=models.Q(status='active'),
                name='unique_active_patient_assignment',
            ),
        ]
        indexes = [
            models.Index(fields=['assigned_nurse', 'status']),
        ]

    def __str__(self):
        return f'{self.patient.patient_code} → {self.assigned_nurse_name}'

    def save(self, *args, **kwargs):
        if self.assigned_nurse and not self.assigned_nurse_name:
            self.assigned_nurse_name = (
                self.assigned_nurse.get_full_name().strip() or self.assigned_nurse.username
            )
        if self.patient and not self.ward:
            self.ward = self.patient.room.split('-')[0] if '-' in self.patient.room else self.patient.room
        super().save(*args, **kwargs)
        if self.status == 'active' and self.patient_id:
            Patient.objects.filter(pk=self.patient_id).update(assigned_nurse=self.assigned_nurse)


class KardexRecord(models.Model):
    patient = models.ForeignKey(
        Patient,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='kardex_records',
    )
    last_name = models.CharField(max_length=100)
    first_name = models.CharField(max_length=100)
    middle_name = models.CharField(max_length=100, blank=True, default='')
    age = models.CharField(max_length=20, blank=True, default='')
    gender = models.CharField(max_length=20, blank=True, default='')
    religion = models.CharField(max_length=100, blank=True, default='')
    room = models.CharField(max_length=50, blank=True, default='')
    bed_number = models.CharField(max_length=50, blank=True, default='')
    admission_date = models.CharField(max_length=50, blank=True, default='')
    attending_physician = models.CharField(max_length=200, blank=True, default='')
    chief_complaint = models.TextField(blank=True, default='')
    admitting_diagnosis = models.TextField(blank=True, default='')
    final_diagnosis = models.TextField(blank=True, default='')
    diet = models.CharField(max_length=200, blank=True, default='')
    temperature = models.CharField(max_length=20, blank=True, default='')
    pulse_rate = models.CharField(max_length=20, blank=True, default='')
    respiratory_rate = models.CharField(max_length=20, blank=True, default='')
    blood_pressure = models.CharField(max_length=20, blank=True, default='')
    oxygen_saturation = models.CharField(max_length=20, blank=True, default='')
    special_endorsements = models.TextField(blank=True, default='')
    saved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='kardex_records',
    )
    saved_by_name = models.CharField(max_length=200, blank=True, default='')
    saved_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-saved_at']
        indexes = [
            models.Index(fields=['last_name', 'first_name']),
            models.Index(fields=['saved_at']),
        ]

    def __str__(self):
        return f'{self.last_name}, {self.first_name}'

    @property
    def patient_name(self):
        parts = [self.first_name, self.middle_name, self.last_name]
        return ' '.join(p for p in parts if p).strip()
