from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.contrib.auth.models import User

from .models import (
    ChartingNote,
    HandoverNote,
    KardexRecord,
    Notification,
    NurseProfile,
    Patient,
    PatientAssignment,
    Task,
)


class NurseProfileInline(admin.StackedInline):
    model = NurseProfile
    can_delete = False
    fk_name = 'user'


class UserAdmin(BaseUserAdmin):
    inlines = [NurseProfileInline]


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
    list_display = ('task_code', 'title', 'patient_name', 'assigned_to', 'status', 'priority')
    list_filter = ('status', 'priority', 'category')
    search_fields = ('task_code', 'title', 'patient_name', 'assigned_to')


@admin.register(HandoverNote)
class HandoverNoteAdmin(admin.ModelAdmin):
    list_display = ('handover_code', 'patient_name', 'shift', 'date', 'status', 'nurse_from', 'nurse_to')
    list_filter = ('shift', 'status')


@admin.register(ChartingNote)
class ChartingNoteAdmin(admin.ModelAdmin):
    list_display = ('note_code', 'patient_name', 'note_type', 'nurse_name', 'timestamp')
    list_filter = ('note_type',)


@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    list_display = ('title', 'recipient', 'notification_type', 'is_read', 'created_at')
    list_filter = ('notification_type', 'is_read')


@admin.register(PatientAssignment)
class PatientAssignmentAdmin(admin.ModelAdmin):
    list_display = ('patient', 'assigned_nurse_name', 'status', 'priority', 'assigned_at')
    list_filter = ('status', 'priority')


@admin.register(KardexRecord)
class KardexRecordAdmin(admin.ModelAdmin):
    list_display = ('last_name', 'first_name', 'room', 'saved_by_name', 'saved_at')
    search_fields = ('last_name', 'first_name', 'room')


admin.site.unregister(User)
admin.site.register(User, UserAdmin)
