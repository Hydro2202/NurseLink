"""
Backfill the structured PatientUpdate table from the legacy
``Patient.edit_history`` JSON. Each history entry
({editedBy, editedAt, changes}) becomes one PatientUpdate row per change.

edit_history only ever stored the editor's display *name* (not a user id), so
backfilled rows have changed_by=NULL and keep the name in changed_by_name.
edit_history itself is left untouched (read-only for old records); new changes
are written straight to PatientUpdate from now on.
"""
from django.db import migrations
from django.utils.dateparse import parse_datetime


def backfill(apps, schema_editor):
    Patient = apps.get_model('api', 'Patient')
    PatientUpdate = apps.get_model('api', 'PatientUpdate')
    rows = []
    for patient in Patient.objects.exclude(edit_history=[]).iterator():
        for entry in patient.edit_history or []:
            if not isinstance(entry, dict):
                continue
            changed_at = parse_datetime(entry.get('editedAt') or '') if entry.get('editedAt') else None
            if changed_at is None:
                continue
            editor = entry.get('editedBy') or ''
            for change in entry.get('changes') or []:
                if isinstance(change, dict):
                    field_name = change.get('label') or change.get('field') or ''
                    old_value = str(change.get('from') or '')
                    new_value = str(change.get('to') or '')
                else:
                    # Oldest rows stored just a label string, no before/after.
                    field_name = str(change)
                    old_value = ''
                    new_value = ''
                if not field_name:
                    continue
                rows.append(
                    PatientUpdate(
                        patient_id=patient.pk,
                        field_name=field_name,
                        old_value=old_value,
                        new_value=new_value,
                        changed_by=None,
                        changed_by_name=editor,
                        changed_at=changed_at,
                        source='legacy',
                    )
                )
    if rows:
        PatientUpdate.objects.bulk_create(rows, batch_size=500)


def noop_reverse(apps, schema_editor):
    # Backfilled rows are identifiable by source='legacy'; a reverse removes
    # exactly those, leaving any new rows intact.
    PatientUpdate = apps.get_model('api', 'PatientUpdate')
    PatientUpdate.objects.filter(source='legacy').delete()


class Migration(migrations.Migration):
    dependencies = [
        ('api', '0081_notification_acknowledged_at_notification_priority_and_more'),
    ]
    operations = [migrations.RunPython(backfill, noop_reverse)]
