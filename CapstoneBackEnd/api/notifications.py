"""
Creating notifications.

The Notification model and its API existed before anything wrote to it, so the
bell was permanently empty. These helpers are the single place events turn into
inbox rows, so that "who gets told about what" is one readable list rather than
something scattered through the viewsets.

Delivery is pull-based: clients poll /api/notifications/ and pick new rows up
within seconds. Nothing here assumes a socket, so it works the same on the
dev server, on a phone over the LAN, and behind any WSGI host.
"""

import logging
import threading
import time
from datetime import datetime, time as dtime, timedelta
from zoneinfo import ZoneInfo

from django.conf import settings
from django.contrib.auth.models import User
from django.core.mail import send_mail
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from .models import HandoverNote, Notification, NurseProfile, Task
from .names import full_name, name_variants
from .realtime import push_notification

logger = logging.getLogger(__name__)

# Event names. Only HANDOVER_RECEIVED is raised as a popup: it is the one
# that makes a nurse responsible for a patient they have not seen yet.
HANDOVER_RECEIVED = 'handover_received'
HANDOVER_ACKNOWLEDGED = 'handover_acknowledged'
HANDOVER_ACCEPTED = 'handover_accepted'
HANDOVER_DECLINED = 'handover_declined'
HANDOVER_CANCELLED = 'handover_cancelled'
HANDOVER_COMPLETED = 'handover_completed'
# Head-nurse oversight only — never actionable, never an approval request.
# See notify_referral_head_nurse_fyi.
REFERRAL_HEAD_NURSE_FYI = 'referral_head_nurse_fyi'
# Raised to the receiving nurse while a referral is still pending, plus the
# sender for the overdue case — see check_due_referral_reminders.
REFERRAL_ALMOST_DUE = 'referral_almost_due'
REFERRAL_OVERDUE = 'referral_overdue'
TASK_ASSIGNED = 'task_assigned'
TASK_UPDATED = 'task_updated'
TASK_DUE_SOON = 'task_due_soon'
TASK_DUE = 'task_due'
KARDEX_REVIEWED = 'kardex_reviewed'
NURSE_REASSIGNED = 'nurse_reassigned'
TASK_HANDOVER_VERIFIED = 'task_handover_verified'
TASK_HANDOVER_ACCEPTED = 'task_handover_accepted'
TASK_HANDOVER_REJECTED = 'task_handover_rejected'
NEW_REGISTRATION_PENDING = 'new_registration_pending'
SAFETY_ALERT = 'safety_alert'
PATIENT_ASSIGNED = 'patient_assigned'
PATIENT_UNASSIGNED = 'patient_unassigned'
DUTY_ASSIGNED = 'duty_assigned'
TASK_DELAY_FLAGGED = 'task_delay_flagged'

# How far ahead of a task's/referral's due moment its "almost due" popup
# fires. Single constants so the lead time is defined once and the check
# functions, tests, and any documentation all agree on the same number.
TASK_REMINDER_LEAD_MINUTES = 15
REFERRAL_REMINDER_LEAD_MINUTES = 30



def wants(recipient, field) -> bool:
    """
    Does this nurse want this kind of notification?

    Checked before a Notification row is created, so switching a preference off
    stops the notification happening rather than creating one and hiding it —
    which is what a nurse actually means by turning it off.

    Defaults to True whenever preferences cannot be read: a missing row or a
    database hiccup must never silently swallow a patient handover.
    """
    from .models import UserPreferences

    if recipient is None:
        return False
    try:
        preferences, _ = UserPreferences.objects.get_or_create(user=recipient)
        return bool(getattr(preferences, field, True))
    except Exception:
        logger.exception('Could not read preferences for user %s; assuming enabled.', recipient.pk)
        return True



def _email_notification(notification):
    """
    Send a notification by email, when the nurse has asked for that.

    Prefers Brevo over HTTPS (same as Email OTP — see
    api/otp_service.py::_send_via_brevo) whenever BREVO_API_KEY is set, for
    the same reason: Render blocks outbound SMTP (ports 25/465/587/2525) on
    every plan, so the raw send_mail() path below hangs for the OS-level TCP
    timeout (~139s, confirmed in production — see EMAIL_HOST's comment in
    settings.py) before failing. That 139s used to run inline inside notify(),
    which is why submitting or accepting an endorsement could take minutes —
    see _dispatch_email for where that stopped being on the request thread.
    SMTP stays the local-dev path when no Brevo key is configured.

    Best effort and last: the notification is already saved and already pushed
    to the nurse's socket by the time this runs, so a mail/API failure costs
    an email, never the notification.

    Note that Email OTP is transactional and deliberately ignores this
    preference — a nurse cannot opt out of the code that lets them sign in.
    """
    recipient = notification.recipient
    address = (recipient.email or '').strip()
    if not address:
        return

    body = (
        notification.title
        + '\n\n'
        + notification.message
        + '\n\n'
        + 'You are receiving this because Email Notifications are on in your '
          'NurseLink settings.'
    )
    subject = 'NurseLink: %s' % notification.title
    brevo_key = getattr(settings, 'BREVO_API_KEY', '') or ''
    try:
        if brevo_key:
            from .otp_service import _send_via_brevo
            _send_via_brevo(address, subject, body)
        else:
            send_mail(subject, body, settings.DEFAULT_FROM_EMAIL, [address], fail_silently=True)
    except Exception:
        logger.exception('Could not email notification %s to %s', notification.pk, address)


