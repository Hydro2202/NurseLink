"""
The shift-rotation restriction on referrals (Morning -> Afternoon -> Night,
same department only) is gone — Endorsement allows any shift, any
department. These tests pin the *removal*: every shift/department
combination that used to be rejected now succeeds. Self-endorsement and
head-nurse oversight are unrelated rules that persist unchanged.

ReferralEmptyReasonTests (the old /handovers/eligible-recipients/
emptyReason semantics) is replaced by EndorsementEligibleReceiversTests,
covering the new /endorsements/eligible-receivers/ shift-grouped listing.
"""

import datetime
from unittest.mock import patch
from zoneinfo import ZoneInfo

from django.contrib.auth.models import User
from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APITestCase

from .models import Department, DutyAssignment, NurseProfile, Patient

MANILA = ZoneInfo('Asia/Manila')


def make_nurse(username, *, role='staff_nurse'):
    user = User.objects.create_user(
        username=username, email=f'{username}@hospital.test', password='pw-test-1234',
        first_name=username, last_name='Nurse',
    )
    NurseProfile.objects.create(
        user=user, role=role, is_active_staff=True, approval_status='approved',
    )
    return user


def make_shift(nurse, department, duty_date, shift, *, status='scheduled'):
    times = DutyAssignment.SHIFT_DEFAULT_TIMES[shift]
    return DutyAssignment.objects.create(
        nurse=nurse, department=department, duty_date=duty_date, shift=shift,
        start_time=times[0], end_time=times[1], status=status,
    )


class ReferralShiftTestBase(APITestCase):
    def setUp(self):
        cache.clear()
        self.dept = Department.objects.get_or_create(name='Shift Rotation Test Ward')[0]
        self.other_dept = Department.objects.get_or_create(name='Shift Rotation Other Ward')[0]
        self.head_nurse = make_nurse('rotation_head', role='head_nurse')
        self.day = datetime.date(2026, 9, 27)
        self.next_day = datetime.date(2026, 9, 28)
        self.patient = Patient.objects.create(
            patient_code='ROT001', name='Rotation Patient', age=50, gender='Male',
            room='R-1', diagnosis='Test', admission_date=self.day,
        )

    def _now_at(self, date, hour, minute=0):
        return datetime.datetime(date.year, date.month, date.day, hour, minute, tzinfo=MANILA)


class ReferralShiftRotationTests(ReferralShiftTestBase):
    def _refer(self, sender, recipient, patient=None):
        self.client.force_authenticate(user=sender)
        return self.client.post('/api/handovers/', {
            'patientId': (patient or self.patient).patient_code,
            'patientName': (patient or self.patient).name,
            'date': str(self.day),
            'nurseFrom': sender.get_full_name(),
            'nurseTo': recipient.get_full_name() if recipient else '',
            'nurseToId': str(recipient.pk) if recipient else '',
            'sbar': {'situation': 's', 'background': 'b', 'assessment': 'a', 'recommendation': 'r'},
        }, format='json')

    def test_same_shift_referral_is_now_allowed(self):
        morning = make_nurse('rot_morning1')
        other_morning = make_nurse('rot_morning1b')
        make_shift(morning, self.dept, self.day, 'morning')
        make_shift(other_morning, self.dept, self.day, 'morning')

        with patch('api.referral_shifts.timezone.now', return_value=self._now_at(self.day, 10)):
            response = self._refer(morning, other_morning)
        self.assertEqual(response.status_code, 201, response.data)

    def test_any_shift_combination_is_allowed_not_just_the_next_one(self):
        morning = make_nurse('rot_morning2')
        night = make_nurse('rot_night2')
        make_shift(morning, self.dept, self.day, 'morning')
        make_shift(night, self.dept, self.day, 'night')

        with patch('api.referral_shifts.timezone.now', return_value=self._now_at(self.day, 10)):
            response = self._refer(morning, night)
        self.assertEqual(response.status_code, 201, response.data)

    def test_different_department_referral_is_now_allowed(self):
        morning = make_nurse('rot_morning3')
        other_dept_afternoon = make_nurse('rot_afternoon3')
        make_shift(morning, self.dept, self.day, 'morning')
        make_shift(other_dept_afternoon, self.other_dept, self.day, 'afternoon')

        with patch('api.referral_shifts.timezone.now', return_value=self._now_at(self.day, 10)):
            response = self._refer(morning, other_dept_afternoon)
        self.assertEqual(response.status_code, 201, response.data)

    def test_referring_while_off_duty_is_now_allowed(self):
        unscheduled = make_nurse('rot_unscheduled')
        someone = make_nurse('rot_someone')

        with patch('api.referral_shifts.timezone.now', return_value=self._now_at(self.day, 10)):
            response = self._refer(unscheduled, someone)
        self.assertEqual(response.status_code, 201, response.data)

    def test_referring_to_a_nurse_with_no_roster_assignment_is_now_allowed(self):
        morning = make_nurse('rot_morning4')
        unscheduled_recipient = make_nurse('rot_unscheduled_recipient')
        make_shift(morning, self.dept, self.day, 'morning')

        with patch('api.referral_shifts.timezone.now', return_value=self._now_at(self.day, 10)):
            response = self._refer(morning, unscheduled_recipient)
        self.assertEqual(response.status_code, 201, response.data)

    def test_self_referral_rejected(self):
        morning = make_nurse('rot_self1')
        make_shift(morning, self.dept, self.day, 'morning')

        with patch('api.referral_shifts.timezone.now', return_value=self._now_at(self.day, 10)):
            response = self._refer(morning, morning)
        self.assertEqual(response.status_code, 400)
        self.assertIn('yourself', response.data['nurseToId'])

    def test_head_nurse_sees_all_referrals_regardless_of_shift(self):
        morning = make_nurse('rot_morning9')
        afternoon = make_nurse('rot_afternoon7')
        make_shift(morning, self.dept, self.day, 'morning')
        make_shift(afternoon, self.dept, self.day, 'afternoon')

        with patch('api.referral_shifts.timezone.now', return_value=self._now_at(self.day, 10)):
            response = self._refer(morning, afternoon)
        self.assertEqual(response.status_code, 201, response.data)

        self.client.force_authenticate(user=self.head_nurse)
        list_response = self.client.get('/api/handovers/')
        self.assertEqual(list_response.status_code, 200)
        codes = [h['id'] for h in list_response.data]
        self.assertIn(response.data['id'], codes)


