"""
Only the people on a referral may change it.

Editing a referral (SBAR, recipient) is the sender's alone; deleting it is the
sender's or the receiver's — the two people the app shows a delete button to.
Any other nurse in the ward could previously rewrite or delete it.
"""

from django.contrib.auth.models import User
from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from .models import Department, HandoverNote, NurseProfile, Patient


def make_nurse(email, first, role='staff_nurse'):
    user = User.objects.create_user(
        username=email, email=email, password='pw-test-1234', first_name=first, last_name='Nurse',
    )
    NurseProfile.objects.create(
        user=user, role=role, department='ICU', approval_status='approved', is_active_staff=True,
    )
    return user


class ReferralOwnershipTests(TestCase):
    def setUp(self):
        cache.clear()
        self.sender = make_nurse('sender@hospital.com', 'Ana')
        self.receiver = make_nurse('receiver@hospital.com', 'Ben')
        self.outsider = make_nurse('outsider@hospital.com', 'Cara')
        self.head = make_nurse('head@hospital.com', 'Dana', role='head_nurse')
        dept = Department.objects.get_or_create(name='Referral Ownership Ward')[0]
        today = timezone.localdate()
        patient = Patient.objects.create(
            patient_code='P-RO1', name='Juan Dela Cruz', age=61, gender='Male', room='204-B',
            diagnosis='CHF', admission_date=today, risk_level='medium',
            attending_physician='Dr. Lim', department=dept, assigned_nurse=self.sender,
        )
        self.referral = HandoverNote.objects.create(
            handover_code='H-RO1', patient=patient, patient_name=patient.name, shift='morning',
            date=today, nurse_from='Ana Nurse', nurse_to='Ben Nurse', nurse_to_user=self.receiver,
            situation='original situation', status='sent', created_by=self.sender,
        )
        self.url = f'/api/handovers/{self.referral.handover_code}/'

    def client_for(self, user):
        client = APIClient()
        client.force_authenticate(user)
        return client

    def test_outsider_cannot_edit(self):
        res = self.client_for(self.outsider).patch(
            self.url, {'nurseTo': 'Cara Nurse', 'sbar': {'situation': 'tampered'}}, format='json',
        )
        self.assertEqual(res.status_code, 403)
        self.referral.refresh_from_db()
        self.assertEqual(self.referral.situation, 'original situation')
        self.assertEqual(self.referral.nurse_to, 'Ben Nurse')

    def test_outsider_cannot_replace_with_put(self):
        res = self.client_for(self.outsider).put(self.url, {'nurseTo': 'Cara Nurse'}, format='json')
        self.assertEqual(res.status_code, 403)

    def test_receiver_cannot_edit(self):
        res = self.client_for(self.receiver).patch(self.url, {'nurseTo': 'Someone'}, format='json')
        self.assertEqual(res.status_code, 403)

    def test_sender_can_edit(self):
        res = self.client_for(self.sender).patch(
            self.url, {'sbar': {'situation': 'updated by sender'}}, format='json',
        )
        self.assertEqual(res.status_code, 200, res.content)

    def test_outsider_cannot_delete(self):
        res = self.client_for(self.outsider).delete(self.url)
        self.assertEqual(res.status_code, 403)
        self.assertTrue(HandoverNote.objects.filter(pk=self.referral.pk).exists())

    def test_head_nurse_cannot_delete(self):
        res = self.client_for(self.head).delete(self.url)
        self.assertEqual(res.status_code, 403)
        self.assertTrue(HandoverNote.objects.filter(pk=self.referral.pk).exists())

    def test_sender_can_delete(self):
        res = self.client_for(self.sender).delete(self.url)
        self.assertEqual(res.status_code, 204)
        self.assertFalse(HandoverNote.objects.filter(pk=self.referral.pk).exists())

    def test_receiver_can_delete(self):
        res = self.client_for(self.receiver).delete(self.url)
        self.assertEqual(res.status_code, 204)
        self.assertFalse(HandoverNote.objects.filter(pk=self.referral.pk).exists())

    def test_outsider_can_still_read(self):
        # Reading is unchanged: the ward shares referral visibility.
        res = self.client_for(self.outsider).get(self.url)
        self.assertEqual(res.status_code, 200)
