import uuid
from datetime import datetime, timedelta
from datetime import time as dtime
from zoneinfo import ZoneInfo

from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.utils import timezone

from .names import full_name


class ClinicalRole(models.TextChoices):
    """The only clinical roles an account may hold. Used by the model, the
    serializers and the admin — never a free-text value."""

    RN = 'RN', 'RN'
    LPN = 'LPN', 'LPN'
    CHARGE_NURSE = 'Charge Nurse', 'Charge Nurse'
    CLINICAL_NURSE_SPECIALIST = 'Clinical Nurse Specialist', 'Clinical Nurse Specialist'


class NurseProfile(models.Model):
    """Extra nurse info linked 1-to-1 with Django's built-in User."""

    ROLE_CHOICES = [
        ('staff_nurse', 'Staff Nurse'),
        ('head_nurse', 'Head Nurse'),
    ]
    VERIFICATION_METHOD_CHOICES = [
        ('FACE', 'Face Verification'),
        ('EMAIL_OTP', 'Email OTP'),
    ]
    CLINICAL_ROLE_CHOICES = ClinicalRole.choices
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
    # New-signup-wizard field (signup-v2). Additive/nullable-by-default —
    # the old signup flow never collects a phone number, so this is blank
    # for every account created before it existed.
    phone_number = models.CharField(max_length=20, blank=True, default='')
    # Holds either an http(s) URL or a self-contained data: URI. Profile
    # photos are uploaded from the device and normalised to a small JPEG
    # before they land here, so there is no media server to configure and
    # nothing to serve separately — see api.avatar.normalize_avatar().
    avatar = models.TextField(blank=True, default='')
    clinical_role = models.CharField(
        max_length=40, choices=CLINICAL_ROLE_CHOICES, default='RN', blank=True
    )
    shift = models.CharField(max_length=20, choices=SHIFT_CHOICES, default='', blank=True)
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
    # What an applicant asked for at signup. A request only — it grants no
    # permission. Head nurse is granted by an admin via
    # AdminUserViewSet.grant_role, which also records who did it and when.
    requested_role = models.CharField(max_length=20, blank=True, default='')
    role_granted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='roles_granted',
    )
    role_granted_at = models.DateTimeField(null=True, blank=True)

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
        return full_name(self.user)


def compute_bmi(height_cm, weight_kg):
    """weight_kg / (height_cm/100)**2, rounded to 1 decimal — shared by
    Patient and KardexRecord so the two never disagree on the formula.
    None whenever either measurement is missing or height is non-positive
    (a zero/negative height would otherwise divide-by-zero or invert the
    sign, and there's no such thing as a real Kardex entry with either)."""
    if height_cm is None or weight_kg is None:
        return None
    height_m = float(height_cm) / 100
    if height_m <= 0:
        return None
    return round(float(weight_kg) / (height_m ** 2), 1)


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
        ('critical', 'Critical'),
    ]
    STATUS_CHOICES = [
        ('admitted', 'Admitted'),
        ('observation', 'Under Observation'),
        ('discharged', 'Discharged'),
    ]

    patient_code = models.CharField(max_length=20, unique=True, db_index=True)
    name = models.CharField(max_length=200)
    # Registration/demographic detail beyond `name` — null/blank on every
    # patient that predates these fields; nullable+unique on
    # medical_record_number specifically so those pre-existing NULLs never
    # collide with each other under the unique constraint.
    medical_record_number = models.CharField(
        max_length=20, null=True, blank=True, unique=True, db_index=True
    )
    first_name = models.CharField(max_length=100, blank=True, default='')
    middle_name = models.CharField(max_length=100, blank=True, default='')
    last_name = models.CharField(max_length=100, blank=True, default='')
    date_of_birth = models.DateField(null=True, blank=True)
    contact_number = models.CharField(max_length=20, blank=True, default='')
    address = models.CharField(max_length=255, blank=True, default='')
    emergency_contact_name = models.CharField(max_length=200, blank=True, default='')
    emergency_contact_number = models.CharField(max_length=20, blank=True, default='')
    bed_number = models.CharField(max_length=20, blank=True, default='')
    age = models.PositiveIntegerField(validators=[MaxValueValidator(150)])
    gender = models.CharField(max_length=10, choices=GENDER_CHOICES)
    room = models.CharField(max_length=50, db_index=True)
    diagnosis = models.CharField(max_length=255)
    admission_date = models.DateField()
    risk_level = models.CharField(max_length=10, choices=RISK_CHOICES, default='low', db_index=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='admitted', db_index=True)
    attending_physician = models.CharField(max_length=200, blank=True, default='')
    # Which hospital department this patient belongs to — separate from the
    # free-text `room`, and what the All Patients "Assigned Nurse" column
    # resolves against the Duty Roster with (see PatientSerializer.
    # get_onDutyNurseName): nullable, since most existing patients predate
    # this field and a supervisor sets it explicitly.
    department = models.ForeignKey(
        'Department',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='patients',
    )
    # Discharge audit trail — set only through PatientViewSet.discharge,
    # never through a direct field edit (see PatientSerializer.validate_status).
    discharged_at = models.DateTimeField(null=True, blank=True)
    discharged_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='patients_discharged',
    )

    heart_rate = models.PositiveIntegerField(default=0)
    blood_pressure = models.CharField(max_length=20, default='')
    temperature = models.FloatField(default=0)
    oxygen_saturation = models.PositiveIntegerField(default=0)
    respiratory_rate = models.PositiveIntegerField(default=0)

    # Nullable — most existing patients predate this field, and a Kardex
    # save only sets these when the nurse actually filled them in (same
    # "leave what wasn't provided alone" convention KardexRecordSerializer.
    # create() already uses for the vitals snapshot above).
    height_cm = models.DecimalField(max_digits=5, decimal_places=1, null=True, blank=True)
    weight_kg = models.DecimalField(max_digits=5, decimal_places=1, null=True, blank=True)

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

    # Audit trail for record corrections (e.g. a supervisor fixing a
    # misrecorded vital or wrong diagnosis on a discharged patient) — same
    # {editedBy, editedAt, changes} shape ChartingNote.edit_history already
    # uses. See PatientSerializer.update().
    edit_history = models.JSONField(default=list, blank=True)

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

    @property
    def bmi(self):
        return compute_bmi(self.height_cm, self.weight_kg)


