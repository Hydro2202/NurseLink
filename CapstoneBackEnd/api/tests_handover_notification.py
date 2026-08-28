"""
Patient handover notifications.

The guarantees a nurse's safety depends on: the right person is told, nobody
else is, they are told exactly once, and nothing is lost because they happened
to be offline when it arrived.
"""

import datetime

from django.contrib.auth.models import User
from django.core.cache import cache
from rest_framework.test import APITestCase

from .models import HandoverNote, Notification, NurseProfile, Patient


def make_nurse(email, first, last):
    user = User.objects.create_user(
        username=email, email=email, password='pw-test-1234',
        first_name=first, last_name=last,
    )
    NurseProfile.objects.create(user=user, role='staff_nurse', department='Med-Surg')
    return user


class HandoverNotificationTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.sender = make_nurse('maria@hospital.com', 'Maria', 'Santos')
        self.receiver = make_nurse('ben@hospital.com', 'Ben', 'Diaz')
        self.bystander = make_nurse('cora@hospital.com', 'Cora', 'Reyes')
        self.patient = Patient.objects.create(
            patient_code='P700', name='Lawrence Cruz', age=54, gender='Male',
            room='210-A', diagnosis='Pneumonia',
            admission_date=datetime.date(2026, 3, 1), risk_level='medium',
        )
        self.client.force_authenticate(user=self.sender)

    def payload(self, **extra):
        body = {
            'patientId': 'P700',
            'patientName': 'Lawrence Cruz',
            'shift': 'morning',
            'date': '2026-03-03',
            'nurseFrom': 'Maria Santos',
            'nurseTo': 'Ben Diaz',
            'nurseToId': str(self.receiver.pk),
            'sbar': {'situation': 's', 'background': 'b', 'assessment': 'a',
                     'recommendation': 'Monitor closely.'},
            'unfinishedTasks': [],
        }
        body.update(extra)
        return body

    def create_handover(self, **extra):
        response = self.client.post('/api/handovers/', self.payload(**extra), format='json')
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()['id']

    def inbox(self, user):
        self.client.force_authenticate(user=user)
        response = self.client.get('/api/notifications/')
        self.assertEqual(response.status_code, 200)
        return response.json()

    # --- content ---------------------------------------------------------

    def test_the_notification_names_the_patient_and_the_sending_nurse(self):
        code = self.create_handover()

        rows = self.inbox(self.receiver)['results']
        self.assertEqual(len(rows), 1)
        note = rows[0]

        self.assertEqual(note['event'], 'handover_received')
        self.assertEqual(note['title'], 'Patient Handover')
        self.assertEqual(
            note['message'],
            'Patient Lawrence Cruz has been handed over to you by Maria Santos.',
        )
        self.assertEqual(note['patient'], 'Lawrence Cruz')
        self.assertEqual(note['senderName'], 'Maria Santos')
        self.assertEqual(note['handoverId'], code)
        self.assertFalse(note['isRead'])

    def test_it_carries_the_real_patient_so_view_patient_can_open_it(self):
        self.create_handover()

        note = self.inbox(self.receiver)['results'][0]
        self.assertEqual(note['patientId'], 'P700')
        self.assertTrue(Patient.objects.filter(patient_code=note['patientId']).exists())

    def test_it_carries_a_timestamp_for_the_popup(self):
        self.create_handover()

        note = self.inbox(self.receiver)['results'][0]
        self.assertTrue(note['createdAt'], 'popup needs an exact time, not "3 mins ago"')

    # --- security --------------------------------------------------------

    def test_only_the_receiving_nurse_is_told(self):
        self.create_handover()

        self.assertEqual(self.inbox(self.receiver)['unreadCount'], 1)
        self.assertEqual(self.inbox(self.bystander)['unreadCount'], 0)
        self.assertEqual(self.inbox(self.sender)['unreadCount'], 0)

    def test_one_nurse_cannot_read_another_nurses_inbox(self):
        self.create_handover()
        note = Notification.objects.get(recipient=self.receiver)

        self.client.force_authenticate(user=self.bystander)
        response = self.client.get('/api/notifications/%s/' % note.pk)
        self.assertEqual(response.status_code, 404)

    def test_an_anonymous_request_gets_nothing(self):
        self.create_handover()
        self.client.force_authenticate(user=None)
        self.assertEqual(self.client.get('/api/notifications/').status_code, 401)

    def test_handing_a_patient_to_yourself_notifies_nobody(self):
        self.create_handover(nurseToId=str(self.sender.pk), nurseTo='Maria Santos')
        self.assertEqual(Notification.objects.count(), 0)

    # --- exactly once ----------------------------------------------------

    def test_one_handover_produces_one_notification(self):
        self.create_handover()
        self.assertEqual(
            Notification.objects.filter(recipient=self.receiver, event='handover_received').count(),
            1,
        )

    def test_reading_the_inbox_repeatedly_does_not_multiply_it(self):
        self.create_handover()
        for _ in range(4):
            self.inbox(self.receiver)
        self.assertEqual(Notification.objects.count(), 1)

    def test_two_handovers_produce_two_notifications(self):
        self.create_handover()
        self.create_handover()
        self.assertEqual(Notification.objects.filter(recipient=self.receiver).count(), 2)

    def test_notifying_twice_for_one_handover_is_a_no_op(self):
        from .notifications import notify_handover_created

        code = self.create_handover()
        handover = HandoverNote.objects.get(handover_code=code)

        notify_handover_created(handover)
        notify_handover_created(handover)

        self.assertEqual(Notification.objects.filter(handover=handover).count(), 1)

    # --- offline / dismissal --------------------------------------------

    def test_a_handover_sent_while_offline_is_waiting_at_next_sign_in(self):
        # Nothing about delivery depends on the recipient being connected: the
        # notification is a database row, and signing in is just a read.
        self.create_handover()

        inbox = self.inbox(self.receiver)
        self.assertEqual(inbox['unreadCount'], 1)
        self.assertEqual(inbox['results'][0]['event'], 'handover_received')

    def test_dismissing_marks_it_read_without_touching_the_handover(self):
        code = self.create_handover()
        note = Notification.objects.get(recipient=self.receiver)

        self.client.force_authenticate(user=self.receiver)
        response = self.client.post('/api/notifications/%s/mark_read/' % note.pk)
        self.assertEqual(response.status_code, 200)

        note.refresh_from_db()
        self.assertTrue(note.is_read)
        self.assertEqual(self.inbox(self.receiver)['unreadCount'], 0)

        # The handover is untouched and still listed for the receiving nurse.
        handover = HandoverNote.objects.get(handover_code=code)
        self.assertEqual(handover.status, 'pending')
        self.assertEqual(handover.nurse_to_user, self.receiver)

        # And the entry itself survives in the notification centre.
        self.assertEqual(len(self.inbox(self.receiver)['results']), 1)

    def test_a_dismissed_handover_does_not_come_back_unread(self):
        self.create_handover()
        note = Notification.objects.get(recipient=self.receiver)

        self.client.force_authenticate(user=self.receiver)
        self.client.post('/api/notifications/%s/mark_read/' % note.pk)

        # Whatever the client does next — refresh, remount, poll again — the
        # server keeps reporting it as read, which is what retires the popup.
        for _ in range(3):
            self.assertEqual(self.inbox(self.receiver)['unreadCount'], 0)

    # --- failure ---------------------------------------------------------

    def test_a_rejected_handover_notifies_nobody(self):
        response = self.client.post(
            '/api/handovers/', self.payload(nurseToId='999999'), format='json'
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(Notification.objects.count(), 0)
        self.assertEqual(HandoverNote.objects.count(), 0)
