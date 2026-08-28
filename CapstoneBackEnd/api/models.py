import uuid

from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models


class NurseProfile(models.Model):
    """Extra nurse info linked 1-to-1 with Django's built-in User."""

    ROLE_CHOICES = [
        ('staff_nurse', 'Staff Nurse'),
        ('supervisor', 'Supervisor'),
    ]
    VERIFICATION_METHOD_CHOICES = [
        ('FACE', 'Face Verification'),
        ('EMAIL_OTP', 'Email OTP'),
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
    # Holds either an http(s) URL or a self-contained data: URI. Profile
    # photos are uploaded from the device and normalised to a small JPEG
    # before they land here, so there is no media server to configure and
    # nothing to serve separately — see api.avatar.normalize_avatar().
    avatar = models.TextField(blank=True, default='')
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
    verification_method = models.CharField(
        max_length=20, choices=VERIFICATION_METHOD_CHOICES, blank=True, default=''
    )
    prc_verified_at = models.DateTimeField(null=True, blank=True)
    prc_license_expiry = models.CharField(max_length=20, blank=True, default='')
    prc_profession = models.CharField(max_length=120, blank=True, default='')

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
    # The handover this task came from, when it came from one. Writing a
    # handover creates the task on the *sender's* list, because until someone
    # accepts it the patient is still theirs; acknowledging moves that same task
    # across rather than making a second copy. Keeping the link is what lets the
    # transfer find the task later.
    source_handover = models.ForeignKey(
        'HandoverNote',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='tasks',
    )
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
    # nurse_to is the name typed on the form, which is not enough to reach an
    # account — several nurses in this ward share a display name. The handover
    # form already knows which nurse was picked, so keep the account itself and
    # let notifications land on exactly one inbox. Nullable because handovers
    # created before this field (and any addressed to a non-user) have none.
    nurse_to_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='handovers_received',
    )
    # Set the first time a handover is acknowledged, so adopting its unfinished
    # work into the incoming nurse's task list can never happen twice.
    acknowledged_at = models.DateTimeField(null=True, blank=True)
    acknowledged_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='handovers_acknowledged',
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
    # What kind of event this was, as opposed to how loud it should look.
    # notification_type carries severity for colouring; this says what happened,
    # which is what lets the app decide a patient handover deserves a popup
    # while a routine task assignment only needs the bell.
    event = models.CharField(max_length=30, blank=True, default='', db_index=True)
    title = models.CharField(max_length=200)
    message = models.TextField()
    patient_label = models.CharField(max_length=100, blank=True, default='')
    # Real references rather than the display strings above, so a notification
    # can open the actual patient and handover it is talking about.
    patient = models.ForeignKey(
        'Patient',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='notifications',
    )
    handover = models.ForeignKey(
        'HandoverNote',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='notifications',
    )
    sender = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='notifications_sent',
    )
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


