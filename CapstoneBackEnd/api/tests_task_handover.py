"""
Task-level shift handover, gated by supervisor verification.

Distinct from HandoverNote (api/tests_handover_flow.py etc.) — this is one
task/duty item, not an SBAR patient note, and the receiving nurse must never
hear about it until a supervisor approves. Everything here checks that gate
holds: same-shift eligibility comes from the real Duty Roster (not a static
profile shift), creation always lands as 'pending', and only approve/reject
can move it from there.
"""

from datetime import time as dtime
from zoneinfo import ZoneInfo

from django.conf import settings
from django.contrib.auth.models import User
from django.utils import timezone
from rest_framework.test import APITestCase

from .models import Department, DutyAssignment, Notification, NurseProfile, Task, TaskHandover


def make_user(email, first, last, *, role='staff_nurse'):
    user = User.objects.create_user(
        username=email, email=email, password='pw-test-1234',
        first_name=first, last_name=last,
    )
    NurseProfile.objects.create(
        user=user, role=role, department='ICU', shift='afternoon',
        approval_status='approved', is_active_staff=True,
    )
    return user


class TaskHandoverTests(APITestCase):
    def setUp(self):
        self.supervisor = make_user('sup@hospital.com', 'Ana', 'Cruz', role='head_nurse')
        self.nurse_a = make_user('nursea@hospital.com', 'Juan', 'Dela Cruz')
        self.nurse_b = make_user('nurseb@hospital.com', 'Maria', 'Santos')
        self.nurse_c = make_user('nursec@hospital.com', 'Pedro', 'Reyes')
        self.nurse_d = make_user('nursed@hospital.com', 'Lena', 'Villa')

        self.dept1, _ = Department.objects.get_or_create(name='Cardiology Unit')
        self.dept2, _ = Department.objects.get_or_create(name='Anesthesiology')

        # Duty-roster "today" is the facility's local calendar day (see
        # DUTY_LOCAL_TIMEZONE), not Django's own TIME_ZONE (UTC) —
        # timezone.localdate() can be a day off from what the shift-eligibility
        # and handover-creation logic under test actually resolves "today" as.
        self.today = timezone.now().astimezone(ZoneInfo(settings.DUTY_LOCAL_TIMEZONE)).date()

        # nurse_a and nurse_b: same shift, same department -> eligible pair.
        DutyAssignment.objects.create(
            nurse=self.nurse_a, department=self.dept1, duty_date=self.today,
            shift='afternoon', start_time=dtime(15, 0), end_time=dtime(23, 0),
        )
        DutyAssignment.objects.create(
            nurse=self.nurse_b, department=self.dept1, duty_date=self.today,
            shift='afternoon', start_time=dtime(15, 0), end_time=dtime(23, 0),
        )
        # nurse_c: same department, different shift -> not eligible.
        DutyAssignment.objects.create(
            nurse=self.nurse_c, department=self.dept1, duty_date=self.today,
            shift='morning', start_time=dtime(7, 0), end_time=dtime(15, 0),
        )
        # nurse_d: same shift, different department -> eligible only when
        # sameDepartment is turned off.
        DutyAssignment.objects.create(
            nurse=self.nurse_d, department=self.dept2, duty_date=self.today,
            shift='afternoon', start_time=dtime(15, 0), end_time=dtime(23, 0),
        )

        self.task = Task.objects.create(
            task_code='T900', title='Recheck IV site', assigned_to='Juan Dela Cruz',
            assigned_nurse=self.nurse_a, status='pending',
        )

    # ---- eligible_recipients ----

    def test_eligible_recipients_lists_same_shift_same_department_nurses(self):
        self.client.force_authenticate(user=self.nurse_a)
        response = self.client.get('/api/task-handovers/eligible_recipients/')
        self.assertEqual(response.status_code, 200, response.content)
        ids = {row['id'] for row in response.data}
        self.assertIn(str(self.nurse_b.pk), ids)
        self.assertNotIn(str(self.nurse_c.pk), ids)  # different shift
        self.assertNotIn(str(self.nurse_d.pk), ids)  # different department (default scoping)

    def test_eligible_recipients_excludes_self(self):
        self.client.force_authenticate(user=self.nurse_a)
        response = self.client.get('/api/task-handovers/eligible_recipients/')
        ids = {row['id'] for row in response.data}
        self.assertNotIn(str(self.nurse_a.pk), ids)

    def test_eligible_recipients_same_department_false_includes_other_departments(self):
        self.client.force_authenticate(user=self.nurse_a)
        response = self.client.get('/api/task-handovers/eligible_recipients/?sameDepartment=false')
        ids = {row['id'] for row in response.data}
        self.assertIn(str(self.nurse_d.pk), ids)

    def test_eligible_recipients_requires_own_duty_assignment(self):
        off_duty_nurse = make_user('off@hospital.com', 'Off', 'Duty')
        self.client.force_authenticate(user=off_duty_nurse)
        response = self.client.get('/api/task-handovers/eligible_recipients/')
        self.assertEqual(response.status_code, 400)
        self.assertIn('no scheduled duty', response.json()['detail'])

    # ---- create ----

    def test_create_handover_is_pending_and_derives_shift_department(self):
        self.client.force_authenticate(user=self.nurse_a)
        response = self.client.post(
            '/api/task-handovers/',
            {'toNurseId': self.nurse_b.pk, 'taskId': self.task.pk, 'notes': 'BP due at 6pm'},
            format='json',
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.data['status'], 'pending')
        self.assertEqual(response.data['shift'], 'afternoon')
        self.assertEqual(response.data['departmentId'], self.dept1.id)
        self.assertEqual(response.data['fromNurseId'], self.nurse_a.pk)
        self.assertEqual(response.data['toNurseId'], self.nurse_b.pk)
        self.assertEqual(response.data['taskTitle'], 'Recheck IV site')

    def test_create_handover_rejects_recipient_on_different_shift(self):
        self.client.force_authenticate(user=self.nurse_a)
        response = self.client.post(
            '/api/task-handovers/',
            {'toNurseId': self.nurse_c.pk, 'taskDescription': 'Chase up labs'},
            format='json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('toNurseId', response.json())
        self.assertEqual(TaskHandover.objects.count(), 0)

    def test_create_handover_requires_task_or_description(self):
        self.client.force_authenticate(user=self.nurse_a)
        response = self.client.post(
            '/api/task-handovers/', {'toNurseId': self.nurse_b.pk}, format='json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('taskDescription', response.json())

    def test_create_handover_rejects_self(self):
        self.client.force_authenticate(user=self.nurse_a)
        response = self.client.post(
            '/api/task-handovers/',
            {'toNurseId': self.nurse_a.pk, 'taskDescription': 'Solo task'},
            format='json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('toNurseId', response.json())

    def test_create_handover_requires_sender_duty_assignment(self):
        off_duty_nurse = make_user('off2@hospital.com', 'Off', 'Duty2')
        self.client.force_authenticate(user=off_duty_nurse)
        response = self.client.post(
            '/api/task-handovers/',
            {'toNurseId': self.nurse_b.pk, 'taskDescription': 'Anything'},
            format='json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('dutyDate', response.json())

    def test_create_handover_does_not_notify_the_receiving_nurse_yet(self):
        self.client.force_authenticate(user=self.nurse_a)
        self.client.post(
            '/api/task-handovers/',
            {'toNurseId': self.nurse_b.pk, 'taskDescription': 'Not verified yet'},
            format='json',
        )
        self.assertFalse(
            Notification.objects.filter(recipient=self.nurse_b, event='task_handover_verified').exists()
        )

    # ---- list scoping ----

    def test_nurse_sees_only_own_sent_or_received_handovers(self):
        h1 = TaskHandover.objects.create(
            handover_code='TH001', task_description='A', from_nurse=self.nurse_a,
            to_nurse=self.nurse_b, department=self.dept1, shift='afternoon', duty_date=self.today,
        )
        TaskHandover.objects.create(
            handover_code='TH002', task_description='B', from_nurse=self.nurse_c,
            to_nurse=self.nurse_d, department=self.dept1, shift='morning', duty_date=self.today,
        )
        self.client.force_authenticate(user=self.nurse_a)
        response = self.client.get('/api/task-handovers/')
        codes = {row['id'] for row in response.data}
        self.assertEqual(codes, {h1.handover_code})

    def test_supervisor_sees_all_handovers_filterable(self):
        TaskHandover.objects.create(
            handover_code='TH001', task_description='A', from_nurse=self.nurse_a,
            to_nurse=self.nurse_b, department=self.dept1, shift='afternoon', duty_date=self.today,
        )
        TaskHandover.objects.create(
            handover_code='TH002', task_description='B', from_nurse=self.nurse_c,
            to_nurse=self.nurse_d, department=self.dept2, shift='morning', duty_date=self.today,
        )
        self.client.force_authenticate(user=self.supervisor)
        response = self.client.get('/api/task-handovers/')
        self.assertEqual(len(response.data), 2)

        response = self.client.get(f'/api/task-handovers/?departmentId={self.dept1.id}')
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]['id'], 'TH001')

        response = self.client.get('/api/task-handovers/?shift=morning')
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]['id'], 'TH002')

    # ---- approve ----

    def test_supervisor_can_approve_pending_handover(self):
        handover = TaskHandover.objects.create(
            handover_code='TH010', task=self.task, task_description='Recheck IV site',
            from_nurse=self.nurse_a, to_nurse=self.nurse_b, department=self.dept1,
            shift='afternoon', duty_date=self.today,
        )
        self.client.force_authenticate(user=self.supervisor)
        response = self.client.post(f'/api/task-handovers/{handover.handover_code}/approve/')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.data['status'], 'verified')
        self.assertEqual(response.data['supervisorId'], self.supervisor.pk)
        self.assertIsNotNone(response.data['verifiedAt'])

        note = Notification.objects.filter(recipient=self.nurse_b, event='task_handover_verified').first()
        self.assertIsNotNone(note)
        self.assertIn('Juan Dela Cruz', note.message)
        self.assertTrue(
            Notification.objects.filter(recipient=self.nurse_a, event='task_handover_accepted').exists()
        )

    def test_nurse_cannot_approve_handover(self):
        handover = TaskHandover.objects.create(
            handover_code='TH011', task_description='X', from_nurse=self.nurse_a,
            to_nurse=self.nurse_b, department=self.dept1, shift='afternoon', duty_date=self.today,
        )
        self.client.force_authenticate(user=self.nurse_a)
        response = self.client.post(f'/api/task-handovers/{handover.handover_code}/approve/')
        self.assertEqual(response.status_code, 403)

    def test_cannot_approve_an_already_reviewed_handover(self):
        handover = TaskHandover.objects.create(
            handover_code='TH012', task_description='X', from_nurse=self.nurse_a,
            to_nurse=self.nurse_b, department=self.dept1, shift='afternoon',
            duty_date=self.today, status='verified',
        )
        self.client.force_authenticate(user=self.supervisor)
        response = self.client.post(f'/api/task-handovers/{handover.handover_code}/approve/')
        self.assertEqual(response.status_code, 400)

    def test_approve_reassigns_a_linked_open_task(self):
        handover = TaskHandover.objects.create(
            handover_code='TH013', task=self.task, task_description='Recheck IV site',
            from_nurse=self.nurse_a, to_nurse=self.nurse_b, department=self.dept1,
            shift='afternoon', duty_date=self.today,
        )
        self.client.force_authenticate(user=self.supervisor)
        self.client.post(f'/api/task-handovers/{handover.handover_code}/approve/')
        self.task.refresh_from_db()
        self.assertEqual(self.task.assigned_nurse_id, self.nurse_b.pk)

    def test_approve_does_not_reassign_a_completed_task(self):
        self.task.status = 'completed'
        self.task.save(update_fields=['status'])
        handover = TaskHandover.objects.create(
            handover_code='TH014', task=self.task, task_description='Recheck IV site',
            from_nurse=self.nurse_a, to_nurse=self.nurse_b, department=self.dept1,
            shift='afternoon', duty_date=self.today,
        )
        self.client.force_authenticate(user=self.supervisor)
        self.client.post(f'/api/task-handovers/{handover.handover_code}/approve/')
        self.task.refresh_from_db()
        self.assertEqual(self.task.assigned_nurse_id, self.nurse_a.pk)

    # ---- reject ----

    def test_supervisor_can_reject_with_reason(self):
        handover = TaskHandover.objects.create(
            handover_code='TH020', task_description='X', from_nurse=self.nurse_a,
            to_nurse=self.nurse_b, department=self.dept1, shift='afternoon', duty_date=self.today,
        )
        self.client.force_authenticate(user=self.supervisor)
        response = self.client.post(
            f'/api/task-handovers/{handover.handover_code}/reject/',
            {'reason': 'Receiving nurse is on break-relief only.'}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.data['status'], 'rejected')
        self.assertEqual(response.data['rejectionReason'], 'Receiving nurse is on break-relief only.')

        note = Notification.objects.filter(recipient=self.nurse_a, event='task_handover_rejected').first()
        self.assertIsNotNone(note)
        self.assertIn('break-relief', note.message)
        self.assertFalse(
            Notification.objects.filter(recipient=self.nurse_b, event='task_handover_verified').exists()
        )

    def test_reject_without_reason_is_allowed(self):
        handover = TaskHandover.objects.create(
            handover_code='TH021', task_description='X', from_nurse=self.nurse_a,
            to_nurse=self.nurse_b, department=self.dept1, shift='afternoon', duty_date=self.today,
        )
        self.client.force_authenticate(user=self.supervisor)
        response = self.client.post(f'/api/task-handovers/{handover.handover_code}/reject/')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.data['status'], 'rejected')

    def test_reject_does_not_reassign_the_task(self):
        handover = TaskHandover.objects.create(
            handover_code='TH022', task=self.task, task_description='Recheck IV site',
            from_nurse=self.nurse_a, to_nurse=self.nurse_b, department=self.dept1,
            shift='afternoon', duty_date=self.today,
        )
        self.client.force_authenticate(user=self.supervisor)
        self.client.post(f'/api/task-handovers/{handover.handover_code}/reject/')
        self.task.refresh_from_db()
        self.assertEqual(self.task.assigned_nurse_id, self.nurse_a.pk)

    def test_nurse_cannot_reject(self):
        handover = TaskHandover.objects.create(
            handover_code='TH023', task_description='X', from_nurse=self.nurse_a,
            to_nurse=self.nurse_b, department=self.dept1, shift='afternoon', duty_date=self.today,
        )
        self.client.force_authenticate(user=self.nurse_b)
        response = self.client.post(f'/api/task-handovers/{handover.handover_code}/reject/')
        self.assertEqual(response.status_code, 403)

    # ---- auth ----

    def test_unauthenticated_cannot_list_or_create(self):
        response = self.client.get('/api/task-handovers/')
        self.assertEqual(response.status_code, 401)
        response = self.client.post('/api/task-handovers/', {}, format='json')
        self.assertEqual(response.status_code, 401)
