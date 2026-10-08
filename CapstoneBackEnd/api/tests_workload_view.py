"""
GET /api/workload/ — the supervisor's Assign action on this page is the only
UI path to NurseViewSet.assign (department/shift reassignment). Several
nurses on this ward share a display name, so nurseEmail has to be in the
response — without it a supervisor reassigning "Raiden Villapando" here has
no way to tell which of several accounts they just picked.

Also pins the patient/task counting itself: a bulk-query rewrite (to fix an
N+1 — 3 queries per nurse in a loop) must reproduce the exact same matching
rule the original per-nurse queries had, including the double-counting of a
free-text-assigned task across same-named nurses.
"""

import datetime

from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from .models import NurseProfile, Patient, Task


def make_nurse(email, first, last, *, department='ICU', shift='morning'):
    user = User.objects.create_user(
        username=email, email=email, password='pw-test-1234',
        first_name=first, last_name=last,
    )
    NurseProfile.objects.create(
        user=user, role='staff_nurse', department=department, shift=shift,
        approval_status='approved', is_active_staff=True,
    )
    return user


class WorkloadViewTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.supervisor = User.objects.create_user(
            username='sup@hospital.com', email='sup@hospital.com',
            password='pw-test-1234', first_name='Ana', last_name='Cruz',
        )
        NurseProfile.objects.create(
            user=self.supervisor, role='head_nurse', approval_status='approved', is_active_staff=True,
        )
        self.client.force_authenticate(self.supervisor)

    def test_each_nurse_row_includes_their_email(self):
        make_nurse('raiden41@hospital.com', 'Raiden', 'Villapando')
        response = self.client.get('/api/workload/')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.data[0]['nurseEmail'], 'raiden41@hospital.com')

    def test_same_named_nurses_are_distinguishable_by_email(self):
        # The exact bug report this guards against: several accounts share a
        # display name, so the email is the only thing that tells them apart
        # in the Assign list.
        make_nurse('raiden41@hospital.com', 'Raiden', 'Villapando', department='ICU')
        make_nurse('raiden42@hospital.com', 'Raiden', 'Villapando', department='ER')

        response = self.client.get('/api/workload/')
        rows = [row for row in response.data if row['nurseName'] == 'Raiden Villapando']
        self.assertEqual(len(rows), 2)
        emails = {row['nurseEmail'] for row in rows}
        self.assertEqual(emails, {'raiden41@hospital.com', 'raiden42@hospital.com'})

    def test_patient_count_matches_the_assigned_nurse_fk(self):
        nurse = make_nurse('ben@hospital.com', 'Ben', 'Diaz')
        other = make_nurse('cora@hospital.com', 'Cora', 'Reyes')
        for i in range(3):
            Patient.objects.create(
                patient_code=f'P90{i}', name=f'Patient {i}', age=50, gender='Male',
                room=f'20{i}', diagnosis='x', admission_date=datetime.date(2026, 3, 1),
                assigned_nurse=nurse,
            )
        Patient.objects.create(
            patient_code='P910', name='Other patient', age=50, gender='Male',
            room='210', diagnosis='x', admission_date=datetime.date(2026, 3, 1),
            assigned_nurse=other,
        )

        response = self.client.get('/api/workload/')
        row = next(r for r in response.data if r['nurseEmail'] == 'ben@hospital.com')
        self.assertEqual(row['patientCount'], 3)

    def test_task_count_matches_via_fk_and_via_free_text_name(self):
        nurse = make_nurse('ben@hospital.com', 'Ben', 'Diaz')
        Task.objects.create(
            task_code='T900', title='FK-assigned', assigned_to='Ben Diaz', assigned_nurse=nurse,
        )
        Task.objects.create(
            task_code='T901', title='Name-only assigned', assigned_to='Ben Diaz',
            status='completed',
        )
        Task.objects.create(
            task_code='T902', title='Someone else entirely', assigned_to='Nobody Here',
        )

        response = self.client.get('/api/workload/')
        row = next(r for r in response.data if r['nurseEmail'] == 'ben@hospital.com')
        self.assertEqual(row['taskCount'], 2)
        self.assertEqual(row['completedTasks'], 1)

    def test_a_name_only_task_counts_for_every_same_named_nurse_independently(self):
        # Pins the existing (not newly introduced) behaviour: with no FK, a
        # free-text-assigned task matches by name alone, so two accounts
        # sharing a display name both get credited for the same task — the
        # N+1 fix must not silently change this.
        make_nurse('raiden41@hospital.com', 'Raiden', 'Villapando', department='ICU')
        make_nurse('raiden42@hospital.com', 'Raiden', 'Villapando', department='ER')
        Task.objects.create(task_code='T903', title='Ambiguous', assigned_to='Raiden Villapando')

        response = self.client.get('/api/workload/')
        rows = [r for r in response.data if r['nurseName'] == 'Raiden Villapando']
        self.assertEqual(len(rows), 2)
        self.assertTrue(all(r['taskCount'] == 1 for r in rows))

    def test_a_nurse_with_no_patients_or_tasks_shows_zero_not_an_error(self):
        make_nurse('lonely@hospital.com', 'Lonely', 'Nurse')
        response = self.client.get('/api/workload/')
        row = next(r for r in response.data if r['nurseEmail'] == 'lonely@hospital.com')
        self.assertEqual(row['patientCount'], 0)
        self.assertEqual(row['taskCount'], 0)
        self.assertEqual(row['completedTasks'], 0)
