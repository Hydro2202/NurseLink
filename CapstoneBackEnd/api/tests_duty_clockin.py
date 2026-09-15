"""
Real clock-in/clock-out on top of a scheduled DutyAssignment.

start_time/end_time stay the plan; actual_start_time/actual_end_time are
when the nurse really worked, and actual_worked_hours/actual_overtime_hours
are derived from those the same way the scheduled hours are derived from the
plan (DutyAssignment.save()) — never trusted as given, always recomputed.
"""

from datetime import time as dtime
from datetime import timedelta
from unittest.mock import patch
from zoneinfo import ZoneInfo

from django.conf import settings
from django.contrib.auth.models import User
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from .models import Department, DutyAssignment, Notification, NurseProfile


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


class DutyClockInOutTests(APITestCase):
    def setUp(self):
        self.supervisor = make_user('sup@hospital.com', 'Ana', 'Cruz', role='head_nurse')
        self.nurse = make_user('nurse@hospital.com', 'Juan', 'Dela Cruz')
        self.other_nurse = make_user('other@hospital.com', 'Maria', 'Santos')
        self.dept, _ = Department.objects.get_or_create(name='Intensive Care Unit (ICU)')

        self.today = timezone.localdate()
        self.assignment = DutyAssignment.objects.create(
            nurse=self.nurse, department=self.dept, duty_date=self.today,
            shift='morning', start_time=dtime(7, 0), end_time=dtime(15, 0),
            created_by=self.supervisor,
        )

    def _at(self, hour, minute=0, day_offset=0):
        # duty_date/start_time/end_time are facility-local wall-clock values
        # (DUTY_LOCAL_TIMEZONE), not UTC — anchor mocked "now" the same way
        # so it lines up with DutyAssignment.scheduled_start_datetime().
        d = self.today + timedelta(days=day_offset)
        return timezone.datetime(d.year, d.month, d.day, hour, minute, tzinfo=ZoneInfo(settings.DUTY_LOCAL_TIMEZONE))

    # ---- ownership ----

    def test_nurse_can_start_their_own_shift(self):
        self.client.force_authenticate(user=self.nurse)
        with patch('django.utils.timezone.now', return_value=self._at(7, 0)):
            response = self.client.post(f'/api/duty-assignments/{self.assignment.pk}/start/')
        self.assertEqual(response.status_code, 200, response.content)
        self.assignment.refresh_from_db()
        self.assertIsNotNone(self.assignment.actual_start_time)

    def test_a_different_nurse_cannot_start_someone_elses_shift(self):
        self.client.force_authenticate(user=self.other_nurse)
        response = self.client.post(f'/api/duty-assignments/{self.assignment.pk}/start/')
        # Scoped out of their own queryset entirely, so this looks like it
        # does not exist rather than leaking that it belongs to someone else.
        self.assertEqual(response.status_code, 404)
        self.assignment.refresh_from_db()
        self.assertIsNone(self.assignment.actual_start_time)

    def test_supervisor_cannot_start_a_nurses_shift_on_their_behalf(self):
        self.client.force_authenticate(user=self.supervisor)
        with patch('django.utils.timezone.now', return_value=self._at(7, 0)):
            response = self.client.post(f'/api/duty-assignments/{self.assignment.pk}/start/')
        self.assertEqual(response.status_code, 403)

    # ---- start validation ----

    def test_cannot_start_more_than_the_buffer_before_scheduled_time(self):
        self.client.force_authenticate(user=self.nurse)
        with patch('django.utils.timezone.now', return_value=self._at(6, 30)):
            response = self.client.post(f'/api/duty-assignments/{self.assignment.pk}/start/')
        self.assertEqual(response.status_code, 400)
        self.assertIn('early', response.json()['detail'].lower())

    @override_settings(DUTY_START_BUFFER_MINUTES=30)
    def test_buffer_is_configurable(self):
        self.client.force_authenticate(user=self.nurse)
        with patch('django.utils.timezone.now', return_value=self._at(6, 35)):
            response = self.client.post(f'/api/duty-assignments/{self.assignment.pk}/start/')
        self.assertEqual(response.status_code, 200, response.content)

    def test_cannot_start_the_same_shift_twice(self):
        self.client.force_authenticate(user=self.nurse)
        with patch('django.utils.timezone.now', return_value=self._at(7, 0)):
            self.client.post(f'/api/duty-assignments/{self.assignment.pk}/start/')
            response = self.client.post(f'/api/duty-assignments/{self.assignment.pk}/start/')
        self.assertEqual(response.status_code, 400)
        self.assertIn('already been started', response.json()['detail'])

    def test_cannot_start_an_assignment_that_is_not_for_today(self):
        future = DutyAssignment.objects.create(
            nurse=self.nurse, department=self.dept, duty_date=self.today + timedelta(days=3),
            shift='morning', start_time=dtime(7, 0), end_time=dtime(15, 0),
        )
        self.client.force_authenticate(user=self.nurse)
        response = self.client.post(f'/api/duty-assignments/{future.pk}/start/')
        self.assertEqual(response.status_code, 400)
        self.assertIn('not for today', response.json()['detail'])

    def test_yesterdays_still_open_night_shift_can_be_started(self):
        # An overnight shift dated "yesterday" is still legitimately startable
        # from "today" for a short window (this only governs *start*; the
        # override below just proves the date check itself, not lateness).
        yesterday_shift = DutyAssignment.objects.create(
            nurse=self.nurse, department=self.dept, duty_date=self.today - timedelta(days=1),
            shift='night', start_time=dtime(23, 0), end_time=dtime(7, 0),
        )
        self.client.force_authenticate(user=self.nurse)
        with patch('django.utils.timezone.now', return_value=self._at(0, 30)), \
             override_settings(DUTY_START_BUFFER_MINUTES=600):
            response = self.client.post(f'/api/duty-assignments/{yesterday_shift.pk}/start/')
        self.assertEqual(response.status_code, 200, response.content)

    # ---- end validation ----

    def test_cannot_end_a_shift_that_has_not_started(self):
        self.client.force_authenticate(user=self.nurse)
        response = self.client.post(f'/api/duty-assignments/{self.assignment.pk}/end/')
        self.assertEqual(response.status_code, 400)
        self.assertIn('not been started', response.json()['detail'])

    def test_cannot_end_the_same_shift_twice(self):
        self.client.force_authenticate(user=self.nurse)
        with patch('django.utils.timezone.now', return_value=self._at(7, 0)):
            self.client.post(f'/api/duty-assignments/{self.assignment.pk}/start/')
        with patch('django.utils.timezone.now', return_value=self._at(15, 0)):
            self.client.post(f'/api/duty-assignments/{self.assignment.pk}/end/')
            response = self.client.post(f'/api/duty-assignments/{self.assignment.pk}/end/')
        self.assertEqual(response.status_code, 400)
        self.assertIn('already been ended', response.json()['detail'])

    def test_a_different_nurse_cannot_end_someone_elses_shift(self):
        self.client.force_authenticate(user=self.nurse)
        with patch('django.utils.timezone.now', return_value=self._at(7, 0)):
            self.client.post(f'/api/duty-assignments/{self.assignment.pk}/start/')
        self.client.force_authenticate(user=self.other_nurse)
        response = self.client.post(f'/api/duty-assignments/{self.assignment.pk}/end/')
        self.assertEqual(response.status_code, 404)

    # ---- hours computation ----

    def test_actual_hours_with_no_overtime(self):
        self.client.force_authenticate(user=self.nurse)
        with patch('django.utils.timezone.now', return_value=self._at(7, 0)):
            self.client.post(f'/api/duty-assignments/{self.assignment.pk}/start/')
        with patch('django.utils.timezone.now', return_value=self._at(15, 0)):
            response = self.client.post(f'/api/duty-assignments/{self.assignment.pk}/end/')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.data['actualWorkedHours'], 8.0)
        self.assertEqual(response.data['actualOvertimeHours'], 0.0)
        self.assertEqual(response.data['status'], 'completed')
        # The scheduled-side numbers must stay exactly what they were.
        self.assertEqual(response.data['regularHours'], 8.0)

    def test_actual_overtime_when_clocked_out_late(self):
        self.client.force_authenticate(user=self.nurse)
        with patch('django.utils.timezone.now', return_value=self._at(7, 0)):
            self.client.post(f'/api/duty-assignments/{self.assignment.pk}/start/')
        with patch('django.utils.timezone.now', return_value=self._at(17, 20)):
            response = self.client.post(f'/api/duty-assignments/{self.assignment.pk}/end/')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.data['actualWorkedHours'], 10.33)
        self.assertEqual(response.data['actualOvertimeHours'], 2.33)

    def test_overnight_shift_actual_hours_do_not_go_negative(self):
        night = DutyAssignment.objects.create(
            nurse=self.nurse, department=self.dept, duty_date=self.today,
            shift='night', start_time=dtime(23, 0), end_time=dtime(7, 0),
        )
        self.client.force_authenticate(user=self.nurse)
        with patch('django.utils.timezone.now', return_value=self._at(23, 0)):
            self.client.post(f'/api/duty-assignments/{night.pk}/start/')
        with patch('django.utils.timezone.now', return_value=self._at(7, 0, day_offset=1)):
            response = self.client.post(f'/api/duty-assignments/{night.pk}/end/')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.data['actualWorkedHours'], 8.0)
        self.assertEqual(response.data['actualOvertimeHours'], 0.0)

    def test_client_cannot_set_actual_times_directly(self):
        self.client.force_authenticate(user=self.supervisor)
        response = self.client.patch(
            f'/api/duty-assignments/{self.assignment.pk}/',
            {'actualStartTime': self._at(7, 0).isoformat()}, format='json',
        )
        self.assertEqual(response.status_code, 200)
        self.assignment.refresh_from_db()
        self.assertIsNone(self.assignment.actual_start_time)

    # ---- notifications (reuses the existing Notification model/infra) ----

    def test_late_start_notifies_the_creating_supervisor(self):
        self.client.force_authenticate(user=self.nurse)
        with patch('django.utils.timezone.now', return_value=self._at(7, 45)):
            self.client.post(f'/api/duty-assignments/{self.assignment.pk}/start/')
        note = Notification.objects.filter(recipient=self.supervisor, event='duty_started_late').first()
        self.assertIsNotNone(note)
        self.assertIn('Juan Dela Cruz', note.message)

    def test_on_time_start_does_not_notify(self):
        self.client.force_authenticate(user=self.nurse)
        with patch('django.utils.timezone.now', return_value=self._at(7, 0)):
            self.client.post(f'/api/duty-assignments/{self.assignment.pk}/start/')
        self.assertFalse(Notification.objects.filter(event='duty_started_late').exists())

    def test_overtime_on_end_notifies_the_creating_supervisor(self):
        self.client.force_authenticate(user=self.nurse)
        with patch('django.utils.timezone.now', return_value=self._at(7, 0)):
            self.client.post(f'/api/duty-assignments/{self.assignment.pk}/start/')
        with patch('django.utils.timezone.now', return_value=self._at(16, 0)):
            self.client.post(f'/api/duty-assignments/{self.assignment.pk}/end/')
        note = Notification.objects.filter(recipient=self.supervisor, event='duty_overtime_recorded').first()
        self.assertIsNotNone(note)

    def test_unauthenticated_cannot_start_or_end(self):
        response = self.client.post(f'/api/duty-assignments/{self.assignment.pk}/start/')
        self.assertEqual(response.status_code, 401)

    # ---- supervisor manual close-out (forgotten clock-out) ----

    def test_supervisor_can_close_a_shift_the_nurse_forgot_to_end(self):
        self.client.force_authenticate(user=self.nurse)
        with patch('django.utils.timezone.now', return_value=self._at(7, 0)):
            self.client.post(f'/api/duty-assignments/{self.assignment.pk}/start/')

        self.client.force_authenticate(user=self.supervisor)
        with patch('django.utils.timezone.now', return_value=self._at(18, 0)):
            response = self.client.post(f'/api/duty-assignments/{self.assignment.pk}/close/')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.data['status'], 'completed')
        self.assertEqual(response.data['actualEndRecordedBy'], 'Ana Cruz')
        self.assertIsNotNone(response.data['actualEndTime'])

        self.assignment.refresh_from_db()
        self.assertEqual(self.assignment.actual_end_recorded_by, self.supervisor)

    def test_nurse_cannot_close_out_a_shift_only_supervisors_can(self):
        self.client.force_authenticate(user=self.nurse)
        with patch('django.utils.timezone.now', return_value=self._at(7, 0)):
            self.client.post(f'/api/duty-assignments/{self.assignment.pk}/start/')
            response = self.client.post(f'/api/duty-assignments/{self.assignment.pk}/close/')
        self.assertEqual(response.status_code, 403)

    def test_cannot_close_a_shift_that_was_never_started(self):
        self.client.force_authenticate(user=self.supervisor)
        response = self.client.post(f'/api/duty-assignments/{self.assignment.pk}/close/')
        self.assertEqual(response.status_code, 400)
        self.assertIn('never started', response.json()['detail'])

    def test_cannot_close_an_already_ended_shift(self):
        self.client.force_authenticate(user=self.nurse)
        with patch('django.utils.timezone.now', return_value=self._at(7, 0)):
            self.client.post(f'/api/duty-assignments/{self.assignment.pk}/start/')
        with patch('django.utils.timezone.now', return_value=self._at(15, 0)):
            self.client.post(f'/api/duty-assignments/{self.assignment.pk}/end/')
        self.client.force_authenticate(user=self.supervisor)
        response = self.client.post(f'/api/duty-assignments/{self.assignment.pk}/close/')
        self.assertEqual(response.status_code, 400)
        self.assertIn('already been ended', response.json()['detail'])

    def test_ordinary_self_end_does_not_set_recorded_by(self):
        self.client.force_authenticate(user=self.nurse)
        with patch('django.utils.timezone.now', return_value=self._at(7, 0)):
            self.client.post(f'/api/duty-assignments/{self.assignment.pk}/start/')
        with patch('django.utils.timezone.now', return_value=self._at(15, 0)):
            response = self.client.post(f'/api/duty-assignments/{self.assignment.pk}/end/')
        self.assertIsNone(response.data['actualEndRecordedBy'])

    def test_close_notifies_the_nurse(self):
        self.client.force_authenticate(user=self.nurse)
        with patch('django.utils.timezone.now', return_value=self._at(7, 0)):
            self.client.post(f'/api/duty-assignments/{self.assignment.pk}/start/')
        self.client.force_authenticate(user=self.supervisor)
        with patch('django.utils.timezone.now', return_value=self._at(18, 0)):
            self.client.post(f'/api/duty-assignments/{self.assignment.pk}/close/')
        note = Notification.objects.filter(recipient=self.nurse, event='duty_closed_by_head_nurse').first()
        self.assertIsNotNone(note)

    # ---- supervisor marking Completed via the plain edit form (PATCH) ----
    #
    # The roster's Edit modal sets status through a plain PATCH, not /close/
    # — this used to leave actual_end_time null and skip the notification
    # entirely, which is what let a nurse's own device keep showing the
    # shift as ongoing after a refresh (my-duty.tsx and dashboard.tsx both
    # read actual_end_time). perform_update keeps the two in sync so either
    # path produces the same result.

    def test_marking_completed_via_patch_fills_in_the_end_time_like_close_does(self):
        self.client.force_authenticate(user=self.nurse)
        with patch('django.utils.timezone.now', return_value=self._at(7, 0)):
            self.client.post(f'/api/duty-assignments/{self.assignment.pk}/start/')

        self.client.force_authenticate(user=self.supervisor)
        with patch('django.utils.timezone.now', return_value=self._at(18, 0)):
            response = self.client.patch(
                f'/api/duty-assignments/{self.assignment.pk}/', {'status': 'completed'}, format='json',
            )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.data['status'], 'completed')
        self.assertIsNotNone(response.data['actualEndTime'])
        self.assertEqual(response.data['actualEndRecordedBy'], 'Ana Cruz')

        self.assignment.refresh_from_db()
        self.assertEqual(self.assignment.actual_end_recorded_by, self.supervisor)

    def test_marking_completed_via_patch_notifies_the_nurse(self):
        self.client.force_authenticate(user=self.nurse)
        with patch('django.utils.timezone.now', return_value=self._at(7, 0)):
            self.client.post(f'/api/duty-assignments/{self.assignment.pk}/start/')

        self.client.force_authenticate(user=self.supervisor)
        with patch('django.utils.timezone.now', return_value=self._at(18, 0)):
            self.client.patch(
                f'/api/duty-assignments/{self.assignment.pk}/', {'status': 'completed'}, format='json',
            )
        note = Notification.objects.filter(recipient=self.nurse, event='duty_closed_by_head_nurse').first()
        self.assertIsNotNone(note)

    def test_marking_completed_via_patch_on_a_never_started_shift_does_not_fabricate_an_end_time(self):
        # No actual_start_time at all — e.g. a supervisor administratively
        # closing out a no-show. Nothing to close, so this must not invent
        # attendance data the nurse never actually had.
        self.client.force_authenticate(user=self.supervisor)
        response = self.client.patch(
            f'/api/duty-assignments/{self.assignment.pk}/', {'status': 'completed'}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.data['status'], 'completed')
        self.assertIsNone(response.data['actualEndTime'])
        self.assertIsNone(response.data['actualEndRecordedBy'])
        self.assertEqual(Notification.objects.filter(event='duty_closed_by_head_nurse').count(), 0)

    def test_patching_an_already_completed_shift_again_does_not_re_notify(self):
        self.client.force_authenticate(user=self.nurse)
        with patch('django.utils.timezone.now', return_value=self._at(7, 0)):
            self.client.post(f'/api/duty-assignments/{self.assignment.pk}/start/')
        with patch('django.utils.timezone.now', return_value=self._at(15, 0)):
            self.client.post(f'/api/duty-assignments/{self.assignment.pk}/end/')

        self.client.force_authenticate(user=self.supervisor)
        response = self.client.patch(
            f'/api/duty-assignments/{self.assignment.pk}/', {'notes': 'corrected note'}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(Notification.objects.filter(event='duty_closed_by_head_nurse').count(), 0)

    def test_patch_cannot_forge_actual_end_time_the_auto_fill_still_uses_real_now(self):
        # actualEndTime is read_only on the serializer — a client-supplied
        # value in the body is silently dropped, not accepted, so
        # perform_update's auto-fill (real "now") is what actually lands.
        self.client.force_authenticate(user=self.nurse)
        with patch('django.utils.timezone.now', return_value=self._at(7, 0)):
            self.client.post(f'/api/duty-assignments/{self.assignment.pk}/start/')

        self.client.force_authenticate(user=self.supervisor)
        forged_end = self._at(16, 30).isoformat()
        with patch('django.utils.timezone.now', return_value=self._at(18, 0)):
            response = self.client.patch(
                f'/api/duty-assignments/{self.assignment.pk}/',
                {'status': 'completed', 'actualEndTime': forged_end}, format='json',
            )
        self.assertEqual(response.status_code, 200, response.content)
        self.assignment.refresh_from_db()
        self.assertIsNotNone(self.assignment.actual_end_time)
        self.assertNotEqual(self.assignment.actual_end_time.isoformat(), forged_end)
        self.assertEqual(self.assignment.actual_end_recorded_by, self.supervisor)
