# Backfills to_shift/shift_date/department on referrals (HandoverNote) that
# predate the shift-rotation feature. to_shift/shift_date are always
# derivable — a pure function of the referral's own existing shift/date
# (see api.referral_shifts.get_next_shift) — but department needs a
# best-effort DutyAssignment lookup for the sender on that date/shift, and
# is left null when none is found, per "leave nulls where it can't be
# determined."

from django.db import migrations

from api.referral_shifts import get_next_shift


def backfill_forward(apps, schema_editor):
    HandoverNote = apps.get_model('api', 'HandoverNote')
    DutyAssignment = apps.get_model('api', 'DutyAssignment')

    for handover in HandoverNote.objects.filter(to_shift='').iterator():
        to_shift, shift_date = get_next_shift(handover.shift, handover.date)
        handover.to_shift = to_shift
        handover.shift_date = shift_date

        if handover.created_by_id:
            assignment = (
                DutyAssignment.objects.filter(
                    nurse_id=handover.created_by_id,
                    duty_date=handover.date,
                    shift=handover.shift,
                )
                .exclude(status='cancelled')
                .first()
            )
            if assignment is not None:
                handover.department_id = assignment.department_id

        handover.save(update_fields=['to_shift', 'shift_date', 'department'])


def backfill_backward(apps, schema_editor):
    # Irreversible by design: clearing these back to blank/null loses no
    # information that wasn't already derivable, but there's nothing
    # meaningful to restore either, so this is a no-op rather than a fake
    # reverse.
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0046_referral_shift_rotation'),
    ]

    operations = [
        migrations.RunPython(backfill_forward, backfill_backward),
    ]
