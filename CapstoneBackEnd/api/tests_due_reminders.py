"""
Due-date reminders — tasks and referrals.

Both piggyback on the live poll (see api/notifications.py's
check_due_task_reminders / check_due_referral_reminders) rather than a
scheduler, so these tests call the check functions directly: that is
exactly what LiveStateView does on every poll, and testing it that way
keeps these fast and independent of the poll endpoint's own concerns
(notification counts, revision stamps, etc).
"""

import datetime
from zoneinfo import ZoneInfo

from django.conf import settings
from django.contrib.auth.models import User
from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone

from .models import HandoverNote, Notification, NurseProfile, Patient, Task
from .notifications import (
    TASK_REMINDER_LEAD_MINUTES,
    REFERRAL_REMINDER_LEAD_MINUTES,
    check_due_task_reminders,
    check_due_referral_reminders,
)

# Task.due_date/due_time are interpreted as local wall-clock time in this
# zone (see notifications._task_scheduled_at) — the same convention the
# TimePicker-driven frontend relies on implicitly. Building due_date/due_time
# from a plain UTC `timezone.now()` without this conversion would silently
# shift every "now + N minutes" in these tests by the zone's UTC offset.
LOCAL_TZ = ZoneInfo(settings.DUTY_LOCAL_TIMEZONE)


def local_parts(moment):
    """A tz-aware `moment` -> (date, 'HH:MM') in DUTY_LOCAL_TIMEZONE."""
    local = moment.astimezone(LOCAL_TZ)
    return local.date(), local.strftime('%H:%M')


def make_nurse(email, first, last):
    user = User.objects.create_user(
        username=email, email=email, password='pw-test-1234',
        first_name=first, last_name=last,
    )
    NurseProfile.objects.create(user=user, role='staff_nurse', department='Med-Surg')
    return user


def make_patient(code, name='Juan Dela Cruz'):
    return Patient.objects.create(
        patient_code=code, name=name, age=50, gender='Male',
        room='101', diagnosis='Observation', admission_date=datetime.date(2026, 1, 1),
    )


class TaskDueReminderTests(TestCase):
    def setUp(self):
        cache.clear()
        self.nurse = make_nurse('ben@hospital.com', 'Ben', 'Diaz')
        self.patient = make_patient('TDR001')

    def make_task(self, *, due_date, due_time, status='pending'):
        return Task.objects.create(
            task_code=f'T-{Task.objects.count() + 1}', title='Wound dressing',
            patient=self.patient, patient_name=self.patient.name, assigned_to='Ben Diaz',
            assigned_nurse=self.nurse, status=status, priority='medium',
            due_date=due_date, due_time=due_time,
        )

    def test_due_soon_reminder_fires_once_within_lead_window(self):
        now = timezone.now()
        soon = now + datetime.timedelta(minutes=TASK_REMINDER_LEAD_MINUTES - 2)
        due_date, due_time = local_parts(soon)
        task = self.make_task(due_date=due_date, due_time=due_time)

        check_due_task_reminders(self.nurse)

        task.refresh_from_db()
        self.assertIsNotNone(task.reminder_soon_sent_at)
        self.assertIsNone(task.reminder_sent_at)
        self.assertEqual(
            Notification.objects.filter(recipient=self.nurse, event='task_due_soon').count(), 1
        )

        # A second poll must not raise it again.
        check_due_task_reminders(self.nurse)
        self.assertEqual(
            Notification.objects.filter(recipient=self.nurse, event='task_due_soon').count(), 1
        )

    def test_due_now_reminder_fires_once_at_due_time(self):
        now = timezone.now()
        past = now - datetime.timedelta(minutes=1)
        due_date, due_time = local_parts(past)
        task = self.make_task(due_date=due_date, due_time=due_time)

        check_due_task_reminders(self.nurse)

        task.refresh_from_db()
        self.assertIsNotNone(task.reminder_sent_at)
        self.assertEqual(
            Notification.objects.filter(recipient=self.nurse, event='task_due').count(), 1
        )

        check_due_task_reminders(self.nurse)
        self.assertEqual(
            Notification.objects.filter(recipient=self.nurse, event='task_due').count(), 1
        )

    def test_no_reminder_for_completed_tasks(self):
        now = timezone.now()
        past = now - datetime.timedelta(minutes=1)
        due_date, due_time = local_parts(past)
        self.make_task(due_date=due_date, due_time=due_time, status='completed')

        check_due_task_reminders(self.nurse)

        self.assertEqual(Notification.objects.filter(recipient=self.nurse).count(), 0)

    def test_overdue_status_is_set_when_due_time_passes(self):
        now = timezone.now()
        past = now - datetime.timedelta(minutes=5)
        due_date, due_time = local_parts(past)
        task = self.make_task(due_date=due_date, due_time=due_time)

        check_due_task_reminders(self.nurse)

        task.refresh_from_db()
        self.assertEqual(task.status, 'overdue')

    def test_editing_due_time_rearms_both_reminders(self):
        now = timezone.now()
        past = now - datetime.timedelta(minutes=1)
        due_date, due_time = local_parts(past)
        task = self.make_task(due_date=due_date, due_time=due_time)
        check_due_task_reminders(self.nurse)
        task.refresh_from_db()
        self.assertIsNotNone(task.reminder_sent_at)
        self.assertEqual(task.status, 'overdue')
        due_notifications_so_far = Notification.objects.filter(
            recipient=self.nurse, event='task_due'
        ).count()
        self.assertEqual(due_notifications_so_far, 1)

        # Reschedule to the future, the same way TaskSerializer.update() does.
        future = now + datetime.timedelta(hours=2)
        task.due_date, task.due_time = local_parts(future)
        task.reminder_sent_at = None
        task.reminder_soon_sent_at = None
        task.status = 'pending'
        task.save()

        check_due_task_reminders(self.nurse)
        task.refresh_from_db()
        # Not due yet — no new reminder, and no longer marked overdue.
        self.assertIsNone(task.reminder_sent_at)
        self.assertEqual(task.status, 'pending')
        self.assertEqual(
            Notification.objects.filter(recipient=self.nurse, event='task_due').count(),
            due_notifications_so_far,
        )


