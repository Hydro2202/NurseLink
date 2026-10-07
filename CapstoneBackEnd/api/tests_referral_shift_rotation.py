"""
Referral shift-rotation rule: a nurse may only refer a patient to a nurse
on the *next* shift in rotation — Morning -> Afternoon -> Night -> next
day's Morning — in the same department, never the same shift, never
themselves. The Duty Roster (DutyAssignment) is the only source of truth;
see api/referral_shifts.py.

Every test pins "now" to a fixed moment (via mocking
api.referral_shifts.timezone.now) rather than relying on the real wall
clock, so these are deterministic no matter when the suite runs.
"""

import datetime
from unittest.mock import patch
from zoneinfo import ZoneInfo

from django.contrib.auth.models import User
from django.core.cache import cache
from rest_framework.test import APITestCase

from .models import Department, DutyAssignment, HandoverNote, NurseProfile, Patient

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
    """Shared fixture for both ReferralShiftRotationTests and ReferralEmptyReasonTests."""

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

    # --- Morning -> Afternoon --------------------------------------------

    def test_morning_nurse_sees_only_afternoon_nurses(self):
        morning = make_nurse('rot_morning1')
        afternoon = make_nurse('rot_afternoon1')
        night = make_nurse('rot_night1')
        make_shift(morning, self.dept, self.day, 'morning')
        make_shift(afternoon, self.dept, self.day, 'afternoon')
        make_shift(night, self.dept, self.day, 'night')

        with patch('api.referral_shifts.timezone.now', return_value=self._now_at(self.day, 10)):
            self.client.force_authenticate(user=morning)
            response = self.client.get('/api/handovers/eligible-recipients/')
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data['onDuty'])
        self.assertEqual(response.data['nextShift'], 'afternoon')
        ids = {r['id'] for r in response.data['recipients']}
        self.assertEqual(ids, {str(afternoon.pk)})

    def test_morning_nurse_can_refer_to_afternoon_nurse(self):
        morning = make_nurse('rot_morning2')
        afternoon = make_nurse('rot_afternoon2')
        make_shift(morning, self.dept, self.day, 'morning')
        make_shift(afternoon, self.dept, self.day, 'afternoon')

        with patch('api.referral_shifts.timezone.now', return_value=self._now_at(self.day, 10)):
            response = self._refer(morning, afternoon)
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data['shift'], 'morning')
        self.assertEqual(response.data['toShift'], 'afternoon')
        self.assertEqual(response.data['shiftDate'], str(self.day))
        self.assertEqual(response.data['departmentName'], self.dept.name)

    def test_morning_nurse_referring_to_a_morning_nurse_is_rejected(self):
        morning = make_nurse('rot_morning3')
        other_morning = make_nurse('rot_morning3b')
        make_shift(morning, self.dept, self.day, 'morning')
        make_shift(other_morning, self.dept, self.day, 'morning')

        with patch('api.referral_shifts.timezone.now', return_value=self._now_at(self.day, 10)):
            response = self._refer(morning, other_morning)
        self.assertEqual(response.status_code, 400)
        self.assertIn('nurseToId', response.data)

    # --- Afternoon -> Night -----------------------------------------------

    def test_afternoon_nurse_sees_only_night_nurses(self):
        afternoon = make_nurse('rot_afternoon3')
        night = make_nurse('rot_night2')
        morning = make_nurse('rot_morning4')
        make_shift(afternoon, self.dept, self.day, 'afternoon')
        make_shift(night, self.dept, self.day, 'night')
        make_shift(morning, self.dept, self.day, 'morning')

        with patch('api.referral_shifts.timezone.now', return_value=self._now_at(self.day, 18)):
            self.client.force_authenticate(user=afternoon)
            response = self.client.get('/api/handovers/eligible-recipients/')
        self.assertEqual(response.data['nextShift'], 'night')
        ids = {r['id'] for r in response.data['recipients']}
        self.assertEqual(ids, {str(night.pk)})

    def test_afternoon_same_shift_referral_rejected(self):
        afternoon = make_nurse('rot_afternoon4')
        other_afternoon = make_nurse('rot_afternoon4b')
        make_shift(afternoon, self.dept, self.day, 'afternoon')
        make_shift(other_afternoon, self.dept, self.day, 'afternoon')

        with patch('api.referral_shifts.timezone.now', return_value=self._now_at(self.day, 18)):
            response = self._refer(afternoon, other_afternoon)
        self.assertEqual(response.status_code, 400)
        self.assertIn('same shift', response.data['nurseToId'])

    # --- Night -> next day's Morning, both sides of midnight -------------

    def test_night_nurse_before_midnight_sees_next_day_morning_nurses(self):
        night = make_nurse('rot_night3')
        next_morning = make_nurse('rot_morning5')
        make_shift(night, self.dept, self.day, 'night')
        make_shift(next_morning, self.dept, self.next_day, 'morning')

        with patch('api.referral_shifts.timezone.now', return_value=self._now_at(self.day, 23, 30)):
            self.client.force_authenticate(user=night)
            response = self.client.get('/api/handovers/eligible-recipients/')
        self.assertTrue(response.data['onDuty'])
        self.assertEqual(response.data['nextShift'], 'morning')
        self.assertEqual(response.data['nextShiftDate'], self.next_day)
        ids = {r['id'] for r in response.data['recipients']}
        self.assertEqual(ids, {str(next_morning.pk)})

    def test_night_nurse_after_midnight_still_sees_next_day_morning_nurses(self):
        night = make_nurse('rot_night4')
        next_morning = make_nurse('rot_morning6')
        make_shift(night, self.dept, self.day, 'night')
        make_shift(next_morning, self.dept, self.next_day, 'morning')

        # 02:00 on the 28th — still within the night shift filed under the
        # 27th (23:00 -> 07:00), which is exactly the case that broke
        # without midnight-aware lookup.
        with patch('api.referral_shifts.timezone.now', return_value=self._now_at(self.next_day, 2)):
            self.client.force_authenticate(user=night)
            response = self.client.get('/api/handovers/eligible-recipients/')
        self.assertTrue(response.data['onDuty'])
        self.assertEqual(response.data['currentShift'], 'night')
        self.assertEqual(response.data['nextShift'], 'morning')
        self.assertEqual(response.data['nextShiftDate'], self.next_day)
        ids = {r['id'] for r in response.data['recipients']}
        self.assertEqual(ids, {str(next_morning.pk)})

    def test_night_nurse_can_refer_after_midnight(self):
        night = make_nurse('rot_night5')
        next_morning = make_nurse('rot_morning7')
        make_shift(night, self.dept, self.day, 'night')
        make_shift(next_morning, self.dept, self.next_day, 'morning')

        with patch('api.referral_shifts.timezone.now', return_value=self._now_at(self.next_day, 2)):
            response = self._refer(night, next_morning)
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data['shift'], 'night')
        self.assertEqual(response.data['toShift'], 'morning')
        self.assertEqual(response.data['shiftDate'], str(self.next_day))

    # --- Self, no roster, other department --------------------------------

    def test_self_referral_rejected(self):
        morning = make_nurse('rot_self1')
        make_shift(morning, self.dept, self.day, 'morning')

        with patch('api.referral_shifts.timezone.now', return_value=self._now_at(self.day, 10)):
            response = self._refer(morning, morning)
        self.assertEqual(response.status_code, 400)
        self.assertIn('yourself', response.data['nurseToId'])

    def test_nurse_with_no_roster_assignment_gets_not_on_duty_error(self):
        unscheduled = make_nurse('rot_unscheduled')
        afternoon = make_nurse('rot_afternoon5')
        make_shift(afternoon, self.dept, self.day, 'afternoon')

        with patch('api.referral_shifts.timezone.now', return_value=self._now_at(self.day, 10)):
            self.client.force_authenticate(user=unscheduled)
            list_response = self.client.get('/api/handovers/eligible-recipients/')
            self.assertFalse(list_response.data['onDuty'])
            self.assertEqual(list_response.data['recipients'], [])

            create_response = self._refer(unscheduled, afternoon)
        self.assertEqual(create_response.status_code, 400)
        self.assertIn('not on duty', create_response.data['nonFieldErrors'])

    def test_nurse_from_another_department_does_not_appear_as_recipient(self):
        morning = make_nurse('rot_morning8')
        wrong_dept_afternoon = make_nurse('rot_afternoon6')
        make_shift(morning, self.dept, self.day, 'morning')
        make_shift(wrong_dept_afternoon, self.other_dept, self.day, 'afternoon')

        with patch('api.referral_shifts.timezone.now', return_value=self._now_at(self.day, 10)):
            self.client.force_authenticate(user=morning)
            response = self.client.get('/api/handovers/eligible-recipients/')
            self.assertEqual(response.data['recipients'], [])

            create_response = self._refer(morning, wrong_dept_afternoon)
        self.assertEqual(create_response.status_code, 400)
        self.assertIn('next shift', create_response.data['nurseToId'])

    # --- Head nurse oversight is unaffected by shift ----------------------

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