class PatientVisit(models.Model):
    """
    One admission-to-discharge encounter under a Patient profile.

    Patient's own diagnosis/room/attending_physician/assigned_nurse fields
    stay the *current* snapshot — every existing reader (Kardex, handover
    SBAR, dashboards) keeps using them exactly as before. This is the
    history layer underneath: readmitting a discharged patient (see
    PatientViewSet.readmit) reactivates the same Patient row rather than
    creating a duplicate, and opens a new PatientVisit rather than losing
    the previous stay's record.

    diagnosis/room/attending_physician/assigned_nurse_name/medical_team are
    snapshotted (not live-joined) because PatientDoctor is unique on
    (patient, doctor) — a doctor re-assigned on a later visit reactivates
    the same row rather than creating a new one, so a later admission can
    silently rewrite what a date-range query would attribute to an earlier
    visit. Vitals and notes don't have that problem (VitalSigns/ChartingNote
    are insert-only, one row per real event) and are read live, scoped to
    [admission_date, discharge_date or now) — see PatientVisitSerializer.
    """

    patient = models.ForeignKey(Patient, on_delete=models.CASCADE, related_name='visits')
    admission_date = models.DateField()
    # Null while the visit is still open (the patient hasn't been discharged
    # from *this* stay yet).
    discharge_date = models.DateTimeField(null=True, blank=True)
    diagnosis = models.CharField(max_length=255, blank=True, default='')
    room = models.CharField(max_length=50, blank=True, default='')
    attending_physician = models.CharField(max_length=200, blank=True, default='')
    assigned_nurse = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='patient_visits',
    )
    assigned_nurse_name = models.CharField(max_length=200, blank=True, default='')
    # [{"name": ..., "specialization": ..., "departmentName": ...}, ...] —
    # a snapshot of the Kardex care team, not a live PatientDoctor join; see
    # the class docstring for why.
    medical_team = models.JSONField(default=list, blank=True)
    discharged_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='visits_discharged',
    )
    # Discharge Plan (M.E.T.H.O.D.) — filled in as part of discharging this
    # visit, so "who/when completed it" reuses discharged_by/discharge_date
    # above rather than duplicating them; both happen at the same moment (see
    # PatientViewSet.discharge). Blank on visits with no plan — open visits,
    # or ones discharged before this feature existed.
    discharge_plan_medications = models.TextField(blank=True, default='')
    discharge_plan_environment = models.TextField(blank=True, default='')
    discharge_plan_treatment = models.TextField(blank=True, default='')
    discharge_plan_health_teaching = models.TextField(blank=True, default='')
    discharge_plan_outpatient_referral = models.TextField(blank=True, default='')
    discharge_plan_diet = models.TextField(blank=True, default='')
    # Whether the plan text came from the AI-draft (and was then reviewed/
    # possibly edited) vs typed from scratch — same spirit as
    # ChartingNote.ai_generated.
    discharge_plan_ai_generated = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-admission_date', '-created_at']
        indexes = [
            models.Index(fields=['patient', '-admission_date']),
        ]

    def __str__(self):
        status = 'active' if self.discharge_date is None else 'closed'
        return f'{self.patient_id} visit @ {self.admission_date} ({status})'


def default_task_checklist():
    """
    The standard steps behind any task, not a clinical judgment about this
    one — see Task.checklist. A plain default (not AI-generated) on purpose:
    Problem #6 is explicit that a recommendation may only assist a nurse, not
    decide for them, so this stays a fixed, predictable checklist rather than
    something a model invents per task. Must be a callable, not a literal
    list, so Django gives each Task its own list instead of one shared
    default every row would silently mutate together.
    """
    return [
        {'text': 'Verify patient identity', 'done': False},
        {'text': 'Review task/instructions', 'done': False},
        {'text': 'Check required patient information', 'done': False},
        {'text': 'Perform assigned task', 'done': False},
        {'text': 'Document result', 'done': False},
        {'text': 'Confirm completion', 'done': False},
    ]


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
    #: [{"text": str, "done": bool}, ...]. An empty list is the escape hatch
    #: Problem #6 calls for ("unless the existing workflow has a valid
    #: exception") — completing a task with no checklist is never blocked.
    checklist = models.JSONField(default=default_task_checklist, blank=True)
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

    department = models.ForeignKey(
        'Department',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='tasks',
    )

    #: The mandatory final checklist step on every 'vital_signs' category
    #: task — TaskSerializer.validate_checklist gates it behind at least 2
    #: logged VitalSigns rows, so its wording has to actually say what it's
    #: gating, not a generic "Confirm completion" a nurse could tick blind.
    VITAL_SIGNS_CHECKLIST_TEXT = 'Vital Signs Check'

    def save(self, *args, **kwargs):
        if self.patient and not self.patient_name:
            self.patient_name = self.patient.name
        if self.patient and not self.patient_room:
            self.patient_room = self.patient.room
        if self.patient and not self.attending_physician:
            self.attending_physician = self.patient.attending_physician
        if self.category == 'vital_signs':
            checklist = list(self.checklist or [])
            if checklist and checklist[-1].get('text') != self.VITAL_SIGNS_CHECKLIST_TEXT:
                checklist[-1] = {**checklist[-1], 'text': self.VITAL_SIGNS_CHECKLIST_TEXT}
                self.checklist = checklist
            elif not checklist:
                self.checklist = [{'text': self.VITAL_SIGNS_CHECKLIST_TEXT, 'done': False}]
        super().save(*args, **kwargs)


