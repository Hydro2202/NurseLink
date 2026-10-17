"""
The live-update endpoint.

Every screen in the app decides whether to refetch by comparing the revision
strings this returns, so the contract that matters is narrow but strict: a
revision must move when something changed, must not move when nothing did, and
the whole thing must stay cheap enough to ask for every few seconds.
"""

import datetime

from django.contrib.auth.models import User
from django.core.cache import cache
from django.test.utils import CaptureQueriesContext
from django.db import connection
from rest_framework.test import APITestCase

from .models import Department, DutyAssignment, HandoverNote, Notification, NurseProfile, Patient, Task


class LiveStateTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(
            username='nurse@hospital.com', email='nurse@hospital.com',
            password='pw-test-1234', first_name='Ana', last_name='Cruz',
        )
        NurseProfile.objects.create(user=self.user, role='staff_nurse')
        self.other = User.objects.create_user(
            username='other@hospital.com', email='other@hospital.com',
            password='pw-test-1234', first_name='Ben', last_name='Diaz',
        )
        NurseProfile.objects.create(user=self.other, role='staff_nurse')
        self.client.force_authenticate(user=self.user)

    def state(self):
        response = self.client.get('/api/live/')
        self.assertEqual(response.status_code, 200)
        return response.json()

    def make_task(self, **extra):
        fields = dict(
            task_code='T900', title='Wound dressing', assigned_to='Ana Cruz',
            assigned_nurse=self.user, status='pending',
        )
        fields.update(extra)
        return Task.objects.create(**fields)

    def test_requires_authentication(self):
        self.client.force_authenticate(user=None)
        self.assertEqual(self.client.get('/api/live/').status_code, 401)

    def test_nothing_changing_leaves_every_revision_alone(self):
        first = self.state()
        second = self.state()
        self.assertEqual(first, second)

    def test_a_new_task_moves_only_the_task_revision(self):
        before = self.state()
        self.make_task()
        after = self.state()

        self.assertNotEqual(before['tasks'], after['tasks'])
        self.assertEqual(before['handovers'], after['handovers'])
        self.assertEqual(before['notifications'], after['notifications'])

    def test_editing_a_task_moves_the_revision(self):
        task = self.make_task()
        before = self.state()

        task.status = 'in_progress'
        task.save()

        self.assertNotEqual(before['tasks'], self.state()['tasks'])

    def test_deleting_a_task_moves_the_revision(self):
        task = self.make_task()
        self.make_task(task_code='T901')
        before = self.state()

        task.delete()

        # Only the count changes here, which is exactly why the revision
        # carries one alongside the newest timestamp.
        self.assertNotEqual(before['tasks'], self.state()['tasks'])

    def test_a_task_handed_to_another_nurse_still_registers(self):
        task = self.make_task()
        before = self.state()

        task.assigned_nurse = self.other
        task.assigned_to = 'Ben Diaz'
        task.save()

        self.assertNotEqual(before['tasks'], self.state()['tasks'])

    def test_a_new_handover_moves_only_the_handover_revision(self):
        before = self.state()
        HandoverNote.objects.create(
            handover_code='H900', patient_name='Juan Dela Cruz', shift='morning',
            date=datetime.date(2026, 3, 3), nurse_from='Ben Diaz', nurse_to='Ana Cruz',
            created_by=self.other,
        )
        after = self.state()

        self.assertNotEqual(before['handovers'], after['handovers'])
        self.assertEqual(before['tasks'], after['tasks'])

    def test_a_notification_moves_the_inbox_revision_and_the_badge(self):
        before = self.state()
        self.assertEqual(before['unreadCount'], 0)

        Notification.objects.create(
            recipient=self.user, notification_type='warning',
            title='New handover received', message='Ben Diaz handed over a patient.',
        )
        after = self.state()

        self.assertNotEqual(before['notifications'], after['notifications'])
        self.assertEqual(after['unreadCount'], 1)

    def test_reading_a_notification_moves_the_revision_and_the_badge(self):
        note = Notification.objects.create(
            recipient=self.user, notification_type='info',
            title='New task assigned', message='Something to do.',
        )
        before = self.state()

        note.is_read = True
        note.save()
        after = self.state()

        self.assertNotEqual(before['notifications'], after['notifications'])
        self.assertEqual(after['unreadCount'], 0)

    def test_another_nurses_notification_is_invisible_here(self):
        before = self.state()

        Notification.objects.create(
            recipient=self.other, notification_type='info',
            title='Not yours', message='Addressed to somebody else.',
        )

        self.assertEqual(before['notifications'], self.state()['notifications'])
        self.assertEqual(self.state()['unreadCount'], 0)

    def test_a_new_patient_moves_the_patient_revision(self):
        before = self.state()
        Patient.objects.create(
            patient_code='P900', name='Juan Dela Cruz', age=40, gender='Male',
            room='201-A', diagnosis='CHF', admission_date=datetime.date(2026, 3, 2),
        )
        self.assertNotEqual(before['patients'], self.state()['patients'])

    def test_a_new_duty_assignment_moves_the_duty_revision(self):
        before = self.state()
        dept, _ = Department.objects.get_or_create(name='ICU')
        DutyAssignment.objects.create(
            nurse=self.user, department=dept, duty_date=datetime.date(2026, 3, 3),
            shift='morning', start_time=datetime.time(7, 0), end_time=datetime.time(15, 0),
        )
        after = self.state()

        self.assertNotEqual(before['duty'], after['duty'])
        self.assertEqual(before['tasks'], after['tasks'])

    def test_ending_a_shift_moves_the_duty_revision(self):
        # This is the case the bug report was about: a head nurse ending a
        # nurse's shift has to move this revision, or the nurse's own
        # my-duty/dashboard screens have no signal to refetch on.
        dept, _ = Department.objects.get_or_create(name='ICU')
        assignment = DutyAssignment.objects.create(
            nurse=self.user, department=dept, duty_date=datetime.date(2026, 3, 3),
            shift='morning', start_time=datetime.time(7, 0), end_time=datetime.time(15, 0),
        )
        before = self.state()

        assignment.status = 'completed'
        assignment.save(update_fields=['status', 'updated_at'])

        self.assertNotEqual(before['duty'], self.state()['duty'])

    def test_another_nurses_duty_assignment_still_registers(self):
        # duty is a system-wide pulse like tasks/handovers/patients, not
        # scoped to the polling nurse — see LiveStateView._revision.
        before = self.state()
        dept, _ = Department.objects.get_or_create(name='ICU')
        DutyAssignment.objects.create(
            nurse=self.other, department=dept, duty_date=datetime.date(2026, 3, 3),
            shift='night', start_time=datetime.time(23, 0), end_time=datetime.time(7, 0),
        )
        self.assertNotEqual(before['duty'], self.state()['duty'])

    def test_a_department_reassignment_moves_only_the_profile_revision(self):
        before = self.state()
        profile = self.user.nurse_profile
        profile.department = 'ICU'
        profile.save(update_fields=['department'])
        after = self.state()

        self.assertNotEqual(before['profile'], after['profile'])
        self.assertEqual(before['tasks'], after['tasks'])
        self.assertEqual(before['notifications'], after['notifications'])

    def test_a_shift_reassignment_moves_the_profile_revision(self):
        before = self.state()
        profile = self.user.nurse_profile
        profile.shift = 'night'
        profile.save(update_fields=['shift'])

        self.assertNotEqual(before['profile'], self.state()['profile'])

    def test_another_nurses_reassignment_is_invisible_here(self):
        before = self.state()
        other_profile = self.other.nurse_profile
        other_profile.department = 'ER'
        other_profile.save(update_fields=['department'])

        self.assertEqual(before['profile'], self.state()['profile'])

    def test_the_poll_stays_cheap(self):
        # This is requested every few seconds by every signed-in nurse, so it
        # must never grow into something that walks the tables it summarises.
        for index in range(25):
            self.make_task(task_code='T9%02d' % index)

        with CaptureQueriesContext(connection) as queries:
            self.state()

        self.assertLessEqual(
            # 7, not 6: check_due_referral_reminders (called alongside
            # check_due_task_reminders — see LiveStateView.get) adds exactly
            # one more cheap, indexed filter() for this nurse's own pending
            # referrals. Still a handful of small queries, not a table walk.
            len(queries), 7, 'live poll should be a handful of aggregates, not list queries'
        )
