"""
The channel layer itself — separate from tests_realtime.py, which already
proves the full handover-to-socket pipeline.

These tests cover the two things this task changed: that the test suite
really does get the in-memory layer (so it needs no Redis), and that
push_notification's sync-to-async send still reaches a connected socket
through whichever layer settings.CHANNEL_LAYERS names. Swapping in
RedisChannelLayer for production changes only CONFIG; the send/receive path
exercised here is exactly what production runs too.
"""

from channels.db import database_sync_to_async
from channels.testing import WebsocketCommunicator
from django.conf import settings
from django.contrib.auth.models import User
from django.test import TransactionTestCase

from CapstoneBackEnd.asgi import application

from .auth_sessions import issue_session
from .models import NurseProfile, Notification
from .realtime import push_notification


@database_sync_to_async
def make_nurse(email):
    user = User.objects.create_user(username=email, email=email, password='pw-test-1234',
                                    first_name='Test', last_name='Nurse')
    NurseProfile.objects.create(user=user, role='staff_nurse')
    return user, issue_session(user).key


@database_sync_to_async
def make_and_push_notification(recipient):
    """The real production call: create the row, then push_notification() on it —
    not layer.group_send() directly, so this exercises async_to_sync too."""
    notification = Notification.objects.create(
        recipient=recipient, event='test_event', title='Test', message='Hello from the channel layer.',
    )
    push_notification(notification)
    return notification


class ChannelLayerConfigTests(TransactionTestCase):
    def test_the_test_suite_uses_the_in_memory_layer(self):
        # Forced by settings.py whenever 'test' is in sys.argv, specifically so
        # `manage.py test` needs no Redis — see CHANNEL_LAYER_MEMORY there.
        self.assertEqual(
            settings.CHANNEL_LAYERS['default']['BACKEND'], 'channels.layers.InMemoryChannelLayer',
        )


class PushNotificationReachesSocketTests(TransactionTestCase):
    async def test_a_pushed_notification_reaches_the_connected_socket(self):
        nurse, token = await make_nurse('channel-layer@hospital.com')
        communicator = WebsocketCommunicator(application, '/ws/notifications/?token=%s' % token)
        connected, _ = await communicator.connect()
        self.assertTrue(connected)
        await communicator.receive_json_from(timeout=2)  # the 'connected' frame

        notification = await make_and_push_notification(nurse)

        event = await communicator.receive_json_from(timeout=5)
        self.assertEqual(event['type'], 'notification')
        self.assertEqual(event['id'], str(notification.pk))
        self.assertEqual(event['message'], 'Hello from the channel layer.')

        await communicator.disconnect()

    async def test_nothing_arrives_at_a_different_nurses_socket(self):
        owner, owner_token = await make_nurse('owner@hospital.com')
        other, _ = await make_nurse('other@hospital.com')
        communicator = WebsocketCommunicator(application, '/ws/notifications/?token=%s' % owner_token)
        await communicator.connect()
        await communicator.receive_json_from(timeout=2)

        await make_and_push_notification(other)

        self.assertTrue(await communicator.receive_nothing(timeout=1))
        await communicator.disconnect()