class Department(models.Model):
    name = models.CharField(max_length=150, unique=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


class Doctor(models.Model):
    STATUS_CHOICES = [
        ('active', 'Active'),
        ('inactive', 'Inactive'),
    ]

    full_name = models.CharField(max_length=200)
    specialization = models.CharField(max_length=150, blank=True, default='')
    department = models.ForeignKey(Department, on_delete=models.PROTECT, related_name='doctors')
    license_number = models.CharField(max_length=50, blank=True, default='')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='active', db_index=True)

    class Meta:
        ordering = ['full_name']

    def __str__(self):
        return f'{self.full_name} ({self.department.name})'


class TaskDoctor(models.Model):
    """Junction row: one task can have many doctors, one doctor can be on
    many tasks. A doctor is never overwritten by selecting another — each
    selection adds its own row here rather than replacing a single field."""

    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name='task_doctors')
    doctor = models.ForeignKey(Doctor, on_delete=models.CASCADE, related_name='task_assignments')
    assigned_at = models.DateTimeField(auto_now_add=True)
    assigned_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='doctor_assignments_made',
    )

    class Meta:
        unique_together = ('task', 'doctor')
        ordering = ['assigned_at']

    def __str__(self):
        return f'{self.task.task_code} -> {self.doctor.full_name}'


class PatientDoctor(models.Model):
    """A patient's Kardex-level doctor roster — who is actually responsible
    for this patient, independent of any one task. Add New Task reads from
    this (filtered by department) rather than the hospital-wide Doctor list,
    so a task can only ever be assigned to a doctor already on this patient's
    care team."""

    STATUS_CHOICES = [
        ('active', 'Active'),
        ('inactive', 'Inactive'),
    ]

    patient = models.ForeignKey(Patient, on_delete=models.CASCADE, related_name='assigned_doctors')
    doctor = models.ForeignKey(Doctor, on_delete=models.CASCADE, related_name='patient_assignments')
    assigned_at = models.DateTimeField(auto_now_add=True)
    assigned_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='patient_doctor_assignments_made',
    )
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='active')

    class Meta:
        unique_together = ('patient', 'doctor')
        ordering = ['assigned_at']

    def __str__(self):
        return f'{self.patient.patient_code} -> {self.doctor.full_name}'


