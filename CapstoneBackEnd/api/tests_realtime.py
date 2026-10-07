"""
The notification WebSocket.

What has to hold: a socket belongs to exactly one authenticated nurse, an
unauthenticated one is refused before it can join anything, a handover reaches
the receiving nurse's socket and nobody else's, and a push that cannot be
delivered never costs the database row behind it.
"""

import datetime
from zoneinfo import ZoneInfo

from channels.db import database_sync_to_async
from channels.layers import get_channel_layer
from channels.testing import WebsocketCommunicator
from django.conf import settings
from django.contrib.auth.models import User
from django.test import TransactionTestCase
from django.utils import timezone
from .auth_sessions import issue_session

from CapstoneBackEnd.asgi import application

from .models import Department, DutyAssignment, HandoverNote, Notification, NurseProfile, Patient
from .notifications import notify_handover_created


@database_sync_to_async
def make_nurse(email, first, last):
    user = User.objects.create_user(
        username=email, email=email, password='pw-test-1234',
        first_name=first, last_name=last,
    )
    NurseProfile.objects.create(user=user, role='staff_nurse')
    return user, issue_session(user).key


@database_sync_to_async
def make_patient():
    return Patient.objects.create(
        patient_code='P800', name='Lawrence Cruz', age=54, gender='Male',
        room='210-A', diagnosis='Pneumonia',
        admission_date=datetime.date(2026, 3, 1),
    )


@database_sync_to_async
def make_handover(patient, sender, receiver):
    return HandoverNote.objects.create(
        handover_code='H800', patient=patient, patient_name=patient.name,
        shift='morning', date=datetime.date(2026, 3, 3),
        nurse_from=sender.get_full_name(), nurse_to=receiver.get_full_name(),
        nurse_to_user=receiver, created_by=sender, status='pending',
    )


@database_sync_to_async
def give_shift_pair(sender, receiver):
    """Duty Roster coverage for the shift-rotation rule (see
    api/referral_shifts.py): sender on Morning (a wide window, so it
    covers "now" regardless of the real wall clock), receiver on
    Afternoon (the next shift) — same department."""
    dept = Department.objects.get_or_create(name='Realtime Test Ward')[0]
    today = timezone.now().astimezone(ZoneInfo(settings.DUTY_LOCAL_TIMEZONE)).date()
    DutyAssignment.objects.create(
        nurse=sender, department=dept, duty_date=today, shift='morning',
        start_time=datetime.time(0, 0), end_time=datetime.time(23, 59, 59),
    )
    DutyAssignment.objects.create(
        nurse=receiver, department=dept, duty_date=today, shift='afternoon',
        start_time=DutyAssignment.SHIFT_DEFAULT_TIMES['afternoon'][0],
        end_time=DutyAssignment.SHIFT_DEFAULT_TIMES['afternoon'][1],
    )


@database_sync_to_async
def send_handover_notification(handover):
    return notify_handover_created(handover)


@database_sync_to_async
def notification_count():
    return Notification.objects.count()


@database_sync_to_async
def post_handover(sender_token, patient, receiver, nurse_to_id=None):
    """POST /api/handovers/ exactly as the app does, token auth and all."""
    from rest_framework.test import APIClient

    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION='Bearer %s' % sender_token)
    return client.post(
        '/api/handovers/',
        {
            'patientId': patient.patient_code,
            'patientName': patient.name,
            'shift': 'morning',
            'date': '2026-03-03',
            'nurseFrom': 'Maria Santos',
            'nurseTo': receiver.get_full_name(),
            'nurseToId': nurse_to_id or str(receiver.pk),
            'sbar': {'situation': 's', 'background': 'b', 'assessment': 'a',
                     'recommendation': 'Monitor closely.'},
            'unfinishedTasks': [],
        },
        format='json',
    )


async def connect(token=None):
    url = '/ws/notifications/'
    if token:
        url += '?token=%s' % token
    communicator = WebsocketCommunicator(application, url)
    connected, _ = await communicator.connect()
    return communicator, connected


