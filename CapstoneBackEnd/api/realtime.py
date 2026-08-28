"""
Pushing a notification to one nurse's open socket.

The database stays the source of truth: a Notification row is written first, and
this is only the delivery on top of it. If the push fails — nobody connected,
channel layer misconfigured, process restarted — the row is still there and the
nurse sees it on their next poll or sign-in. Nothing here is allowed to break
the transaction that created it.
"""

import logging

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.db import transaction

from .consumers import user_group

logger = logging.getLogger(__name__)


def push_notification(notification):
    """
    Send one saved Notification to its recipient, after the commit lands.

    Deferred with on_commit so the client can never be told about a row that a
    later rollback removes — and so the notification it then fetches is
    guaranteed to be readable.
    """
    if notification is None:
        return

    payload = _payload(notification)
    recipient_id = notification.recipient_id

    def _send():
        _send_to_user(recipient_id, payload)

    # Outside an atomic block on_commit runs immediately, which is correct too.
    transaction.on_commit(_send)


def _payload(notification):
    sender = notification.sender
    patient = notification.patient
    return {
        'type': 'notification',
        'event': notification.event or '',
        'id': str(notification.pk),
        'title': notification.title,
        'message': notification.message,
        'patientId': patient.patient_code if patient else None,
        'patientName': notification.patient_label or (patient.name if patient else None),
        'handoverId': (
            notification.handover.handover_code if notification.handover_id else None
        ),
        'senderName': (
            (sender.get_full_name().strip() or sender.username) if sender else None
        ),
        'createdAt': notification.created_at.isoformat(),
    }


def _send_to_user(user_id, payload):
    layer = get_channel_layer()
    if layer is None:
        logger.warning('[Realtime] No channel layer; notification stays in the database only.')
        return

    group = user_group(user_id)
    try:
        logger.info('[Realtime] Sending %s to %s', payload.get('event') or 'notification', group)
        async_to_sync(layer.group_send)(group, {'type': 'notify', 'payload': payload})
        logger.info('[Realtime] Event sent to %s', group)
    except Exception:
        # Delivery is best-effort by design; the row in the database is not.
        logger.exception('[Realtime] Push failed for %s; database row is unaffected.', group)