class RegistrationSession(models.Model):
    """
    Tracks one in-progress signup wizard from the moment Face Verification is
    first attempted through account creation. Anonymous (no user yet) — the
    frontend carries `session_id` across steps 3-7 as its proof of identity
    verification progress. The backend, not the client, is the source of
    truth for face attempt counts and OTP verification status.
    """

    VERIFICATION_METHOD_CHOICES = NurseProfile.VERIFICATION_METHOD_CHOICES

    session_id = models.UUIDField(default=uuid.uuid4, unique=True, editable=False, db_index=True)
    email = models.EmailField(blank=True, default='')
    face_attempts = models.PositiveSmallIntegerField(default=0)
    face_verified = models.BooleanField(default=False)
    face_locked = models.BooleanField(default=False)
    otp_verified = models.BooleanField(default=False)
    verification_method = models.CharField(
        max_length=20, choices=VERIFICATION_METHOD_CHOICES, blank=True, default=''
    )
    # PRC nursing-licence verification. Separate from `is_verified` below —
    # a session proves identity via face/OTP *and* a valid PRC licence via
    # these fields; SignupSerializer checks both independently.
    prc_verified = models.BooleanField(default=False)
    prc_license_number = models.CharField(max_length=50, blank=True, default='')
    prc_full_name = models.CharField(max_length=200, blank=True, default='')
    prc_expiry = models.CharField(max_length=20, blank=True, default='')  # native MM/DD/YYYY from OCR
    prc_profession = models.CharField(max_length=120, blank=True, default='')

    # Step 1/2 (ID Review) — the PRC-ID-shaped fields the n8n identity-verify
    # workflow extracts, kept separate from the prc_* fields above (which
    # belong to Step 5's independently-gated, locally-OCR'd PRC licence
    # scan). Only ever populated after id_field_validation.validate_prc_id_fields
    # passes — see VerifyIdView.post. Real DateFields, not strings: dates
    # reach here only once validated as real, parseable dates.
    id_last_name = models.CharField(max_length=100, blank=True, default='')
    id_first_name = models.CharField(max_length=100, blank=True, default='')
    id_middle_name = models.CharField(max_length=100, blank=True, default='')
    id_registration_no = models.CharField(max_length=50, blank=True, default='')
    id_registration_date = models.DateField(null=True, blank=True)
    id_valid_until = models.DateField(null=True, blank=True)
    id_verification_status = models.CharField(max_length=20, blank=True, default='')

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='registration_session',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=['session_id']),
        ]

    def __str__(self):
        return f'RegistrationSession({self.session_id})'

    @property
    def is_verified(self) -> bool:
        return self.face_verified or self.otp_verified


class FaceVerificationAttempt(models.Model):
    """
    Verification history: one row per face-verification call. Stores only the
    outcome (never raw images or biometric embeddings — those are decoded in
    memory, compared, and discarded within the request).
    """

    REASON_CHOICES = [
        ('', 'Match / genuine mismatch'),
        ('NO_FACE', 'No face detected (selfie)'),
        ('MULTIPLE_FACES', 'Multiple faces detected (selfie)'),
        ('BLURRY', 'Selfie too blurry'),
        ('ID_NO_FACE', 'No face detected (Hospital ID)'),
        ('ID_MULTIPLE_FACES', 'Multiple faces detected (Hospital ID)'),
        ('ID_BLURRY', 'Hospital ID photo too blurry'),
        ('ID_NOT_IMAGE', 'Hospital ID not an image (e.g. PDF)'),
        ('INVALID_IMAGE', 'Invalid/corrupt selfie image'),
        ('ID_INVALID_IMAGE', 'Invalid/corrupt Hospital ID image'),
        ('PRC_NO_FACE', 'No face detected (PRC card)'),
        ('PRC_MULTIPLE_FACES', 'Multiple faces detected (PRC card)'),
        ('PRC_BLURRY', 'PRC card photo too blurry'),
        ('PRC_NOT_IMAGE', 'PRC card not an image (e.g. PDF)'),
        ('PRC_INVALID_IMAGE', 'Invalid/corrupt PRC card image'),
        ('MISMATCH', 'Face did not match Hospital ID'),
    ]

    session = models.ForeignKey(
        RegistrationSession,
        on_delete=models.CASCADE,
        related_name='face_attempts_log',
    )
    matched = models.BooleanField(default=False)
    confidence = models.FloatField(default=0.0)
    reason = models.CharField(max_length=30, choices=REASON_CHOICES, blank=True, default='')
    countable = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['session', '-created_at']),
        ]

    def __str__(self):
        return f'FaceVerificationAttempt(session={self.session_id}, matched={self.matched}, reason={self.reason})'


