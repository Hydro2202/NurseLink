"""
/api/nurses/?shift= — the Receiving Nurse picker on the Create Handover Note
modal (and any other same-shift nurse picker) filtered by the real Duty
Roster for the day, not a static NurseProfile.shift default.

The one correctness trap this endpoint has to avoid: a nurse can have more
than one DutyAssignment row for the same day (e.g. reassigned mid-day, or a
data-entry duplicate). Filtering by `pk__in` of a distinct nurse-id subquery
(rather than joining DutyAssignment onto the nurse queryset directly) is
what keeps that from producing duplicate rows in the response — every test
below that creates more than one roster row for a nurse is checking exactly
that.
"""

from datetime import time as dtime
from datetime import timedelta
from zoneinfo import ZoneInfo

from django.conf import settings
from django.contrib.auth.models import User
from django.utils import timezone
from rest_framework.test import APITestCase

from .models import Department, DutyAssignment, NurseProfile


def make_user(email, first, last, *, role='staff_nurse'):
    user = User.objects.create_user(
        username=email, email=email, password='pw-test-1234',
        first_name=first, last_name=last,
    )
    NurseProfile.objects.create(
        user=user, role=role, department='ICU', shift='morning',
        approval_status='approved', is_active_staff=True,
    )
    return user


class NurseShiftFilterTests(APITestCase):
    def setUp(self):
        self.nurse_a = make_user('nursea@hospital.com', 'Juan', 'Dela Cruz')
        self.nurse_b = make_user('nurseb@hospital.com', 'Maria', 'Santos')
        self.nurse_c = make_user('nursec@hospital.com', 'Pedro', 'Reyes')
        self.dept, _ = Department.objects.get_or_create(name='Cardiology Unit')
        # Duty-roster "today" is the facility's local calendar day (see
        # DUTY_LOCAL_TIMEZONE), not Django's own TIME_ZONE (UTC) —
        # timezone.localdate() can be a day off from what NurseViewSet.list's
        # shift filter actually resolves "today" as.
        self.today = timezone.now().astimezone(ZoneInfo(settings.DUTY_LOCAL_TIMEZONE)).date()
        self.client.force_authenticate(user=self.nurse_a)

    def _assign(self, nurse, *, shift='afternoon', date=None, status='scheduled', start=(15, 0), end=(23, 0)):
        return DutyAssignment.objects.create(
            nurse=nurse, department=self.dept, duty_date=date or self.today,
            shift=shift, start_time=dtime(*start), end_time=dtime(*end), status=status,
        )

    def test_shift_filter_lists_only_that_shifts_nurses(self):
        self._assign(self.nurse_b, shift='afternoon')
        self._assign(self.nurse_c, shift='morning', start=(7, 0), end=(15, 0))

        response = self.client.get('/api/nurses/?shift=afternoon')
        self.assertEqual(response.status_code, 200, response.content)
        ids = {row['id'] for row in response.data}
        self.assertIn(str(self.nurse_b.pk), ids)
        self.assertNotIn(str(self.nurse_c.pk), ids)

    def test_shift_filter_excludes_self(self):
        self._assign(self.nurse_a, shift='afternoon')
        response = self.client.get('/api/nurses/?shift=afternoon')
        ids = {row['id'] for row in response.data}
        self.assertNotIn(str(self.nurse_a.pk), ids)

    def test_shift_filter_dedupes_a_nurse_with_two_roster_rows(self):
        # Two afternoon assignments the same day for the same nurse (e.g. a
        # split department assignment) must still surface as one entry.
        self._assign(self.nurse_b, shift='afternoon')
        DutyAssignment.objects.create(
            nurse=self.nurse_b, department=self.dept, duty_date=self.today,
            shift='afternoon', start_time=dtime(15, 0), end_time=dtime(19, 0),
        )
        response = self.client.get('/api/nurses/?shift=afternoon')
        ids = [row['id'] for row in response.data]
        self.assertEqual(ids.count(str(self.nurse_b.pk)), 1)

    def test_shift_filter_excludes_cancelled_assignments(self):
        self._assign(self.nurse_b, shift='afternoon', status='cancelled')
        response = self.client.get('/api/nurses/?shift=afternoon')
        ids = {row['id'] for row in response.data}
        self.assertNotIn(str(self.nurse_b.pk), ids)

    def test_shift_filter_respects_date_param(self):
        tomorrow = self.today + timedelta(days=1)
        self._assign(self.nurse_b, shift='afternoon', date=tomorrow)

        response = self.client.get('/api/nurses/?shift=afternoon')
        self.assertNotIn(str(self.nurse_b.pk), {row['id'] for row in response.data})

        response = self.client.get(f'/api/nurses/?shift=afternoon&date={tomorrow.isoformat()}')
        self.assertIn(str(self.nurse_b.pk), {row['id'] for row in response.data})

    def test_shift_filter_with_no_nurses_scheduled_returns_empty_list(self):
        response = self.client.get('/api/nurses/?shift=night')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, [])

    def test_search_narrows_within_the_shift_filtered_list(self):
        self._assign(self.nurse_b, shift='afternoon')
        self._assign(self.nurse_c, shift='afternoon')

        response = self.client.get('/api/nurses/?shift=afternoon&search=Santos')
        ids = {row['id'] for row in response.data}
        self.assertEqual(ids, {str(self.nurse_b.pk)})

    def test_no_shift_param_returns_the_full_roster(self):
        self._assign(self.nurse_b, shift='afternoon')
        response = self.client.get('/api/nurses/')
        ids = {row['id'] for row in response.data}
        self.assertIn(str(self.nurse_b.pk), ids)
        self.assertIn(str(self.nurse_c.pk), ids)
