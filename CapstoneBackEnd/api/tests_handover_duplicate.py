"""
A given nurse can only receive one handover for a given patient — once
Nurse X has been handed Patient Y, Nurse X must not be offered (or accepted)
for Patient Y again. This is scoped to the (patient, nurse) pair, so a
*different* nurse can still receive the same patient, including while an
earlier handover for that patient is still unacknowledged.
"""

import datetime
from zoneinfo import ZoneInfo

from django.conf import settings
from django.contrib.auth.models import User
from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APITestCase

from .models import Department, DutyAssignment, HandoverNote, NurseProfile, Patient


def make_nurse(email, first, last):
    user = User.objects.create_user(
        username=email, email=email, password='pw-test-1234',
        first_name=first, last_name=last,
    )
    NurseProfile.objects.create(user=user, role='staff_nurse', department='Med-Surg')
    return user


def give_shift_pair(sender, recipients, department):
    """Duty Roster coverage for the shift-rotation rule (see
    api/referral_shifts.py): `sender` on Morning (a wide window, so it
    covers "now" regardless of the real wall clock), every `recipients` on
    Afternoon (the next shift) — all in `department`."""
    today = timezone.now().astimezone(ZoneInfo(settings.DUTY_LOCAL_TIMEZONE)).date()
    DutyAssignment.objects.create(
        nurse=sender, department=department, duty_date=today, shift='morning',
        start_time=datetime.time(0, 0), end_time=datetime.time(23, 59, 59),
    )
    for recipient in recipients:
        DutyAssignment.objects.create(
            nurse=recipient, department=department, duty_date=today, shift='afternoon',
            start_time=DutyAssignment.SHIFT_DEFAULT_TIMES['afternoon'][0],
            end_time=DutyAssignment.SHIFT_DEFAULT_TIMES['afternoon'][1],
        )


class HandoverDuplicateTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.sender = make_nurse('ana@hospital.com', 'Ana', 'Cruz')
        self.receiver = make_nurse('ben@hospital.com', 'Ben', 'Diaz')
        self.third = make_nurse('cora@hospital.com', 'Cora', 'Reyes')
        self.patient = Patient.objects.create(
            patient_code='P970', name='Juan Dela Cruz', age=61, gender='Male',
            room='204-B', diagnosis='CHF', admission_date=datetime.date(2026, 3, 2),
            risk_level='medium', attending_physician='Dr. Lim',
        )
        dept = Department.objects.get_or_create(name='Handover Duplicate Test Ward')[0]
        give_shift_pair(self.sender, [self.receiver, self.third], dept)
        self.client.force_authenticate(user=self.sender)

    def create_handover(self, nurse_to='Ben Diaz', nurse_to_id=None):
        body = {
            'patientId': 'P970', 'shift': 'morning', 'date': '2026-09-04',
            'dueAt': (timezone.now() + datetime.timedelta(hours=2)).isoformat(),
            'nurseFrom': 'Ana Cruz', 'nurseTo': nurse_to,
            'sbar': {'situation': 'Stable', 'background': '', 'assessment': '', 'recommendation': ''},
        }
        if nurse_to_id is not None:
            body['nurseToId'] = str(nurse_to_id)
        return self.client.post('/api/handovers/', body, format='json')

    def test_a_second_handover_to_the_same_nurse_for_the_same_patient_is_blocked(self):
        first = self.create_handover('Ben Diaz', self.receiver.pk)
        self.assertEqual(first.status_code, 201)

        second = self.create_handover('Ben Diaz', self.receiver.pk)
        self.assertEqual(second.status_code, 400)
        self.assertIn('Ben Diaz', str(second.data))

    def test_a_different_nurse_can_still_receive_the_same_patient(self):
        # Even while the first handover is still unacknowledged — the
        # restriction is per (patient, nurse), not per patient alone.
        first = self.create_handover('Ben Diaz', self.receiver.pk)
        self.assertEqual(first.status_code, 201)

        second = self.create_handover('Cora Reyes', self.third.pk)
        self.assertEqual(second.status_code, 201)

    def test_handover_for_a_different_patient_is_unaffected(self):
        other_patient = Patient.objects.create(
            patient_code='P971', name='Maria Santos', age=45, gender='Female',
            room='205-A', diagnosis='Pneumonia', admission_date=datetime.date(2026, 3, 2),
            risk_level='low', attending_physician='Dr. Lim',
        )
        self.create_handover('Ben Diaz', self.receiver.pk)
        response = self.client.post('/api/handovers/', {
            'patientId': 'P971', 'shift': 'morning', 'date': '2026-09-04',
            'dueAt': (timezone.now() + datetime.timedelta(hours=2)).isoformat(),
            'nurseFrom': 'Ana Cruz', 'nurseTo': 'Ben Diaz', 'nurseToId': str(self.receiver.pk),
            'sbar': {'situation': 'Stable', 'background': '', 'assessment': '', 'recommendation': ''},
        }, format='json')
        self.assertEqual(response.status_code, 201)

    def test_the_same_nurse_is_still_blocked_after_acknowledging(self):
        # Acknowledging does not reset the (patient, nurse) pairing — Ben has
        # now received this patient and cannot be handed it again.
        first = self.create_handover('Ben Diaz', self.receiver.pk)
        code = first.data['id']

        self.client.force_authenticate(user=self.receiver)
        ack = self.client.post(f'/api/handovers/{code}/acknowledge/')
        self.assertEqual(ack.status_code, 200)

        second = self.create_handover('Ben Diaz', self.receiver.pk)
        self.assertEqual(second.status_code, 400)

    def test_handover_with_no_patient_link_is_never_blocked(self):
        # Free-text/legacy handovers with no patientId have nothing to
        # collide on — never blocked by this check.
        first = self.client.post('/api/handovers/', {
            'shift': 'morning', 'date': '2026-09-04',
            'dueAt': (timezone.now() + datetime.timedelta(hours=2)).isoformat(),
            'nurseFrom': 'Ana Cruz', 'nurseTo': 'Ben Diaz',
            'patientName': 'Walk-in, not yet in the system',
            'sbar': {'situation': 'Stable', 'background': '', 'assessment': '', 'recommendation': ''},
        }, format='json')
        self.assertEqual(first.status_code, 201)
        second = self.client.post('/api/handovers/', {
            'shift': 'morning', 'date': '2026-09-04',
            'dueAt': (timezone.now() + datetime.timedelta(hours=2)).isoformat(),
            'nurseFrom': 'Ana Cruz', 'nurseTo': 'Ben Diaz',
            'patientName': 'Walk-in, not yet in the system',
            'sbar': {'situation': 'Stable', 'background': '', 'assessment': '', 'recommendation': ''},
        }, format='json')
        self.assertEqual(second.status_code, 201)


