"""
Shift-rotation eligibility for referrals (HandoverNote).

A referral may only move to the *next* shift in the rotation — Morning ->
Afternoon -> Night -> next day's Morning — never to a nurse on the same
shift, never to the sender, and only within the same department/ward as
the sender's own current duty assignment. The Duty Roster (DutyAssignment)
is the only source of truth here: never NurseProfile.shift/department,
which are static profile defaults that drift from the actual day-to-day
schedule (the same class of bug already fixed for head-nurse referral
visibility — see HandoverViewSet.get_queryset).
"""

from datetime import timedelta
from zoneinfo import ZoneInfo

from django.conf import settings
from django.contrib.auth.models import User
from django.utils import timezone

from .models import DutyAssignment

SHIFT_LABELS = dict(DutyAssignment.SHIFT_CHOICES)


class ReferralShiftError(Exception):
    """
    Raised by check_referral_eligibility. `field` is the form field the
    message belongs under (matches HandoverSerializer's camelCase field
    names, or 'nonFieldErrors' for a whole-form rejection like "not on
    duty") — kept on the exception so the serializer can turn this into a
    field-level 400 without the two modules agreeing on anything beyond
    this one attribute.
    """

    def __init__(self, message, field='nonFieldErrors'):
        super().__init__(message)
        self.field = field


def _local_now():
    return timezone.now().astimezone(ZoneInfo(settings.DUTY_LOCAL_TIMEZONE))


def get_current_shift(nurse, now=None):
    """
    The DutyAssignment actually covering `now` for `nurse` — not merely
    "has a roster row for today", but the one row (if any) whose real
    start/end window contains this exact moment. scheduled_start_datetime()/
    scheduled_end_datetime() already handle a shift whose end_time is
    earlier than its start_time (crosses midnight) by treating the end as
    the next calendar day, so a night shift filed under yesterday's
    duty_date that runs past midnight is still found and still correctly
    "current" for a referral made just after midnight.

    Returns the DutyAssignment, or None if the nurse isn't on duty right now.
    """
    if now is None:
        now = _local_now()
    local_date = now.date()
    candidates = (
        DutyAssignment.objects.filter(
            nurse=nurse, duty_date__in=(local_date, local_date - timedelta(days=1))
        )
        .exclude(status='cancelled')
        .select_related('department')
    )
    for candidate in candidates:
        if candidate.scheduled_start_datetime() <= now <= candidate.scheduled_end_datetime():
            return candidate
    return None


_NEXT_SHIFT = {'morning': 'afternoon', 'afternoon': 'night', 'night': 'morning'}


def get_next_shift(shift_type, shift_date, crosses_midnight=None):
    """
    Morning -> Afternoon, Afternoon -> Night, Night -> Morning — the next
    step in the fixed rotation, always. The *date* is `shift_date` unless
    this specific shift actually crosses midnight, in which case it's the
    next calendar day.

    `crosses_midnight` should be the real assignment's own
    end_time <= start_time (the same rule DutyAssignment.
    scheduled_end_datetime() uses) — start/end times are freely editable
    per assignment (see DutyAssignment's docstring), so a shift labeled
    "Night" is not assumed to always span midnight; a 4:00-7:00 AM shift
    labeled Night, for instance, does not, and its next shift is that same
    day's Morning, not tomorrow's.

    When omitted (the historical-backfill path in migration 0047, which
    has no per-assignment start/end times for an old referral to check —
    only the shift type and date the referral itself recorded), falls back
    to the type's usual behavior: only Night is assumed to cross midnight.
    This is a best-effort default for data that predates this field, not a
    claim that every Night shift crosses midnight — see get_eligible_
    recipients/check_referral_eligibility below, which always pass the
    real value for a live roster lookup.
    """
    if shift_type not in _NEXT_SHIFT:
        raise ValueError(f'Unknown shift type: {shift_type!r}')
    if crosses_midnight is None:
        crosses_midnight = shift_type == 'night'
    next_date = shift_date + timedelta(days=1) if crosses_midnight else shift_date
    return _NEXT_SHIFT[shift_type], next_date


#: Why get_eligible_recipients came back empty, in the order checked below.
#: None when recipients is non-empty. Codes, not display text — the
#: frontend owns the wording. See HandoverViewSet.eligible_recipients.
EMPTY_REASON_OFF_DUTY = 'user_off_duty'
EMPTY_REASON_NO_NEXT_SHIFT_STAFF = 'no_next_shift_staff'
EMPTY_REASON_ONLY_SELF_SCHEDULED = 'only_self_scheduled'
EMPTY_REASON_NO_ELIGIBLE_NURSE = 'no_eligible_nurse_on_next_shift'


