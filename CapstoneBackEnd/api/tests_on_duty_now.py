"""
"On duty now" must mean a nurse actually clocked in and within their shift —
not merely that they have an active/approved account. This is the single
backend rule the Head Nurse dashboard's Nurse Overview and the Duty Roster's
"On duty now" both read, so the two can never disagree.
"""
import datetime
from zoneinfo import ZoneInfo

from django.conf import settings
from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from .duty_status import duty_is_on_duty_now, local_today, nurse_ids_on_duty_now
from .models import Department, DutyAssignment, NurseProfile

LOCAL = ZoneInfo(settings.DUTY_LOCAL_TIMEZONE)


def make_nurse(email, role='staff_nurse'):
    user = User.objects.create_user(
        username=email, email=email, password='pw-test-1234',
        first_name=email.split('@')[0].title(), last_name='N',
    )
    NurseProfile.objects.create(user=user, role=role, approval_status='approved', is_active_staff=True)
    return user


def local_dt(y, mo, d, h, mi=0):
    """An aware datetime in the facility's local timezone (what the shift
    times are interpreted in), so a controlled 'now' lines up with them."""
    return timezone.make_aware(datetime.datetime(y, mo, d, h, mi), timezone=LOCAL)


class OnDutyNowTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.head = make_nurse('head@h.com', 'head_nurse')
        self.nurse = make_nurse('alice@h.com')
        self.dept = Department.objects.create(name='ICU')
        # The facility-local calendar day — the same basis the backend uses.
        self.today = local_today()

    def _duty(self, **kw):
        # A full-day window on today's local date, so the current local moment
        # falls inside it regardless of what time the test runs.
        base = dict(
            nurse=self.nurse, department=self.dept, duty_date=self.today,
            shift='morning', start_time=datetime.time(0, 0), end_time=datetime.time(23, 59),
            status='scheduled', created_by=self.head,
        )
        base.update(kw)
        return DutyAssignment.objects.create(**base)

    # --- the four cases from the bug report --------------------------------
    def test_no_assignment_is_off_duty(self):
        self.assertNotIn(self.nurse.pk, nurse_ids_on_duty_now())

    def test_assigned_but_not_clocked_in_is_off_duty(self):
        self._duty(actual_start_time=None, actual_end_time=None)
        self.assertNotIn(self.nurse.pk, nurse_ids_on_duty_now())

    def test_clocked_in_during_shift_is_on_duty(self):
        self._duty(actual_start_time=timezone.now(), actual_end_time=None)
        self.assertIn(self.nurse.pk, nurse_ids_on_duty_now())

    def test_clocked_out_is_off_duty(self):
        self._duty(actual_start_time=timezone.now(), actual_end_time=timezone.now())
        self.assertNotIn(self.nurse.pk, nurse_ids_on_duty_now())

    # --- the per-duty predicate (deterministic, controlled "now") ----------
    def test_predicate_rejects_shift_that_has_not_started(self):
        now = local_dt(2026, 1, 1, 8, 0)
        duty = self._duty(
            duty_date=datetime.date(2026, 1, 1),
            start_time=datetime.time(9, 0), end_time=datetime.time(17, 0),
            actual_start_time=now - datetime.timedelta(hours=2),  # clocked in early
        )
        self.assertFalse(duty_is_on_duty_now(duty, now=now))

    def test_predicate_rejects_forgotten_clockout_hours_past_end(self):
        now = local_dt(2026, 1, 1, 20, 0)
        duty = self._duty(
            duty_date=datetime.date(2026, 1, 1),
            start_time=datetime.time(9, 0), end_time=datetime.time(17, 0),
            actual_start_time=local_dt(2026, 1, 1, 9, 0),
        )
        # 3h past the 17:00 end, beyond the 2h grace -> not on duty.
        self.assertFalse(duty_is_on_duty_now(duty, now=now))

    def test_predicate_accepts_clocked_in_within_shift(self):
        now = local_dt(2026, 1, 1, 12, 0)
        duty = self._duty(
            duty_date=datetime.date(2026, 1, 1),
            start_time=datetime.time(9, 0), end_time=datetime.time(17, 0),
            actual_start_time=local_dt(2026, 1, 1, 9, 0),
        )
        self.assertTrue(duty_is_on_duty_now(duty, now=now))

    def test_cancelled_duty_is_never_on_duty(self):
        now = local_dt(2026, 1, 1, 12, 0)
        duty = self._duty(
            duty_date=datetime.date(2026, 1, 1), status='cancelled',
            start_time=datetime.time(9, 0), end_time=datetime.time(17, 0),
            actual_start_time=local_dt(2026, 1, 1, 9, 0),
        )
        self.assertFalse(duty_is_on_duty_now(duty, now=now))

    # --- the endpoints both screens read ----------------------------------
    def test_workload_endpoint_exposes_onDutyNow(self):
        self._duty(actual_start_time=timezone.now(), actual_end_time=None)
        other = make_nurse('bob@h.com')  # approved + active but no duty
        self.client.force_authenticate(self.head)
        res = self.client.get('/api/workload/')
        self.assertEqual(res.status_code, 200, res.content)
        by_id = {row['nurseId']: row for row in res.data}
        self.assertTrue(by_id[str(self.nurse.pk)]['onDutyNow'])
        self.assertFalse(by_id[str(other.pk)]['onDutyNow'])

    def test_duty_serializer_exposes_isOnDutyNow(self):
        self._duty(actual_start_time=timezone.now(), actual_end_time=None)
        self.client.force_authenticate(self.head)
        res = self.client.get('/api/duty-assignments/')
        self.assertEqual(res.status_code, 200, res.content)
        self.assertTrue(res.data[0]['isOnDutyNow'])