class NurseListExcludeForPatientTests(APITestCase):
    """NurseViewSet's ?excludeForPatient= is the frontend-facing half of the
    same rule: a nurse who already received this patient must not appear
    in the picker at all."""

    def setUp(self):
        cache.clear()
        self.sender = make_nurse('ana2@hospital.com', 'Ana', 'Cruz')
        self.receiver = make_nurse('ben2@hospital.com', 'Ben', 'Diaz')
        self.third = make_nurse('cora2@hospital.com', 'Cora', 'Reyes')
        self.patient = Patient.objects.create(
            patient_code='P980', name='Juan Dela Cruz', age=61, gender='Male',
            room='204-B', diagnosis='CHF', admission_date=datetime.date(2026, 3, 2),
            risk_level='medium', attending_physician='Dr. Lim',
        )
        self.other_patient = Patient.objects.create(
            patient_code='P981', name='Maria Santos', age=45, gender='Female',
            room='205-A', diagnosis='Pneumonia', admission_date=datetime.date(2026, 3, 2),
            risk_level='low', attending_physician='Dr. Lim',
        )
        dept = Department.objects.get_or_create(name='Nurse Exclude Test Ward')[0]
        give_shift_pair(self.sender, [self.receiver], dept)
        self.client.force_authenticate(user=self.sender)

    def test_a_nurse_who_received_the_patient_is_excluded(self):
        create = self.client.post('/api/handovers/', {
            'patientId': 'P980', 'shift': 'morning', 'date': '2026-09-04',
            'dueAt': (timezone.now() + datetime.timedelta(hours=2)).isoformat(),
            'nurseFrom': 'Ana Cruz', 'nurseTo': 'Ben Diaz', 'nurseToId': str(self.receiver.pk),
            'sbar': {'situation': '', 'background': '', 'assessment': '', 'recommendation': ''},
        }, format='json')
        self.assertEqual(create.status_code, 201, create.content)

        resp = self.client.get('/api/nurses/?excludeForPatient=P980')
        self.assertEqual(resp.status_code, 200)
        ids = [n['id'] for n in resp.data]
        self.assertNotIn(str(self.receiver.pk), ids)
        self.assertIn(str(self.third.pk), ids)

    def test_the_same_nurse_is_not_excluded_for_a_different_patient(self):
        create = self.client.post('/api/handovers/', {
            'patientId': 'P980', 'shift': 'morning', 'date': '2026-09-04',
            'dueAt': (timezone.now() + datetime.timedelta(hours=2)).isoformat(),
            'nurseFrom': 'Ana Cruz', 'nurseTo': 'Ben Diaz', 'nurseToId': str(self.receiver.pk),
            'sbar': {'situation': '', 'background': '', 'assessment': '', 'recommendation': ''},
        }, format='json')
        self.assertEqual(create.status_code, 201, create.content)

        resp = self.client.get('/api/nurses/?excludeForPatient=P981')
        self.assertEqual(resp.status_code, 200)
        ids = [n['id'] for n in resp.data]
        self.assertIn(str(self.receiver.pk), ids)

    def test_search_matches_name(self):
        resp = self.client.get('/api/nurses/?search=diaz')
        self.assertEqual(resp.status_code, 200)
        names = [n['name'] for n in resp.data]
        self.assertTrue(any('Diaz' in name for name in names))
        self.assertFalse(any('Reyes' in name for name in names))
