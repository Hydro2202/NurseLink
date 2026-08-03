from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.contrib.auth.models import User

from .models import NurseProfile, Patient


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


admin.site.unregister(User)
admin.site.register(User, UserAdmin)
