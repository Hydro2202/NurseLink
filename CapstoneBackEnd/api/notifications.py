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

from django.conf import settings
from django.contrib.auth.models import User
from django.core.mail import send_mail

from .models import Notification
from .realtime import push_notification

logger = logging.getLogger(__name__)

# Event names. Only HANDOVER_RECEIVED is raised as a popup: it is the one
# that makes a nurse responsible for a patient they have not seen yet.
HANDOVER_RECEIVED = 'handover_received'
HANDOVER_ACKNOWLEDGED = 'handover_acknowledged'
TASK_ASSIGNED = 'task_assigned'
KARDEX_REVIEWED = 'kardex_reviewed'
NURSE_REASSIGNED = 'nurse_reassigned'
TASK_HANDOVER_VERIFIED = 'task_handover_verified'
TASK_HANDOVER_ACCEPTED = 'task_handover_accepted'
TASK_HANDOVER_REJECTED = 'task_handover_rejected'



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

    Uses the project's existing Django mail configuration — the same one Email
    OTP goes through — rather than a second mail path. Nothing new is
    configured: if EMAIL_* is unset the console backend prints it, exactly as it
    does for OTP.

    Best effort and last: the notification is already saved and already pushed
    to the nurse's socket by the time this runs, so a mail server that is slow
    or down costs an email, never the notification.

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
    try:
        send_mail(
            'NurseLink: %s' % notification.title,
            body,
            settings.DEFAULT_FROM_EMAIL,
            [address],
            fail_silently=True,
        )
    except Exception:
        logger.exception('Could not email notification %s to %s', notification.pk, address)


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
    for user in User.objects.all():
        candidates = {
            ' '.join(user.get_full_name().lower().split()),
            user.username.lower().strip(),
            (user.email or '').lower().strip(),
        }
        candidates.discard('')
        if key in candidates:
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

    # And by email, if that is how this nurse wants to be reached as well.
    if wants(recipient, 'email_notifications'):
        _email_notification(notification)

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
    return notify(
        recipient,
        notification_type='warning',
        event=HANDOVER_RECEIVED,
        title='Patient Handover',
        message=(
            f'Patient {patient_name or "a patient"} has been handed over to you '
            f'by {handover.nurse_from}.'
        ),
        patient_label=patient_name,
        patient=handover.patient,
        handover=handover,
        sender=handover.created_by,
        action_label='Review handover',
        action_path='/handover',
        action_highlight_id=handover.handover_code,
    )


def notify_handover_acknowledged(handover, nurse, adopted_tasks):
    """
    Tell the outgoing nurse their handover landed.

    They are the one person who needs to know the patient is now somebody
    else's responsibility, and how much of their unfinished work was picked up.
    Skipped when a nurse acknowledges their own handover, which is just noise.
    """
    recipient = handover.created_by
    if recipient is None or recipient.pk == nurse.pk:
        return None

    if not wants(recipient, 'handover_notifications'):
        return None

    nurse_name = nurse.get_full_name().strip() or nurse.username
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
        event=HANDOVER_ACKNOWLEDGED,
        title='Handover acknowledged',
        message=(
            f'{nurse_name} acknowledged your handover for '
            f'{handover.patient_name or "a patient"}.{tail}'
        ),
        patient_label=handover.patient_name or '',
        patient=handover.patient,
        handover=handover,
        sender=nurse,
        action_label='View handover',
        action_path='/handover',
        action_highlight_id=handover.handover_code,
    )


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
    preference = 'critical_alerts' if task.priority == 'urgent' else 'task_notifications'
    if not wants(recipient, preference):
        logger.info(
            '[Settings] %s has %s off; task %s not notified.',
            recipient.username, preference, task.task_code,
        )
        return None

    who = ''
    if actor is not None:
        who = f'{actor.get_full_name().strip() or actor.username} assigned you '
    patient = f' for {task.patient_name}' if task.patient_name else ''

    return notify(
        recipient,
        notification_type='critical' if task.priority == 'urgent' else 'info',
        event=TASK_ASSIGNED,
        title='Urgent task assigned' if task.priority == 'urgent' else 'New task assigned',
        message=f'{who or "New task: "}{task.title}{patient}.',
        patient_label=task.patient_name or '',
        patient=task.patient,
        sender=actor,
        action_label='Open tasks',
        action_path='/tasks',
        action_highlight_id=task.task_code,
    )


def notify_kardex_reviewed(kardex, reviewer):
    """
    Tell the nurse who saved a kardex what the supervisor decided.

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

    reviewer_name = reviewer.get_full_name().strip() or reviewer.username
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
    receiving nurse's inbox — the whole point of the supervisor-verification
    gate is that nothing is said to them before a supervisor signs off, so
    this must never be called from the create path, only from the approve
    action once status is already 'verified'.
    """
    recipient = handover.to_nurse
    if recipient is None:
        return None
    if not wants(recipient, 'task_notifications'):
        return None

    sender_name = handover.from_nurse.get_full_name().strip() or handover.from_nurse.username
    task_label = handover.task.title if handover.task_id else (handover.task_description or 'a task')
    tail = f' Notes: {handover.notes}' if handover.notes else ''

    return notify(
        recipient,
        notification_type='info',
        event=TASK_HANDOVER_VERIFIED,
        title='Task handed over to you',
        message=f'{sender_name} handed over "{task_label}" to you, verified by a supervisor.{tail}',
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

    receiver_name = handover.to_nurse.get_full_name().strip() or handover.to_nurse.username
    return notify(
        recipient,
        notification_type='success',
        event=TASK_HANDOVER_ACCEPTED,
        title='Handover verified',
        message=f'Your handover to {receiver_name} was verified by a supervisor and they have been notified.',
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
        handover.supervisor.get_full_name().strip() or handover.supervisor.username
        if handover.supervisor else 'A supervisor'
    )
    receiver_name = handover.to_nurse.get_full_name().strip() or handover.to_nurse.username
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


def notify_nurse_reassigned(profile, actor, *, changed_department, changed_shift):
    """
    Tell a nurse their department or shift was changed by a supervisor.

    Skipped when a supervisor somehow reassigns themselves (not a real
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
        parts.append(f'shift to {profile.shift}')
    if not parts:
        return None

    actor_name = actor.get_full_name().strip() or actor.username if actor else 'A supervisor'
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