class HandoverNote(models.Model):
    SHIFT_CHOICES = [
        ('morning', 'Morning'),
        ('afternoon', 'Afternoon'),
        ('night', 'Night'),
    ]
    # Nurse-to-nurse only — there is no head-nurse approval gate in this flow.
    # 'sent' -> 'received' -> 'accepted' | 'declined' -> 'completed'. Head
    # nurses are notified at every transition (see
    # api/notifications.py::notify_referral_head_nurse_fyi) and can view
    # every referral, but never act on one — see HandoverViewSet.accept/
    # decline/complete, which only ever authorize the sending/receiving
    # nurse.
    STATUS_CHOICES = [
        ('sent', 'Sent'),
        ('received', 'Received'),
        ('accepted', 'Accepted'),
        ('declined', 'Declined'),
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
    # The shift the *sender* filed this referral on — server-derived from
    # their own current DutyAssignment as of HandoverSerializer.create()
    # (see api/referral_shifts.py), never a client-chosen value, so it
    # always matches a real roster entry. to_shift/shift_date/department
    # below are the shift-rotation rule's target: a referral may only go to
    # the next shift in rotation (Morning -> Afternoon -> Night -> next
    # day's Morning), in the same department as `shift`/`date` below.
    shift = models.CharField(max_length=20, choices=SHIFT_CHOICES, default='morning')
    date = models.DateField()
    to_shift = models.CharField(max_length=20, choices=SHIFT_CHOICES, blank=True, default='')
    # The target shift's date — equal to `date` for Morning->Afternoon and
    # Afternoon->Night, but the *next* calendar day for Night->Morning
    # (see get_next_shift). Nullable only for referrals created before this
    # field existed; every new referral has one.
    shift_date = models.DateField(null=True, blank=True)
    # The referring nurse's department at creation time (from their
    # DutyAssignment, not the free-text NurseProfile.department — see
    # HandoverViewSet.get_queryset's docstring for why that field is
    # unreliable). Nullable for the same reason shift_date is.
    department = models.ForeignKey(
        Department,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='referrals',
    )
    nurse_from = models.CharField(max_length=200)
    nurse_to = models.CharField(max_length=200)
    situation = models.TextField(blank=True, default='')
    background = models.TextField(blank=True, default='')
    assessment = models.TextField(blank=True, default='')
    recommendation = models.TextField(blank=True, default='')
    unfinished_tasks = models.JSONField(default=list, blank=True)
    photos = models.JSONField(default=list, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='sent', db_index=True)
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
    accepted_at = models.DateTimeField(null=True, blank=True)
    accepted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='handovers_accepted',
    )
    declined_at = models.DateTimeField(null=True, blank=True)
    declined_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='handovers_declined',
    )
    declined_reason = models.TextField(blank=True, default='')
    completed_at = models.DateTimeField(null=True, blank=True)
    completed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='handovers_completed',
    )
    # Audit trail for head nurses (view-only — they never act on a referral):
    # a list of {status, by, byName, at, note} entries, one per transition,
    # oldest first. Seeded on create with the initial 'sent' entry.
    status_history = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-date', '-created_at']
        indexes = [
            models.Index(fields=['date', 'shift']),
            models.Index(fields=['nurse_from']),
            models.Index(fields=['nurse_to']),
            models.Index(fields=['status']),
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
    # Section-by-section structure rendered by the app (Auto Charting). Persisted so
    # View Full Note can rehydrate the exact approved chart without regex-parsing
    # free text (and without inventing clinical content that was never saved).
    structured_data = models.JSONField(default=dict, blank=True)
    FORMAT_CHOICES = [
        ('fdar', 'FDAR'),
        ('legacy', 'Legacy'),
    ]
    # Legacy notes (created before FDAR support existed) keep using content/
    # structured_data exactly as before, forever — see the 0038 data
    # migration, which flips every pre-existing row to 'legacy' once. Every
    # note created from here on is 'fdar' and populates focus/data/action/
    # response below; note_format is otherwise immutable post-create (see
    # ChartingNoteSerializer, where it's read-only).
    note_format = models.CharField(max_length=10, choices=FORMAT_CHOICES, default='fdar', db_index=True)
    # FDAR sections — populated only when note_format == 'fdar'. Four
    # discrete TextFields (not JSON) because FDAR is exactly four fixed
    # narrative sections, each independently editable in the nurse-facing
    # UI. Legacy rows leave these blank; content/structured_data remain
    # their source of truth.
    focus = models.TextField(blank=True, default='')
    data = models.TextField(blank=True, default='')
    action = models.TextField(blank=True, default='')
    response = models.TextField(blank=True, default='')
    ai_generated = models.BooleanField(default=False)
    edited = models.BooleanField(default=False)
    confirmed = models.BooleanField(default=False)
    confirmed_at = models.DateTimeField(null=True, blank=True)
    attending_physician = models.CharField(max_length=200, blank=True, default='')
    edit_history = models.JSONField(default=list, blank=True)
    # Auto-charting: whether this note's assessment/observation text (or an
    # explicit "vital sign change noted" checkbox in structured_data) flagged
    # a vital-sign change worth re-charting — see api/vitals_detection.py and
    # ChartingNoteSerializer._apply_vitals_flag. 'pending' until a nurse
    # confirms a new VitalSigns entry (which flips it to 'resolved') or the
    # note simply sits dismissed — 'pending' covers both, on purpose: a
    # dismissed prompt is still an outstanding vitals recheck, not a
    # cancelled one.
    VITALS_STATUS_CHOICES = [
        ('none', 'No vital-sign change flagged'),
        ('pending', 'Pending vitals update'),
        ('resolved', 'Vitals updated'),
    ]
    vitals_update_status = models.CharField(
        max_length=20, choices=VITALS_STATUS_CHOICES, default='none', db_index=True
    )
    # Which vital-sign categories were detected/flagged, e.g.
    # ['bloodPressure', 'temperature'] — keys match VitalSigns/PatientSerializer's
    # vitalSigns dict, so the frontend can highlight exactly those fields.
    flagged_vitals = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-timestamp']
        indexes = [
            models.Index(fields=['timestamp']),
            models.Index(fields=['note_type']),
            models.Index(fields=['confirmed']),
            models.Index(fields=['nurse', 'timestamp']),
            models.Index(fields=['vitals_update_status']),
        ]

    def __str__(self):
        return f'{self.note_code} — {self.patient_name}'


class VitalSigns(models.Model):
    """
    One timestamped vital-signs reading for a patient — an insert-only
    history row, never edited in place, unlike Patient.heart_rate/etc. (the
    "current snapshot" fields, which VitalSignsSerializer.create keeps in
    sync for the many existing call sites — Kardex, handover SBAR autofill —
    that still read the snapshot rather than this history).

    source/triggered_by_note is the auto-charting link: an assessment note
    whose text mentioned a vital-sign change (see api/vitals_detection.py)
    prompts a nurse to confirm a new reading pre-filled from the previous
    one; triggered_by_note is set when that reading came from such a prompt,
    and stays null for ordinary scheduled charting — this is what lets the
    vitals timeline show *why* a reading exists.
    """

    SOURCE_CHOICES = [
        ('scheduled', 'Scheduled Charting'),
        ('assessment_triggered', 'Assessment-Triggered Update'),
    ]

    patient = models.ForeignKey(
        Patient, on_delete=models.CASCADE, related_name='vital_signs_history',
    )
    # Set when this reading was taken as one of the timed check-ins on a
    # 'vital_signs' category Task (see TaskSerializer.validate_checklist) —
    # null for readings logged outside that flow (Kardex admission vitals,
    # ad-hoc assessment-triggered ones). This is what lets the task's
    # checklist gate count "how many readings has this task's nurse actually
    # done" instead of just "does this patient have vitals history at all".
    task = models.ForeignKey(
        Task, on_delete=models.SET_NULL, null=True, blank=True, related_name='vital_signs_readings',
    )
    heart_rate = models.PositiveIntegerField(null=True, blank=True)
    blood_pressure = models.CharField(max_length=20, blank=True, default='')
    temperature = models.FloatField(null=True, blank=True)
    oxygen_saturation = models.PositiveIntegerField(null=True, blank=True)
    respiratory_rate = models.PositiveIntegerField(null=True, blank=True)
    # Whether the patient was on supplemental O2 at the time of this reading
    # — distinct from oxygen_saturation (the SpO2 reading itself). Null means
    # not recorded, not "no".
    oxygen_use = models.BooleanField(null=True, blank=True)
    pain_scale = models.PositiveIntegerField(
        null=True, blank=True, validators=[MaxValueValidator(10)]
    )
    source = models.CharField(max_length=20, choices=SOURCE_CHOICES, default='scheduled', db_index=True)
    triggered_by_note = models.ForeignKey(
        ChartingNote,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='triggered_vitals',
    )
    recorded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='vital_signs_recorded',
    )
    notes = models.CharField(max_length=255, blank=True, default='')
    recorded_at = models.DateTimeField(default=timezone.now, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-recorded_at']
        verbose_name_plural = 'Vital signs'
        indexes = [
            models.Index(fields=['patient', '-recorded_at']),
            models.Index(fields=['source']),
        ]

    def __str__(self):
        return f'{self.patient_id} vitals @ {self.recorded_at:%Y-%m-%d %H:%M}'


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
                full_name(self.assigned_nurse)
            )
        if self.patient and not self.ward:
            self.ward = self.patient.room.split('-')[0] if '-' in self.patient.room else self.patient.room
        super().save(*args, **kwargs)
        if self.status == 'active' and self.patient_id:
            Patient.objects.filter(pk=self.patient_id).update(assigned_nurse=self.assigned_nurse)


