from django.db import migrations

# One-time cleanup for rows saved before Task.save() always collapsed a
# vital_signs task's checklist to this single item: those rows got the
# generic 6-item default_task_checklist() with only the LAST item renamed,
# so they displayed "0/6 completed" instead of a single Vital Signs Check
# entry. This matches Task.save()'s own collapsing logic exactly, so future
# saves of these same rows stay consistent with what this migration sets.
VITAL_SIGNS_CHECKLIST_TEXT = 'Vital Signs Check'


def collapse_forward(apps, schema_editor):
    Task = apps.get_model('api', 'Task')
    to_update = []
    for task in Task.objects.filter(category='vital_signs').only('id', 'checklist'):
        checklist = task.checklist or []
        if len(checklist) == 1 and checklist[0].get('text') == VITAL_SIGNS_CHECKLIST_TEXT:
            continue
        already_done = bool(checklist) and bool(checklist[-1].get('done'))
        task.checklist = [{'text': VITAL_SIGNS_CHECKLIST_TEXT, 'done': already_done}]
        to_update.append(task)
    if to_update:
        Task.objects.bulk_update(to_update, ['checklist'])


def collapse_backward(apps, schema_editor):
    # Not reversible — the original generic checklist items (if any existed)
    # are gone by the time this has run forward; nothing to restore.
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0072_nurseprofile_last_seen_at'),
    ]

    operations = [
        migrations.RunPython(collapse_forward, collapse_backward),
    ]
