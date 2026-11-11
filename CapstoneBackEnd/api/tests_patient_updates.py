"""
The structured patient activity trail (PatientUpdate), allergy editing, the
Kardex-medication history entries, change notifications, and the
high-priority allergy alert (acknowledge-before-dismiss).
"""
import datetime

from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from .models import (
    KardexMedication,
    Notification,
    NurseProfile,
    Patient,
    PatientUpdate,
)


def make_nurse(email, role='staff_nurse'):
    user = User.objects.create_user(username=email, email=email, password='pw-test-1234', first_name=email[:4], last_name='N')
    NurseProfile.objects.create(user=user, role=role, approval_status='approved', is_active_staff=True)
    return user


class PatientUpdateTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.head = make_nurse('head@h.com', 'head_nurse')
        self.staff = make_nurse('staff@h.com', 'staff_nurse')
        self.client.force_authenticate(self.head)
        self.patient = Patient.objects.create(
            patient_code='P1', name='Test Pt', age=40, gender='Male', room='204',
            diagnosis='Obs', admission_date=datetime.date.today(), assigned_nurse=self.staff,
            risk_level='low', allergies=[],
        )

    def test_room_change_writes_a_patient_update_with_before_after(self):
        res = self.client.patch(f'/api/patients/{self.patient.patient_code}/', {'room': '310'}, format='json')
        self.assertEqual(res.status_code, 200, res.content)
        row = PatientUpdate.objects.get(patient=self.patient, field_name='Room')
        self.assertEqual((row.old_value, row.new_value, row.source), ('204', '310', 'patient_form'))
        self.assertEqual(row.changed_by, self.head)
        # Exposed on the serializer's activity list, newest first.
        self.assertEqual(res.data['activity'][0]['field'], 'Room')
        self.assertEqual(res.data['activity'][0]['to'], '310')

    def test_change_notifies_assigned_nurse_but_not_the_actor(self):
        self.client.patch(f'/api/patients/{self.patient.patient_code}/', {'room': '310'}, format='json')
        self.assertEqual(Notification.objects.filter(recipient=self.staff, event='patient_updated').count(), 1)
        self.assertEqual(Notification.objects.filter(recipient=self.head, event='patient_updated').count(), 0)

    def test_allergy_edit_is_logged_and_sends_a_high_priority_ack_alert(self):
        res = self.client.patch(
            f'/api/patients/{self.patient.patient_code}/', {'allergies': ['Penicillin', '']}, format='json',
        )
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data['allergies'], ['Penicillin'])  # blank trimmed
        self.assertTrue(PatientUpdate.objects.filter(patient=self.patient, field_name='Allergies').exists())
        alert = Notification.objects.get(recipient=self.staff, event='patient_updated')
        self.assertEqual(alert.notification_type, 'critical')
        self.assertEqual(alert.priority, 'high')
        self.assertTrue(alert.requires_ack)

    def test_high_priority_alert_cannot_be_dismissed_until_acknowledged(self):
        self.client.patch(f'/api/patients/{self.patient.patient_code}/', {'allergies': ['Latex']}, format='json')
        self.client.force_authenticate(self.staff)
        alert = Notification.objects.get(recipient=self.staff, requires_ack=True)
        # Dismiss is refused while unacknowledged.
        res = self.client.post(f'/api/notifications/{alert.id}/mark_read/')
        self.assertEqual(res.status_code, 400)
        alert.refresh_from_db()
        self.assertFalse(alert.is_read)
        # Acknowledge marks it acknowledged and read.
        res = self.client.post(f'/api/notifications/{alert.id}/acknowledge/')
        self.assertEqual(res.status_code, 200, res.content)
        alert.refresh_from_db()
        self.assertIsNotNone(alert.acknowledged_at)
        self.assertTrue(alert.is_read)

    def test_mark_all_read_leaves_unacknowledged_alerts_unread(self):
        self.client.patch(f'/api/patients/{self.patient.patient_code}/', {'allergies': ['Sulfa']}, format='json')
        self.client.force_authenticate(self.staff)
        self.client.post('/api/notifications/mark_all_read/')
        self.assertTrue(Notification.objects.get(recipient=self.staff, requires_ack=True).is_read is False)

    def test_kardex_medication_add_writes_to_patient_history(self):
        res = self.client.post(
            '/api/kardex-medications/',
            {'patientId': 'P1', 'medicationName': 'Paracetamol', 'dose': '500mg', 'startDate': str(datetime.date.today())},
            format='json',
        )
        self.assertEqual(res.status_code, 201, res.content)
        row = PatientUpdate.objects.filter(patient=self.patient, field_name='Medication', source='kardex').first()
        self.assertIsNotNone(row)
        self.assertIn('Paracetamol', row.new_value)