class DutyAssignment(models.Model):
    """
    A supervisor-created duty-roster entry: which nurse works which
    department, on which date, for which hours. Regular/overtime/total
    hours are always derived here from the stored times (see save()) —
    never trusted as-given from the client — so the numbers can't drift
    from what was actually scheduled. Schedule-conflict checking lives in
    DutyAssignmentSerializer.validate(), the same layer PatientAssignment
    uses for its own business rules.
    """

    SHIFT_CHOICES = [
        ('morning', 'Morning'),
        ('afternoon', 'Afternoon'),
        ('night', 'Night'),
    ]
    STATUS_CHOICES = [
        ('scheduled', 'Scheduled'),
        ('in_progress', 'In Progress'),
        ('completed', 'Completed'),
        ('cancelled', 'Cancelled'),
    ]
    # Defaults offered when a shift is picked in the UI — the supervisor can
    # still adjust start/end afterward, these are just a sane starting point.
    SHIFT_DEFAULT_TIMES = {
        'morning': (dtime(7, 0), dtime(15, 0)),
        'afternoon': (dtime(15, 0), dtime(23, 0)),
        'night': (dtime(23, 0), dtime(7, 0)),
    }

    nurse = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='duty_assignments',
    )
    department = models.ForeignKey(
        Department,
        on_delete=models.PROTECT,
        related_name='duty_assignments',
    )
    duty_date = models.DateField(db_index=True)
    shift = models.CharField(max_length=20, choices=SHIFT_CHOICES, default='morning')
    start_time = models.TimeField()
    end_time = models.TimeField()
    regular_hours = models.FloatField(default=0)
    overtime_start = models.TimeField(null=True, blank=True)
    overtime_end = models.TimeField(null=True, blank=True)
    overtime_hours = models.FloatField(default=0)
    total_hours = models.FloatField(default=0)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='scheduled', db_index=True)
    # Real attendance, layered on top of the schedule above — start_time/
    # end_time stay the plan; these are when the nurse actually clocked in
    # and out. Both null until the nurse acts; actual_worked_hours/
    # actual_overtime_hours are derived from them the same way regular_hours/
    # overtime_hours are derived from the schedule (see save()), and freeze
    # once actual_end_time is set rather than staying "live".
    actual_start_time = models.DateTimeField(null=True, blank=True)
    actual_end_time = models.DateTimeField(null=True, blank=True)
    actual_worked_hours = models.FloatField(default=0)
    actual_overtime_hours = models.FloatField(default=0)
    # Set only when a supervisor closes out a shift the nurse never ended
    # themselves (see DutyAssignmentViewSet.close) — null for an ordinary
    # self-ended shift. This is what lets the record say "closed by a
    # supervisor" rather than silently looking like the nurse's own action.
    actual_end_recorded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='duty_shifts_closed',
    )
    notes = models.TextField(blank=True, default='')
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='duty_assignments_created',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['duty_date', 'start_time']
        indexes = [
            models.Index(fields=['nurse', 'duty_date']),
            models.Index(fields=['department', 'duty_date']),
        ]

    def __str__(self):
        nurse_name = full_name(self.nurse)
        return f'{nurse_name} — {self.department.name} — {self.duty_date}'

    @staticmethod
    def duration_hours(start, end):
        """Hours between two times of day. Wraps past midnight when end <= start."""
        if start is None or end is None:
            return 0.0
        start_minutes = start.hour * 60 + start.minute
        end_minutes = end.hour * 60 + end.minute
        if end_minutes <= start_minutes:
            end_minutes += 24 * 60
        return round((end_minutes - start_minutes) / 60, 2)

    def scheduled_start_datetime(self):
        """
        duty_date + start_time as a real, comparable moment in time.

        duty_date/start_time are the facility's local wall-clock values (as
        entered on the roster), not UTC — localized against
        DUTY_LOCAL_TIMEZONE rather than Django's active TIME_ZONE (UTC), so
        this lines up with the real instant timezone.now() returns
        regardless of what timezone the server process itself runs in.
        """
        naive = datetime.combine(self.duty_date, self.start_time)
        return timezone.make_aware(naive, timezone=ZoneInfo(settings.DUTY_LOCAL_TIMEZONE))

    def scheduled_end_datetime(self):
        """
        duty_date + end_time as a real moment — same midnight-wrap rule as
        duration_hours (end_time <= start_time means the shift ends the next
        calendar day), just expressed as an absolute timestamp instead of a
        bare time-of-day, which is what actual clock-in/out needs to compare
        against. Same DUTY_LOCAL_TIMEZONE localization as scheduled_start_datetime.
        """
        naive = datetime.combine(self.duty_date, self.end_time)
        if self.end_time <= self.start_time:
            naive += timedelta(days=1)
        return timezone.make_aware(naive, timezone=ZoneInfo(settings.DUTY_LOCAL_TIMEZONE))

    def schedule_status_at(self, now):
        """'upcoming' / 'current' / 'past' against the real start and end instants."""
        if now < self.scheduled_start_datetime():
            return 'upcoming'
        if now < self.scheduled_end_datetime():
            return 'current'
        return 'past'

    def schedule_window_label(self):
        """
        "Oct 2, 11:00 PM – Oct 3, 7:00 AM" in the hospital's timezone — the one
        place this text is built, so the roster, notifications and exports
        all show the same window (see Night shifts in the roster legend).
        """
        local = ZoneInfo(settings.DUTY_LOCAL_TIMEZONE)

        def fmt(moment):
            moment = moment.astimezone(local)
            hour12 = moment.hour % 12 or 12
            meridiem = 'PM' if moment.hour >= 12 else 'AM'
            return f'{moment:%b} {moment.day}, {hour12}:{moment:%M} {meridiem}'

        return f'{fmt(self.scheduled_start_datetime())} – {fmt(self.scheduled_end_datetime())}'

    def save(self, *args, **kwargs):
        self.regular_hours = self.duration_hours(self.start_time, self.end_time)
        self.overtime_hours = (
            self.duration_hours(self.overtime_start, self.overtime_end)
            if self.overtime_start and self.overtime_end
            else 0.0
        )
        self.total_hours = round(self.regular_hours + self.overtime_hours, 2)

        # Actual attendance — worked time is simply the clocked span; actual
        # overtime is whatever of that span falls after the scheduled end,
        # the real-attendance counterpart to overtime_hours above. Frozen the
        # moment actual_end_time is set; while only actual_start_time exists
        # the nurse is still clocked in, so there is nothing to freeze yet.
        if self.actual_start_time and self.actual_end_time:
            worked_seconds = (self.actual_end_time - self.actual_start_time).total_seconds()
            self.actual_worked_hours = round(max(worked_seconds, 0) / 3600, 2)
            overtime_seconds = (self.actual_end_time - self.scheduled_end_datetime()).total_seconds()
            self.actual_overtime_hours = round(max(overtime_seconds, 0) / 3600, 2)
        else:
            self.actual_worked_hours = 0.0
            self.actual_overtime_hours = 0.0

        super().save(*args, **kwargs)