class ReferralDueReminderTests(TestCase):
    def setUp(self):
        cache.clear()
        self.sender = make_nurse('ana@hospital.com', 'Ana', 'Cruz')
        self.receiver = make_nurse('ben@hospital.com', 'Ben', 'Diaz')
        self.patient = make_patient('RDR001')

    def make_referral(self, *, due_at, status='sent'):
        code = f'H-{HandoverNote.objects.count() + 1}'
        handover = HandoverNote.objects.create(
            handover_code=code, patient=self.patient, patient_name=self.patient.name,
            date=timezone.now().date(), due_at=due_at,
            nurse_from='Ana Cruz', nurse_to='Ben Diaz',
            created_by=self.sender, nurse_to_user=self.receiver, status=status,
        )
        return handover

    def test_almost_due_fires_once_to_receiver_only(self):
        now = timezone.now()
        soon = now + datetime.timedelta(minutes=REFERRAL_REMINDER_LEAD_MINUTES - 2)
        self.make_referral(due_at=soon)

        check_due_referral_reminders(self.receiver)

        self.assertEqual(
            Notification.objects.filter(recipient=self.receiver, event='referral_almost_due').count(), 1
        )
        self.assertEqual(
            Notification.objects.filter(recipient=self.sender, event='referral_almost_due').count(), 0
        )

        # A second poll (by either nurse) must not raise it again.
        check_due_referral_reminders(self.receiver)
        check_due_referral_reminders(self.sender)
        self.assertEqual(
            Notification.objects.filter(recipient=self.receiver, event='referral_almost_due').count(), 1
        )

    def test_overdue_fires_once_to_both_sender_and_receiver(self):
        now = timezone.now()
        past = now - datetime.timedelta(minutes=1)
        self.make_referral(due_at=past)

        check_due_referral_reminders(self.receiver)

        self.assertEqual(
            Notification.objects.filter(recipient=self.receiver, event='referral_overdue').count(), 1
        )
        self.assertEqual(
            Notification.objects.filter(recipient=self.sender, event='referral_overdue').count(), 1
        )

        # The sender's own poll, arriving after, must not raise it a second time.
        check_due_referral_reminders(self.sender)
        self.assertEqual(
            Notification.objects.filter(recipient=self.receiver, event='referral_overdue').count(), 1
        )
        self.assertEqual(
            Notification.objects.filter(recipient=self.sender, event='referral_overdue').count(), 1
        )

    def test_no_alerts_once_accepted(self):
        now = timezone.now()
        past = now - datetime.timedelta(minutes=1)
        self.make_referral(due_at=past, status='accepted')

        check_due_referral_reminders(self.receiver)
        check_due_referral_reminders(self.sender)

        self.assertEqual(Notification.objects.filter(event='referral_overdue').count(), 0)

    def test_no_alerts_once_declined(self):
        now = timezone.now()
        past = now - datetime.timedelta(minutes=1)
        self.make_referral(due_at=past, status='declined')

        check_due_referral_reminders(self.receiver)
        check_due_referral_reminders(self.sender)

        self.assertEqual(Notification.objects.filter(event='referral_overdue').count(), 0)

    def test_no_alerts_once_cancelled(self):
        now = timezone.now()
        past = now - datetime.timedelta(minutes=1)
        self.make_referral(due_at=past, status='cancelled')

        check_due_referral_reminders(self.receiver)
        check_due_referral_reminders(self.sender)

        self.assertEqual(Notification.objects.filter(event='referral_overdue').count(), 0)


