"""
A task checklist assists a nurse; it never decides anything on its own (see
default_task_checklist in models.py) — but the one thing it IS allowed to do
is stop a task from being marked complete while a step is still unchecked.
These tests pin that gate, and its escape hatch: a task with no checklist
at all is never blocked.
"""

import datetime

from django.contrib.auth.models import User
from django.core.cache import cache
from rest_framework.test import APITestCase

from .models import NurseProfile, Patient, Task


def make_nurse(email, first, last):
    user = User.objects.create_user(
        username=email, email=email, password='pw-test-1234',
        first_name=first, last_name=last,
    )
    NurseProfile.objects.create(user=user, role='staff_nurse', department='Med-Surg')
    return user


class TaskChecklistTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.nurse = make_nurse('nurse@hospital.com', 'Ben', 'Diaz')
        self.patient = Patient.objects.create(
            patient_code='P900', name='Juan Dela Cruz', age=61, gender='Male',
            room='204-B', diagnosis='CHF', admission_date=datetime.date(2026, 3, 2),
            risk_level='medium', attending_physician='Dr. Lim',
        )
        self.client.force_authenticate(user=self.nurse)

    def test_new_task_gets_the_default_checklist(self):
        task = Task.objects.create(
            task_code='T900', patient=self.patient, patient_name=self.patient.name,
            title='Check vitals', assigned_to='Ben Diaz', assigned_nurse=self.nurse,
        )
        self.assertEqual(len(task.checklist), 6)
        self.assertTrue(all(item['done'] is False for item in task.checklist))

    def test_complete_is_rejected_with_unfinished_items(self):
        task = Task.objects.create(
            task_code='T901', patient=self.patient, patient_name=self.patient.name,
            title='Check vitals', assigned_to='Ben Diaz', assigned_nurse=self.nurse,
        )
        response = self.client.post('/api/tasks/T901/complete/')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(len(response.data['unfinishedChecklistItems']), 6)
        task.refresh_from_db()
        self.assertEqual(task.status, 'pending')

    def test_complete_succeeds_once_every_item_is_checked(self):
        task = Task.objects.create(
            task_code='T902', patient=self.patient, patient_name=self.patient.name,
            title='Check vitals', assigned_to='Ben Diaz', assigned_nurse=self.nurse,
        )
        checked = [{**item, 'done': True} for item in task.checklist]
        patch = self.client.patch('/api/tasks/T902/', {'checklist': checked}, format='json')
        self.assertEqual(patch.status_code, 200)

        response = self.client.post('/api/tasks/T902/complete/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['status'], 'completed')

    def test_task_with_no_checklist_is_never_blocked(self):
        task = Task.objects.create(
            task_code='T903', patient=self.patient, patient_name=self.patient.name,
            title='Check vitals', assigned_to='Ben Diaz', assigned_nurse=self.nurse,
            checklist=[],
        )
        response = self.client.post('/api/tasks/T903/complete/')
        self.assertEqual(response.status_code, 200)

    def test_partially_checked_task_is_still_rejected(self):
        task = Task.objects.create(
            task_code='T904', patient=self.patient, patient_name=self.patient.name,
            title='Check vitals', assigned_to='Ben Diaz', assigned_nurse=self.nurse,
        )
        partial = list(task.checklist)
        partial[0] = {**partial[0], 'done': True}
        self.client.patch('/api/tasks/T904/', {'checklist': partial}, format='json')

        response = self.client.post('/api/tasks/T904/complete/')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(len(response.data['unfinishedChecklistItems']), 5)