class TaskHandover(models.Model):
    """
    One task/duty item handed from one nurse to another on the same shift.

    Distinct from HandoverNote (the SBAR patient handover, which notifies its
    recipient immediately on creation): this is for a specific task, and the
    receiving nurse is never told anything about it until a supervisor has
    verified it — see notify_task_handover_verified, the only place that
    notification is raised. shift/department are never taken from the client;
    they are read off the sending nurse's own DutyAssignment for duty_date at
    creation time (see TaskHandoverSerializer.validate), so they always match
    the actual day's roster rather than a static profile default.
    """

    STATUS_CHOICES = [
        ('pending', 'Pending Verification'),
        ('verified', 'Verified'),
        ('rejected', 'Rejected'),
    ]

    handover_code = models.CharField(max_length=30, unique=True, db_index=True)
    task = models.ForeignKey(
        Task,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='task_handovers',
    )
    # Free-text summary of the work being handed over — always populated
    # (defaulted from task.title when a task is linked), so a handover is
    # always readable even if the linked Task is later deleted.
    task_description = models.TextField(blank=True, default='')
    from_nurse = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='task_handovers_sent',
    )
    to_nurse = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='task_handovers_received',
    )
    department = models.ForeignKey(
        Department,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='task_handovers',
    )
    shift = models.CharField(max_length=20, choices=DutyAssignment.SHIFT_CHOICES, blank=True, default='')
    duty_date = models.DateField(db_index=True)
    notes = models.TextField(blank=True, default='')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending', db_index=True)
    supervisor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='task_handovers_reviewed',
    )
    verified_at = models.DateTimeField(null=True, blank=True)
    rejection_reason = models.TextField(blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['status', 'duty_date']),
            models.Index(fields=['to_nurse', 'status']),
            models.Index(fields=['from_nurse']),
        ]

    def __str__(self):
        return f'{self.handover_code} — {self.from_nurse} to {self.to_nurse}'


