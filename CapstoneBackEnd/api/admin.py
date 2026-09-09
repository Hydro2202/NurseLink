from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.contrib.auth.models import User

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
    RegistrationOTP,
    RegistrationSession,
    Task,
    TaskDoctor,
)
from .notifications import notify


class NurseProfileInline(admin.StackedInline):
    model = NurseProfile
    can_delete = False
    fk_name = 'user'


class UserAdmin(BaseUserAdmin):
    inlines = [NurseProfileInline]


@admin.register(NurseProfile)
class NurseProfileAdmin(admin.ModelAdmin):
    """
    The actual review screen for Problem #1 (nurse hospital verification).

    Signup already runs identity verification (PRC licence + face/OTP) and
    lands every new account here as 'pending' — this list is where an admin
    checks the claimed hospital/department/employee ID against what they
    actually know and either approves or rejects. Nothing else in the app
    can do this: approval_status is enforced server-side in
    api/permissions.py and LoginView/OAuthTokenView, not just displayed here.
    """

    list_display = (
        'user', 'role', 'department', 'hospital_name', 'employee_id',
        'approval_status', 'is_active_staff', 'verification_method',
    )
    list_display_links = ('user',)
    list_editable = ('approval_status', 'is_active_staff')
    list_filter = ('approval_status', 'role', 'is_active_staff', 'verification_method')
    search_fields = (
        'user__username', 'user__email', 'user__first_name', 'user__last_name',
        'employee_id', 'hospital_name', 'license_number',
    )
    actions = ['approve_nurses', 'reject_nurses']

    @admin.action(description='Approve selected nurse registrations')
    def approve_nurses(self, request, queryset):
        count = 0
        for profile in queryset.exclude(approval_status='approved'):
            profile.approval_status = 'approved'
            profile.rejection_reason = ''
            profile.save(update_fields=['approval_status', 'rejection_reason'])
            notify(
                profile.user,
                notification_type='success',
                event='account_approved',
                title='Account approved',
                message='Your NurseLink registration has been approved. You can now sign in.',
            )
            count += 1
        self.message_user(request, f'{count} account(s) approved.')

    @admin.action(description='Reject selected nurse registrations')
    def reject_nurses(self, request, queryset):
        count = 0
        for profile in queryset.exclude(approval_status='rejected'):
            profile.approval_status = 'rejected'
            if not profile.rejection_reason:
                profile.rejection_reason = 'Registration rejected by administrator.'
            profile.save(update_fields=['approval_status', 'rejection_reason'])
            count += 1
        self.message_user(
            request,
            f'{count} account(s) rejected with a generic reason. Open a profile to set a '
            'specific reason before the nurse tries to log in again.',
        )


@admin.register(Patient)
class PatientAdmin(admin.ModelAdmin):
    list_display = (
        'patient_code',
        'name',
        'room',
        'risk_level',
        'admission_date',
        'assigned_nurse',
    )
    list_filter = ('risk_level', 'gender', 'room')
    search_fields = ('patient_code', 'name', 'room', 'diagnosis')


@admin.register(Task)
class TaskAdmin(admin.ModelAdmin):
    list_display = ('task_code', 'title', 'patient_name', 'department', 'assigned_to', 'status', 'priority')
    list_filter = ('status', 'priority', 'category', 'department')
    search_fields = ('task_code', 'title', 'patient_name', 'assigned_to')


@admin.register(Department)
class DepartmentAdmin(admin.ModelAdmin):
    list_display = ('name',)
    search_fields = ('name',)


@admin.register(Doctor)
class DoctorAdmin(admin.ModelAdmin):
    list_display = ('full_name', 'department', 'specialization', 'license_number', 'status')
    list_filter = ('department', 'status')
    list_editable = ('status',)
    search_fields = ('full_name', 'specialization', 'license_number')


@admin.register(TaskDoctor)
class TaskDoctorAdmin(admin.ModelAdmin):
    list_display = ('task', 'doctor', 'assigned_at', 'assigned_by')
    list_filter = ('assigned_at',)
    search_fields = ('task__task_code', 'doctor__full_name')


@admin.register(PatientDoctor)
class PatientDoctorAdmin(admin.ModelAdmin):
    list_display = ('patient', 'doctor', 'status', 'assigned_at', 'assigned_by')
    list_filter = ('status',)
    search_fields = ('patient__patient_code', 'patient__name', 'doctor__full_name')


@admin.register(HandoverNote)
class HandoverNoteAdmin(admin.ModelAdmin):
    list_display = ('handover_code', 'patient_name', 'shift', 'date', 'status', 'nurse_from', 'nurse_to')
    list_filter = ('shift', 'status')


@admin.register(ChartingNote)
class ChartingNoteAdmin(admin.ModelAdmin):
    list_display = (
        'note_code',
        'patient_name',
        'note_type',
        'nurse_name',
        'confirmed',
        'timestamp',
    )
    list_filter = ('note_type', 'confirmed', 'ai_generated')


@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    list_display = ('title', 'recipient', 'notification_type', 'is_read', 'created_at')
    list_filter = ('notification_type', 'is_read')


@admin.register(PatientAssignment)
class PatientAssignmentAdmin(admin.ModelAdmin):
    list_display = ('patient', 'assigned_nurse_name', 'status', 'priority', 'assigned_at')
    list_filter = ('status', 'priority')


@admin.register(DutyAssignment)
class DutyAssignmentAdmin(admin.ModelAdmin):
    list_display = (
        'nurse', 'department', 'duty_date', 'shift', 'start_time', 'end_time',
        'regular_hours', 'overtime_hours', 'total_hours', 'status',
    )
    list_filter = ('shift', 'status', 'department')
    search_fields = ('nurse__first_name', 'nurse__last_name', 'nurse__username', 'department__name')
    date_hierarchy = 'duty_date'
    readonly_fields = ('regular_hours', 'overtime_hours', 'total_hours')


@admin.register(KardexRecord)
class KardexRecordAdmin(admin.ModelAdmin):
    list_display = ('last_name', 'first_name', 'room', 'status', 'saved_by_name', 'reviewed_by', 'saved_at')
    list_filter = ('status',)
    search_fields = ('last_name', 'first_name', 'room')


@admin.register(RegistrationSession)
class RegistrationSessionAdmin(admin.ModelAdmin):
    list_display = (
        'session_id',
        'email',
        'face_attempts',
        'face_verified',
        'otp_verified',
        'verification_method',
        'user',
        'created_at',
    )
    list_filter = ('face_verified', 'otp_verified', 'verification_method')
    search_fields = ('session_id', 'email')
    readonly_fields = [f.name for f in RegistrationSession._meta.fields]


@admin.register(RegistrationOTP)
class RegistrationOTPAdmin(admin.ModelAdmin):
    list_display = ('email', 'purpose', 'verified', 'is_active', 'attempts', 'created_at', 'expires_at')
    list_filter = ('purpose', 'verified', 'is_active')
    search_fields = ('email',)
    readonly_fields = [f.name for f in RegistrationOTP._meta.fields]


@admin.register(FaceVerificationAttempt)
class FaceVerificationAttemptAdmin(admin.ModelAdmin):
    list_display = ('session', 'matched', 'confidence', 'reason', 'countable', 'created_at')
    list_filter = ('matched', 'reason', 'countable')
    readonly_fields = [f.name for f in FaceVerificationAttempt._meta.fields]


admin.site.unregister(User)
admin.site.register(User, UserAdmin)