class EndorsementEligibleReceiversTests(ReferralShiftTestBase):
    """GET /endorsements/eligible-receivers/ — any active nurse except me,
    grouped by shift (Morning -> Afternoon -> Night -> Unassigned), empty
    groups included.

    Unlike ReferralShiftRotationTests above, this endpoint has no shift-
    rotation logic to mock a fixed "now" for — it calls current_duties(),
    which checks the real wall-clock date — so these fixtures use the real
    today, not self.day (a fixed date in the test file's past/future that
    only matters for the mocked api.referral_shifts.timezone.now() above).
    """

    def test_groups_by_shift_and_includes_empty_groups(self):
        today = timezone.now().date()
        me = make_nurse('elig_me')
        morning = make_nurse('elig_morning')
        afternoon = make_nurse('elig_afternoon')
        unassigned = make_nurse('elig_unassigned')
        make_shift(me, self.dept, today, 'morning', status='in_progress')
        make_shift(morning, self.dept, today, 'morning', status='in_progress')
        make_shift(afternoon, self.dept, today, 'afternoon', status='in_progress')

        self.client.force_authenticate(user=me)
        response = self.client.get('/api/endorsements/eligible-receivers/')
        self.assertEqual(response.status_code, 200, response.data)
        by_shift = {g['shift']['id']: g['nurses'] for g in response.data}
        self.assertEqual({'morning', 'afternoon', 'night', 'unassigned'}, set(by_shift))
        self.assertEqual({n['id'] for n in by_shift['morning']}, {str(morning.pk)})
        self.assertEqual({n['id'] for n in by_shift['afternoon']}, {str(afternoon.pk)})
        self.assertEqual({n['id'] for n in by_shift['night']}, set())
        self.assertIn(str(unassigned.pk), {n['id'] for n in by_shift['unassigned']})
        # The signed-in nurse never appears as their own candidate receiver.
        all_ids = {n['id'] for nurses in by_shift.values() for n in nurses}
        self.assertNotIn(str(me.pk), all_ids)

    def test_shift_id_filter(self):
        today = timezone.now().date()
        me = make_nurse('elig_filter_me')
        morning = make_nurse('elig_filter_morning')
        make_shift(morning, self.dept, today, 'morning', status='in_progress')

        self.client.force_authenticate(user=me)
        response = self.client.get('/api/endorsements/eligible-receivers/?shiftId=morning')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]['shift']['id'], 'morning')
        self.assertEqual({n['id'] for n in response.data[0]['nurses']}, {str(morning.pk)})

    def test_inactive_or_unapproved_nurse_is_excluded(self):
        me = make_nurse('elig_active_me')
        pending = make_nurse('elig_pending')
        NurseProfile.objects.filter(user=pending).update(approval_status='pending')

        self.client.force_authenticate(user=me)
        response = self.client.get('/api/endorsements/eligible-receivers/')
        all_ids = {n['id'] for g in response.data for n in g['nurses']}
        self.assertNotIn(str(pending.pk), all_ids)
