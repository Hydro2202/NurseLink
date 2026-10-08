"""
POST /api/patients/<patient_code>/notify-nurse/ — the "Notify Nurse" button
on the Head Nurse dashboard's Patient Safety Alerts panel. Used to be a
pure client-side toast that told nobody; this wires it to the real
Notification inbox (see notify_safety_alert in api/notifications.py).
"""

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from .models import Notification, NurseProfile, Patient, UserPreferences


def make_user(email, first, last, *, role='staff_nurse'):
    user = User.objects.create_user(
        username=email, email=email, password='pw-test-1234',
        first_name=first, last_name=last,
    )
    NurseProfile.objects.create(user=user, role=role, department='ICU', approval_status='approved', is_active_staff=True)
    return user


class NotifyNurseTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.head_nurse = make_user('maria@hospital.com', 'Maria', 'Santos', role='head_nurse')
        self.nurse = make_user('ben@hospital.com', 'Ben', 'Diaz')
        self.patient = Patient.objects.create(
            patient_code='P-9001', name='Ramon Rivera', age=60, gender='Male',
            room='INT-349', diagnosis='Observation', admission_date=timezone.localdate(),
            risk_level='high', assigned_nurse=self.nurse,
        )
        self.client.force_authenticate(self.head_nurse)

    def notify(self, message=None):
        payload = {'message': message} if message is not None else {}
        return self.client.post(f'/api/patients/{self.patient.patient_code}/notify-nurse/', payload, format='json')

    def test_head_nurse_can_notify_the_assigned_nurse(self):
        response = self.notify('Vital signs require attention. BP 155/77, HR 159, Temp 40.7°C.')
        self.assertEqual(response.status_code, 200, response.data)

        notification = Notification.objects.get(recipient=self.nurse)
        self.assertEqual(notification.notification_type, 'critical')
        self.assertEqual(notification.patient_id, self.patient.pk)
        self.assertIn('Ramon Rivera', notification.message)
        self.assertIn('BP 155/77', notification.message)
        self.assertEqual(notification.sender, self.head_nurse)

    def test_a_default_message_is_used_when_none_is_given(self):
        response = self.notify()
        self.assertEqual(response.status_code, 200, response.data)
        notification = Notification.objects.get(recipient=self.nurse)
        self.assertIn('Ramon Rivera', notification.message)
        self.assertIn('requires immediate attention', notification.message)

    def test_a_patient_with_no_assigned_nurse_cannot_be_notified(self):
        self.patient.assigned_nurse = None
        self.patient.save(update_fields=['assigned_nurse'])

        response = self.notify('Check vitals.')
        self.assertEqual(response.status_code, 400)
        self.assertFalse(Notification.objects.exists())

    def test_a_staff_nurse_cannot_use_this_head_nurse_only_action(self):
        self.client.force_authenticate(self.nurse)
        response = self.notify('Check vitals.')
        self.assertEqual(response.status_code, 403)
        self.assertFalse(Notification.objects.exists())

    def test_nurse_with_critical_alerts_off_is_not_notified_but_the_request_still_succeeds(self):
        UserPreferences.objects.create(user=self.nurse, critical_alerts=False)
        response = self.notify('Check vitals.')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(Notification.objects.exists())

    def test_notifying_oneself_about_ones_own_patient_is_a_silent_no_op(self):
        # Defensive: a head nurse is never the assigned nurse of their own
        # alert in real usage, but the self-notify guard every other
        # notify_* wrapper has should still apply here.
        self.patient.assigned_nurse = self.head_nurse
        self.patient.save(update_fields=['assigned_nurse'])

        response = self.notify('Check vitals.')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(Notification.objects.exists())