class NotificationSocketTests(TransactionTestCase):
    """TransactionTestCase: on_commit hooks only fire on a real commit."""

    async def test_a_valid_token_connects_and_is_told_whose_socket_it_is(self):
        user, token = await make_nurse('ben@hospital.com', 'Ben', 'Diaz')

        communicator, connected = await connect(token)
        self.assertTrue(connected)

        hello = await communicator.receive_json_from(timeout=2)
        self.assertEqual(hello['type'], 'connected')
        self.assertEqual(hello['userId'], str(user.pk))

        await communicator.disconnect()

    async def test_a_socket_with_no_token_is_refused(self):
        communicator, connected = await connect()
        self.assertFalse(connected, 'anonymous sockets must never be accepted')
        await communicator.disconnect()

    async def test_a_socket_with_a_bogus_token_is_refused(self):
        communicator, connected = await connect('not-a-real-token')
        self.assertFalse(connected)
        await communicator.disconnect()

    async def test_a_handover_reaches_the_receiving_nurses_socket(self):
        sender, _ = await make_nurse('maria@hospital.com', 'Maria', 'Santos')
        receiver, receiver_token = await make_nurse('ben@hospital.com', 'Ben', 'Diaz')
        patient = await make_patient()
        handover = await make_handover(patient, sender, receiver)

        communicator, connected = await connect(receiver_token)
        self.assertTrue(connected)
        await communicator.receive_json_from(timeout=2)  # the connected frame

        await send_handover_notification(handover)

        event = await communicator.receive_json_from(timeout=3)
        self.assertEqual(event['type'], 'notification')
        self.assertEqual(event['event'], 'handover_received')
        self.assertEqual(event['patientName'], 'Lawrence Cruz')
        self.assertEqual(event['patientId'], 'P800')
        self.assertEqual(event['senderName'], 'Maria Santos')
        self.assertEqual(event['handoverId'], 'H800')
        self.assertIn('Lawrence Cruz', event['message'])
        # An id, so the client can recognise one it has already shown.
        self.assertTrue(event['id'])

        await communicator.disconnect()

    async def test_the_event_does_not_reach_any_other_nurse(self):
        sender, _ = await make_nurse('maria@hospital.com', 'Maria', 'Santos')
        receiver, _ = await make_nurse('ben@hospital.com', 'Ben', 'Diaz')
        bystander, bystander_token = await make_nurse('cora@hospital.com', 'Cora', 'Reyes')
        patient = await make_patient()
        handover = await make_handover(patient, sender, receiver)

        communicator, connected = await connect(bystander_token)
        self.assertTrue(connected)
        await communicator.receive_json_from(timeout=2)

        await send_handover_notification(handover)

        # Patient information must not be broadcast to the ward.
        self.assertTrue(await communicator.receive_nothing(timeout=1))
        await communicator.disconnect()

    async def test_the_notification_survives_when_nobody_is_listening(self):
        sender, _ = await make_nurse('maria@hospital.com', 'Maria', 'Santos')
        receiver, _ = await make_nurse('ben@hospital.com', 'Ben', 'Diaz')
        patient = await make_patient()
        handover = await make_handover(patient, sender, receiver)

        # Nobody connected: the push has nowhere to go and must not raise.
        await send_handover_notification(handover)

        self.assertEqual(await notification_count(), 1)

    async def test_one_handover_pushes_one_event(self):
        sender, _ = await make_nurse('maria@hospital.com', 'Maria', 'Santos')
        receiver, receiver_token = await make_nurse('ben@hospital.com', 'Ben', 'Diaz')
        patient = await make_patient()
        handover = await make_handover(patient, sender, receiver)

        communicator, _ = await connect(receiver_token)
        await communicator.receive_json_from(timeout=2)

        # Called twice: the second is a no-op, so no second event is pushed.
        await send_handover_notification(handover)
        await communicator.receive_json_from(timeout=3)
        await send_handover_notification(handover)

        self.assertTrue(
            await communicator.receive_nothing(timeout=1),
            'one handover must not produce two popups',
        )
        await communicator.disconnect()

    async def test_a_ping_is_answered_so_idle_sockets_stay_open(self):
        _, token = await make_nurse('ben@hospital.com', 'Ben', 'Diaz')
        communicator, _ = await connect(token)
        await communicator.receive_json_from(timeout=2)

        await communicator.send_json_to({'type': 'ping'})
        self.assertEqual((await communicator.receive_json_from(timeout=2))['type'], 'pong')

        await communicator.disconnect()

    async def test_two_nurses_get_their_own_sockets(self):
        one, one_token = await make_nurse('one@hospital.com', 'One', 'Nurse')
        two, two_token = await make_nurse('two@hospital.com', 'Two', 'Nurse')

        a, _ = await connect(one_token)
        b, _ = await connect(two_token)
        self.assertEqual((await a.receive_json_from(timeout=2))['userId'], str(one.pk))
        self.assertEqual((await b.receive_json_from(timeout=2))['userId'], str(two.pk))

        layer = get_channel_layer()
        await layer.group_send(
            'nurse_%s' % one.pk, {'type': 'notify', 'payload': {'type': 'test', 'id': 'x'}}
        )

        self.assertEqual((await a.receive_json_from(timeout=2))['type'], 'test')
        self.assertTrue(await b.receive_nothing(timeout=1))

        await a.disconnect()
        await b.disconnect()


class HandoverApiPushTests(TransactionTestCase):
    """
    The whole pipeline: the real POST a nurse's app makes, through to the frame
    arriving on the receiving nurse's socket. Nothing here calls the notifier
    directly — if the API stops pushing, this fails.
    """

    async def test_posting_a_handover_pushes_to_the_receiving_nurses_socket(self):
        sender, sender_token = await make_nurse('maria@hospital.com', 'Maria', 'Santos')
        receiver, receiver_token = await make_nurse('ben@hospital.com', 'Ben', 'Diaz')
        await give_shift_pair(sender, receiver)
        patient = await make_patient()

        communicator, connected = await connect(receiver_token)
        self.assertTrue(connected)
        await communicator.receive_json_from(timeout=2)

        created = await post_handover(sender_token, patient, receiver)
        self.assertEqual(created.status_code, 201, created.content)

        event = await communicator.receive_json_from(timeout=5)
        self.assertEqual(event['event'], 'handover_received')
        self.assertEqual(event['patientName'], 'Lawrence Cruz')
        self.assertEqual(event['senderName'], 'Maria Santos')
        self.assertEqual(event['handoverId'], created.json()['id'])

        await communicator.disconnect()

    async def test_a_rejected_handover_pushes_nothing(self):
        sender, sender_token = await make_nurse('maria@hospital.com', 'Maria', 'Santos')
        receiver, receiver_token = await make_nurse('ben@hospital.com', 'Ben', 'Diaz')
        patient = await make_patient()

        communicator, _ = await connect(receiver_token)
        await communicator.receive_json_from(timeout=2)

        rejected = await post_handover(sender_token, patient, receiver, nurse_to_id='999999')
        self.assertEqual(rejected.status_code, 400)

        # No handover saved means no popup: the database is the source of truth.
        self.assertTrue(await communicator.receive_nothing(timeout=1))
        await communicator.disconnect()
