"""
Vital signs schedules: turns each patient's active VitalSignsSchedule into
one "Vital Signs Monitoring" task per scheduled check.

This app has no background worker (see notifications.check_due_task_reminders),
so generation runs from the live poll every client already makes, throttled to
once a minute, plus `manage.py generate_vitals_tasks` for a cron job. Either
way it catches up: every check from the last generated one up to the next
upcoming one is created, so a closed browser or a quiet ward never skips a
check, it only delays when the task appears.

Duplicates are impossible rather than merely avoided: Task has a unique
(patient, scheduled_for) constraint, and a clash is treated as "already there".
"""

import logging
from datetime import timedelta
from zoneinfo import ZoneInfo

from django.conf import settings
from django.core.cache import cache
from django.db import IntegrityError, transaction
from django.utils import timezone

from . import task_events
from .models import Task, VitalSignsSchedule
from .names import full_name
from .utils import next_code

logger = logging.getLogger(__name__)

#: A check's task appears this long before it is due.
LEAD_TIME = timedelta(minutes=30)
#: Safety cap per schedule per run (one day of hourly checks).
MAX_PER_RUN = 24
#: How often the live poll may trigger a run.
THROTTLE_SECONDS = 60

TASK_TITLE = 'Vital Signs Monitoring'

RISK_TO_PRIORITY = {'critical': 'high', 'high': 'high', 'medium': 'medium', 'low': 'low'}

#: The 5 values Edit Patient Information's "Vital Signs Monitoring (as
#: ordered)" dropdown can save — every_1h/2h/4h map onto a 'scheduled' row's
#: frequency_hours; 'prn' and 'not_specified' have no frequency at all (see
#: VitalSignsSchedule.MODE_CHOICES and Patient.vitals_monitoring_order).
ORDER_VALUE_TO_FREQUENCY = {'every_1h': 1, 'every_2h': 2, 'every_4h': 4}
MONITORING_ORDER_VALUES = (*ORDER_VALUE_TO_FREQUENCY, 'prn', 'not_specified')


def current_monitoring_order(patient):
    """The single value Patient.vitals_monitoring_order exposes, derived
    from this patient's active VitalSignsSchedule row (or its absence)."""
    active = patient.vitals_schedules.filter(ended_at__isnull=True).first()
    if active is None:
        return 'not_specified'
    if active.mode == 'prn':
        return 'prn'
    for value, hours in ORDER_VALUE_TO_FREQUENCY.items():
        if hours == active.frequency_hours:
            return value
    return 'not_specified'  # defensive: an unrecognized frequency_hours value


def set_monitoring_order(patient, order_value, user, basis=''):
    """Set, change or clear a patient's Vital Signs Monitoring (as ordered).

    The single entry point both Edit Patient Information's simple dropdown
    and the richer Kardex vitals-schedule editor ultimately funnel through
    (the latter via its own startAt/basis handling in views.py, which calls
    VitalSignsSchedule.objects.create directly but follows the identical
    end-active-then-create-new shape), so there is exactly one place that
    decides what changing the order actually does — never two independently
    maintained copies of this logic.
    """
    if order_value not in MONITORING_ORDER_VALUES:
        raise ValueError(f'Unknown monitoring order {order_value!r}')
    active = patient.vitals_schedules.filter(ended_at__isnull=True).first()

    if order_value == 'not_specified':
        if active is not None:
            end_schedule(active, user, 'Not specified')
        return None

    mode = 'prn' if order_value == 'prn' else 'scheduled'
    frequency = ORDER_VALUE_TO_FREQUENCY.get(order_value)
    if active is not None and active.mode == mode and active.frequency_hours == frequency:
        return active  # no real change — leave history alone

    if active is not None:
        label = 'as needed (PRN)' if mode == 'prn' else f'every {frequency} hour{"s" if frequency != 1 else ""}'
        end_schedule(active, user, f'Changed to {label}')

    now = timezone.now()
    local_now = _local(now)
    start_at = local_now.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
    schedule = VitalSignsSchedule.objects.create(
        patient=patient, mode=mode, frequency_hours=frequency, start_at=start_at, basis=basis,
        set_by=user if user is not None and user.is_authenticated else None,
        set_by_name=full_name(user) if user is not None and user.is_authenticated else '',
    )
    if mode == 'scheduled':
        generate_for_schedule(schedule)
    return schedule


def _local(moment):
    return timezone.localtime(moment, ZoneInfo(settings.DUTY_LOCAL_TIMEZONE))


