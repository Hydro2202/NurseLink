"""
A shift is a real window, not a calendar date. A Night shift dated Oct 2 runs
from 11:00 PM Oct 2 to 7:00 AM Oct 3 in the hospital's timezone, and its
upcoming/current/past status is decided against those instants — never the
date alone, and never the server's or the phone's own timezone.
"""

from datetime import date, datetime, time
from zoneinfo import ZoneInfo
from unittest.mock import patch

from django.contrib.auth.models import User
from django.test import TestCase, override_settings
from django.utils import timezone

from .models import Department, DutyAssignment, NurseProfile

MANILA = ZoneInfo('Asia/Manila')


def local(y, mo, d, h, mi=0):
    return datetime(y, mo, d, h, mi, tzinfo=MANILA)


def make_assignment(shift, start, end, duty_date=date(2026, 10, 2)):
    user = User.objects.create_user(username=f'n{shift}{start}@x.com', email=f'n{shift}{start}@x.com',
                                    password='pw-test-1234')
    NurseProfile.objects.create(user=user, role='staff_nurse', approval_status='approved',
                                is_active_staff=True)
    dept, _ = Department.objects.get_or_create(name='Medical Ward')
    return DutyAssignment.objects.create(
        nurse=user, department=dept, duty_date=duty_date, shift=shift,
        start_time=start, end_time=end,
    )


@override_settings(TIME_ZONE='UTC', DUTY_LOCAL_TIMEZONE='Asia/Manila')
class NightShiftWindowTests(TestCase):
    def setUp(self):
        self.night = make_assignment('night', time(23, 0), time(7, 0))

    def test_night_shift_dated_oct_2_is_upcoming_at_10pm_oct_2(self):
        self.assertEqual(self.night.schedule_status_at(local(2026, 10, 2, 22, 0)), 'upcoming')

    def test_night_shift_dated_oct_2_is_current_at_2am_oct_3(self):
        self.assertEqual(self.night.schedule_status_at(local(2026, 10, 3, 2, 0)), 'current')

    def test_night_shift_dated_oct_2_is_past_at_8am_oct_3(self):
        self.assertEqual(self.night.schedule_status_at(local(2026, 10, 3, 8, 0)), 'past')

    def test_night_window_starts_and_ends_on_the_right_days_in_hospital_time(self):
        start = self.night.scheduled_start_datetime().astimezone(MANILA)
        end = self.night.scheduled_end_datetime().astimezone(MANILA)
        self.assertEqual((start.date(), start.hour), (date(2026, 10, 2), 23))
        self.assertEqual((end.date(), end.hour), (date(2026, 10, 3), 7))

    def test_window_label_explains_the_overnight_span(self):
        self.assertEqual(self.night.schedule_window_label(),
                         'Oct 2, 11:00 PM – Oct 3, 7:00 AM')

    def test_server_utc_does_not_shift_the_hospital_window(self):
        # 11:00 PM Manila is 3:00 PM UTC; the instant must be that, not 11:00 PM UTC.
        start_utc = self.night.scheduled_start_datetime().astimezone(ZoneInfo('UTC'))
        self.assertEqual((start_utc.day, start_utc.hour), (2, 15))

    def test_status_is_correct_even_when_the_clock_is_read_in_utc(self):
        # 2:00 AM Oct 3 Manila is 6:00 PM Oct 2 UTC — same moment, same answer.
        utc_now = local(2026, 10, 3, 2, 0).astimezone(ZoneInfo('UTC'))
        self.assertEqual(self.night.schedule_status_at(utc_now), 'current')


@override_settings(TIME_ZONE='UTC', DUTY_LOCAL_TIMEZONE='Asia/Manila')
class DayAndEveningShiftTests(TestCase):
    def test_morning_shift_status(self):
        morning = make_assignment('morning', time(7, 0), time(15, 0))
        self.assertEqual(morning.schedule_status_at(local(2026, 10, 2, 6, 0)), 'upcoming')
        self.assertEqual(morning.schedule_status_at(local(2026, 10, 2, 10, 0)), 'current')
        self.assertEqual(morning.schedule_status_at(local(2026, 10, 2, 16, 0)), 'past')

    def test_evening_shift_status_and_label(self):
        evening = make_assignment('afternoon', time(15, 0), time(23, 0))
        self.assertEqual(evening.schedule_status_at(local(2026, 10, 2, 14, 0)), 'upcoming')
        self.assertEqual(evening.schedule_status_at(local(2026, 10, 2, 18, 0)), 'current')
        self.assertEqual(evening.schedule_status_at(local(2026, 10, 2, 23, 30)), 'past')
        self.assertEqual(evening.schedule_window_label(), 'Oct 2, 3:00 PM – Oct 2, 11:00 PM')


@override_settings(TIME_ZONE='UTC', DUTY_LOCAL_TIMEZONE='Asia/Manila')
class SerializerExposesWindowTests(TestCase):
    def test_serializer_reports_status_against_the_current_time(self):
        from .serializers import DutyAssignmentSerializer

        night = make_assignment('night', time(23, 0), time(7, 0))
        with patch('api.serializers.timezone.now', return_value=local(2026, 10, 3, 2, 0)):
            data = DutyAssignmentSerializer(night).data
        self.assertEqual(data['scheduleStatus'], 'current')
        self.assertEqual(data['scheduleWindowLabel'], 'Oct 2, 11:00 PM – Oct 3, 7:00 AM')
        self.assertTrue(data['scheduledStartAt'].startswith('2026-10-02T23:00'))