class ReferralEmptyReasonTests(ReferralShiftTestBase):
    """
    emptyReason on GET /handovers/eligible-recipients/: why the recipients
    list came back empty. Reuses ReferralShiftRotationTests' setUp (self.dept,
    self.day, self.next_day) and helpers (make_nurse, make_shift).
    """

    def test_normal_case_has_no_empty_reason(self):
        morning = make_nurse('reason_morning1')
        afternoon = make_nurse('reason_afternoon1')
        make_shift(morning, self.dept, self.day, 'morning')
        make_shift(afternoon, self.dept, self.day, 'afternoon')

        with patch('api.referral_shifts.timezone.now', return_value=self._now_at(self.day, 10)):
            self.client.force_authenticate(user=morning)
            response = self.client.get('/api/handovers/eligible-recipients/')
        self.assertTrue(response.data['recipients'])
        self.assertIsNone(response.data['emptyReason'])

    def test_user_off_duty_empty_reason(self):
        unscheduled = make_nurse('reason_offduty1')

        with patch('api.referral_shifts.timezone.now', return_value=self._now_at(self.day, 10)):
            self.client.force_authenticate(user=unscheduled)
            response = self.client.get('/api/handovers/eligible-recipients/')
        self.assertFalse(response.data['onDuty'])
        self.assertEqual(response.data['recipients'], [])
        self.assertEqual(response.data['emptyReason'], 'user_off_duty')

    def test_no_next_shift_staff_empty_reason(self):
        # On duty, but literally nobody — in any department — is scheduled
        # for the next shift.
        morning = make_nurse('reason_morning2')
        make_shift(morning, self.dept, self.day, 'morning')

        with patch('api.referral_shifts.timezone.now', return_value=self._now_at(self.day, 10)):
            self.client.force_authenticate(user=morning)
            response = self.client.get('/api/handovers/eligible-recipients/')
        self.assertTrue(response.data['onDuty'])
        self.assertEqual(response.data['recipients'], [])
        self.assertEqual(response.data['emptyReason'], 'no_next_shift_staff')

    def test_only_self_scheduled_empty_reason(self):
        # Double-booked: on duty for the current (morning) shift, and also
        # the only one scheduled for the department's next (afternoon) shift.
        morning = make_nurse('reason_morning3')
        make_shift(morning, self.dept, self.day, 'morning')
        make_shift(morning, self.dept, self.day, 'afternoon')

        with patch('api.referral_shifts.timezone.now', return_value=self._now_at(self.day, 10)):
            self.client.force_authenticate(user=morning)
            response = self.client.get('/api/handovers/eligible-recipients/')
        self.assertTrue(response.data['onDuty'])
        self.assertEqual(response.data['recipients'], [])
        self.assertEqual(response.data['emptyReason'], 'only_self_scheduled')

    def test_no_eligible_nurse_empty_reason_when_only_head_nurse_scheduled(self):
        # Someone else IS scheduled for the next shift, but they're a head
        # nurse — not a valid referral recipient.
        morning = make_nurse('reason_morning4')
        afternoon_head = make_nurse('reason_afternoon_head', role='head_nurse')
        make_shift(morning, self.dept, self.day, 'morning')
        make_shift(afternoon_head, self.dept, self.day, 'afternoon')

        with patch('api.referral_shifts.timezone.now', return_value=self._now_at(self.day, 10)):
            self.client.force_authenticate(user=morning)
            response = self.client.get('/api/handovers/eligible-recipients/')
        self.assertTrue(response.data['onDuty'])
        self.assertEqual(response.data['recipients'], [])
        self.assertEqual(response.data['emptyReason'], 'no_eligible_nurse_on_next_shift')

    def test_no_eligible_nurse_empty_reason_when_scheduled_nurse_not_approved(self):
        morning = make_nurse('reason_morning5')
        afternoon_pending = make_nurse('reason_afternoon_pending')
        NurseProfile.objects.filter(user=afternoon_pending).update(approval_status='pending')
        make_shift(morning, self.dept, self.day, 'morning')
        make_shift(afternoon_pending, self.dept, self.day, 'afternoon')

        with patch('api.referral_shifts.timezone.now', return_value=self._now_at(self.day, 10)):
            self.client.force_authenticate(user=morning)
            response = self.client.get('/api/handovers/eligible-recipients/')
        self.assertEqual(response.data['recipients'], [])
        self.assertEqual(response.data['emptyReason'], 'no_eligible_nurse_on_next_shift')
