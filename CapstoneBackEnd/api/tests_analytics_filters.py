"""
GET /api/analytics/'s optional filters — start_date/end_date, department,
shift, nurse, risk — added for the head nurse dashboard's filter bar (see
utils/dashboardFilters.ts on both frontends). All default to the
pre-existing unfiltered (last-7-days-by-default, otherwise all-time) view
when left out.
"""
import datetime

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from .duty_status import local_today
from .models import Department, DutyAssignment, NurseProfile, Patient, Task


def make_nurse(email, first, last):
    user = User.objects.create_user(
        username=email, email=email, password='pw-test-1234', first_name=first, last_name=last,
    )
    NurseProfile.objects.create(
        user=user, role='staff_nurse', department='ICU', approval_status='approved', is_active_staff=True,
    )
    return user


def make_patient(code, **extra):
    fields = dict(
        patient_code=code, name='Patient', age=50, gender='Male',
        room='100', diagnosis='Observation', admission_date=timezone.localdate(),
    )
    fields.update(extra)
    return Patient.objects.create(**fields)


class AnalyticsFilterTests(TestCase):
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
        unfiltered = self.client.get('/api/analytics/').json()
        default = self.client.get('/api/analytics/', {}).json()
        self.assertEqual(unfiltered, default)

    def test_staff_nurse_cannot_read_analytics(self):
        # Analytics is head-nurse-only — unlike /api/workload/, nothing on
        # the staff side reads this endpoint, and the page it feeds
        # (analytics.tsx) redirects a staff nurse away client-side too.
        staff = make_nurse('ben@hospital.com', 'Ben', 'Diaz')
        self.client.force_authenticate(staff)
        response = self.client.get('/api/analytics/')
        self.assertEqual(response.status_code, 403)

    def test_admin_has_read_only_access(self):
        admin = User.objects.create_user(
            username='admin@hospital.com', email='admin@hospital.com',
            password='pw-test-1234', is_staff=True,
        )
        self.client.force_authenticate(admin)
        response = self.client.get('/api/analytics/')
        self.assertEqual(response.status_code, 200)

    def test_invalid_start_date_is_a_400(self):
        response = self.client.get('/api/analytics/', {'start_date': 'nope'})
        self.assertEqual(response.status_code, 400)

    def test_invalid_end_date_is_a_400(self):
        response = self.client.get('/api/analytics/', {'end_date': '2026-02-30'})
        self.assertEqual(response.status_code, 400)

    def test_start_after_end_is_a_400(self):
        response = self.client.get(
            '/api/analytics/', {'start_date': '2026-03-10', 'end_date': '2026-03-01'}
        )
        self.assertEqual(response.status_code, 400)

    def test_date_range_scopes_total_tasks_to_the_window(self):
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
            '/api/analytics/', {'start_date': '2026-03-01', 'end_date': '2026-03-10'}
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['kpis']['totalTasks'], 1)

    def test_department_filter_scopes_task_types_to_that_departments_patients(self):
        icu_patient = make_patient('P900', department=self.icu)
        er_patient = make_patient('P901', department=self.er)
        Task.objects.create(task_code='T900', title='ICU task', assigned_to='X', patient=icu_patient)
        Task.objects.create(task_code='T901', title='ER task', assigned_to='X', patient=er_patient)

        response = self.client.get('/api/analytics/', {'department': self.icu.pk})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['kpis']['totalTasks'], 1)

    def test_risk_filter_scopes_to_tasks_whose_patient_has_that_risk_level(self):
        high_risk = make_patient('P900', risk_level='high')
        low_risk = make_patient('P901', risk_level='low')
        Task.objects.create(task_code='T900', title='High risk task', assigned_to='X', patient=high_risk)
        Task.objects.create(task_code='T901', title='Low risk task', assigned_to='X', patient=low_risk)

        response = self.client.get('/api/analytics/', {'risk': 'high'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['kpis']['totalTasks'], 1)

    def test_nurse_filter_scopes_to_that_nurses_tasks(self):
        nurse = make_nurse('ben@hospital.com', 'Ben', 'Diaz')
        other = make_nurse('cora@hospital.com', 'Cora', 'Reyes')
        Task.objects.create(task_code='T900', title='Ben task', assigned_to='Ben Diaz', assigned_nurse=nurse)
        Task.objects.create(task_code='T901', title='Cora task', assigned_to='Cora Reyes', assigned_nurse=other)

        response = self.client.get('/api/analytics/', {'nurse': nurse.pk})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['kpis']['totalTasks'], 1)

    def test_shift_filter_is_resolved_from_real_duty_assignments(self):
        # The exact bug report this guards against: Delay by Shift (and the
        # general shift filter) used to read the stale NurseProfile.shift
        # default instead of the real Duty Roster.
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
        Task.objects.create(
            task_code='T900', title='Morning task', assigned_to='Mo Rning', assigned_nurse=morning_nurse,
        )
        Task.objects.create(
            task_code='T901', title='Night task', assigned_to='Ni Ght', assigned_nurse=night_nurse,
        )

        response = self.client.get('/api/analytics/', {'shift': 'night'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['kpis']['totalTasks'], 1)

    def test_delay_by_shift_counts_overdue_tasks_for_nurses_actually_on_that_duty_shift(self):
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
        Task.objects.create(
            task_code='T900', title='Overdue morning', assigned_to='Mo Rning',
            assigned_nurse=morning_nurse, status='overdue',
        )
        Task.objects.create(
            task_code='T901', title='Overdue night', assigned_to='Ni Ght',
            assigned_nurse=night_nurse, status='overdue',
        )

        response = self.client.get('/api/analytics/').json()
        delay_by_label = {row['label']: row['value'] for row in response['delayData']}
        self.assertEqual(delay_by_label['Morning'], 1)
        self.assertEqual(delay_by_label['Night'], 1)
        self.assertEqual(delay_by_label['Afternoon'], 0)

    def test_non_numeric_nurse_filter_matches_nothing_rather_than_everyone(self):
        nurse = make_nurse('ben@hospital.com', 'Ben', 'Diaz')
        Task.objects.create(task_code='T900', title='Ben task', assigned_to='Ben Diaz', assigned_nurse=nurse)

        response = self.client.get('/api/analytics/', {'nurse': 'not-an-id'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['kpis']['totalTasks'], 0)

    def test_non_numeric_department_filter_matches_nothing_rather_than_everyone(self):
        patient = make_patient('P900', department=self.icu)
        Task.objects.create(task_code='T900', title='ICU task', assigned_to='X', patient=patient)

        response = self.client.get('/api/analytics/', {'department': 'not-an-id'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['kpis']['totalTasks'], 0)

    def test_custom_range_wider_than_30_days_is_clamped(self):
        response = self.client.get(
            '/api/analytics/', {'start_date': '2026-01-01', 'end_date': '2026-06-01'}
        )
        self.assertEqual(response.status_code, 200)
        # 31 days of per-day completion bars, not the full ~150-day span.
        self.assertEqual(len(response.json()['taskCompletion']), 31)
