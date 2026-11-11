"""
Nurse-absence patient reassignment with automatic task transfer.

When a nurse is marked absent, the head nurse reassigns each of their patients
to a replacement nurse. ``reassign_patient_with_tasks`` does the whole thing
atomically: move patient ownership (closing the old PatientAssignment and
opening a new one — the existing idiom from PatientAssignmentSerializer),
transfer only the *unfinished* tasks to the new nurse (completed tasks stay
with the original nurse's history), and notify the receiving nurse with the
absence context and how many pending tasks came with the patient.
"""
from django.contrib.auth import get_user_model
from django.db.models import Count, Q
from django.utils import timezone

from .duty_status import current_duties, duty_fields
from .models import DutyAssignment, Patient, PatientAssignment, Task
from .names import full_name
from .notifications import notify
from .referral_shifts import SHIFT_LABELS

User = get_user_model()

# Unfinished = still the responsibility of whoever holds the patient. Completed
# tasks are history and never move (they stay under the nurse who did them).
UNFINISHED_TASK_STATUSES = ('pending', 'in_progress', 'overdue')

PATIENT_REASSIGNED = 'patient_reassigned'


def eligible_replacement_nurses(absent_user, *, department_id=None, shift=None, search=''):
    """
    Nurses who may receive the absent nurse's patients.

    A nurse is eligible when they are an approved, active staff member, are not
    the absent nurse, and are not themselves marked absent on their current
    duty. Each entry carries the nurse's current shift/department (from the
    duty roster, via current_duties) and their present patient workload so the
    head nurse can spread the load. Optional ``department_id``/``shift``/
    ``search`` narrow the list.
    """
    nurses = list(
        User.objects.filter(
            nurse_profile__approval_status='approved',
            nurse_profile__is_active_staff=True,
        )
        .exclude(pk=getattr(absent_user, 'pk', None))
        .select_related('nurse_profile')
        .order_by('first_name', 'last_name')
    )
    if search:
        s = search.strip().lower()
        nurses = [n for n in nurses if s in full_name(n).lower()]

    duties = current_duties([n.pk for n in nurses])
    # Patient workload per nurse in one query.
    load = dict(
        Patient.objects.filter(assigned_nurse__in=nurses)
        .values_list('assigned_nurse')
        .annotate(n=Count('id'))
        .values_list('assigned_nurse', 'n')
    )

    out = []
    for nurse in nurses:
        duty = duties.get(nurse.pk)
        # Skip a nurse whose own current duty is marked absent — they are
        # unavailable and must never receive a reassignment.
        if duty is not None and duty.status == 'absent':
            continue
        duty_shift, department = duty_fields(getattr(nurse, 'nurse_profile', None), duty)
        if shift and duty_shift != shift:
            continue
        if department_id and (duty is None or str(duty.department_id) != str(department_id)):
            continue
        out.append({
            'id': str(nurse.pk),
            'fullName': full_name(nurse),
            'shift': duty_shift,
            'shiftLabel': SHIFT_LABELS.get(duty_shift, duty_shift) if duty_shift else 'Off duty',
            'department': {
                'id': duty.department_id if duty else None,
                'name': department,
            },
            'patientCount': load.get(nurse.pk, 0),
            'onDuty': duty is not None,
        })
    return out


def reassign_patient_with_tasks(patient, new_nurse, actor, *, reason='', absent_nurse=None):
    """
    Reassign ``patient`` to ``new_nurse`` and transfer their unfinished tasks.

    Returns ``(assignment, transferred_count)``. Must be called inside a
    transaction by the caller (the view wraps the whole batch in one).
    """
    previous_nurse = patient.assigned_nurse

    # Close the current active assignment and open a new one — same close/create
    # idiom PatientAssignmentSerializer.create uses, so the assignment history
    # is preserved (the old row stays as 'reassigned', never deleted).
    PatientAssignment.objects.filter(patient=patient, status='active').update(
        status='reassigned', ended_at=timezone.now(), end_reason='REASSIGNED',
    )
    assignment = PatientAssignment.objects.create(
        patient=patient,
        assigned_nurse=new_nurse,
        assigned_nurse_name=full_name(new_nurse),
        ward=patient.department.name if patient.department_id else '',
        priority='routine',
        status='active',
        assigned_by=actor,
        notes=f'Reassigned from {full_name(previous_nurse)} (absent).' if previous_nurse else '',
    )
    patient.assigned_nurse = new_nurse
    patient.save(update_fields=['assigned_nurse'])

    # Transfer only the unfinished tasks; completed tasks are left untouched so
    # they remain in the original nurse's records.
    transferred = Task.objects.filter(
        patient=patient, status__in=UNFINISHED_TASK_STATUSES,
    ).update(assigned_nurse=new_nurse, assigned_to=full_name(new_nurse))

    _notify_receiving_nurse(assignment, new_nurse, actor, reason, transferred, absent_nurse, previous_nurse)
    return assignment, transferred


def _notify_receiving_nurse(assignment, new_nurse, actor, reason, transferred, absent_nurse, previous_nurse):
    if new_nurse is None or (actor is not None and new_nurse.pk == getattr(actor, 'pk', None)):
        return
    patient = assignment.patient
    absent_name = full_name(absent_nurse) if absent_nurse else (full_name(previous_nurse) if previous_nurse else 'the previous nurse')
    reason_tail = f' Reason: {reason}.' if reason else ''
    task_tail = (
        f' You are now responsible for {transferred} pending task{"s" if transferred != 1 else ""}.'
        if transferred else ' This patient has no pending tasks.'
    )
    notify(
        new_nurse,
        notification_type='warning',
        event=PATIENT_REASSIGNED,
        title=f'Patient reassigned to you — {patient.name}',
        message=(
            f'{patient.name} (Room {patient.room}) has been reassigned to you because '
            f'{absent_name} is marked absent.{reason_tail}{task_tail}'
        ),
        patient_label=patient.name,
        patient=patient,
        sender=actor,
        action_label='View patient',
        action_path='/my-patients',
    )
