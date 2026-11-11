"""
What a nurse is actually rostered for, read from the Duty Roster.

NurseProfile.shift used to default to 'morning', so every nurse looked like a
morning-shift nurse even with nothing on the roster. Screens that show a
nurse's shift (the Assign Nurse picker, the Team tab, the nurse's profile) now
ask this module instead: a shift is shown only when the nurse has a real duty.
"""
from datetime import timedelta

from django.conf import settings
from django.db.models import Q
from django.utils import timezone
from zoneinfo import ZoneInfo

from .models import DutyAssignment


def local_today():
    return timezone.now().astimezone(ZoneInfo(settings.DUTY_LOCAL_TIMEZONE)).date()


def current_duties(nurse_ids):
    """
    {nurse_id: DutyAssignment} -- the duty each nurse is on now, else their next
    upcoming one. Cancelled and finished duties don't count. A shift already in
    progress wins even if it started yesterday (night shift past midnight).
    """
    nurse_ids = list(nurse_ids)
    if not nurse_ids:
        return {}
    duties = (
        DutyAssignment.objects.filter(nurse_id__in=nurse_ids)
        .filter(Q(duty_date__gte=local_today()) | Q(status='in_progress'))
        .exclude(status__in=['cancelled', 'completed'])
        .select_related('department')
        .order_by('duty_date', 'start_time')
    )
    result = {}
    for duty in duties:
        existing = result.get(duty.nurse_id)
        if existing is None or (duty.status == 'in_progress' and existing.status != 'in_progress'):
            result[duty.nurse_id] = duty
    return result


def duty_fields(profile, duty):
    """(shift, department) to display: shift only when on duty; the duty's
    department first, else the department the head nurse last assigned."""
    shift = duty.shift if duty else ''
    department = duty.department.name if duty else (profile.department if profile else '')
    return shift, department


# NurseProfile.overtime_hours/burnout_risk are static fields that default to
# 0/'low' and are never written anywhere outside the demo seed script and
# tests — the same kind of stale-default trap `shift` used to be (see the
# module docstring). The real number lives on today's DutyAssignment rows,
# so the Workload Monitor and Team screens read it from there instead.
def today_overtime_hours(nurse_ids):
    """
    {nurse_id: float} -- real overtime hours for today, summed across every
    one of today's duty assignments (a nurse can have more than one — see
    current_duties's own note about a head nurse re-assigning them later
    the same day). An ended shift uses its frozen actual_overtime_hours; one
    still clocked in past its scheduled end counts what's accrued so far;
    one nobody has clocked into yet falls back to its scheduled
    overtime_hours. Mirrors duty-roster.tsx's own effectiveOvertimeHours so
    the head nurse sees the same figure everywhere.
    """
    nurse_ids = list(nurse_ids)
    if not nurse_ids:
        return {}
    now = timezone.now()
    duties = DutyAssignment.objects.filter(
        nurse_id__in=nurse_ids, duty_date=local_today()
    ).exclude(status='cancelled')
    totals: dict = {}
    for duty in duties:
        if duty.actual_end_time is not None:
            hours = duty.actual_overtime_hours
        elif duty.actual_start_time is not None:
            seconds = (now - duty.scheduled_end_datetime()).total_seconds()
            hours = round(max(seconds, 0) / 3600, 2)
        else:
            hours = duty.overtime_hours
        totals[duty.nurse_id] = round(totals.get(duty.nurse_id, 0) + hours, 2)
    return totals


# A nurse still clocked in this long past their scheduled end reads as a
# forgotten clock-out, not someone still on duty — mirrors the Duty Roster
# screen's own MISSED_CLOCKOUT_MINUTES so the two never disagree.
DUTY_MISSED_CLOCKOUT_MINUTES = 120


def duty_is_on_duty_now(duty, now=None):
    """
    True when THIS duty means the nurse is actually on shift right now:
    they clocked in (actual_start_time set), have not clocked out
    (actual_end_time null), the shift has started, and they are not more than
    DUTY_MISSED_CLOCKOUT_MINUTES past its scheduled end. Cancelled duties never
    count. This is the single predicate both the Head Nurse dashboard's Nurse
    Overview and the Duty Roster's "On duty now" read, so the two screens can
    never disagree — being assigned, or approved/active, is not "on duty".
    """
    if duty is None or duty.status == 'cancelled':
        return False
    if duty.actual_start_time is None or duty.actual_end_time is not None:
        return False
    now = now or timezone.now()
    start = duty.scheduled_start_datetime()
    end = duty.scheduled_end_datetime()
    return start <= now <= end + timedelta(minutes=DUTY_MISSED_CLOCKOUT_MINUTES)


def nurse_ids_on_duty_now():
    """Set of user ids that are on shift right now, per duty_is_on_duty_now.
    Looks at today's and yesterday's duties (a night shift crosses midnight)."""
    now = timezone.now()
    today = local_today()
    duties = (
        DutyAssignment.objects.filter(duty_date__in=(today, today - timedelta(days=1)))
        .exclude(status='cancelled')
        .filter(actual_start_time__isnull=False, actual_end_time__isnull=True)
    )
    return {d.nurse_id for d in duties if duty_is_on_duty_now(d, now)}


def nurses_on_duty_now(department_id=None):
    """
    User ids of everyone on shift right now: clocked in and not out, or inside
    the scheduled hours of a duty that isn't cancelled, completed or clocked
    out. Optionally limited to one department.
    """
    local_now = timezone.now().astimezone(ZoneInfo(settings.DUTY_LOCAL_TIMEZONE))
    today = local_now.date()
    duties = (
        DutyAssignment.objects.filter(duty_date__in=(today, today - timedelta(days=1)))
        .exclude(status__in=['cancelled', 'completed'])
        .filter(actual_end_time__isnull=True)
    )
    if department_id is not None:
        duties = duties.filter(department_id=department_id)
    on_duty = set()
    for duty in duties:
        if duty.actual_start_time is not None or (
            duty.scheduled_start_datetime() <= local_now <= duty.scheduled_end_datetime()
        ):
            on_duty.add(duty.nurse_id)
    return on_duty
