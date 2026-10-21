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
    for schedule in VitalSignsSchedule.objects.filter(ended_at__isnull=True).select_related(
        'patient', 'patient__assigned_nurse', 'patient__department'
    ):
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
    open_checks = schedule.tasks.exclude(status='completed')
    overdue = open_checks.filter(scheduled_for__lt=now).count()
    last_reading = patient.vital_signs_history.order_by('-recorded_at').first()
    return {
        'nextCheckAt': schedule.occurrence_at_or_after(now),
        'lastCheckAt': last_reading.recorded_at if last_reading else None,
        'overdueChecks': overdue,
        'monitoringStatus': 'overdue' if overdue else 'on_schedule',
    }
