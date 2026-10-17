"""
Nurse presence: whether a nurse is actively using the app right now.

touch_last_seen is called from every LiveStateView poll (see api.presence
and LiveStateView.get); this covers the throttling, the online/away/offline
thresholds, and that logout clears it (fully) or leaves it (another device
still open).
"""
import datetime

from django.contrib.auth.models import User
from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APITestCase

from .auth_sessions import issue_session
from .models import AuthSession, NurseProfile
from .presence import presence_fields, presence_for, touch_last_seen

PASSWORD = 'pw-test-1234'


def make_nurse(email='nurse@hospital.com', **extra):
    user = User.objects.create_user(
        username=email, email=email, password=PASSWORD, first_name='Ana', last_name='Cruz',
    )
    fields = dict(role='staff_nurse', department='ICU', approval_status='approved', is_active_staff=True)
    fields.update(extra)
    return user, NurseProfile.objects.create(user=user, **fields)


class PresenceForTests(APITestCase):
    def test_never_seen_is_offline(self):
        self.assertEqual(presence_for(None), 'offline')

    def test_seen_just_now_is_online(self):
        now = timezone.now()
        self.assertEqual(presence_for(now, now=now), 'online')

    def test_seen_two_minutes_ago_is_still_online(self):
        now = timezone.now()
        self.assertEqual(presence_for(now - datetime.timedelta(minutes=2), now=now), 'online')

    def test_seen_five_minutes_ago_is_away(self):
        now = timezone.now()
        self.assertEqual(presence_for(now - datetime.timedelta(minutes=5), now=now), 'away')

    def test_seen_fifteen_minutes_ago_is_still_away(self):
        now = timezone.now()
        self.assertEqual(presence_for(now - datetime.timedelta(minutes=15), now=now), 'away')

    def test_seen_twenty_minutes_ago_is_offline(self):
        now = timezone.now()
        self.assertEqual(presence_for(now - datetime.timedelta(minutes=20), now=now), 'offline')

    def test_presence_fields_with_no_profile(self):
        self.assertEqual(presence_fields(None), ('offline', None))


class TouchLastSeenTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.user, self.profile = make_nurse()

    def test_first_touch_writes_immediately(self):
        self.assertIsNone(self.profile.last_seen_at)
        touch_last_seen(self.profile)
        self.profile.refresh_from_db()
        self.assertIsNotNone(self.profile.last_seen_at)

    def test_second_touch_within_a_minute_does_not_move_the_timestamp(self):
        touch_last_seen(self.profile)
        self.profile.refresh_from_db()
        first = self.profile.last_seen_at

        touch_last_seen(self.profile)
        self.profile.refresh_from_db()
        self.assertEqual(self.profile.last_seen_at, first)

    def test_touch_after_the_throttle_window_moves_the_timestamp(self):
        touch_last_seen(self.profile)
        self.profile.refresh_from_db()
        first = self.profile.last_seen_at

        self.profile.last_seen_at = first - datetime.timedelta(seconds=61)
        self.profile.save(update_fields=['last_seen_at'])

        touch_last_seen(self.profile)
        self.profile.refresh_from_db()
        self.assertGreater(self.profile.last_seen_at, first)


class LivePollPresenceTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.user, self.profile = make_nurse()
        self.client.force_authenticate(user=self.user)

    def test_polling_live_marks_the_nurse_seen(self):
        self.assertIsNone(self.profile.last_seen_at)
        self.assertEqual(self.client.get('/api/live/').status_code, 200)
        self.profile.refresh_from_db()
        self.assertIsNotNone(self.profile.last_seen_at)


class NurseListPresenceTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.head, _ = make_nurse(email='head@hospital.com', role='head_nurse')
        self.nurse, self.nurse_profile = make_nurse(email='nurse@hospital.com')
        self.client.force_authenticate(user=self.head)

    def row(self):
        response = self.client.get('/api/nurses/')
        self.assertEqual(response.status_code, 200)
        return next(r for r in response.json() if r['id'] == str(self.nurse.pk))

    def test_never_seen_nurse_is_offline(self):
        row = self.row()
        self.assertEqual(row['presence'], 'offline')
        self.assertIsNone(row['lastSeenAt'])

    def test_recently_seen_nurse_is_online(self):
        self.nurse_profile.last_seen_at = timezone.now()
        self.nurse_profile.save(update_fields=['last_seen_at'])
        row = self.row()
        self.assertEqual(row['presence'], 'online')
        self.assertIsNotNone(row['lastSeenAt'])

    def test_long_ago_seen_nurse_is_offline(self):
        self.nurse_profile.last_seen_at = timezone.now() - datetime.timedelta(hours=2)
        self.nurse_profile.save(update_fields=['last_seen_at'])
        self.assertEqual(self.row()['presence'], 'offline')


class LogoutPresenceTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.user, self.profile = make_nurse()

    def as_token(self, key):
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {key}')

    def test_logout_clears_last_seen_when_it_was_the_only_session(self):
        session = issue_session(self.user)
        self.as_token(session.key)
        self.client.get('/api/live/')
        self.profile.refresh_from_db()
        self.assertIsNotNone(self.profile.last_seen_at)

        self.assertEqual(self.client.post('/api/auth/logout/').status_code, 200)
        self.profile.refresh_from_db()
        self.assertIsNone(self.profile.last_seen_at)

    def test_logout_on_one_device_leaves_presence_alone_while_another_is_open(self):
        session_a = issue_session(self.user)
        session_b = issue_session(self.user)

        self.as_token(session_a.key)
        self.client.get('/api/live/')
        self.profile.refresh_from_db()
        self.assertIsNotNone(self.profile.last_seen_at)

        self.as_token(session_a.key)
        self.assertEqual(self.client.post('/api/auth/logout/').status_code, 200)
        self.profile.refresh_from_db()
        self.assertIsNotNone(self.profile.last_seen_at)

        self.as_token(session_b.key)
        self.assertEqual(self.client.post('/api/auth/logout/').status_code, 200)
        self.profile.refresh_from_db()
        self.assertIsNone(self.profile.last_seen_at)

    def test_logout_all_clears_presence_even_with_other_sessions_open(self):
        issue_session(self.user)
        session_b = issue_session(self.user)
        self.profile.last_seen_at = timezone.now()
        self.profile.save(update_fields=['last_seen_at'])

        self.as_token(session_b.key)
        self.assertEqual(self.client.post('/api/auth/logout-all/').status_code, 200)
        self.profile.refresh_from_db()
        self.assertIsNone(self.profile.last_seen_at)
        self.assertEqual(AuthSession.objects.filter(user=self.user).count(), 0)
