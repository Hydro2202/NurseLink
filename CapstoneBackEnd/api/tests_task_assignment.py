"""
Task assignments are corrected, never deleted, from the normal API surface.

A wrong nurse-to-task assignment used to be fixed by hard-deleting the Task
row, which erased its history along with the mistake. These tests pin the
replacement: DELETE is rejected outright (even for a direct API call, not
just hidden in the UI), and `unassign` — supervisor only — clears the nurse
and returns the task to pending while keeping the row and its task_code.
"""

import datetime

from django.contrib.auth.models import User
from django.core.cache import cache
from rest_framework.test import APITestCase

from .models import NurseProfile, Patient, Task


def make_user(email, first, last, role):
    user = User.objects.create_user(
        username=email, email=email, password='pw-test-1234',
        first_name=first, last_name=last,
    )
    NurseProfile.objects.create(user=user, role=role, department='Med-Surg')
    return user


class TaskAssignmentTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.supervisor = make_user('sup@hospital.com', 'Maria', 'Santos', 'head_nurse')
        self.nurse = make_user('nurse@hospital.com', 'Ben', 'Diaz', 'staff_nurse')
        self.other_nurse = make_user('other@hospital.com', 'Cora', 'Reyes', 'staff_nurse')
        self.patient = Patient.objects.create(
            patient_code='P700', name='Juan Dela Cruz', age=61, gender='Male',
            room='204-B', diagnosis='CHF', admission_date=datetime.date(2026, 3, 2),
            risk_level='medium', attending_physician='Dr. Lim',
        )
        self.task = Task.objects.create(
            task_code='T700',
            patient=self.patient,
            patient_name=self.patient.name,
            title='Check vitals',
            assigned_to='Ben Diaz',
            assigned_nurse=self.nurse,
            status='in_progress',
        )

    def test_delete_is_rejected_even_as_supervisor(self):
        self.client.force_authenticate(user=self.supervisor)
        response = self.client.delete('/api/tasks/T700/')
        self.assertEqual(response.status_code, 405)
        self.task.refresh_from_db()  # still there

    def test_unassign_requires_supervisor(self):
        self.client.force_authenticate(user=self.other_nurse)
        response = self.client.post('/api/tasks/T700/unassign/')
        self.assertEqual(response.status_code, 403)
        self.task.refresh_from_db()
        self.assertEqual(self.task.assigned_nurse_id, self.nurse.pk)

    def test_supervisor_unassign_clears_nurse_and_keeps_task(self):
        self.client.force_authenticate(user=self.supervisor)
        response = self.client.post('/api/tasks/T700/unassign/')
        self.assertEqual(response.status_code, 200)

        self.task.refresh_from_db()
        self.assertIsNone(self.task.assigned_nurse)
        self.assertEqual(self.task.assigned_to, '')
        self.assertEqual(self.task.status, 'pending')
        # The row survives — same task_code, not a new one.
        self.assertTrue(Task.objects.filter(task_code='T700').exists())

    def test_unassigning_a_completed_task_does_not_reopen_it(self):
        self.task.status = 'completed'
        self.task.save(update_fields=['status'])

        self.client.force_authenticate(user=self.supervisor)
        response = self.client.post('/api/tasks/T700/unassign/')
        self.assertEqual(response.status_code, 200)

        self.task.refresh_from_db()
        self.assertIsNone(self.task.assigned_nurse)


class TaskScopingIdorTests(APITestCase):
    """A staff nurse must never be able to reach another nurse's task by
    adding ?assignedTo=<their name> — not to view it, and not to act on it."""

    def setUp(self):
        cache.clear()
        self.nurse = make_user('nurse@hospital.com', 'Ben', 'Diaz', 'staff_nurse')
        self.other_nurse = make_user('other@hospital.com', 'Cora', 'Reyes', 'staff_nurse')
        self.supervisor = make_user('sup@hospital.com', 'Maria', 'Santos', 'head_nurse')
        self.patient = Patient.objects.create(
            patient_code='P701', name='Juan Dela Cruz', age=61, gender='Male',
            room='204-B', diagnosis='CHF', admission_date=datetime.date(2026, 3, 2),
            risk_level='medium', attending_physician='Dr. Lim',
        )
        self.others_task = Task.objects.create(
            task_code='T701', patient=self.patient, patient_name=self.patient.name,
            title='Check vitals', assigned_to='Cora Reyes', assigned_nurse=self.other_nurse,
        )

    def test_a_staff_nurse_cannot_list_another_nurses_tasks_via_assignedto(self):
        self.client.force_authenticate(user=self.nurse)
        response = self.client.get('/api/tasks/?assignedTo=Cora Reyes')
        self.assertEqual(response.status_code, 200)
        self.assertEqual([t['id'] for t in response.data], [])

    def test_a_staff_nurse_cannot_retrieve_another_nurses_task_via_assignedto(self):
        self.client.force_authenticate(user=self.nurse)
        response = self.client.get('/api/tasks/T701/?assignedTo=Cora Reyes')
        self.assertEqual(response.status_code, 404)

    def test_a_staff_nurse_cannot_complete_another_nurses_task_via_assignedto(self):
        checked = [{**item, 'done': True} for item in self.others_task.checklist]
        self.others_task.checklist = checked
        self.others_task.save(update_fields=['checklist'])

        self.client.force_authenticate(user=self.nurse)
        response = self.client.post('/api/tasks/T701/complete/?assignedTo=Cora Reyes')
        self.assertEqual(response.status_code, 404)

        self.others_task.refresh_from_db()
        self.assertNotEqual(self.others_task.status, 'completed')

    def test_head_nurse_can_still_filter_by_assignedto(self):
        """The fix must not break the legitimate head-nurse use of this filter."""
        self.client.force_authenticate(user=self.supervisor)
        response = self.client.get('/api/tasks/?assignedTo=Cora Reyes')
        self.assertEqual(response.status_code, 200)
        self.assertEqual([t['id'] for t in response.data], ['T701'])
