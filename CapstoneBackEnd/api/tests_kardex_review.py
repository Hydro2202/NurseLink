"""
Kardex supervisor approval.

There is no edit-in-place endpoint for a kardex (create + delete only, by
design — see the comment on KardexRecord.STATUS_CHOICES), so these tests
pin the workflow that exists instead: every kardex is born 'submitted',
only a supervisor can move it to approved/returned/rejected, a decision
can't be made twice, and a returned/rejected review requires a reason a
staff nurse could actually act on.
"""

import datetime

from django.contrib.auth.models import User
from django.core.cache import cache
from rest_framework.test import APITestCase

from .models import KardexRecord, NurseProfile, Notification, Patient


def make_user(email, first, last, role):
    user = User.objects.create_user(
        username=email, email=email, password='pw-test-1234',
        first_name=first, last_name=last,
    )
    NurseProfile.objects.create(user=user, role=role, department='Med-Surg')
    return user


class KardexReviewTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.nurse = make_user('nurse@hospital.com', 'Ben', 'Diaz', 'staff_nurse')
        self.other_nurse = make_user('other@hospital.com', 'Cora', 'Reyes', 'staff_nurse')
        self.supervisor = make_user('sup@hospital.com', 'Maria', 'Santos', 'head_nurse')
        self.patient = Patient.objects.create(
            patient_code='P800', name='Juan Dela Cruz', age=61, gender='Male',
            room='204-B', diagnosis='CHF', admission_date=datetime.date(2026, 3, 2),
            risk_level='medium', attending_physician='Dr. Lim',
        )
        self.kardex = KardexRecord.objects.create(
            patient=self.patient, last_name='Dela Cruz', first_name='Juan',
            room='204-B', saved_by=self.nurse, saved_by_name='Ben Diaz',
        )

    def review(self, user, decision, notes=''):
        self.client.force_authenticate(user=user)
        return self.client.post(
            f'/api/kardex/{self.kardex.pk}/review/', {'decision': decision, 'notes': notes},
        )

    def test_new_kardex_is_submitted_by_default(self):
        self.assertEqual(self.kardex.status, 'submitted')

    def test_staff_nurse_cannot_review(self):
        response = self.review(self.other_nurse, 'approved')
        self.assertEqual(response.status_code, 403)
        self.kardex.refresh_from_db()
        self.assertEqual(self.kardex.status, 'submitted')

    def test_supervisor_can_approve(self):
        response = self.review(self.supervisor, 'approved')
        self.assertEqual(response.status_code, 200)

        self.kardex.refresh_from_db()
        self.assertEqual(self.kardex.status, 'approved')
        self.assertEqual(self.kardex.reviewed_by, self.supervisor)
        self.assertIsNotNone(self.kardex.reviewed_at)

    def test_return_without_notes_is_rejected(self):
        response = self.review(self.supervisor, 'returned', notes='')
        self.assertEqual(response.status_code, 400)
        self.kardex.refresh_from_db()
        self.assertEqual(self.kardex.status, 'submitted')

    def test_return_with_notes_records_the_reason(self):
        response = self.review(self.supervisor, 'returned', notes='Missing admitting diagnosis.')
        self.assertEqual(response.status_code, 200)

        self.kardex.refresh_from_db()
        self.assertEqual(self.kardex.status, 'returned')
        self.assertEqual(self.kardex.review_notes, 'Missing admitting diagnosis.')

    def test_cannot_review_an_already_reviewed_kardex(self):
        first = self.review(self.supervisor, 'approved')
        self.assertEqual(first.status_code, 200)

        second = self.review(self.supervisor, 'rejected', notes='Changed my mind')
        self.assertEqual(second.status_code, 409)
        self.kardex.refresh_from_db()
        self.assertEqual(self.kardex.status, 'approved')  # unchanged

    def test_review_notifies_the_nurse_who_saved_it(self):
        self.review(self.supervisor, 'returned', notes='Please add vitals.')

        notification = Notification.objects.filter(recipient=self.nurse).first()
        self.assertIsNotNone(notification)
        self.assertIn('Please add vitals.', notification.message)

    def test_status_filter_scopes_the_review_queue(self):
        KardexRecord.objects.create(
            patient=self.patient, last_name='Dela Cruz', first_name='Juan',
            room='204-B', saved_by=self.nurse, saved_by_name='Ben Diaz', status='approved',
        )
        self.client.force_authenticate(user=self.supervisor)
        response = self.client.get('/api/kardex/?status=submitted')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]['id'], str(self.kardex.pk))
