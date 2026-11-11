"""
The one place that records a change to a patient's record.

``record_patient_update`` writes a structured PatientUpdate row per changed
field (the audit trail behind the patient Activity History) and then fans out
the change notification. Every path that changes tracked patient data — the
patient form (PatientSerializer.update), discharge/readmit, and Kardex
medications — calls this, so the logging and notifications are never
duplicated.

A "change" is a dict ``{'label': 'Room', 'from': '204', 'to': '310'}`` (an
optional ``'field'`` machine name is accepted too).
"""
import logging

from django.utils import timezone

from .models import PatientUpdate

logger = logging.getLogger(__name__)


def _actor_name(user):
    if not (user and getattr(user, 'is_authenticated', False)):
        return ''
    # Lazy import: serializers imports this module, so importing it at module
    # load would be circular.
    from .serializers import nurse_display_name

    return nurse_display_name(user)


def record_patient_update(patient, user, changes, source='patient_form', *, notify=True):
    """
    Write one PatientUpdate row per change and (unless notify=False) notify the
    assigned nurse and the ward's head nurses. Returns the created rows.

    Never raises on a logging/notification failure — it is called in the middle
    of real work (saving a patient, a Kardex order) that must not be lost.
    """
    cleaned = [c for c in (changes or []) if (c.get('label') or c.get('field'))]
    if not cleaned:
        return []

    now = timezone.now()
    actor = user if (user and getattr(user, 'is_authenticated', False)) else None
    actor_name = _actor_name(user)
    rows = [
        PatientUpdate(
            patient=patient,
            field_name=(c.get('label') or c.get('field') or ''),
            old_value=str(c.get('from') or ''),
            new_value=str(c.get('to') or ''),
            changed_by=actor,
            changed_by_name=actor_name,
            changed_at=now,
            source=source,
        )
        for c in cleaned
    ]
    try:
        PatientUpdate.objects.bulk_create(rows)
    except Exception:
        logger.exception('Failed to record patient updates for patient=%s', getattr(patient, 'pk', '?'))
        return []

    # If this patient was loaded with the updates prefetched (list/detail view),
    # that cached list predates these new rows — refresh it so the response
    # that serializes right after an edit includes the change just made.
    if hasattr(patient, 'prefetched_updates'):
        patient.prefetched_updates = list(
            PatientUpdate.objects.filter(patient=patient).select_related('changed_by').order_by('-changed_at', '-id')[:200]
        )

    if notify:
        try:
            from .notifications import notify_patient_change

            notify_patient_change(patient, actor, cleaned)
        except Exception:
            logger.exception('Failed to send patient-change notification for patient=%s', getattr(patient, 'pk', '?'))

    return rows
