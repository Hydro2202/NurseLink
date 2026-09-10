"""
Backfill one PatientVisit per existing Patient row.

New patients get their first visit created in PatientSerializer.create()
from this point forward — this is only for rows that existed before
PatientVisit did, so their history doesn't start empty. An already-
discharged patient gets a closed visit (discharge_date from discharged_at,
if that was ever set); anyone else gets an open one.
"""

from django.db import migrations


def backfill(apps, schema_editor):
    Patient = apps.get_model('api', 'Patient')
    PatientVisit = apps.get_model('api', 'PatientVisit')

    for patient in Patient.objects.all().iterator():
        if PatientVisit.objects.filter(patient=patient).exists():
            continue
        nurse = patient.assigned_nurse
        nurse_name = ''
        if nurse:
            # Historical models from apps.get_model() carry fields but not
            # custom methods like get_full_name(), so build the name from
            # the raw fields instead.
            nurse_name = f'{nurse.first_name} {nurse.last_name}'.strip() or nurse.username
        PatientVisit.objects.create(
            patient=patient,
            admission_date=patient.admission_date,
            discharge_date=patient.discharged_at if patient.status == 'discharged' else None,
            diagnosis=patient.diagnosis,
            room=patient.room,
            attending_physician=patient.attending_physician,
            assigned_nurse=nurse,
            assigned_nurse_name=nurse_name,
            discharged_by=patient.discharged_by if patient.status == 'discharged' else None,
        )


def noop(apps, schema_editor):
    # Backfilled visits are historical data, not schema — nothing to
    # reverse; leaving them in place on a rollback is the safe choice.
    pass


class Migration(migrations.Migration):
    dependencies = [
        ('api', '0033_patientvisit'),
    ]

    operations = [
        migrations.RunPython(backfill, noop),
    ]