def _dispatch_email(notification):
    """
    Runs _email_notification() off the request thread, after commit.

    notify() used to call _email_notification() inline — on Render that
    meant every endorsement create/accept whose recipient has Email
    Notifications on could block the whole HTTP response behind a ~139s SMTP
    timeout (see _email_notification's docstring), once per recipient:
    HandoverSerializer.create()/HandoverViewSet.accept() each notify the
    other nurse AND loop over every head nurse via
    notify_referral_head_nurse_fyi. None of that has to happen before the
    client gets its response — the Notification row (what actually drives
    the bell/popup) is already saved and pushed by the time this runs.

    Scheduled with transaction.on_commit, same guarantee push_notification
    already has, so a rolled-back write can never send a stray email; the
    thread itself is a daemon so it never blocks the process from exiting.

    Under `manage.py test`, runs inline instead: transaction.on_commit
    callbacks never fire inside a TestCase's wrapping (always-rolled-back)
    transaction, and even where they do, a bare background thread leaves no
    way for a test to know the email has actually gone out before it checks
    mail.outbox — see settings.TESTING.
    """
    if settings.TESTING:
        _email_notification(notification)
        return

    def _run():
        start = time.monotonic()
        try:
            _email_notification(notification)
        finally:
            logger.info(
                '[Notify] Email leg for notification %s took %.2fs',
                notification.pk, time.monotonic() - start,
            )
    transaction.on_commit(lambda: threading.Thread(target=_run, daemon=True).start())


def resolve_nurse(name: str):
    """
    Find the User behind a display name.

    Handovers and tasks address nurses by the name typed into a form
    ("Sarah Johnson"), not by id, so this is the bridge back to an account.
    Matching is deliberately forgiving about case and spacing — the same nurse
    gets typed a dozen different ways across a shift — but never guesses
    between two people: an ambiguous name resolves to nobody.
    """
    name = (name or '').strip()
    if not name:
        return None

    key = ' '.join(name.lower().split())
    matches = []
    for user in User.objects.select_related('nurse_profile'):
        if key in name_variants(user):
            matches.append(user)

    if len(matches) == 1:
        return matches[0]
    if len(matches) > 1:
        logger.warning('Notification target %r matches %d accounts; skipping.', name, len(matches))
    return None


def notify(
    recipient,
    *,
    title,
    message,
    notification_type='info',
    event='',
    patient_label='',
    patient=None,
    handover=None,
    sender=None,
    action_label='',
    action_path='',
    action_highlight_id='',
):
    """
    Add one row to a nurse's inbox.

    Returns the Notification, or None when there is nobody to tell. Callers are
    events in the middle of doing real work — acknowledging a handover, saving a
    task — so a failure here must never take that work down with it.
    """
    if recipient is None:
        return None

    try:
        notification = Notification.objects.create(
            recipient=recipient,
            notification_type=notification_type,
            event=event or '',
            title=title,
            message=message,
            patient_label=patient_label or '',
            patient=patient,
            handover=handover,
            sender=sender,
            action_label=action_label or '',
            action_path=action_path or '',
            action_highlight_id=action_highlight_id or '',
        )
    except Exception:
        logger.exception('Could not create notification for user %s', recipient.pk)
        return None

    # Saved first, then pushed. Delivery is an optimisation on top of a row that
    # already exists, so a failed push costs latency, never the notification.
    push_notification(notification)

    # And by email, if that is how this nurse wants to be reached as well —
    # dispatched in the background (see _dispatch_email) so a slow or
    # Render-blocked SMTP/API call never holds up the response this
    # notification was raised from.
    if wants(recipient, 'email_notifications'):
        _dispatch_email(notification)

    return notification


def notify_by_name(name, **kwargs):
    """notify() addressed to a display name; silently does nothing if unknown."""
    return notify(resolve_nurse(name), **kwargs)


def notify_handover_created(handover):
    """
    Tell the incoming nurse a patient has been handed over to them.

    This is the one notification the app raises as a popup rather than only a
    bell entry, because a nurse becoming responsible for a patient they have not
    seen is not something that should wait until they next open the inbox. The
    real patient, sender and handover are attached so the popup can offer to
    open the actual record instead of just naming it.

    Created once, when the handover is saved. A nurse who is offline finds it
    waiting as unread the next time they sign in.
    """
    recipient = handover.nurse_to_user or resolve_nurse(handover.nurse_to)
    if recipient is None:
        # Loud on purpose. A handover that reaches nobody's inbox looks exactly
        # like a working system from the sender's side — it saves, it appears in
        # their list — so the only symptom is a popup that never comes. Say so.
        logger.warning(
            '[Realtime] Handover %s addressed to %r reached no account: '
            'no nurseToId was sent and the name is not unique. No notification created.',
            handover.handover_code,
            handover.nurse_to,
        )
        return None

    # A nurse writing a handover to themselves does not need telling.
    if handover.created_by is not None and handover.created_by.pk == recipient.pk:
        return None

    if not wants(recipient, 'handover_notifications'):
        logger.info(
            '[Settings] %s has handover notifications off; %s not notified.',
            recipient.username, handover.handover_code,
        )
        return None

    # One handover, one notification — even if this is somehow reached twice.
    existing = Notification.objects.filter(
        recipient=recipient, handover=handover, event=HANDOVER_RECEIVED
    ).first()
    if existing is not None:
        return existing

    patient_name = handover.patient_name or (
        handover.patient.name if handover.patient_id else ''
    )
    patient_count = handover.handover_patients.count()
    if patient_count > 1:
        title = 'Patient Endorsement'
        message = f'{patient_count} patients have been referred to you by {handover.nurse_from}.'
    else:
        title = 'Patient Endorsement' if handover.is_endorsement else 'Patient Referral'
        message = f'Patient {patient_name or "a patient"} has been referred to you by {handover.nurse_from}.'
    return notify(
        recipient,
        notification_type='warning',
        event=HANDOVER_RECEIVED,
        title=title,
        message=message,
        patient_label=patient_name,
        patient=handover.patient,
        handover=handover,
        sender=handover.created_by,
        action_label='Review referral',
        action_path='/handover',
        action_highlight_id=handover.handover_code,
    )