def _create_occurrence(schedule, scheduled_for):
    patient = schedule.patient
    local = _local(scheduled_for)
    nurse = patient.assigned_nurse
    for _attempt in range(3):
        try:
            with transaction.atomic():
                task = Task.objects.create(
                    task_code=next_code(Task, 'task_code', 'T'),
                    patient=patient,
                    patient_name=patient.name,
                    patient_room=patient.room,
                    title=TASK_TITLE,
                    description=(
                        f'Scheduled vital signs check ({schedule.get_frequency_hours_display().lower()}).'
                        + (f' Order: {schedule.basis}' if schedule.basis else '')
                    ),
                    priority=RISK_TO_PRIORITY.get(patient.risk_level, 'medium'),
                    category='vital_signs',
                    task_type='procedure',
                    status='pending',
                    due_date=local.date(),
                    due_time=local.strftime('%H:%M'),
                    assigned_nurse=nurse,
                    assigned_to=full_name(nurse) if nurse else '',
                    department=patient.department,
                    vitals_schedule=schedule,
                    scheduled_for=scheduled_for,
                    checklist=[{'text': Task.VITAL_SIGNS_CHECKLIST_TEXT, 'done': False}],
                )
                task_events.record(
                    task, 'created', to_status='pending', assignedTo=task.assigned_to,
                    source='vital signs schedule', frequencyHours=schedule.frequency_hours,
                )
                return task
        except IntegrityError:
            # Either this occurrence already exists (another run won), or
            # next_code collided with a concurrent create: re-check and retry.
            if Task.objects.filter(patient=patient, scheduled_for=scheduled_for).exists():
                return None
    logger.warning('Could not create vitals task for %s at %s', patient.patient_code, scheduled_for)
    return None


def end_schedule(schedule, user=None, reason=''):
    """End an active schedule and drop its not-yet-due, untouched checks.
    Past and in-progress checks (and everything completed) stay as they are."""
    now = timezone.now()
    schedule.ended_at = now
    schedule.ended_by = user if user is not None and user.is_authenticated else None
    schedule.ended_by_name = full_name(user) if schedule.ended_by else task_events.SYSTEM_ACTOR
    schedule.end_reason = reason
    schedule.save(update_fields=['ended_at', 'ended_by', 'ended_by_name', 'end_reason'])
    schedule.tasks.filter(scheduled_for__gt=now, status='pending').exclude(
        vital_signs_readings__isnull=False
    ).delete()


def generate_for_schedule(schedule, now=None):
    """Create every missing check up to the next upcoming one. Returns the count."""
    now = now or timezone.now()
    patient = schedule.patient
    if patient.status == 'discharged':
        end_schedule(schedule, reason='Patient discharged')
        return 0
    last = schedule.tasks.exclude(scheduled_for__isnull=True).order_by('-scheduled_for').first()
    cursor = last.scheduled_for + schedule.interval if last else schedule.start_at
    horizon = now + LEAD_TIME
    created = 0
    while cursor <= horizon and created < MAX_PER_RUN:
        if _create_occurrence(schedule, cursor):
            created += 1
        cursor += schedule.interval
    return created


def generate_all(now=None):
    total = 0
    # mode='scheduled' only — a PRN order has no interval to generate from,
    # by design (see VitalSignsSchedule.MODE_CHOICES).
    for schedule in VitalSignsSchedule.objects.filter(
        ended_at__isnull=True, mode='scheduled'
    ).select_related('patient', 'patient__assigned_nurse', 'patient__department'):
        total += generate_for_schedule(schedule, now=now)
    return total


def generate_if_due():
    """Called from the live poll: at most one run per THROTTLE_SECONDS."""
    if not cache.add('vitals-schedule-generation', True, THROTTLE_SECONDS):
        return 0
    try:
        return generate_all()
    except Exception:  # never break the poll over this
        logger.exception('Vital signs task generation failed')
        return 0


def schedule_summary(schedule, now=None):
    """What the Kardex shows for one patient's active schedule."""
    now = now or timezone.now()
    patient = schedule.patient
    last_reading = patient.vital_signs_history.order_by('-recorded_at').first()
    if schedule.mode == 'prn':
        # No interval, so no "next check" or overdue concept — monitoring
        # happens as the documented order and workflow call for it.
        return {
            'nextCheckAt': None,
            'lastCheckAt': last_reading.recorded_at if last_reading else None,
            'overdueChecks': 0,
            'monitoringStatus': 'prn',
        }
    open_checks = schedule.tasks.exclude(status='completed')
    overdue = open_checks.filter(scheduled_for__lt=now).count()
    return {
        'nextCheckAt': schedule.occurrence_at_or_after(now),
        'lastCheckAt': last_reading.recorded_at if last_reading else None,
        'overdueChecks': overdue,
        'monitoringStatus': 'overdue' if overdue else 'on_schedule',
    }
