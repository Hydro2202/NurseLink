"""
GET /api/workload/'s optional filters — start_date/end_date, department,
shift, nurse — added for the head nurse dashboard's filter bar (see
utils/dashboardFilters.ts on both frontends). All default to the
pre-existing unfiltered behaviour when left out; see tests_workload_view.py
for that behaviour itself, which this file does not re-test.
"""
import datetime

from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from .duty_status import local_today
from .models import Department, DutyAssignment, NurseProfile, Task


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


class WorkloadFilterTests(TestCase):
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
        self.icu = Department.objects.create(name='ICU')
        self.er = Department.objects.create(name='ER')

    def test_no_filters_matches_the_unfiltered_response(self):
        make_nurse('ben@hospital.com', 'Ben', 'Diaz')
        unfiltered = self.client.get('/api/workload/').json()
        filtered = self.client.get('/api/workload/', {}).json()
        self.assertEqual(unfiltered, filtered)

    def test_invalid_start_date_is_a_400(self):
        response = self.client.get('/api/workload/', {'start_date': 'not-a-date'})
        self.assertEqual(response.status_code, 400)

    def test_invalid_end_date_is_a_400(self):
        response = self.client.get('/api/workload/', {'end_date': '2026-13-40'})
        self.assertEqual(response.status_code, 400)

    def test_start_after_end_is_a_400(self):
        response = self.client.get(
            '/api/workload/', {'start_date': '2026-03-10', 'end_date': '2026-03-01'}
        )
        self.assertEqual(response.status_code, 400)

    def test_department_filter_scopes_to_nurses_on_that_duty_department(self):
        icu_nurse = make_nurse('icu@hospital.com', 'Ivy', 'Cruz')
        er_nurse = make_nurse('er@hospital.com', 'Eli', 'Reyes')
        DutyAssignment.objects.create(
            nurse=icu_nurse, department=self.icu, duty_date=local_today(), shift='morning',
            start_time=datetime.time(7, 0), end_time=datetime.time(15, 0),
        )
        DutyAssignment.objects.create(
            nurse=er_nurse, department=self.er, duty_date=local_today(), shift='morning',
            start_time=datetime.time(7, 0), end_time=datetime.time(15, 0),
        )

        response = self.client.get('/api/workload/', {'department': self.icu.pk})
        self.assertEqual(response.status_code, 200)
        emails = {row['nurseEmail'] for row in response.json()}
        self.assertEqual(emails, {'icu@hospital.com'})

    def test_shift_filter_scopes_to_nurses_on_that_duty_shift(self):
        morning_nurse = make_nurse('morning@hospital.com', 'Mo', 'Rning')
        night_nurse = make_nurse('night@hospital.com', 'Ni', 'Ght')
        DutyAssignment.objects.create(
            nurse=morning_nurse, department=self.icu, duty_date=local_today(), shift='morning',
            start_time=datetime.time(7, 0), end_time=datetime.time(15, 0),
        )
        DutyAssignment.objects.create(
            nurse=night_nurse, department=self.icu, duty_date=local_today(), shift='night',
            start_time=datetime.time(23, 0), end_time=datetime.time(7, 0),
        )

        response = self.client.get('/api/workload/', {'shift': 'night'})
        self.assertEqual(response.status_code, 200)
        emails = {row['nurseEmail'] for row in response.json()}
        self.assertEqual(emails, {'night@hospital.com'})

    def test_nurse_filter_scopes_to_exactly_that_nurse(self):
        nurse = make_nurse('ben@hospital.com', 'Ben', 'Diaz')
        make_nurse('cora@hospital.com', 'Cora', 'Reyes')

        response = self.client.get('/api/workload/', {'nurse': nurse.pk})
        self.assertEqual(response.status_code, 200)
        rows = response.json()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['nurseEmail'], 'ben@hospital.com')

    def test_non_numeric_nurse_filter_matches_nothing_rather_than_erroring(self):
        make_nurse('ben@hospital.com', 'Ben', 'Diaz')
        response = self.client.get('/api/workload/', {'nurse': 'not-an-id'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [])

    def test_non_numeric_department_filter_matches_nothing_rather_than_everyone(self):
        make_nurse('ben@hospital.com', 'Ben', 'Diaz')
        response = self.client.get('/api/workload/', {'department': 'not-an-id'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [])

    def test_unknown_department_id_matches_nothing_rather_than_everyone(self):
        make_nurse('ben@hospital.com', 'Ben', 'Diaz')
        response = self.client.get('/api/workload/', {'department': 999999})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [])

    def test_date_range_scopes_task_counts_to_tasks_created_in_that_window(self):
        nurse = make_nurse('ben@hospital.com', 'Ben', 'Diaz')
        in_range = Task.objects.create(
            task_code='T900', title='In range', assigned_to='Ben Diaz', assigned_nurse=nurse,
        )
        in_range.created_at = datetime.datetime(2026, 3, 5, 10, 0, tzinfo=datetime.timezone.utc)
        in_range.save(update_fields=['created_at'])
        out_of_range = Task.objects.create(
            task_code='T901', title='Out of range', assigned_to='Ben Diaz', assigned_nurse=nurse,
        )
        out_of_range.created_at = datetime.datetime(2026, 1, 1, 10, 0, tzinfo=datetime.timezone.utc)
        out_of_range.save(update_fields=['created_at'])

        response = self.client.get(
            '/api/workload/', {'start_date': '2026-03-01', 'end_date': '2026-03-10'}
        )
        self.assertEqual(response.status_code, 200)
        row = next(r for r in response.json() if r['nurseEmail'] == 'ben@hospital.com')
        self.assertEqual(row['taskCount'], 1)
