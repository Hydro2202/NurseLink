"""
POST /api/tasks/<task_code>/notify-nurse/ — the "Notify Nurse" button on the
Head Nurse dashboard's Safety Alerts panel, for a delayed/overdue task. Used
to be a pure client-side toast that told nobody; this wires it to the real
Notification inbox (see notify_task_delay_flagged in api/notifications.py) —
the task-alert counterpart of tests_notify_nurse.py's patient-alert version.
"""

from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from .models import NurseProfile, Notification, Task, UserPreferences


def make_user(email, first, last, *, role='staff_nurse'):
    user = User.objects.create_user(
        username=email, email=email, password='pw-test-1234',
        first_name=first, last_name=last,
    )
    NurseProfile.objects.create(user=user, role=role, department='ICU', approval_status='approved', is_active_staff=True)
    return user


class NotifyTaskNurseTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.head_nurse = make_user('maria@hospital.com', 'Maria', 'Santos', role='head_nurse')
        self.nurse = make_user('ben@hospital.com', 'Ben', 'Diaz')
        self.task = Task.objects.create(
            task_code='T-9001', title='Administer medication', assigned_to='Ben Diaz',
            assigned_nurse=self.nurse, status='overdue', patient_name='Ramon Rivera',
        )
        self.client.force_authenticate(self.head_nurse)

    def notify(self):
        return self.client.post(f'/api/tasks/{self.task.task_code}/notify-nurse/', {}, format='json')

    def test_head_nurse_can_notify_the_assigned_nurse(self):
        response = self.notify()
        self.assertEqual(response.status_code, 200, response.data)

        notification = Notification.objects.get(recipient=self.nurse)
        self.assertEqual(notification.notification_type, 'warning')
        self.assertIn('Administer medication', notification.message)
        self.assertIn('Ramon Rivera', notification.message)
        self.assertEqual(notification.sender, self.head_nurse)
        self.assertEqual(notification.action_path, '/tasks')
        self.assertEqual(notification.action_highlight_id, 'T-9001')

    def test_a_task_with_no_assigned_nurse_account_cannot_be_notified(self):
        self.task.assigned_nurse = None
        self.task.save(update_fields=['assigned_nurse'])

        response = self.notify()
        self.assertEqual(response.status_code, 400)
        self.assertFalse(Notification.objects.exists())

    def test_a_staff_nurse_cannot_use_this_head_nurse_only_action(self):
        self.client.force_authenticate(self.nurse)
        response = self.notify()
        self.assertEqual(response.status_code, 403)
        self.assertFalse(Notification.objects.exists())

    def test_nurse_with_task_notifications_off_is_not_notified_but_the_request_still_succeeds(self):
        UserPreferences.objects.create(user=self.nurse, task_notifications=False)
        response = self.notify()
        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(Notification.objects.exists())

    def test_notifying_oneself_about_ones_own_task_is_a_silent_no_op(self):
        self.task.assigned_nurse = self.head_nurse
        self.task.save(update_fields=['assigned_nurse'])

        response = self.notify()
        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(Notification.objects.exists())