def notify_handover_acknowledged(handover, nurse):
    """
    Tell the outgoing nurse their referral was opened/received.

    This is the lightweight "seen it" step — no responsibility has
    transferred yet and no tasks have moved (that happens on accept, see
    notify_handover_accepted). Skipped when a nurse acknowledges their own
    referral, which is just noise.
    """
    recipient = handover.created_by
    if recipient is None or recipient.pk == nurse.pk:
        return None

    if not wants(recipient, 'handover_notifications'):
        return None

    nurse_name = full_name(nurse)
    return notify(
        recipient,
        notification_type='info',
        event=HANDOVER_ACKNOWLEDGED,
        title='Referral received',
        message=(
            f'{nurse_name} received your referral for '
            f'{handover.patient_name or "a patient"} and has not yet accepted it.'
        ),
        patient_label=handover.patient_name or '',
        patient=handover.patient,
        handover=handover,
        sender=nurse,
        action_label='View referral',
        action_path='/handover',
        action_highlight_id=handover.handover_code,
    )


def notify_handover_accepted(handover, nurse, adopted_tasks):
    """
    Tell the outgoing nurse their referral was accepted.

    They are the one person who needs to know the patient is now somebody
    else's responsibility, and how much of their unfinished work was picked
    up. Skipped when a nurse accepts their own referral, which is just noise.
    """
    recipient = handover.created_by
    if recipient is None or recipient.pk == nurse.pk:
        return None

    if not wants(recipient, 'handover_notifications'):
        return None

    nurse_name = full_name(nurse)
    count = len(adopted_tasks)
    if count == 1:
        tail = ' 1 unfinished task moved to their list.'
    elif count > 1:
        tail = f' {count} unfinished tasks moved to their list.'
    else:
        tail = ''

    return notify(
        recipient,
        notification_type='success',
        event=HANDOVER_ACCEPTED,
        title='Referral accepted',
        message=(
            f'{nurse_name} accepted your referral for '
            f'{handover.patient_name or "a patient"}.{tail}'
        ),
        patient_label=handover.patient_name or '',
        patient=handover.patient,
        handover=handover,
        sender=nurse,
        action_label='View referral',
        action_path='/handover',
        action_highlight_id=handover.handover_code,
    )


def notify_handover_declined(handover, nurse, reason):
    """Tell the outgoing nurse their referral was declined, and why, so they
    can reassign the patient to someone else."""
    recipient = handover.created_by
    if recipient is None or recipient.pk == nurse.pk:
        return None

    if not wants(recipient, 'handover_notifications'):
        return None

    nurse_name = full_name(nurse)
    tail = f' Reason: {reason}' if reason else ''
    return notify(
        recipient,
        notification_type='warning',
        event=HANDOVER_DECLINED,
        title='Referral declined',
        message=(
            f'{nurse_name} declined your referral for '
            f'{handover.patient_name or "a patient"}.{tail}'
        ),
        patient_label=handover.patient_name or '',
        patient=handover.patient,
        handover=handover,
        sender=nurse,
        action_label='View referral',
        action_path='/handover',
        action_highlight_id=handover.handover_code,
    )


def notify_handover_cancelled(handover, nurse):
    """Tell the intended receiver an endorsement sent to them was cancelled
    by the sender before they acted on it."""
    recipient = handover.nurse_to_user
    if recipient is None or recipient.pk == nurse.pk:
        return None

    if not wants(recipient, 'handover_notifications'):
        return None

    nurse_name = full_name(nurse)
    return notify(
        recipient,
        notification_type='warning',
        event=HANDOVER_CANCELLED,
        title='Endorsement cancelled',
        message=f'{nurse_name} cancelled the endorsement they sent you for {handover.patient_name or "a patient"}.',
        patient_label=handover.patient_name or '',
        patient=handover.patient,
        handover=handover,
        sender=nurse,
        action_label='View endorsement',
        action_path='/handover',
        action_highlight_id=handover.handover_code,
    )


def notify_handover_completed(handover, nurse):
    """Tell the outgoing nurse a referral they sent has been marked complete."""
    recipient = handover.created_by
    if recipient is None or recipient.pk == nurse.pk:
        return None

    if not wants(recipient, 'handover_notifications'):
        return None

    nurse_name = full_name(nurse)
    return notify(
        recipient,
        notification_type='success',
        event=HANDOVER_COMPLETED,
        title='Referral completed',
        message=(
            f'{nurse_name} marked the referral for '
            f'{handover.patient_name or "a patient"} as completed.'
        ),
        patient_label=handover.patient_name or '',
        patient=handover.patient,
        handover=handover,
        sender=nurse,
        action_label='View referral',
        action_path='/handover',
        action_highlight_id=handover.handover_code,
    )


