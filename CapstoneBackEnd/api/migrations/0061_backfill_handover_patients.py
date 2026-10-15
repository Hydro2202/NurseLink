from django.db import migrations


def backfill_handover_patients(apps, schema_editor):
    HandoverNote = apps.get_model('api', 'HandoverNote')
    HandoverPatient = apps.get_model('api', 'HandoverPatient')
    rows = [
        HandoverPatient(handover_id=handover.pk, patient_id=handover.patient_id)
        for handover in HandoverNote.objects.filter(patient__isnull=False).only('id', 'patient_id')
    ]
    HandoverPatient.objects.bulk_create(rows, ignore_conflicts=True)


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0060_endorsement_models'),
    ]

    operations = [
        migrations.RunPython(backfill_handover_patients, noop_reverse),
    ]