class KardexRecord(models.Model):
    # There is no separate draft step in the current UI — "Save Kardex" is
    # the only create action, so every record starts life already submitted
    # for review. A nurse whose kardex is returned/rejected corrects it by
    # saving a new one for the same patient (kardex already behaves as an
    # append-only history per patient, ordered by -saved_at) rather than
    # editing in place — no update endpoint exists on this model, on purpose.
    STATUS_CHOICES = [
        ('submitted', 'Submitted for Review'),
        ('approved', 'Approved'),
        ('returned', 'Returned for Correction'),
        ('rejected', 'Rejected'),
    ]

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
    # Numeric (unlike the free-text fields around them) so validation and
    # the bmi property below can actually do arithmetic on them. Nullable —
    # a nurse who didn't measure either leaves the Kardex save unaffected.
    height_cm = models.DecimalField(max_digits=5, decimal_places=1, null=True, blank=True)
    weight_kg = models.DecimalField(max_digits=5, decimal_places=1, null=True, blank=True)
    # Free text, not a DateField — same convention as admission_date below:
    # this is a manually-filled Kardex form field, not a system date the app
    # computes anything from, so it stays exactly what the nurse typed.
    birthday = models.CharField(max_length=50, blank=True, default='')
    religion = models.CharField(max_length=100, blank=True, default='')
    room = models.CharField(max_length=50, blank=True, default='')
    bed_number = models.CharField(max_length=50, blank=True, default='')
    admission_date = models.CharField(max_length=50, blank=True, default='')
    attending_physician = models.CharField(max_length=200, blank=True, default='')
    chief_complaint = models.TextField(blank=True, default='')
    admitting_diagnosis = models.TextField(blank=True, default='')
    final_diagnosis = models.TextField(blank=True, default='')
    diet = models.CharField(max_length=200, blank=True, default='')
    ivf = models.CharField(max_length=200, blank=True, default='')
    temperature = models.CharField(max_length=20, blank=True, default='')
    pulse_rate = models.CharField(max_length=20, blank=True, default='')
    respiratory_rate = models.CharField(max_length=20, blank=True, default='')
    blood_pressure = models.CharField(max_length=20, blank=True, default='')
    oxygen_saturation = models.CharField(max_length=20, blank=True, default='')
    allergies = models.JSONField(default=list, blank=True)
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

    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='submitted', db_index=True)
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='kardex_reviews',
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    #: Reason for a return/rejection. Not used for an approval — an approval
    #: needs no explanation, only a return or rejection does.
    review_notes = models.TextField(blank=True, default='')

    class Meta:
        ordering = ['-saved_at']
        indexes = [
            models.Index(fields=['last_name', 'first_name']),
            models.Index(fields=['saved_at']),
            models.Index(fields=['status', '-saved_at']),
        ]

    def __str__(self):
        return f'{self.last_name}, {self.first_name}'

    @property
    def bmi(self):
        return compute_bmi(self.height_cm, self.weight_kg)

    @property
    def patient_name(self):
        parts = [self.first_name, self.middle_name, self.last_name]
        return ' '.join(p for p in parts if p).strip()


def _lab_status_order():
    """Pending-first, then Done, then Cancelled — the display order the
    Laboratories section wants, which alphabetic status values don't give
    for free (cancelled < done < pending). Used by
    KardexLaboratoryQuerySet.ordered_for_display() below."""
    return models.Case(
        models.When(status='pending', then=models.Value(0)),
        models.When(status='done', then=models.Value(1)),
        models.When(status='cancelled', then=models.Value(2)),
        default=models.Value(3),
        output_field=models.IntegerField(),
    )


class KardexLaboratoryQuerySet(models.QuerySet):
    def ordered_for_display(self):
        """Pending first, then by date_ordered (most recent within each
        status group) — every read path that lists labs for the
        Laboratories section uses this instead of Meta.ordering, since the
        priority-by-status sort isn't expressible as a plain field list."""
        return self.annotate(_status_order=_lab_status_order()).order_by('_status_order', '-date_ordered')


class KardexLaboratory(models.Model):
    """
    One ordered lab/diagnostic test for a patient (CBC, Urinalysis, Chest
    X-ray, ...). Linked to Patient — the current-snapshot side of the
    Patient/KardexRecord split (see Patient's docstring) — rather than to a
    single KardexRecord snapshot, since a lab is ordered and later comes
    back as Done independently of whenever the Kardex form was last saved;
    tying it to one append-only KardexRecord row would orphan it the next
    time that Kardex is re-saved.

    Editable in place (unlike KardexRecord itself): a lab naturally moves
    Pending -> Done as the result comes back, so this is not append-only.
    """

    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('done', 'Done'),
        ('cancelled', 'Cancelled'),
    ]

    patient = models.ForeignKey(Patient, on_delete=models.CASCADE, related_name='laboratories')
    test_name = models.CharField(max_length=200)
    date_ordered = models.DateField()
    date_done = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending', db_index=True)
    result = models.TextField(blank=True, default='')
    remarks = models.TextField(blank=True, default='')
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='laboratories_created',
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='laboratories_updated',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = KardexLaboratoryQuerySet.as_manager()

    class Meta:
        # Plain fallback (e.g. Django admin) — the Laboratories section
        # itself reads via objects.ordered_for_display() instead.
        ordering = ['-date_ordered']
        indexes = [
            models.Index(fields=['patient', 'status']),
        ]

    def __str__(self):
        return f'{self.test_name} ({self.get_status_display()}) — {self.patient_id}'


class KardexMedication(models.Model):
    """
    One medication order for a patient (drug, dose, route, frequency).
    Linked to Patient for the same reason KardexLaboratory is — see its
    docstring. `is_active=False` is how a nurse "discontinues" an order
    without deleting it (deletion is head-nurse-only, per the Kardex
    permission split); its intake history stays intact either way.
    """

    ROUTE_CHOICES = [
        ('Oral', 'Oral'),
        ('IV', 'IV'),
        ('IM', 'IM'),
        ('SubQ', 'SubQ'),
        ('Topical', 'Topical'),
        ('Inhalation', 'Inhalation'),
        ('Other', 'Other'),
    ]

    patient = models.ForeignKey(Patient, on_delete=models.CASCADE, related_name='medication_orders')
    medication_name = models.CharField(max_length=200)
    dose = models.CharField(max_length=100, blank=True, default='')
    route = models.CharField(max_length=20, choices=ROUTE_CHOICES, default='Oral')
    frequency = models.CharField(max_length=100, blank=True, default='')
    start_date = models.DateField()
    end_date = models.DateField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    remarks = models.TextField(blank=True, default='')
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='medications_created',
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='medications_updated',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-is_active', '-start_date']
        indexes = [
            models.Index(fields=['patient', 'is_active']),
        ]

    def __str__(self):
        return f'{self.medication_name} {self.dose} ({self.patient_id})'

    @property
    def last_intake(self):
        # Plain .all() (not .order_by(...).first()) so this reuses a
        # prefetch_related('intakes') cache when one is set up (see
        # KardexMedicationViewSet.get_queryset) instead of issuing a fresh
        # query that silently bypasses it — any further method call on a
        # related manager does that, .all() is the one exception Django
        # recognizes. Still correct without a prefetch: MedicationIntake's
        # own Meta.ordering is already '-scheduled_time', so index [0] is
        # still "most recent" either way.
        intakes = self.intakes.all()
        return intakes[0] if intakes else None