class ReferralDueAtRequiredTests(TestCase):
    """The create-time requirement itself — see HandoverSerializer.validate()."""

    def setUp(self):
        cache.clear()
        from rest_framework.test import APIClient

        self.client = APIClient()
        self.sender = make_nurse('ana2@hospital.com', 'Ana', 'Cruz')
        self.receiver = make_nurse('ben2@hospital.com', 'Ben', 'Diaz')
        self.client.force_authenticate(user=self.sender)

    def _payload(self, **extra):
        body = {
            'date': '2026-03-03',
            'nurseFrom': 'Ana Cruz',
            'nurseTo': 'Ben Diaz',
            'nurseToId': str(self.receiver.pk),
            'sbar': {'situation': 's', 'background': 'b', 'assessment': 'a', 'recommendation': 'r'},
        }
        body.update(extra)
        return body

    def test_missing_due_at_is_rejected(self):
        response = self.client.post('/api/handovers/', self._payload(), format='json')
        self.assertEqual(response.status_code, 400)
        self.assertIn('dueAt', response.data)

    def test_past_due_at_is_rejected(self):
        past = (timezone.now() - datetime.timedelta(hours=1)).isoformat()
        response = self.client.post('/api/handovers/', self._payload(dueAt=past), format='json')
        self.assertEqual(response.status_code, 400)
        self.assertIn('dueAt', response.data)

    def test_future_due_at_is_accepted(self):
        future = (timezone.now() + datetime.timedelta(hours=2)).isoformat()
        response = self.client.post('/api/handovers/', self._payload(dueAt=future), format='json')
        self.assertEqual(response.status_code, 201, response.content)


class TaskDefaultOrderingTests(TestCase):
    """TaskViewSet.get_queryset's default ordering: completed last, then
    High -> Medium -> Low, overdue first within a risk level, then soonest
    due date/time — matching what the frontend's own 'priority' sort does
    client-side (tasks.tsx), so the API and the app never disagree."""

    def setUp(self):
        cache.clear()
        from rest_framework.test import APIClient

        self.client = APIClient()
        self.nurse = make_nurse('order@hospital.com', 'Ben', 'Diaz')
        self.patient = make_patient('ORD001')
        self.client.force_authenticate(user=self.nurse)

    def make_task(self, *, priority, status='pending', due_date=None, due_time='', title=''):
        return Task.objects.create(
            task_code=f'T-ord-{Task.objects.count() + 1}', title=title or priority,
            patient=self.patient, patient_name=self.patient.name, assigned_to='Ben Diaz',
            assigned_nurse=self.nurse, status=status, priority=priority,
            due_date=due_date, due_time=due_time,
        )

    def test_high_medium_low_then_overdue_then_due_date_then_completed_last(self):
        today = timezone.now().date()
        low = self.make_task(priority='low', title='low', due_date=today, due_time='09:00')
        medium_later = self.make_task(
            priority='medium', title='medium-later', due_date=today, due_time='15:00'
        )
        medium_overdue = self.make_task(
            priority='medium', status='overdue', title='medium-overdue',
            due_date=today, due_time='08:00',
        )
        medium_sooner = self.make_task(
            priority='medium', title='medium-sooner', due_date=today, due_time='10:00'
        )
        high = self.make_task(priority='high', title='high', due_date=today, due_time='23:00')
        completed_high = self.make_task(priority='high', status='completed', title='completed-high')

        response = self.client.get('/api/tasks/?mine=true')
        self.assertEqual(response.status_code, 200, response.content)
        ids_in_order = [t['id'] for t in response.data]

        expected = [
            high.task_code,
            medium_overdue.task_code,
            medium_sooner.task_code,
            medium_later.task_code,
            low.task_code,
            completed_high.task_code,
        ]
        self.assertEqual(ids_in_order, expected)
