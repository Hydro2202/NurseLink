# Seeds hospital nursing units/wards into the shared Department table so the
# Duty Roster's department picker has real, backend-driven options — the
# existing rows ("Department of Cardiology", etc.) are physician specialties
# seeded for the Care Team feature; nurses are rostered onto physical wards
# and units instead, which is a different (if overlapping) list. Both live in
# the same table on purpose — Duty Roster reuses the existing Department
# model rather than introducing a second one, per get_or_create these never
# duplicate a name that already exists.

from django.db import migrations

DUTY_DEPARTMENTS = [
    'Emergency Department (ER)',
    'Intensive Care Unit (ICU)',
    'Medical-Surgical Ward',
    'Pediatric Ward',
    'Obstetrics and Gynecology (OB-GYN)',
    'Operating Room (OR)',
    'Recovery Room / PACU',
    'Neonatal Intensive Care Unit (NICU)',
    'Outpatient Department (OPD)',
    'Dialysis Unit',
    'Oncology Unit',
    'Cardiology Unit',
    'Orthopedic Ward',
    'Surgical Ward',
    'Medical Ward',
    'Psychiatric Unit',
    'Isolation Ward',
    'Laboratory',
    'Radiology',
    'Maternity Ward',
    'General Ward',
]


def seed(apps, schema_editor):
    Department = apps.get_model('api', 'Department')
    for name in DUTY_DEPARTMENTS:
        Department.objects.get_or_create(name=name)


def unseed(apps, schema_editor):
    Department = apps.get_model('api', 'Department')
    Department.objects.filter(name__in=DUTY_DEPARTMENTS).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0026_duty_assignment'),
    ]

    operations = [
        migrations.RunPython(seed, unseed),
    ]