def get_eligible_recipients(nurse, now=None):
    """
    Who `nurse` may refer to right now.

    Returns (current_assignment, next_shift, next_date, recipients,
    empty_reason). recipients is a list of every approved, active staff
    nurse in the same department as `nurse`'s current shift, scheduled for
    the next shift in rotation. current_assignment is None (and recipients
    empty, empty_reason EMPTY_REASON_OFF_DUTY) when `nurse` has no active
    shift right now — there is no "next shift" to compute without knowing
    the current one.

    empty_reason distinguishes why recipients is empty, checked in the
    order that gives the most useful answer:
      - EMPTY_REASON_OFF_DUTY: nurse isn't on duty right now.
      - EMPTY_REASON_NO_NEXT_SHIFT_STAFF: nobody at all is scheduled for
        the next shift in this department.
      - EMPTY_REASON_ONLY_SELF_SCHEDULED: the only person scheduled for it
        is `nurse` themself.
      - EMPTY_REASON_NO_ELIGIBLE_NURSE: someone else is scheduled, but none
        of them are an approved, active staff nurse (e.g. only a head
        nurse, or an account still pending approval, is on that slot).
    """
    current = get_current_shift(nurse, now)
    if current is None:
        return None, None, None, [], EMPTY_REASON_OFF_DUTY

    next_shift, next_date = get_next_shift(
        current.shift, current.duty_date, crosses_midnight=current.end_time <= current.start_time
    )

    scheduled_ids = list(
        DutyAssignment.objects.filter(
            department=current.department, duty_date=next_date, shift=next_shift,
        )
        .exclude(status='cancelled')
        .values_list('nurse_id', flat=True)
        .distinct()
    )
    recipient_ids = [pk for pk in scheduled_ids if pk != nurse.pk]

    recipients = list(
        User.objects.filter(
            pk__in=recipient_ids,
            nurse_profile__role='staff_nurse',
            nurse_profile__is_active_staff=True,
            nurse_profile__approval_status='approved',
        )
        .select_related('nurse_profile')
        .order_by('first_name', 'last_name')
    )

    empty_reason = None
    if not recipients:
        if not scheduled_ids:
            empty_reason = EMPTY_REASON_NO_NEXT_SHIFT_STAFF
        elif not recipient_ids:
            empty_reason = EMPTY_REASON_ONLY_SELF_SCHEDULED
        else:
            empty_reason = EMPTY_REASON_NO_ELIGIBLE_NURSE

    return current, next_shift, next_date, recipients, empty_reason


def check_referral_eligibility(nurse, recipient, now=None):
    """
    Validates a referral from `nurse` to `recipient` against the shift
    rotation rule. Returns (current_assignment, next_shift, next_date) on
    success, or raises ReferralShiftError with a caller-facing message and
    the form field it belongs under.
    """
    if recipient is not None and recipient.pk == nurse.pk:
        raise ReferralShiftError('You cannot refer a patient to yourself.', field='nurseToId')

    current = get_current_shift(nurse, now)
    if current is None:
        raise ReferralShiftError('You are not on duty for a shift right now.')

    next_shift, next_date = get_next_shift(
        current.shift, current.duty_date, crosses_midnight=current.end_time <= current.start_time
    )

    if recipient is None:
        raise ReferralShiftError('Select a nurse to refer to.', field='nurseToId')

    is_eligible = (
        DutyAssignment.objects.filter(
            nurse=recipient, department=current.department, duty_date=next_date, shift=next_shift,
        )
        .exclude(status='cancelled')
        .exists()
    )
    if is_eligible:
        return current, next_shift, next_date

    # Same-shift and self are already covered above/by definition (the next
    # shift can never equal the current one) — what's left is "wrong shift",
    # "wrong department", or "not scheduled at all". A same-shift referral
    # is common enough to deserve its own message rather than folding into
    # the generic one.
    is_same_shift = (
        DutyAssignment.objects.filter(
            nurse=recipient, department=current.department, duty_date=current.duty_date, shift=current.shift,
        )
        .exclude(status='cancelled')
        .exists()
    )
    if is_same_shift:
        raise ReferralShiftError('You cannot refer to a nurse on the same shift as you.', field='nurseToId')

    raise ReferralShiftError(
        f'You can only refer to nurses assigned to the next shift ({SHIFT_LABELS[next_shift]}).',
        field='nurseToId',
    )
