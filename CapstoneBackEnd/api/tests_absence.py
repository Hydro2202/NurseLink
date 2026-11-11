"""
Nurse-absence management: marking a shift absent, reassigning the absent
nurse's patients, transferring their unfinished tasks (while preserving
completed ones), the notifications that go out, and the authorization and
validation rules around all of it.

Covers the five required scenarios: (1) a normal absence, (2) reassigning
several patients to different nurses, (3) completed tasks staying with the
original nurse, (4) an invalid reassignment being rejected whole, and (5) the
data the dashboards read staying in sync afterward.
"""
import datetime

from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from .models import (
    Department,
    DutyAssignment,
    Notification,
    NurseProfile,
    Patient,
    PatientAssignment,
    Task,
)


def make_nurse(email, role='staff_nurse'):
    user = User.objects.create_user(
        username=email, email=email, password='pw-test-1234',
        first_name=email.split('@')[0].title(), last_name='N',
    )
    NurseProfile.objects.create(user=user, role=role, approval_status='approved', is_active_staff=True)
    return user


class AbsenceManagementTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.head = make_nurse('head@h.com', 'head_nurse')
        self.absent = make_nurse('alice@h.com')
        self.replacement = make_nurse('bob@h.com')
        self.other = make_nurse('carol@h.com')
        self.dept = Department.objects.create(name='ICU')
        self.today = datetime.date.today()

        self.duty = self._duty(self.absent)
        self._duty(self.replacement)  # on duty too, so it's an eligible receiver

        self.p1 = self._patient('P1', 'Patient One', self.absent)
        self.p2 = self._patient('P2', 'Patient Two', self.absent)
        self.client.force_authenticate(self.head)

    def _duty(self, nurse, status='in_progress'):
        return DutyAssignment.objects.create(
            nurse=nurse, department=self.dept, duty_date=self.today,
            shift='morning', start_time=datetime.time(7, 0), end_time=datetime.time(15, 0),
            status=status, created_by=self.head,
        )

    def _patient(self, code, name, nurse):
        patient = Patient.objects.create(
            patient_code=code, name=name, age=50, gender='Male', room='101',
            diagnosis='Obs', admission_date=self.today, assigned_nurse=nurse,
            risk_level='low', allergies=[],
        )
        PatientAssignment.objects.create(patient=patient, assigned_nurse=nurse, status='active')
        return patient

    def _task(self, patient, nurse, status, code):
        return Task.objects.create(
            task_code=code, patient=patient, patient_name=patient.name, title=f'Task {code}',
            assigned_to=f'{nurse.first_name} {nurse.last_name}', assigned_nurse=nurse, status=status,
        )

    # --- Scenario 1: a normal absence -------------------------------------
    def test_mark_absent_records_metadata_and_keeps_the_shift(self):
        res = self.client.post(f'/api/duty-assignments/{self.duty.id}/mark-absent/', {'reason': 'Sick'}, format='json')
        self.assertEqual(res.status_code, 200, res.content)
        self.duty.refresh_from_db()
        self.assertEqual(self.duty.status, 'absent')
        self.assertEqual(self.duty.marked_absent_by, self.head)
        self.assertIsNotNone(self.duty.marked_absent_at)
        self.assertEqual(self.duty.absence_reason, 'Sick')
        # The shift row is NOT deleted.
        self.assertTrue(DutyAssignment.objects.filter(id=self.duty.id).exists())
        # The absent nurse is told.
        self.assertTrue(Notification.objects.filter(recipient=self.absent, event='marked_absent').exists())
        # The response offers the patients to reassign and eligible nurses.
        self.assertEqual({p['id'] for p in res.data['patients']}, {'P1', 'P2'})
        eligible_ids = {n['id'] for n in res.data['eligibleNurses']}
        self.assertIn(str(self.replacement.pk), eligible_ids)
        self.assertNotIn(str(self.absent.pk), eligible_ids)

    def test_mark_absent_is_head_nurse_only(self):
        self.client.force_authenticate(self.other)
        res = self.client.post(f'/api/duty-assignments/{self.duty.id}/mark-absent/', {}, format='json')
        self.assertEqual(res.status_code, 403)

    def test_completed_shift_cannot_be_marked_absent(self):
        self.duty.status = 'completed'
        self.duty.save(update_fields=['status'])
        res = self.client.post(f'/api/duty-assignments/{self.duty.id}/mark-absent/', {}, format='json')
        self.assertEqual(res.status_code, 400)

    def test_reassignment_candidates_shift_filter_does_not_404_the_duty(self):
        # The absent nurse is on a morning shift; filtering candidate nurses by
        # a different shift must still resolve the duty (not 404 it).
        self.client.post(f'/api/duty-assignments/{self.duty.id}/mark-absent/', {}, format='json')
        res = self.client.get(f'/api/duty-assignments/{self.duty.id}/reassignment-candidates/?shift=night')
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual({p['id'] for p in res.data['patients']}, {'P1', 'P2'})

    # --- Scenario 2: reassigning several patients to different nurses -----
    def test_reassign_multiple_patients_to_different_nurses(self):
        self._duty(self.other)  # make carol on-duty & eligible
        self.client.post(f'/api/duty-assignments/{self.duty.id}/mark-absent/', {'reason': 'Sick'}, format='json')
        res = self.client.post(
            f'/api/duty-assignments/{self.duty.id}/reassign-patients/',
            {'assignments': [
                {'patientId': 'P1', 'nurseId': str(self.replacement.pk)},
                {'patientId': 'P2', 'nurseId': str(self.other.pk)},
            ]},
            format='json',
        )
        self.assertEqual(res.status_code, 200, res.content)
        self.p1.refresh_from_db(); self.p2.refresh_from_db()
        self.assertEqual(self.p1.assigned_nurse, self.replacement)
        self.assertEqual(self.p2.assigned_nurse, self.other)
        # Exactly one active assignment per patient, pointing at the new nurse.
        self.assertEqual(PatientAssignment.objects.get(patient=self.p1, status='active').assigned_nurse, self.replacement)
        self.assertEqual(PatientAssignment.objects.filter(patient=self.p1, status='reassigned').count(), 1)
        # Receiving nurses were each notified.
        self.assertTrue(Notification.objects.filter(recipient=self.replacement, event='patient_reassigned').exists())
        self.assertTrue(Notification.objects.filter(recipient=self.other, event='patient_reassigned').exists())

    # --- Scenario 3: completed tasks stay with the original nurse ---------
    def test_unfinished_tasks_transfer_completed_tasks_stay(self):
        pending = self._task(self.p1, self.absent, 'pending', 'T-PEND')
        in_prog = self._task(self.p1, self.absent, 'in_progress', 'T-PROG')
        overdue = self._task(self.p1, self.absent, 'overdue', 'T-OVER')
        done = self._task(self.p1, self.absent, 'completed', 'T-DONE')

        self.client.post(f'/api/duty-assignments/{self.duty.id}/mark-absent/', {}, format='json')
        res = self.client.post(
            f'/api/duty-assignments/{self.duty.id}/reassign-patients/',
            {'assignments': [{'patientId': 'P1', 'nurseId': str(self.replacement.pk)}]},
            format='json',
        )
        self.assertEqual(res.status_code, 200, res.content)
        for t in (pending, in_prog, overdue):
            t.refresh_from_db()
            self.assertEqual(t.assigned_nurse, self.replacement, f'{t.task_code} should move')
        done.refresh_from_db()
        self.assertEqual(done.assigned_nurse, self.absent, 'completed task must stay with original nurse')
        self.assertEqual(res.data['results'][0]['tasksTransferred'], 3)

    # --- Scenario 4: an invalid reassignment is rejected whole ------------
    def test_reassigning_a_patient_not_owned_by_absent_nurse_is_rejected(self):
        self.p2.assigned_nurse = self.other
        self.p2.save(update_fields=['assigned_nurse'])
        self.client.post(f'/api/duty-assignments/{self.duty.id}/mark-absent/', {}, format='json')
        res = self.client.post(
            f'/api/duty-assignments/{self.duty.id}/reassign-patients/',
            {'assignments': [
                {'patientId': 'P1', 'nurseId': str(self.replacement.pk)},
                {'patientId': 'P2', 'nurseId': str(self.replacement.pk)},
            ]},
            format='json',
        )
        self.assertEqual(res.status_code, 400)
        # Nothing was transferred — the whole batch rolled back.
        self.p1.refresh_from_db()
        self.assertEqual(self.p1.assigned_nurse, self.absent)
        self.assertEqual(PatientAssignment.objects.filter(patient=self.p1, status='reassigned').count(), 0)

    def test_reassigning_to_an_absent_nurse_is_rejected(self):
        self.client.post(f'/api/duty-assignments/{self.duty.id}/mark-absent/', {}, format='json')
        # Mark the replacement absent too.
        rep_duty = DutyAssignment.objects.get(nurse=self.replacement)
        self.client.post(f'/api/duty-assignments/{rep_duty.id}/mark-absent/', {}, format='json')
        res = self.client.post(
            f'/api/duty-assignments/{self.duty.id}/reassign-patients/',
            {'assignments': [{'patientId': 'P1', 'nurseId': str(self.replacement.pk)}]},
            format='json',
        )
        self.assertEqual(res.status_code, 400)
        self.p1.refresh_from_db()
        self.assertEqual(self.p1.assigned_nurse, self.absent)

    def test_duplicate_patient_in_one_request_is_rejected(self):
        self.client.post(f'/api/duty-assignments/{self.duty.id}/mark-absent/', {}, format='json')
        res = self.client.post(
            f'/api/duty-assignments/{self.duty.id}/reassign-patients/',
            {'assignments': [
                {'patientId': 'P1', 'nurseId': str(self.replacement.pk)},
                {'patientId': 'P1', 'nurseId': str(self.other.pk)},
            ]},
            format='json',
        )
        self.assertEqual(res.status_code, 400)

    # --- Scenario 5: the dashboards' data stays in sync -------------------
    def test_reassignment_keeps_patient_and_assignment_rows_consistent(self):
        self._task(self.p1, self.absent, 'pending', 'T-1')
        self.client.post(f'/api/duty-assignments/{self.duty.id}/mark-absent/', {}, format='json')
        self.client.post(
            f'/api/duty-assignments/{self.duty.id}/reassign-patients/',
            {'assignments': [{'patientId': 'P1', 'nurseId': str(self.replacement.pk)}]},
            format='json',
        )
        # What the Nurse Dashboard reads: the new nurse's patient list.
        self.assertIn(self.p1, Patient.objects.filter(assigned_nurse=self.replacement))
        self.assertNotIn(self.p1, Patient.objects.filter(assigned_nurse=self.absent))
        # The unique active-assignment invariant holds (no duplicate active rows).
        self.assertEqual(PatientAssignment.objects.filter(patient=self.p1, status='active').count(), 1)
        # The head nurse got a success summary.
        self.assertTrue(Notification.objects.filter(recipient=self.head, event='reassignment_complete').exists())
