"""
Admin approval rules, the administrator activity log (views, changes,
decisions, print requests), active-task filtering, and the present/future
rule for referral schedules.
"""

import datetime
from zoneinfo import ZoneInfo

from django.conf import settings
from django.contrib.auth.models import User
from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from .duty_status import local_today
from .models import AdminAuditLog, Department, DutyAssignment, NurseProfile, Patient, Task
from .tests_referral_workflow import give_current_shift, make_nurse


def make_admin():
    return User.objects.create_user(
        username='admin@admin.com', email='admin@admin.com', password='Admin!2345',
        first_name='Raiden', last_name='Admin', is_staff=True,
    )


def make_applicant(email, status='pending'):
    user = User.objects.create_user(username=email, email=email, password='Pw-test-1234', first_name='Lia', last_name='Santos')
    NurseProfile.objects.create(user=user, role='staff_nurse', approval_status=status, is_active_staff=True)
    return user


class ApprovalRuleTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = make_admin()
        self.client.force_authenticate(self.admin)

    def test_an_approved_account_cannot_be_rejected_or_approved_again(self):
        user = make_applicant('lia@hospital.com')
        self.assertEqual(self.client.post(f'/api/admin/users/{user.pk}/approve/').status_code, 200)
        res = self.client.post(f'/api/admin/users/{user.pk}/reject/', {'reason': 'Changed my mind'}, format='json')
        self.assertEqual(res.status_code, 409)
        self.assertIn('Deactivate', res.data['detail'])
        self.assertEqual(self.client.post(f'/api/admin/users/{user.pk}/approve/').status_code, 409)
        profile = NurseProfile.objects.get(user=user)
        self.assertEqual(profile.approval_status, 'approved')
        self.assertEqual(profile.rejection_reason, '')
        # Suspending an approved account goes through deactivate instead.
        self.assertEqual(self.client.post(f'/api/admin/users/{user.pk}/deactivate/').status_code, 200)
        profile.refresh_from_db()
        self.assertFalse(profile.is_active_staff)
        self.assertEqual(profile.approval_status, 'approved')

    def test_pending_reject_works_and_is_logged_once(self):
        user = make_applicant('mia@hospital.com')
        res = self.client.post(f'/api/admin/users/{user.pk}/reject/', {'reason': 'ID mismatch'}, format='json')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(self.client.post(f'/api/admin/users/{user.pk}/reject/', {'reason': 'x'}, format='json').status_code, 409)
        entries = AdminAuditLog.objects.filter(action='reject', record_type='accounts', record_id=str(user.pk))
        self.assertEqual(entries.count(), 1)
        # A rejected registration can still be reconsidered and approved.
        self.assertEqual(self.client.post(f'/api/admin/users/{user.pk}/approve/').status_code, 200)
        self.assertTrue(AdminAuditLog.objects.filter(action='approve', record_id=str(user.pk)).exists())


class AdminAuditTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = make_admin()
        self.nurse = make_applicant('nurse@hospital.com', status='approved')
        self.dept = Department.objects.create(name='Audit Ward')
        self.patient = Patient.objects.create(
            patient_code='P700', name='Juan Dela Cruz', age=60, gender='Male', room='301',
            diagnosis='CHF', admission_date=local_today(),
        )
        self.client.force_authenticate(self.admin)

    def test_viewing_a_patient_and_a_department_is_logged_without_clinical_details(self):
        self.assertEqual(self.client.get('/api/admin/records/patients/P700/').status_code, 200)
        self.assertEqual(self.client.get(f'/api/admin/records/departments/{self.dept.pk}/').status_code, 200)
        view = AdminAuditLog.objects.get(action='view', record_type='patients')
        self.assertEqual(view.record_id, 'P700')
        self.assertEqual(view.actor, self.admin)
        self.assertEqual(view.actor_role, 'Administrator')
        self.assertEqual(view.changes, {})
        self.assertNotIn('CHF', str(view.changes) + view.summary)
        self.assertTrue(AdminAuditLog.objects.filter(action='view', record_type='departments', record_id=str(self.dept.pk)).exists())

    def test_failed_and_unauthorized_requests_are_not_logged_as_success(self):
        self.assertEqual(self.client.get('/api/admin/records/patients/NOPE/').status_code, 404)
        self.assertFalse(AdminAuditLog.objects.filter(record_id='NOPE').exists())
        res = self.client.patch('/api/admin/records/patients/P700/', {'age': 'abc'}, format='json')
        self.assertEqual(res.status_code, 400)
        self.assertFalse(AdminAuditLog.objects.filter(action='update').exists())
        self.client.force_authenticate(self.nurse)
        self.assertEqual(self.client.get('/api/admin/records/patients/P700/').status_code, 403)
        self.assertFalse(AdminAuditLog.objects.exists())

    def test_successful_changes_record_before_and_after_and_never_secrets(self):
        res = self.client.patch(f'/api/admin/users/{self.nurse.pk}/', {'phoneNumber': '09170000000'}, format='json')
        self.assertEqual(res.status_code, 200, res.content)
        update = AdminAuditLog.objects.get(action='update', record_type='accounts')
        self.assertEqual(update.changes['phoneNumber'][1], '09170000000')
        self.client.post(f'/api/admin/users/{self.nurse.pk}/set-password/', {'password': 'S3cret-pass!'}, format='json')
        reset = AdminAuditLog.objects.get(action='password_reset')
        self.assertNotIn('S3cret', str(reset.changes) + reset.summary)
        self.client.get(f'/api/admin/users/{self.nurse.pk}/')
        self.assertTrue(AdminAuditLog.objects.filter(action='view', record_type='accounts').exists())

    def test_print_request_is_logged_as_requested(self):
        res = self.client.post('/api/admin/audit-log/print/', {
            'recordType': 'patients', 'scope': 'list', 'count': 12, 'title': 'Patients',
            'filters': {'search': 'cruz'},
        }, format='json')
        self.assertEqual(res.status_code, 201)
        entry = AdminAuditLog.objects.get(action='print')
        self.assertEqual(entry.status, 'requested')
        self.assertEqual(entry.changes['count'], 12)
        self.assertEqual(entry.changes['filters'], {'search': 'cruz'})

    def test_audit_log_filters_paging_and_detail(self):
        self.client.get('/api/admin/records/patients/P700/')
        self.client.post('/api/admin/audit-log/print/', {'recordType': 'patients', 'count': 1}, format='json')
        data = self.client.get('/api/admin/audit-log/', {'category': 'view', 'page': 1}).data
        self.assertEqual(data['count'], 1)
        self.assertEqual(data['results'][0]['action'], 'view')
        self.assertEqual(self.client.get('/api/admin/audit-log/', {'category': 'print', 'page': 1}).data['count'], 1)
        self.assertEqual(self.client.get('/api/admin/audit-log/', {'recordId': 'P700', 'page': 1}).data['count'], 1)
        self.assertEqual(self.client.get('/api/admin/audit-log/', {'actor': 'raiden', 'page': 1}).data['count'], 2)
        self.assertEqual(self.client.get('/api/admin/audit-log/', {'actor': 'nobody', 'page': 1}).data['count'], 0)
        tomorrow = (local_today() + datetime.timedelta(days=1)).isoformat()
        self.assertEqual(self.client.get('/api/admin/audit-log/', {'dateFrom': tomorrow, 'page': 1}).data['count'], 0)
        self.assertEqual(self.client.get('/api/admin/audit-log/', {'dateFrom': 'bad', 'page': 1}).status_code, 400)
        page = self.client.get('/api/admin/audit-log/', {'pageSize': 1, 'page': 2, 'order': 'oldest'}).data
        self.assertEqual(page['results'][0]['action'], 'print')
        everything = self.client.get('/api/admin/audit-log/', {'all': 'true'}).data
        self.assertEqual(len(everything['results']), 2)
        entry_id = everything['results'][0]['id']
        self.assertEqual(self.client.get(f'/api/admin/audit-log/{entry_id}/').status_code, 200)

    def test_audit_log_is_admin_only_and_read_only(self):
        self.client.get('/api/admin/records/patients/P700/')
        entry = AdminAuditLog.objects.get()
        self.client.force_authenticate(self.nurse)
        self.assertEqual(self.client.get('/api/admin/audit-log/').status_code, 403)
        self.assertEqual(self.client.post('/api/admin/audit-log/print/', {'recordType': 'x'}).status_code, 403)
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.delete(f'/api/admin/audit-log/{entry.pk}/').status_code, 405)
        self.assertEqual(self.client.patch(f'/api/admin/audit-log/{entry.pk}/', {'summary': 'x'}).status_code, 405)
        self.assertEqual(self.client.patch(f'/api/admin/records/audit/{entry.pk}/', {}).status_code, 404)
        self.assertTrue(AdminAuditLog.objects.filter(pk=entry.pk).exists())


class ActiveTaskFilterTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.nurse = make_applicant('ana@hospital.com', status='approved')
        self.client.force_authenticate(self.nurse)
        for i, (priority, status) in enumerate([('high', 'completed'), ('high', 'pending'), ('low', 'overdue'), ('low', 'completed')]):
            Task.objects.create(
                task_code=f'TF{i}', title=f'Task {i}', priority=priority, status=status,
                assigned_nurse=self.nurse, assigned_to='Lia Santos', checklist=[],
                completed_at=timezone.now() if status == 'completed' else None,
            )

    def test_active_excludes_completed_whatever_the_priority(self):
        codes = lambda **p: sorted(t['id'] for t in self.client.get('/api/tasks/', p).data)  # noqa: E731
        self.assertEqual(codes(active='true'), ['TF1', 'TF2'])
        self.assertEqual(codes(active='true', priority='high'), ['TF1'])
        self.assertEqual(codes(status='overdue'), ['TF2'])
        self.assertEqual(codes(status='completed'), ['TF0', 'TF3'])
        # Completed tasks keep their priority and completion time.
        done = self.client.get('/api/tasks/TF0/').data
        self.assertEqual(done['priority'], 'high')
        self.assertIsNotNone(done['completedAt'])


class ReferralScheduleTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.sender = make_nurse('out@hospital.com', 'Ana', 'Cruz', department='ICU')
        self.recipient = make_nurse('in@hospital.com', 'Ben', 'Diaz', department='ICU')
        self.patient = Patient.objects.create(
            patient_code='P600', name='Juan Dela Cruz', age=61, gender='Male',
            room='204-B', diagnosis='CHF', admission_date=datetime.date(2026, 3, 2),
        )
        dept = Department.objects.get_or_create(name='Referral Schedule Ward')[0]
        give_current_shift(self.sender, dept, 'morning')
        today = timezone.now().astimezone(ZoneInfo(settings.DUTY_LOCAL_TIMEZONE)).date()
        DutyAssignment.objects.create(
            nurse=self.recipient, department=dept, duty_date=today, shift='afternoon',
            start_time=DutyAssignment.SHIFT_DEFAULT_TIMES['afternoon'][0],
            end_time=DutyAssignment.SHIFT_DEFAULT_TIMES['afternoon'][1],
        )
        self.client.force_authenticate(self.sender)

    def post(self, due_at, patient='P600'):
        return self.client.post('/api/handovers/', {
            'patientId': patient, 'shift': 'morning', 'date': '2026-03-03', 'dueAt': due_at,
            'nurseFrom': 'Ana Cruz', 'nurseTo': 'Ben Diaz', 'nurseToId': str(self.recipient.pk),
            'sbar': {'situation': 's', 'background': 'b', 'assessment': 'a', 'recommendation': 'r'},
        }, format='json')

    def test_past_and_present_are_rejected_and_future_is_accepted(self):
        now = timezone.now()
        for past in (now - datetime.timedelta(days=1), now - datetime.timedelta(minutes=30), now - datetime.timedelta(seconds=1)):
            res = self.post(past.isoformat())
            self.assertEqual(res.status_code, 400, past)
            self.assertIn('dueAt', res.data)
        self.assertEqual(self.post((now + datetime.timedelta(minutes=30)).isoformat()).status_code, 201)
        Patient.objects.create(
            patient_code='P601', name='Lito Reyes', age=40, gender='Male', room='205',
            diagnosis='x', admission_date=datetime.date(2026, 3, 2),
        )
        res = self.post((now + datetime.timedelta(days=1)).isoformat(), patient='P601')
        self.assertEqual(res.status_code, 201, res.content)
