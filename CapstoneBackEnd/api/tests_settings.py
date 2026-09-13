"""
The Settings page, end to end.

Two things matter here. Settings must persist per account and be reachable only
by their owner; and the notification switches must actually govern behaviour,
because a preference that is stored but never consulted is indistinguishable
from a decorative toggle.
"""

import datetime

from unittest.mock import patch

from django.contrib.auth.models import User
from django.core import mail
from django.test import override_settings
from django.core.cache import cache
from rest_framework.test import APITestCase

from .models import (
    HandoverNote,
    Notification,
    NurseProfile,
    Patient,
    Task,
    UserPreferences,
)
from .notifications import notify, notify_handover_created, notify_task_assigned


def make_nurse(email, first, last):
    user = User.objects.create_user(
        username=email, email=email, password='pw-test-1234',
        first_name=first, last_name=last,
    )
    NurseProfile.objects.create(user=user, role='staff_nurse', department='Med-Surg')
    return user


class PreferencesApiTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.nurse = make_nurse('ben@hospital.com', 'Ben', 'Diaz')
        self.other = make_nurse('cora@hospital.com', 'Cora', 'Reyes')
        self.client.force_authenticate(user=self.nurse)

    def test_a_nurse_with_no_row_yet_gets_the_shipped_defaults(self):
        response = self.client.get('/api/preferences/')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {
                'fontSize': 'medium',
                'compactView': False,
                'taskNotifications': True,
                'handoverNotifications': True,
                'criticalAlerts': True,
                'emailNotifications': False,
                'soundAlerts': True,
                'autoRefresh': True,
                'showCharts': True,
                'backgroundSync': True,
            },
        )

    def test_settings_survive_being_saved_and_read_back(self):
        self.client.patch(
            '/api/preferences/',
            {'fontSize': 'large', 'compactView': True},
            format='json',
        )

        # A fresh request, as if the nurse reloaded or signed in elsewhere.
        reloaded = self.client.get('/api/preferences/').json()
        self.assertEqual(reloaded['fontSize'], 'large')
        self.assertTrue(reloaded['compactView'])

    def test_saving_one_section_leaves_the_others_alone(self):
        self.client.patch('/api/preferences/', {'compactView': True}, format='json')
        self.client.patch('/api/preferences/', {'soundAlerts': False}, format='json')

        current = self.client.get('/api/preferences/').json()
        self.assertTrue(current['compactView'], 'appearance was clobbered by a later save')
        self.assertFalse(current['soundAlerts'])
        self.assertTrue(current['autoRefresh'], 'untouched sections must keep their value')

    def test_an_invalid_font_size_is_rejected(self):
        response = self.client.patch('/api/preferences/', {'fontSize': 'enormous'}, format='json')
        self.assertEqual(response.status_code, 400)
        self.assertIn('fontSize', response.json())

    def test_settings_are_private_to_their_owner(self):
        self.client.patch('/api/preferences/', {'compactView': True}, format='json')

        self.client.force_authenticate(user=self.other)
        self.assertFalse(
            self.client.get('/api/preferences/').json()['compactView'],
            'one nurse must never see or inherit another nurse\'s settings',
        )

    def test_settings_require_authentication(self):
        self.client.force_authenticate(user=None)
        self.assertEqual(self.client.get('/api/preferences/').status_code, 401)
        self.assertEqual(
            self.client.patch('/api/preferences/', {'compactView': True}, format='json').status_code,
            401,
        )


