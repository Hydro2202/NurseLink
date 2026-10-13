"""
Turning handovers into real work.

A handover describes something that still needs doing. Left as text on a card it
appears on nobody's task list, so work agreed at the bedside quietly falls off
the end of a shift. This module gives that text an owner at every point in the
handover's life:

  * When the handover is written, its work becomes tasks belonging to the
    *sending* nurse. Until someone accepts the handover the patient is still
    theirs, so they are the one who has to do the job — or mark it done.
  * When the handover is acknowledged, those same tasks move to the receiving
    nurse. Moved, not copied: the ward must never end up with two rows for one
    job, and whatever progress was made survives the transfer.

Entries in a handover's unfinished-task list arrive in two shapes, because both
are legitimate. A task code ("T012") is existing work simply changing hands.
Free text ("Recheck IV site at 14:00") is something noted during the handover
that was never a task, and becomes one.
"""

import logging
import re

from .models import Task
from .names import full_name
from .utils import next_code

logger = logging.getLogger(__name__)

# Blank line between blocks of the copied SBAR, so a task card stays readable.
BLOCK_SEPARATOR = '\n\n'

# Task codes look like T001 / T-2075 — a letter, an optional dash, then digits.
_TASK_CODE = re.compile(r'^[A-Za-z]-?\d+$')

# Only work that is still outstanding is worth moving. A handover that mentions
# an already-finished task should not resurrect it on the next nurse's list.
OPEN_STATUSES = ('pending', 'in_progress')


def looks_like_task_code(entry: str) -> bool:
    return bool(_TASK_CODE.match((entry or '').strip()))


def _entries(handover):
    items = [str(entry).strip() for entry in (handover.unfinished_tasks or [])]
    return [entry for entry in items if entry]


def _display_name(user):
    return full_name(user)


def create_handover_tasks(handover):
    """
    Put a newly written handover's work on the sending nurse's list.

    Returns the Tasks created. Does nothing without a known sender — there would
    be nobody to hold the work — and skips entries that already name an existing
    task, since that task has an owner already.
    """
    sender = handover.created_by
    if sender is None:
        return []

    sender_name = _display_name(sender)
    entries = _entries(handover)

    # Nothing itemised: the handover itself is the work. This is the common
    # case, because the SBAR recommendation is where this ward actually writes
    # what needs doing ("pending tasks, follow-ups, special care").
    if not entries:
        return [_create_summary_task(handover, sender, sender_name)]

    created = []
    for entry in entries:
        if looks_like_task_code(entry) and Task.objects.filter(task_code__iexact=entry).exists():
            # Already a real task with an owner; it changes hands on acknowledge.
            continue
        created.append(_create_from_text(entry, handover, sender, sender_name))
    return created


def adopt_handover_tasks(handover, nurse):
    """
    Move a handover's work onto `nurse`'s task list.

    Returns the Tasks now assigned to them. Callers run this inside the
    acknowledge transaction, so a failure rolls the acknowledgement back rather
    than leaving work half-transferred.
    """
    nurse_name = _display_name(nurse)
    adopted = []
    seen = set()

    # Tasks created when the handover was written. This is the normal path: the
    # work already exists on the sender's list and simply changes hands, which
    # is why acknowledging never duplicates anything.
    for task in handover.tasks.all().order_by('task_code'):
        moved = _reassign(task, nurse, nurse_name)
        if moved.pk not in seen:
            adopted.append(moved)
            seen.add(moved.pk)

    linked_existing = bool(adopted)

    for entry in _entries(handover):
        if looks_like_task_code(entry):
            # Work that existed independently of this handover — reassign it
            # wherever it lives, even when the handover also had its own tasks.
            task = Task.objects.filter(task_code__iexact=entry).first()
            if task is None or task.pk in seen:
                continue
            adopted.append(_reassign(task, nurse, nurse_name))
            seen.add(task.pk)
        elif not linked_existing:
            # Free text with nothing linked: a handover written before tasks
            # were created up front, or one recorded outside the API. Materialise
            # it now so the note still becomes work instead of being dropped.
            created = _create_from_text(entry, handover, nurse, nurse_name)
            adopted.append(created)
            seen.add(created.pk)

    # Nothing linked and nothing itemised. Accepting a handover must always
    # leave the nurse with something to act on, so the handover becomes the task.
    if not adopted:
        adopted.append(_create_summary_task(handover, nurse, nurse_name))

    return adopted


def _reassign(task, nurse, nurse_name):
    """Hand one task over, leaving finished work with whoever completed it."""
    if task.status not in OPEN_STATUSES:
        logger.info('Handover task %s is %s; not reassigning.', task.task_code, task.status)
        return task

    task.assigned_nurse = nurse
    task.assigned_to = nurse_name
    task.save(update_fields=['assigned_nurse', 'assigned_to', 'updated_at'])
    return task


def _summarize(text, fallback):
    """First sentence or line of the recommendation, short enough for a card."""
    text = ' '.join((text or '').split())
    if not text:
        return fallback
    for stop in ('. ', '; '):
        head = text.split(stop)[0].strip()
        if head and head != text:
            text = head
            break
    # A task title is a label, not prose — drop the sentence-ending full stop
    # that a recommendation naturally carries.
    text = text.rstrip('.').strip() or fallback
    return text if len(text) <= 120 else text[:117].rstrip() + '...'


def _base_fields(handover, nurse, nurse_name):
    patient = handover.patient
    return {
        'task_code': next_code(Task, 'task_code', 'T'),
        'patient': patient,
        'patient_name': handover.patient_name or (patient.name if patient else ''),
        'patient_room': patient.room if patient else '',
        'attending_physician': patient.attending_physician if patient else '',
        # Handover work is the next thing a nurse picks up, not background
        # filler, so it lands above routine tasks without crying urgent.
        'priority': 'high',
        'category': 'care',
        'status': 'pending',
        'assigned_to': nurse_name,
        'assigned_nurse': nurse,
        'source_handover': handover,
    }


def _provenance(handover):
    return 'From handover %s (%s shift, %s) by %s.' % (
        handover.handover_code, handover.shift, handover.date, handover.nurse_from
    )


def _create_summary_task(handover, nurse, nurse_name):
    """One task standing for the whole handover."""
    patient_label = handover.patient_name or (
        handover.patient.name if handover.patient else 'patient'
    )
    title = _summarize(handover.recommendation, 'Follow up handover for %s' % patient_label)

    body = [_provenance(handover)]
    for label, value in (
        ('Situation', handover.situation),
        ('Background', handover.background),
        ('Assessment', handover.assessment),
        ('Recommendation', handover.recommendation),
    ):
        if (value or '').strip():
            body.append('%s: %s' % (label, value.strip()))

    return Task.objects.create(
        title=title,
        description=BLOCK_SEPARATOR.join(body),
        **_base_fields(handover, nurse, nurse_name),
    )


def _create_from_text(entry, handover, nurse, nurse_name):
    """Create a task for one line of handover text."""
    # The card shows the title on one line, so keep it short and let the full
    # note live in the description where there is room for it.
    title = entry if len(entry) <= 120 else entry[:117].rstrip() + '...'
    body = [_provenance(handover)]
    if title != entry:
        body.append(entry)

    return Task.objects.create(
        title=title,
        description=BLOCK_SEPARATOR.join(body),
        **_base_fields(handover, nurse, nurse_name),
    )