def notify_referral_head_nurse_fyi(handover, verb, detail=''):
    """
    Keep every head nurse informed of a referral event — created,
    accepted, declined, or completed — purely for oversight. Head nurses
    never approve or act on a referral (see HandoverViewSet.accept/decline/
    complete, which authorize only the two nurses involved), so this is
    deliberately not actionable: no action_label/action_path, and the title
    says "For your information" rather than anything implying a decision is
    needed.

    Every head nurse gets this, same as HandoverViewSet.get_queryset() now
    lets every head nurse list every referral — no department silo. This
    used to filter to head nurse(s) whose own NurseProfile.department
    string exactly equaled the sender's or recipient's, which meant a head
    nurse got zero of these the moment their department string didn't
    match (an admin-only department, a differently-worded ward name, or a
    referral between two nurses with no department set at all).
    """
    profiles = NurseProfile.objects.filter(role='head_nurse').select_related('user')

    patient_name = handover.patient_name or (
        handover.patient.name if handover.patient_id else 'a patient'
    )
    tail = f' {detail}' if detail else ''
    results = []
    for profile in profiles:
        head_nurse = profile.user
        if head_nurse is None:
            continue
        if head_nurse.pk == handover.created_by_id or head_nurse.pk == handover.nurse_to_user_id:
            continue
        if not wants(head_nurse, 'handover_notifications'):
            continue
        results.append(
            notify(
                head_nurse,
                notification_type='info',
                event=REFERRAL_HEAD_NURSE_FYI,
                title=f'Referral {verb} — For your information',
                message=(
                    f'Referral for {patient_name} from {handover.nurse_from} to '
                    f'{handover.nurse_to} was {verb}.{tail}'
                ),
                patient_label=handover.patient_name or '',
                patient=handover.patient,
                handover=handover,
                sender=None,
            )
        )
    return results


def notify_task_assigned(task, actor=None):
    """
    Tell a nurse a task has been put on their list.

    Skipped when they assigned it to themselves — a nurse writing their own
    to-do does not need telling about it.
    """
    recipient = task.assigned_nurse
    if recipient is None:
        return None
    if actor is not None and actor.pk == recipient.pk:
        return None

    # Urgent work is a critical alert; everything else is a task notification.
    # They are separate switches on the Settings page, so honour them separately.
    preference = 'critical_alerts' if task.priority == 'high' else 'task_notifications'
    if not wants(recipient, preference):
        logger.info(
            '[Settings] %s has %s off; task %s not notified.',
            recipient.username, preference, task.task_code,
        )
        return None

    who = ''
    if actor is not None:
        who = f'{full_name(actor)} assigned you '
    patient = f' for {task.patient_name}' if task.patient_name else ''

    return notify(
        recipient,
        notification_type='critical' if task.priority == 'high' else 'info',
        event=TASK_ASSIGNED,
        title='High-risk task assigned' if task.priority == 'high' else 'New task assigned',
        message=f'{who or "New task: "}{task.title}{patient}.',
        patient_label=task.patient_name or '',
        patient=task.patient,
        sender=actor,
        action_label='Open tasks',
        action_path='/tasks',
        action_highlight_id=task.task_code,
    )


def notify_patient_assigned(assignment, actor=None, *, previous_nurse=None):
    """
    Tell a nurse a patient has been put in their care.

    `assignment` is the just-created/updated PatientAssignment (or anything
    with .patient/.assigned_nurse) for the new owner. `previous_nurse`, when
    given and different from the new owner, also gets told the patient moved
    away from them — every call site that changes Patient.assigned_nurse
    (PatientAssignmentSerializer.create()/update(), the bulk-assign path, the
    rebalance command) knows who held it before, so there is never a second
    query here to find out.

    Same self-skip as notify_task_assigned: a nurse assigning a patient to
    themselves, or a previous owner who is also the actor, needs no telling.
    """
    patient = assignment.patient
    new_nurse = assignment.assigned_nurse
    actor_name = full_name(actor) if actor else 'A head nurse'
    room = f' (Room {patient.room})' if patient.room else ''

    primary = None
    if new_nurse is not None and (actor is None or actor.pk != new_nurse.pk):
        if wants(new_nurse, 'task_notifications'):
            primary = notify(
                new_nurse,
                notification_type='info',
                event=PATIENT_ASSIGNED,
                title='New patient assigned',
                message=f'You have been assigned to {patient.name}{room} by {actor_name}.',
                patient_label=patient.name,
                patient=patient,
                sender=actor,
                action_label='Open My Patients',
                action_path='/my-patients',
                # my-patients.tsx already has a working highlight-on-arrival
                # mechanism (see its viewPatient param) — this was the only
                # piece missing to make "View Patient" on this notification
                # actually locate the new patient instead of just opening
                # the plain, unfiltered list.
                action_highlight_id=patient.patient_code,
            )
        else:
            logger.info(
                '[Settings] %s has task_notifications off; patient assignment for %s not notified.',
                new_nurse.username, patient.patient_code,
            )

    if (
        previous_nurse is not None
        and (new_nurse is None or previous_nurse.pk != new_nurse.pk)
        and (actor is None or actor.pk != previous_nurse.pk)
        and wants(previous_nurse, 'task_notifications')
    ):
        notify(
            previous_nurse,
            notification_type='info',
            event=PATIENT_UNASSIGNED,
            title='Patient reassigned',
            message=f'{patient.name}{room} was reassigned to someone else by {actor_name}.',
            patient_label=patient.name,
            patient=patient,
            sender=actor,
            action_label='Open My Patients',
            action_path='/my-patients',
        )

    return primary


