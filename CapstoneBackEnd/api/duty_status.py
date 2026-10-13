"""
What a nurse is actually rostered for, read from the Duty Roster.

NurseProfile.shift used to default to 'morning', so every nurse looked like a
morning-shift nurse even with nothing on the roster. Screens that show a
nurse's shift (the Assign Nurse picker, the Team tab, the nurse's profile) now
ask this module instead: a shift is shown only when the nurse has a real duty.
"""
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