class NotificationPreferenceEffectTests(APITestCase):
    """The switches have to change what the system does, not just what it stores."""

    def setUp(self):
        cache.clear()
        self.sender = make_nurse('maria@hospital.com', 'Maria', 'Santos')
        self.receiver = make_nurse('ben@hospital.com', 'Ben', 'Diaz')
        self.patient = Patient.objects.create(
            patient_code='P600', name='Lawrence Cruz', age=54, gender='Male',
            room='210-A', diagnosis='Pneumonia',
            admission_date=datetime.date(2026, 3, 1),
        )

    def prefs(self, user, **changes):
        preferences, _ = UserPreferences.objects.get_or_create(user=user)
        for key, value in changes.items():
            setattr(preferences, key, value)
        preferences.save()
        return preferences

    def make_handover(self):
        return HandoverNote.objects.create(
            handover_code='H600', patient=self.patient, patient_name=self.patient.name,
            shift='morning', date=datetime.date(2026, 3, 3),
            nurse_from='Maria Santos', nurse_to='Ben Diaz',
            nurse_to_user=self.receiver, created_by=self.sender, status='pending',
        )

    def make_task(self, priority='routine'):
        return Task.objects.create(
            task_code='T600', title='Wound dressing', patient=self.patient,
            patient_name=self.patient.name, assigned_to='Ben Diaz',
            assigned_nurse=self.receiver, status='pending', priority=priority,
        )

    def test_handover_notifications_on_creates_one(self):
        self.prefs(self.receiver, handover_notifications=True)

        notify_handover_created(self.make_handover())

        self.assertEqual(Notification.objects.filter(recipient=self.receiver).count(), 1)

    def test_handover_notifications_off_creates_none(self):
        self.prefs(self.receiver, handover_notifications=False)

        notify_handover_created(self.make_handover())

        # Not created and then hidden — never created, which is what the nurse
        # asked for when they turned the switch off.
        self.assertEqual(Notification.objects.filter(recipient=self.receiver).count(), 0)

    def test_turning_handovers_off_does_not_affect_the_handover_itself(self):
        self.prefs(self.receiver, handover_notifications=False)
        handover = self.make_handover()

        notify_handover_created(handover)

        handover.refresh_from_db()
        self.assertEqual(handover.nurse_to_user, self.receiver)
        self.assertEqual(handover.status, 'pending')

    def test_task_notifications_off_stops_routine_task_notifications(self):
        self.prefs(self.receiver, task_notifications=False)

        notify_task_assigned(self.make_task(), actor=self.sender)

        self.assertEqual(Notification.objects.count(), 0)

    def test_critical_alerts_are_a_separate_switch_from_task_notifications(self):
        # Routine tasks silenced, urgent ones still allowed through.
        self.prefs(self.receiver, task_notifications=False, critical_alerts=True)

        notify_task_assigned(self.make_task(priority='urgent'), actor=self.sender)

        self.assertEqual(Notification.objects.filter(recipient=self.receiver).count(), 1)

    def test_critical_alerts_off_silences_urgent_work(self):
        self.prefs(self.receiver, task_notifications=True, critical_alerts=False)

        notify_task_assigned(self.make_task(priority='urgent'), actor=self.sender)

        self.assertEqual(Notification.objects.count(), 0)

    def test_a_nurse_with_no_preferences_row_still_gets_notified(self):
        # Defaults must fail open: a missing row must never swallow a handover.
        UserPreferences.objects.filter(user=self.receiver).delete()

        notify_handover_created(self.make_handover())

        self.assertEqual(Notification.objects.filter(recipient=self.receiver).count(), 1)

    def test_one_nurses_preference_does_not_silence_another(self):
        self.prefs(self.receiver, handover_notifications=False)
        self.prefs(self.sender, handover_notifications=True)
        handover = self.make_handover()
        handover.acknowledged_by = self.receiver
        handover.save()

        from .notifications import notify_handover_acknowledged

        notify_handover_acknowledged(handover, self.receiver)

        # The sender still wants to know their handover was accepted.
        self.assertEqual(Notification.objects.filter(recipient=self.sender).count(), 1)


class ProfileUpdateTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.nurse = make_nurse('ben@hospital.com', 'Ben', 'Diaz')
        self.other = make_nurse('cora@hospital.com', 'Cora', 'Reyes')
        self.client.force_authenticate(user=self.nurse)

    def test_a_full_name_is_split_and_actually_saved(self):
        response = self.client.patch(
            '/api/auth/me/', {'name': 'Benjamin Reyes Diaz'}, format='json'
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['name'], 'Benjamin Reyes Diaz')

        self.nurse.refresh_from_db()
        self.assertEqual(self.nurse.first_name, 'Benjamin')
        self.assertEqual(self.nurse.last_name, 'Reyes Diaz')

    def test_changing_email_keeps_the_login_username_in_step(self):
        response = self.client.patch(
            '/api/auth/me/', {'email': 'ben.diaz@hospital.com'}, format='json'
        )

        self.assertEqual(response.status_code, 200)
        self.nurse.refresh_from_db()
        self.assertEqual(self.nurse.email, 'ben.diaz@hospital.com')
        self.assertEqual(
            self.nurse.username, 'ben.diaz@hospital.com',
            'username is what authentication matches on; a stale one locks the nurse out',
        )

    def test_an_email_another_account_already_uses_is_rejected(self):
        response = self.client.patch(
            '/api/auth/me/', {'email': 'cora@hospital.com'}, format='json'
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn('email', response.json())
        self.nurse.refresh_from_db()
        self.assertEqual(self.nurse.username, 'ben@hospital.com')

    def test_keeping_your_own_email_is_not_a_clash(self):
        response = self.client.patch(
            '/api/auth/me/', {'email': 'ben@hospital.com', 'name': 'Ben Diaz'}, format='json'
        )
        self.assertEqual(response.status_code, 200)

    def test_a_nurse_can_only_edit_their_own_profile(self):
        # There is no id in this route: /auth/me/ is always the caller, so the
        # only thing to prove is that it edits the caller and nobody else.
        self.client.patch('/api/auth/me/', {'name': 'Changed Name'}, format='json')

        self.other.refresh_from_db()
        self.assertEqual(self.other.get_full_name(), 'Cora Reyes')


class PasswordChangeTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.nurse = make_nurse('ben@hospital.com', 'Ben', 'Diaz')
        self.client.force_authenticate(user=self.nurse)

    def test_a_correct_current_password_changes_it(self):
        response = self.client.post(
            '/api/auth/change-password/',
            {'currentPassword': 'pw-test-1234', 'newPassword': 'Str0ng-New-Pass!'},
            format='json',
        )

        self.assertEqual(response.status_code, 200)
        self.nurse.refresh_from_db()
        self.assertTrue(self.nurse.check_password('Str0ng-New-Pass!'))
        # Hashed, never stored as given.
        self.assertNotIn('Str0ng-New-Pass!', self.nurse.password)

    def test_the_wrong_current_password_is_refused(self):
        response = self.client.post(
            '/api/auth/change-password/',
            {'currentPassword': 'not-my-password', 'newPassword': 'Str0ng-New-Pass!'},
            format='json',
        )

        self.assertEqual(response.status_code, 400)
        self.nurse.refresh_from_db()
        self.assertTrue(self.nurse.check_password('pw-test-1234'))

    def test_a_weak_new_password_is_refused(self):
        response = self.client.post(
            '/api/auth/change-password/',
            {'currentPassword': 'pw-test-1234', 'newPassword': '123'},
            format='json',
        )
        self.assertEqual(response.status_code, 400)


@override_settings(EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend')
class EmailNotificationPreferenceTests(APITestCase):
    """
    Email Notifications goes through the project's existing Django mail setup —
    the same one Email OTP uses — rather than a second mail path.
    """

    def setUp(self):
        cache.clear()
        self.nurse = make_nurse('ben@hospital.com', 'Ben', 'Diaz')
        mail.outbox = []

    def prefs(self, **changes):
        preferences, _ = UserPreferences.objects.get_or_create(user=self.nurse)
        for key, value in changes.items():
            setattr(preferences, key, value)
        preferences.save()

    def test_off_by_default_sends_no_email(self):
        notify(self.nurse, title='New task assigned', message='Something to do.')
        self.assertEqual(len(mail.outbox), 0)

    def test_on_sends_the_notification_to_the_nurses_address(self):
        self.prefs(email_notifications=True)

        notify(self.nurse, title='Patient Handover', message='Lawrence Cruz handed to you.')

        self.assertEqual(len(mail.outbox), 1)
        sent = mail.outbox[0]
        self.assertEqual(sent.to, ['ben@hospital.com'])
        self.assertIn('Patient Handover', sent.subject)
        self.assertIn('Lawrence Cruz handed to you.', sent.body)
        # Real line breaks. An earlier version emitted the two characters
        # backslash and n instead, which reads as gibberish in a mail client.
        literal_backslash_n = chr(92) + 'n'
        self.assertNotIn(literal_backslash_n, sent.body)
        self.assertIn(chr(10), sent.body)

    def test_the_notification_is_still_saved_when_email_fails(self):
        self.prefs(email_notifications=True)

        with patch('api.notifications.send_mail', side_effect=RuntimeError('smtp down')):
            created = notify(self.nurse, title='Patient Handover', message='Still saved.')

        self.assertIsNotNone(created)
        self.assertEqual(Notification.objects.filter(recipient=self.nurse).count(), 1)

    def test_a_nurse_with_no_email_address_is_skipped_quietly(self):
        self.prefs(email_notifications=True)
        self.nurse.email = ''
        self.nurse.save()

        created = notify(self.nurse, title='Patient Handover', message='No address.')

        self.assertIsNotNone(created)
        self.assertEqual(len(mail.outbox), 0)