def notify_task_updated(task, actor=None, *, changed_fields=()):
    """
    Tell the assigned nurse one of their tasks changed — status, priority,
    due date, or who it is reassigned to. TaskSerializer.update() is the
    only caller, which already diffs old vs. new before calling this, so
    `changed_fields` only ever names things that genuinely changed (never
    fired on a no-op save).

    Same self-skip and critical/task_notifications split as
    notify_task_assigned, since this is the same "something on my task
    list" family of event — just the update instead of the create.
    """
    recipient = task.assigned_nurse
    if recipient is None or not changed_fields:
        return None
    if actor is not None and actor.pk == recipient.pk:
        return None

    preference = 'critical_alerts' if task.priority == 'high' else 'task_notifications'
    if not wants(recipient, preference):
        logger.info(
            '[Settings] %s has %s off; task update for %s not notified.',
            recipient.username, preference, task.task_code,
        )
        return None

    who = f'{full_name(actor)} updated ' if actor is not None else 'Updated: '
    patient = f' for {task.patient_name}' if task.patient_name else ''
    what = ', '.join(changed_fields)

    return notify(
        recipient,
        notification_type='critical' if task.priority == 'high' else 'info',
        event=TASK_UPDATED,
        title='High-risk task updated' if task.priority == 'high' else 'Task updated',
        message=f'{who}{task.title}{patient} ({what}).',
        patient_label=task.patient_name or '',
        patient=task.patient,
        sender=actor,
        action_label='Open tasks',
        action_path='/tasks',
        action_highlight_id=task.task_code,
    )


def notify_task_due_soon(task):
    """
    Tell the assigned nurse one of their tasks is due in
    TASK_REMINDER_LEAD_MINUTES.

    No actor — this fires from the scheduled-time check itself (see
    check_due_task_reminders), not from anyone's action, so there's no
    self-skip and no "X did this" phrasing. Same shape as notify_task_due,
    just earlier and worded as a warning rather than "due now".
    """
    recipient = task.assigned_nurse
    if recipient is None:
        return None

    preference = 'critical_alerts' if task.priority == 'high' else 'task_notifications'
    if not wants(recipient, preference):
        return None

    patient = f' for {task.patient_name}' if task.patient_name else ''
    return notify(
        recipient,
        notification_type='critical' if task.priority == 'high' else 'warning',
        event=TASK_DUE_SOON,
        title='High-risk task due soon' if task.priority == 'high' else 'Task due soon',
        message=f'{task.title}{patient} is due in {TASK_REMINDER_LEAD_MINUTES} minutes.',
        patient_label=task.patient_name or '',
        patient=task.patient,
        action_label='Open tasks',
        action_path='/tasks',
        action_highlight_id=task.task_code,
    )


def notify_task_due(task):
    """
    Tell the assigned nurse it's time to do one of their tasks.

    No actor — this fires from the scheduled-time check itself (see
    check_due_task_reminders), not from anyone's action, so there's no
    self-skip and no "X did this" phrasing.
    """
    recipient = task.assigned_nurse
    if recipient is None:
        return None

    preference = 'critical_alerts' if task.priority == 'high' else 'task_notifications'
    if not wants(recipient, preference):
        return None

    patient = f' for {task.patient_name}' if task.patient_name else ''
    return notify(
        recipient,
        notification_type='critical' if task.priority == 'high' else 'warning',
        event=TASK_DUE,
        title='High-risk task due now' if task.priority == 'high' else 'Task due now',
        message=f'{task.title}{patient} is due now.',
        patient_label=task.patient_name or '',
        patient=task.patient,
        action_label='Open tasks',
        action_path='/tasks',
        action_highlight_id=task.task_code,
    )


def notify_task_delay_flagged(task, actor):
    """
    Tell a task's assigned nurse a head nurse flagged it from the Safety
    Alerts panel's "Notify Nurse" button — the task-alert counterpart of
    notify_safety_alert's patient-alert "Notify Nurse" button.

    Only reachable when the task has a real assigned_nurse account (see
    TaskViewSet.notify_nurse) — a name-only legacy assignment (assigned_to
    free text with no FK) has no account to notify, and guessing one by
    name risks notifying the wrong nurse when two accounts share a display
    name (a real, recurring issue in this app's own data). Same self-notify
    guard every other notify_* wrapper uses.
    """
    recipient = task.assigned_nurse
    if recipient is None:
        return None
    if actor is not None and actor.pk == recipient.pk:
        return None

    if not wants(recipient, 'task_notifications'):
        logger.info(
            '[Settings] %s has task_notifications off; delay flag for %s not notified.',
            recipient.username, task.task_code,
        )
        return None

    actor_name = full_name(actor) if actor else 'A head nurse'
    patient = f' for {task.patient_name}' if task.patient_name else ''
    return notify(
        recipient,
        notification_type='warning',
        event=TASK_DELAY_FLAGGED,
        title='Task flagged as delayed',
        message=f'{actor_name} flagged "{task.title}"{patient} as delayed. Please follow up.',
        patient_label=task.patient_name or '',
        patient=task.patient,
        sender=actor,
        action_label='Open tasks',
        action_path='/tasks',
        action_highlight_id=task.task_code,
    )


def _task_scheduled_at(task):
    """
    task.due_date + task.due_time as a real, comparable moment — or None if
    either is missing or due_time doesn't parse.

    due_time is free text (the nurse-facing TimePicker always writes
    "HH:MM" in 24h, but the admin generic record editor's plain text field
    does not enforce that), so a value that doesn't match is treated as "no
    reminder for this task" rather than raised as an error — the same
    fail-open-to-silence philosophy every other best-effort notification
    path in this module already follows.
    """
    if not task.due_date or not task.due_time:
        return None
    try:
        hour, minute = (int(part) for part in task.due_time.strip().split(':', 1))
        naive = datetime.combine(task.due_date, dtime(hour, minute))
    except (ValueError, TypeError):
        return None
    return timezone.make_aware(naive, timezone=ZoneInfo(settings.DUTY_LOCAL_TIMEZONE))


