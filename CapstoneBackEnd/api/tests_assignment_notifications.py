"""
A head nurse assigning a patient or a duty must notify the nurse on the
other end — see notify_patient_assigned/notify_duty_assigned in
notifications.py, wired from PatientAssignmentSerializer (AssignmentViewSet)
and DutyAssignmentViewSet. Task assignment's own notify_task_assigned is
already covered by tests_task_assignment.py; this file is the item-4 gap it
didn't fill.
"""
from django.contrib.auth.models import User
from django.core.cache import cache
from django.core.management import call_command
from django.utils import timezone
from rest_framework.test import APITestCase

from .models import Department, DutyAssignment, Notification, NurseProfile, Patient, PatientAssignment


def make_nurse(email, first, last, *, role='staff_nurse'):
    user = User.objects.create_user(
        username=email, email=email, password='pw-test-1234', first_name=first, last_name=last,
    )
    NurseProfile.objects.create(
        user=user, role=role, department='ICU', approval_status='approved', is_active_staff=True,
    )
    return user


def make_patient(code, **extra):
    fields = dict(
        patient_code=code, name='Juan Dela Cruz', age=50, gender='Male',
        room='201-A', diagnosis='Observation', admission_date=timezone.localdate(),
    )
    fields.update(extra)
    return Patient.objects.create(**fields)


class PatientAssignmentNotificationTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.head = make_nurse('head@hospital.com', 'Ana', 'Cruz', role='head_nurse')
        self.nurse_a = make_nurse('a@hospital.com', 'Ben', 'Diaz')
        self.nurse_b = make_nurse('b@hospital.com', 'Cora', 'Reyes')
        self.patient = make_patient('P900')
        self.client.force_authenticate(user=self.head)

    def assign(self, nurse):
        return self.client.post(
            '/api/assignments/',
            {'patientId': self.patient.patient_code, 'assignedNurseId': nurse.pk},
            format='json',
        )

    def test_new_nurse_is_notified(self):
        response = self.assign(self.nurse_a)
        self.assertEqual(response.status_code, 201, response.content)

        note = Notification.objects.filter(recipient=self.nurse_a, event='patient_assigned').first()
        self.assertIsNotNone(note)
        self.assertIn('Juan Dela Cruz', note.message)
        self.assertIn('201-A', note.message)
        self.assertIn('Ana Cruz', note.message)
        self.assertEqual(note.action_path, '/my-patients')
        self.assertEqual(note.action_highlight_id, 'P900')

    def test_previous_nurse_is_notified_when_reassigned(self):
        self.assign(self.nurse_a)
        Notification.objects.all().delete()

        response = self.assign(self.nurse_b)
        self.assertEqual(response.status_code, 201, response.content)

        moved_away = Notification.objects.filter(recipient=self.nurse_a, event='patient_unassigned').first()
        self.assertIsNotNone(moved_away)
        self.assertIn('Juan Dela Cruz', moved_away.message)

        received = Notification.objects.filter(recipient=self.nurse_b, event='patient_assigned').first()
        self.assertIsNotNone(received)

    def test_head_nurse_assigning_a_patient_to_themselves_is_not_notified(self):
        # Not a realistic workflow (the picker only offers staff nurses), but
        # the self-skip guard must hold even if it is ever reachable.
        from .notifications import notify_patient_assigned

        assignment = PatientAssignment.objects.create(
            patient=self.patient, assigned_nurse=self.head, assigned_nurse_name='Ana Cruz',
        )
        result = notify_patient_assigned(assignment, actor=self.head)
        self.assertIsNone(result)
        self.assertFalse(Notification.objects.filter(recipient=self.head).exists())

    def test_first_assignment_has_no_previous_nurse_to_notify(self):
        response = self.assign(self.nurse_a)
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(Notification.objects.filter(event='patient_unassigned').count(), 0)

    def test_reassigning_via_update_notifies_both_nurses(self):
        create_response = self.assign(self.nurse_a)
        assignment_id = create_response.data['id']
        Notification.objects.all().delete()

        response = self.client.patch(
            f'/api/assignments/{assignment_id}/',
            {'assignedNurseId': self.nurse_b.pk},
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(
            Notification.objects.filter(recipient=self.nurse_a, event='patient_unassigned').exists()
        )
        self.assertTrue(
            Notification.objects.filter(recipient=self.nurse_b, event='patient_assigned').exists()
        )


class DutyAssignmentNotificationTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.head = make_nurse('head@hospital.com', 'Ana', 'Cruz', role='head_nurse')
        self.nurse = make_nurse('nurse@hospital.com', 'Ben', 'Diaz')
        self.dept, _ = Department.objects.get_or_create(name='Medical Ward')
        self.client.force_authenticate(user=self.head)

    def _payload(self, **overrides):
        payload = {
            'nurseId': self.nurse.pk,
            'departmentId': self.dept.pk,
            'dutyDate': '2026-10-18',
            'shift': 'morning',
            'startTime': '07:00',
            'endTime': '15:00',
        }
        payload.update(overrides)
        return payload

    def test_creating_a_duty_notifies_the_nurse(self):
        response = self.client.post('/api/duty-assignments/', self._payload(), format='json')
        self.assertEqual(response.status_code, 201, response.content)

        note = Notification.objects.filter(recipient=self.nurse, event='duty_assigned').first()
        self.assertIsNotNone(note)
        self.assertIn('Morning', note.message)
        self.assertIn('Medical Ward', note.message)
        self.assertEqual(note.action_path, '/my-duty')

    def test_changing_the_shift_notifies_again(self):
        created = self.client.post('/api/duty-assignments/', self._payload(), format='json')
        Notification.objects.all().delete()

        response = self.client.patch(
            f'/api/duty-assignments/{created.data["id"]}/', {'shift': 'night'}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(
            Notification.objects.filter(recipient=self.nurse, event='duty_assigned').exists()
        )

    def test_editing_notes_only_does_not_re_notify(self):
        created = self.client.post('/api/duty-assignments/', self._payload(), format='json')
        Notification.objects.all().delete()

        response = self.client.patch(
            f'/api/duty-assignments/{created.data["id"]}/', {'notes': 'Bring extra gloves'}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertFalse(
            Notification.objects.filter(recipient=self.nurse, event='duty_assigned').exists()
        )

    def test_cancelled_duty_is_not_notified(self):
        response = self.client.post(
            '/api/duty-assignments/', self._payload(status='cancelled'), format='json',
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertFalse(
            Notification.objects.filter(recipient=self.nurse, event='duty_assigned').exists()
        )


class RebalancePatientsNotificationTests(APITestCase):
    def test_rebalance_notifies_the_receiving_nurse(self):
        cache.clear()
        nurse_a = make_nurse('a@hospital.com', 'Ben', 'Diaz')
        nurse_b = make_nurse('b@hospital.com', 'Cora', 'Reyes')
        for i in range(4):
            patient = make_patient(f'P9{i}')
            PatientAssignment.objects.create(
                patient=patient, assigned_nurse=nurse_a, assigned_nurse_name='Ben Diaz', status='active',
            )

        call_command('rebalance_patients')

        self.assertTrue(
            Notification.objects.filter(recipient=nurse_b, event='patient_assigned').exists()
        )