class RegistrationOTP(models.Model):
    """One issued OTP code for email-based registration verification."""

    PURPOSE_CHOICES = [
        ('registration', 'Registration'),
    ]

    session = models.ForeignKey(
        RegistrationSession,
        on_delete=models.CASCADE,
        related_name='otps',
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='registration_otps',
    )
    email = models.EmailField(db_index=True)
    otp_hash = models.CharField(max_length=128)
    purpose = models.CharField(max_length=30, choices=PURPOSE_CHOICES, default='registration')
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    attempts = models.PositiveSmallIntegerField(default=0)
    verified = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['session', 'purpose', 'is_active']),
            models.Index(fields=['email']),
        ]

    def __str__(self):
        return f'OTP({self.email}, active={self.is_active}, verified={self.verified})'


class IdScanAttempt(models.Model):
    """
    One row per ID-scan attempt — successful or not.

    The failures are the point. A log that only records successes cannot
    answer the questions that actually matter during a rollout: which ID
    layouts the OCR keeps misreading, which field is most often flagged for
    review, and whether n8n is dropping requests. Storing only the outcome
    (never the image) keeps this auditable without becoming a store of
    identity documents.
    """

    STATUS_CHOICES = [
        ('success', 'Success'),
        ('needs_review', 'Needs review'),
        ('rejected', 'Rejected'),
        ('error', 'Error'),
    ]
    N8N_STATUS_CHOICES = [
        ('', 'Not attempted'),
        ('success', 'Success'),
        ('failed', 'Failed'),
        ('skipped', 'Skipped'),
    ]

    session = models.ForeignKey(
        RegistrationSession,
        on_delete=models.CASCADE,
        related_name='id_scan_attempts',
        null=True,
        blank=True,
    )
    attempt_number = models.PositiveSmallIntegerField(default=1)
    document_type = models.CharField(max_length=40, blank=True, default='hospital_id')

    # --- OCR outcome ---
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='error', db_index=True)
    ocr_ran = models.BooleanField(default=False)
    registration_number = models.CharField(max_length=50, blank=True, default='', db_index=True)
    last_name = models.CharField(max_length=100, blank=True, default='')
    first_name = models.CharField(max_length=100, blank=True, default='')
    middle_name = models.CharField(max_length=100, blank=True, default='')
    registration_date = models.CharField(max_length=30, blank=True, default='')
    valid_until = models.CharField(max_length=30, blank=True, default='')
    overall_confidence = models.FloatField(default=0.0)
    #: Field names the reviewer must confirm, and which required ones were blank.
    needs_review = models.JSONField(default=list, blank=True)
    missing_required = models.JSONField(default=list, blank=True)

    # --- portrait / face outcome ---
    portrait_present = models.BooleanField(null=True, blank=True)
    face_verified = models.BooleanField(null=True, blank=True)
    face_confidence = models.FloatField(null=True, blank=True)

    # --- n8n outcome ---
    n8n_status = models.CharField(
        max_length=20, choices=N8N_STATUS_CHOICES, blank=True, default='', db_index=True
    )
    n8n_action = models.CharField(max_length=40, blank=True, default='')
    n8n_error = models.TextField(blank=True, default='')

    failure_reason = models.CharField(max_length=60, blank=True, default='')
    message = models.TextField(blank=True, default='')
    #: Set when this scan repeats the registration number of an earlier one.
    duplicate_of = models.ForeignKey(
        'self', on_delete=models.SET_NULL, null=True, blank=True, related_name='duplicates'
    )
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['session', '-created_at']),
            models.Index(fields=['status', '-created_at']),
            models.Index(fields=['registration_number']),
        ]

    def __str__(self):
        who = self.registration_number or self.last_name or 'unknown'
        return f'IdScanAttempt({who}, {self.status}, #{self.attempt_number})'

    @property
    def verified(self) -> bool:
        """
        Overall pass. Deliberately conservative: every required step must
        have actually succeeded, so a partial read or a failed face check can
        never surface as "Verified".
        """
        return (
            self.status == 'success'
            and self.portrait_present is True
            and not self.missing_required
        )