def check_due_task_reminders(user):
    """
    Raises "due soon" (TASK_REMINDER_LEAD_MINUTES ahead) and "due now"
    notifications the first time a poll notices one of this nurse's own
    tasks has reached either moment, and flips status to 'overdue' once
    the due moment has passed without completion.

    Called from LiveStateView on every poll, scoped to the signed-in
    nurse's own tasks — a small, cheap, indexed query — rather than a
    separate scheduler: this app has no background job runner, and the
    live poll already reaches the server every few seconds anyway (see
    this module's own docstring on pull-based delivery).
    reminder_soon_sent_at/reminder_sent_at are what stop each reminder
    firing more than once; both are cleared by TaskSerializer.update()
    whenever the schedule itself changes, which re-arms them.
    """
    now = timezone.now()
    lead = timedelta(minutes=TASK_REMINDER_LEAD_MINUTES)
    candidates = Task.objects.filter(
        assigned_nurse=user, due_date__isnull=False,
    ).exclude(status='completed')
    for task in candidates:
        scheduled = _task_scheduled_at(task)
        if scheduled is None:
            continue
        update_fields = []
        if (
            task.reminder_soon_sent_at is None
            and scheduled - lead <= now < scheduled
        ):
            notify_task_due_soon(task)
            task.reminder_soon_sent_at = now
            update_fields.append('reminder_soon_sent_at')
        if task.reminder_sent_at is None and scheduled <= now:
            notify_task_due(task)
            task.reminder_sent_at = now
            update_fields.append('reminder_sent_at')
        if task.status != 'overdue' and scheduled < now:
            task.status = 'overdue'
            update_fields.append('status')
        if update_fields:
            task.save(update_fields=update_fields)


def notify_referral_almost_due(handover):
    """
    Tell the receiving nurse a pending referral is due in
    REFERRAL_REMINDER_LEAD_MINUTES. Receiver only — they're the one who
    still has to act on it; see notify_referral_overdue for why the
    overdue case also tells the sender.
    """
    recipient = handover.nurse_to_user
    if recipient is None:
        return None
    if not wants(recipient, 'handover_notifications'):
        return None

    patient_count = handover.handover_patients.count()
    patient_label = (
        f'{patient_count} patients' if patient_count > 1
        else (handover.patient_name or 'a patient')
    )
    return notify(
        recipient,
        notification_type='warning',
        event=REFERRAL_ALMOST_DUE,
        title='Referral almost due',
        message=(
            f'The referral for {patient_label} from {handover.nurse_from} is due in '
            f'{REFERRAL_REMINDER_LEAD_MINUTES} minutes.'
        ),
        patient_label=handover.patient_name or '',
        patient=handover.patient,
        handover=handover,
        action_label='Review referral',
        action_path='/handover',
        action_highlight_id=handover.handover_code,
    )


def notify_referral_overdue(handover):
    """
    Tell both nurses once a pending referral's due time has passed: the
    receiver, who still hasn't acted, and the sender, whose patient is
    still waiting on someone. Each is gated by their own notification
    preference independently, so one having referral alerts off never
    silences the other's.
    """
    patient_count = handover.handover_patients.count()
    patient_label = (
        f'{patient_count} patients' if patient_count > 1
        else (handover.patient_name or 'a patient')
    )
    results = []
    receiver = handover.nurse_to_user
    if receiver is not None and wants(receiver, 'handover_notifications'):
        results.append(notify(
            receiver,
            notification_type='critical',
            event=REFERRAL_OVERDUE,
            title='Referral overdue',
            message=f'The referral for {patient_label} from {handover.nurse_from} is now overdue.',
            patient_label=handover.patient_name or '',
            patient=handover.patient,
            handover=handover,
            action_label='Review referral',
            action_path='/handover',
            action_highlight_id=handover.handover_code,
        ))
    sender = handover.created_by
    if (
        sender is not None
        and (receiver is None or sender.pk != receiver.pk)
        and wants(sender, 'handover_notifications')
    ):
        results.append(notify(
            sender,
            notification_type='warning',
            event=REFERRAL_OVERDUE,
            title='Referral overdue',
            message=(
                f'Your referral for {patient_label} to {handover.nurse_to} is now overdue '
                'and still pending.'
            ),
            patient_label=handover.patient_name or '',
            patient=handover.patient,
            handover=handover,
            action_label='View referral',
            action_path='/handover',
            action_highlight_id=handover.handover_code,
        ))
    return results