class MedicationIntake(models.Model):
    """
    One actual administration event against a KardexMedication order —
    insert-only, like VitalSigns: a recorded intake is never edited or
    un-recorded, only superseded by the next scheduled dose.
    """

    STATUS_CHOICES = [
        ('given', 'Given'),
        ('held', 'Held'),
        ('refused', 'Refused'),
        ('missed', 'Missed'),
    ]

    medication = models.ForeignKey(KardexMedication, on_delete=models.CASCADE, related_name='intakes')
    scheduled_time = models.DateTimeField()
    administered_at = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='given', db_index=True)
    #: Required by the serializer whenever status isn't 'given'.
    reason = models.TextField(blank=True, default='')
    administered_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='medication_intakes',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-scheduled_time']
        indexes = [
            models.Index(fields=['medication', '-scheduled_time']),
        ]

    def __str__(self):
        return f'{self.medication_id} @ {self.scheduled_time:%Y-%m-%d %H:%M} ({self.get_status_display()})'


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
    # Time-based lockout: set when the attempts run out. Ends by itself at
    # face_locked_until; each new lockout on the same identity is longer
    # (settings.FACE_LOCKOUT_MINUTES). Unlocking early is admin-only.
    face_locked_until = models.DateTimeField(null=True, blank=True)
    face_lock_count = models.PositiveSmallIntegerField(default=0)
    face_unlocked_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='face_lockouts_cleared',
    )
    face_unlocked_at = models.DateTimeField(null=True, blank=True)
    face_unlock_reason = models.TextField(blank=True, default='')
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
    # The PRC card image exactly as scanned (data URI). Stored server-side and
    # never returned to clients: face verification matches the selfie against
    # this, not against an image the client sends. See VerifyIdView.
    id_portrait = models.TextField(blank=True, default='')

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


class UserPreferences(models.Model):
    """
    One nurse's Settings page, stored server side.

    These are account settings rather than device settings: a nurse who signs in
    on the ward tablet should get the same font size and the same notification
    choices they set on their phone. Keeping them here also means the server can
    honour them — a nurse who turns off handover notifications is not asking the
    app to hide them, they are asking not to be notified, and only the backend
    can decide that before a notification is ever created.

    Every field has a default matching the shipped behaviour, so a row created
    for an existing nurse changes nothing until they touch a control.
    """

    FONT_SIZE_CHOICES = [
        ('small', 'Small'),
        ('medium', 'Medium'),
        ('large', 'Large'),
    ]

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='preferences',
    )

    # Appearance
    font_size = models.CharField(max_length=10, choices=FONT_SIZE_CHOICES, default='medium')
    compact_view = models.BooleanField(default=False)

    # Notifications. Checked before a Notification row is created, so switching
    # one off stops the notification happening rather than merely hiding it.
    task_notifications = models.BooleanField(default=True)
    handover_notifications = models.BooleanField(default=True)
    critical_alerts = models.BooleanField(default=True)
    email_notifications = models.BooleanField(default=False)
    sound_alerts = models.BooleanField(default=True)

    # System
    auto_refresh = models.BooleanField(default=True)
    show_charts = models.BooleanField(default=True)
    background_sync = models.BooleanField(default=True)

    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name_plural = 'user preferences'

    def __str__(self):
        return 'Preferences for %s' % self.user.username


class AuthSession(models.Model):
    """
    One API token per login. Replaces DRF's authtoken Token for request auth,
    because Token.user is one-to-one: a second login on another device would
    hand back the same key, and logging out on one device would revoke both.
    Revoking a session deletes only that row; the user's other sessions stay.
    """

    key = models.CharField(max_length=40, unique=True, db_index=True)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='auth_sessions',
    )
    created = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f'Session for {self.user_id} ({self.created:%Y-%m-%d %H:%M})'


class EmailChangeRequest(models.Model):
    """
    A pending login-email change. The code is sent to the NEW address and is
    only stored as a hash; the email changes only when it is confirmed.
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='email_change_requests',
    )
    old_email = models.EmailField(max_length=254)
    new_email = models.EmailField(max_length=254)
    code_hash = models.CharField(max_length=64)
    attempts = models.PositiveIntegerField(default=0)
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(null=True, blank=True)
    created = models.DateTimeField(auto_now_add=True)


class CorrectionRequest(models.Model):
    """
    A nurse's request to change a verified identity field. Changes nothing
    until an admin approves it (AdminCorrectionViewSet).
    """

    STATUS_CHOICES = [('pending', 'Pending'), ('approved', 'Approved'), ('rejected', 'Rejected')]

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='correction_requests',
    )
    requested = models.JSONField(default=dict)
    reason = models.TextField()
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending', db_index=True)
    created = models.DateTimeField(auto_now_add=True)
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='corrections_reviewed',
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    review_note = models.TextField(blank=True, default='')