def check_due_referral_reminders(user):
    """
    Raises "almost due" (receiver only) and "overdue" (receiver + sender)
    referral alerts the first time a poll notices a pending referral
    (sent/received — not yet accepted/declined/cancelled) involving this
    user has reached, or is about to reach, its due_at.

    Scoped to referrals where this user is the receiver or the sender,
    same reasoning and mechanism as check_due_task_reminders — piggybacks
    on the existing live poll. Each alert has its own *_sent_at field on
    HandoverNote (not per-recipient), so whichever of the two nurses' polls
    gets there first raises it for both and the other's poll then sees it
    already set.
    """
    now = timezone.now()
    lead = timedelta(minutes=REFERRAL_REMINDER_LEAD_MINUTES)
    pending = HandoverNote.objects.filter(
        Q(nurse_to_user=user) | Q(created_by=user),
        due_at__isnull=False,
        status__in=['sent', 'received'],
    )
    for handover in pending:
        due_at = handover.due_at
        update_fields = []
        if (
            handover.nurse_to_user_id == user.pk
            and handover.reminder_almost_due_sent_at is None
            and due_at - lead <= now < due_at
        ):
            notify_referral_almost_due(handover)
            handover.reminder_almost_due_sent_at = now
            update_fields.append('reminder_almost_due_sent_at')
        if handover.reminder_overdue_sent_at is None and due_at <= now:
            notify_referral_overdue(handover)
            handover.reminder_overdue_sent_at = now
            update_fields.append('reminder_overdue_sent_at')
        if update_fields:
            handover.save(update_fields=update_fields)


def notify_kardex_reviewed(kardex, reviewer):
    """
    Tell the nurse who saved a kardex what the head nurse decided.

    Silent on approval would leave 'approved' to mean nothing more than 'not
    complained about yet' — and a return/rejection is exactly the case where
    the nurse needs to know *now*, not next time they happen to scroll past
    it, since correcting it means saving a new kardex for the same patient.

    No dedicated kardex preference exists yet — gated on task_notifications,
    the closest existing switch for "something on my work list changed".
    """
    recipient = kardex.saved_by
    if recipient is None or recipient.pk == reviewer.pk:
        return None

    if not wants(recipient, 'task_notifications'):
        return None

    outcomes = {
        'approved': ('success', 'Kardex approved', 'approved your kardex for'),
        'returned': ('warning', 'Kardex returned for correction', 'returned your kardex for correction —'),
        'rejected': ('critical', 'Kardex rejected', 'rejected your kardex for'),
    }
    notification_type, title, verb = outcomes.get(kardex.status, ('info', 'Kardex reviewed', 'reviewed your kardex for'))

    reviewer_name = full_name(reviewer)
    patient_label = kardex.patient_name or 'a patient'
    tail = f' {kardex.review_notes}' if kardex.status in ('returned', 'rejected') and kardex.review_notes else ''

    return notify(
        recipient,
        notification_type=notification_type,
        event=KARDEX_REVIEWED,
        title=title,
        message=f'{reviewer_name} {verb} {patient_label}.{tail}',
        patient_label=kardex.patient_name or '',
        patient=kardex.patient,
        sender=reviewer,
        action_label='Open Kardex',
        action_path='/kardex',
    )


def notify_task_handover_verified(handover):
    """
    Tell the receiving nurse a task has been handed over to them.

    This is deliberately the *only* place a TaskHandover ever reaches the
    receiving nurse's inbox — the whole point of the head-nurse-verification
    gate is that nothing is said to them before a head nurse signs off, so
    this must never be called from the create path, only from the approve
    action once status is already 'verified'.
    """
    recipient = handover.to_nurse
    if recipient is None:
        return None
    if not wants(recipient, 'task_notifications'):
        return None

    sender_name = full_name(handover.from_nurse)
    task_label = handover.task.title if handover.task_id else (handover.task_description or 'a task')
    tail = f' Notes: {handover.notes}' if handover.notes else ''

    return notify(
        recipient,
        notification_type='info',
        event=TASK_HANDOVER_VERIFIED,
        title='Task handed over to you',
        message=f'{sender_name} handed over "{task_label}" to you, verified by a head nurse.{tail}',
        sender=handover.from_nurse,
        action_label='Open tasks',
        action_path='/tasks',
        action_highlight_id=handover.task.task_code if handover.task_id else handover.handover_code,
    )


def notify_task_handover_accepted(handover):
    """
    Tell the sending nurse their handover was verified — the optional second
    notification the spec calls for, so they know the task really is off
    their plate rather than silently disappearing from their queue.
    """
    recipient = handover.from_nurse
    if recipient is None:
        return None
    if not wants(recipient, 'task_notifications'):
        return None

    receiver_name = full_name(handover.to_nurse)
    return notify(
        recipient,
        notification_type='success',
        event=TASK_HANDOVER_ACCEPTED,
        title='Handover verified',
        message=f'Your handover to {receiver_name} was verified by a head nurse and they have been notified.',
        sender=handover.supervisor,
        action_label='Open tasks',
        action_path='/tasks',
        action_highlight_id=handover.task.task_code if handover.task_id else handover.handover_code,
    )


def notify_task_handover_rejected(handover):
    """Tell the sending nurse why their handover was rejected — the task stays theirs."""
    recipient = handover.from_nurse
    if recipient is None:
        return None
    if not wants(recipient, 'task_notifications'):
        return None

    supervisor_name = (
        full_name(handover.supervisor)
        if handover.supervisor else 'A head nurse'
    )
    receiver_name = full_name(handover.to_nurse)
    tail = f' Reason: {handover.rejection_reason}' if handover.rejection_reason else ''

    return notify(
        recipient,
        notification_type='warning',
        event=TASK_HANDOVER_REJECTED,
        title='Handover rejected',
        message=f'{supervisor_name} rejected your handover to {receiver_name}.{tail}',
        sender=handover.supervisor,
        action_label='Open tasks',
        action_path='/tasks',
        action_highlight_id=handover.task.task_code if handover.task_id else handover.handover_code,
    )


def notify_duty_assigned(duty, actor=None):
    """
    Tell a nurse they have been put on a shift — DutyAssignmentViewSet's
    create/update, whenever the duty is still a live, upcoming shift (not a
    past or cancelled one; see the call site). Same self-skip and
    task_notifications gate as notify_nurse_reassigned, the closest existing
    "something about my work assignment changed" notification.
    """
    recipient = duty.nurse
    if recipient is None or (actor is not None and actor.pk == recipient.pk):
        return None

    if not wants(recipient, 'task_notifications'):
        return None

    actor_name = full_name(actor) if actor else 'A head nurse'
    department = duty.department.name if duty.department_id else ''
    where = f', {department}' if department else ''
    # %-d (no leading zero) is a glibc/macOS strftime extension that raises
    # on Windows, so the day number is appended separately instead.
    when = f'{duty.duty_date.strftime("%b")} {duty.duty_date.day}'
    return notify(
        recipient,
        notification_type='info',
        event=DUTY_ASSIGNED,
        title='Duty assigned',
        message=f'{actor_name} put you on {duty.get_shift_display()} shift, {when}{where}.',
        sender=actor,
        # /my-duty, not /duty-roster — the recipient here is always the nurse
        # the shift belongs to, viewing their own schedule, never the head
        # nurse's roster-management screen (which this used to send every
        # recipient to, head nurse or not).
        action_label='Open My Duty',
        action_path='/my-duty',
    )


def notify_nurse_reassigned(profile, actor, *, changed_department, changed_shift):
    """
    Tell a nurse their department or shift was changed by a head nurse.

    Skipped when a head nurse somehow reassigns themselves (not a real
    workflow, but harmless to guard). Gated on task_notifications, same as
    kardex review — the closest existing switch for "something about my
    work assignment changed".
    """
    recipient = profile.user
    if recipient is None or (actor is not None and actor.pk == recipient.pk):
        return None

    if not wants(recipient, 'task_notifications'):
        return None

    parts = []
    if changed_department:
        parts.append(f'department to {profile.department}')
    if changed_shift:
        parts.append(f'shift to {profile.get_shift_display() if profile.shift else "unassigned"}')
    if not parts:
        return None

    actor_name = full_name(actor) if actor else 'A head nurse'
    return notify(
        recipient,
        notification_type='info',
        event=NURSE_REASSIGNED,
        title='Assignment updated',
        message=f'{actor_name} changed your {" and ".join(parts)}.',
        sender=actor,
        action_label='Open Settings',
        action_path='/settings',
    )


def notify_safety_alert(patient, actor, *, message):
    """
    Tell a patient's assigned nurse that a head nurse flagged them for a
    critical safety alert — the "Notify Nurse" button on the Patient
    Safety Alerts panel. `message` is the alert detail already shown on
    the dashboard (e.g. the vitals that triggered it), passed through
    as-is rather than recomputed here.

    Skipped when the patient has nobody assigned, or when a nurse somehow
    notifies themselves about their own patient — same self-notify guard
    every other notify_* wrapper uses. Gated on critical_alerts, the same
    preference an urgent task assignment uses.
    """
    recipient = patient.assigned_nurse
    if recipient is None:
        return None
    if actor is not None and actor.pk == recipient.pk:
        return None

    if not wants(recipient, 'critical_alerts'):
        logger.info(
            '[Settings] %s has critical alerts off; safety alert for %s not notified.',
            recipient.username, patient.patient_code,
        )
        return None

    actor_name = full_name(actor) if actor else 'A head nurse'
    return notify(
        recipient,
        notification_type='critical',
        event=SAFETY_ALERT,
        title='Patient Safety Alert',
        message=f'{actor_name} flagged {patient.name} ({patient.room}): {message}',
        patient_label=patient.name,
        patient=patient,
        sender=actor,
        action_label='View Patient',
        # The recipient here is the patient's assigned nurse (a staff
        # nurse), not the head nurse who raised the alert — '/dashboard?
        # section=alerts' used to send every recipient to the HEAD nurse's
        # own dashboard Alerts section, which doesn't exist on a staff
        # nurse's dashboard (it just landed them on their own dashboard,
        # doing nothing useful). Same destination as notify_patient_assigned:
        # the nurse's own patient list, highlighted on this patient.
        action_path='/my-patients',
        action_highlight_id=patient.patient_code,
    )


def notify_admin_new_registration(new_user):
    """
    Tell every admin (User.is_staff) account the moment a new signup
    finishes — the whole point of the Admin Accounts screen is reviewing
    exactly these, and until this exists nothing ever told an admin one
    was waiting.

    Unconditional, like AdminUserViewSet.approve()/reject() already are —
    this is core admin operational information, not something to gate
    behind a nurse-facing preference switch (an admin account might not
    even have meaningful preferences to check).

    Fans out to every admin rather than one recipient: any of them can act
    on it, and AdminUserViewSet.list() already shows the same pending
    account to all of them.
    """
    profile = getattr(new_user, 'nurse_profile', None)
    # A signup can only *request* head nurse (see SignupSerializer), so the
    # admin is told what was asked for, not what the account is.
    requested = profile.requested_role if profile else ''
    role_label = 'Head Nurse' if requested == 'head_nurse' else 'Staff Nurse'
    name = full_name(new_user)

    admins = User.objects.filter(is_staff=True)
    created = []
    for admin in admins:
        result = notify(
            admin,
            notification_type='warning',
            event=NEW_REGISTRATION_PENDING,
            title='New account pending approval',
            message=f'{name} ({role_label}) just signed up and is waiting for approval.',
            sender=new_user,
            action_label='Review',
            action_path='/admin/accounts',
        )
        if result is not None:
            created.append(result)
    return created
