"""
Admin edit/delete on every hospital record (api/admin_records.py): an admin can
change or remove any record, the change is what every nurse then reads, each
action is audit-logged, and non-admins can't use the endpoint at all.
"""

import datetime

from django.contrib.auth.models import User
from django.utils import timezone
from rest_framework.test import APITestCase

from .models import (
    AdminAuditLog,
    ChartingNote,
    Department,
    Doctor,
    DutyAssignment,
    HandoverNote,
    KardexRecord,
    NurseProfile,
    Patient,
    Task,
    TaskHandover,
    VitalSigns,
)


def make_user(email, first, last, role='staff_nurse', **profile):
    user = User.objects.create_user(
        username=email, email=email, password='pw-test-1234', first_name=first, last_name=last,
    )
    NurseProfile.objects.create(
        user=user, role=role, approval_status='approved', is_active_staff=True, **profile,
    )
    return user


class AdminRecordTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            username='admin@admin.com', email='admin@admin.com', password='pw-admin-1234',
            is_staff=True, first_name='Raiden',
        )
        self.nurse = make_user('nurse@hospital.com', 'Sarah', 'Johnson')
        self.other = make_user('ben@hospital.com', 'Ben', 'Diaz')
        self.dept = Department.objects.create(name='ICU-T')
        self.dept2 = Department.objects.create(name='ER-T')
        self.patient = Patient.objects.create(
            patient_code='P900', name='Ana Vergara', age=40, gender='Female', room='R1',
            diagnosis='Hernia', admission_date=datetime.date(2026, 10, 1), assigned_nurse=self.nurse,
        )
        self.task = Task.objects.create(
            task_code='T900', title='Vital check', patient=self.patient,
            assigned_to='Sarah Johnson', assigned_nurse=self.nurse,
        )
        self.handover = HandoverNote.objects.create(
            handover_code='H900', patient=self.patient, patient_name='Ana Vergara', shift='morning',
            date=datetime.date(2026, 10, 1), nurse_from='Sarah Johnson', nurse_to='Ben Diaz',
            nurse_to_user=self.other, created_by=self.nurse, situation='s', background='b',
            assessment='a', recommendation='r',
        )
        self.task_handover = TaskHandover.objects.create(
            handover_code='TH900', task_description='Give meds', from_nurse=self.nurse,
            to_nurse=self.other, department=self.dept, shift='morning',
            duty_date=datetime.date(2026, 10, 1),
        )
        self.note = ChartingNote.objects.create(
            note_code='C900', patient=self.patient, patient_name='Ana Vergara', nurse=self.nurse,
            nurse_name='Sarah Johnson', timestamp=timezone.now(), content='Original note',
        )
        self.duty = DutyAssignment.objects.create(
            nurse=self.nurse, department=self.dept, duty_date=datetime.date(2026, 10, 1),
            shift='morning', start_time=datetime.time(7, 0), end_time=datetime.time(15, 0),
        )
        self.kardex = KardexRecord.objects.create(
            patient=self.patient, last_name='Vergara', first_name='Ana', diet='Soft',
        )
        self.vitals = VitalSigns.objects.create(
            patient=self.patient, heart_rate=80, recorded_by=self.nurse,
        )
        self.doctor = Doctor.objects.create(full_name='Dr. Bianca Fernandez', department=self.dept2)

    def url(self, record_type, record_id):
        return f'/api/admin/records/{record_type}/{record_id}/'

    def edits(self):
        return [
            ('patients', 'P900', {'diagnosis': 'Appendicitis'}, lambda: Patient.objects.get(pk=self.patient.pk).diagnosis, 'Appendicitis'),
            ('tasks', 'T900', {'title': 'Wound care'}, lambda: Task.objects.get(pk=self.task.pk).title, 'Wound care'),
            ('handovers', 'H900', {'sbar': {'situation': 'updated'}}, lambda: HandoverNote.objects.get(pk=self.handover.pk).situation, 'updated'),
            ('task-handovers', 'TH900', {'taskDescription': 'Give meds', 'notes': 'Admin note'}, lambda: TaskHandover.objects.get(pk=self.task_handover.pk).notes, 'Admin note'),
            ('charting', 'C900', {'content': 'Edited by admin'}, lambda: ChartingNote.objects.get(pk=self.note.pk).content, 'Edited by admin'),
            ('duty', self.duty.pk, {'departmentId': self.dept2.pk}, lambda: DutyAssignment.objects.get(pk=self.duty.pk).department_id, self.dept2.pk),
            ('kardex', self.kardex.pk, {'diet': 'NPO'}, lambda: KardexRecord.objects.get(pk=self.kardex.pk).diet, 'NPO'),
            ('vitals', self.vitals.pk, {'heartRate': 95}, lambda: VitalSigns.objects.get(pk=self.vitals.pk).heart_rate, 95),
            ('departments', self.dept2.pk, {'name': 'Emergency-T'}, lambda: Department.objects.get(pk=self.dept2.pk).name, 'Emergency-T'),
            ('doctors', self.doctor.pk, {'specialization': 'Surgery'}, lambda: Doctor.objects.get(pk=self.doctor.pk).specialization, 'Surgery'),
        ]

    def test_admin_can_edit_every_record_type_and_it_is_audited(self):
        self.client.force_authenticate(self.admin)
        for record_type, record_id, body, read, expected in self.edits():
            with self.subTest(record_type):
                response = self.client.patch(self.url(record_type, record_id), body, format='json')
                self.assertEqual(response.status_code, 200, response.content)
                self.assertEqual(read(), expected)
                self.assertTrue(AdminAuditLog.objects.filter(
                    action='update', record_type=record_type, record_id=str(record_id),
                ).exists())

    def test_admin_edit_is_what_nurses_see(self):
        self.client.force_authenticate(self.admin)
        self.client.patch(self.url('tasks', 'T900'), {'title': 'Changed by admin'}, format='json')
        self.client.force_authenticate(self.nurse)
        response = self.client.get('/api/tasks/T900/')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.data['title'], 'Changed by admin')

    def test_admin_can_delete_every_record_type(self):
        self.client.force_authenticate(self.admin)
        deletions = [
            ('vitals', self.vitals.pk, VitalSigns, self.vitals.pk),
            ('kardex', self.kardex.pk, KardexRecord, self.kardex.pk),
            ('charting', 'C900', ChartingNote, self.note.pk),
            ('task-handovers', 'TH900', TaskHandover, self.task_handover.pk),
            ('handovers', 'H900', HandoverNote, self.handover.pk),
            ('duty', self.duty.pk, DutyAssignment, self.duty.pk),
            ('tasks', 'T900', Task, self.task.pk),
            ('doctors', self.doctor.pk, Doctor, self.doctor.pk),
            ('patients', 'P900', Patient, self.patient.pk),
        ]
        for record_type, record_id, model, pk in deletions:
            with self.subTest(record_type):
                response = self.client.delete(self.url(record_type, record_id))
                self.assertEqual(response.status_code, 204, response.content)
                self.assertFalse(model.objects.filter(pk=pk).exists())
        self.assertEqual(AdminAuditLog.objects.filter(action='delete').count(), len(deletions))

    def test_department_in_use_gives_a_clear_error_not_a_crash(self):
        self.client.force_authenticate(self.admin)
        response = self.client.delete(self.url('departments', self.dept2.pk))  # doctor uses it
        self.assertEqual(response.status_code, 400)
        self.assertIn('still used', response.data['detail'])

    def test_non_admins_cannot_use_the_endpoint(self):
        for user in (self.nurse, make_user('head@hospital.com', 'Maria', 'Santos', role='head_nurse')):
            self.client.force_authenticate(user)
            self.assertEqual(self.client.patch(self.url('tasks', 'T900'), {'title': 'x'}, format='json').status_code, 403)
            self.assertEqual(self.client.delete(self.url('patients', 'P900')).status_code, 403)
        self.assertTrue(Patient.objects.filter(pk=self.patient.pk).exists())

    def test_unknown_type_is_404(self):
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.delete(self.url('nope', 1)).status_code, 404)

    def test_audit_log_endpoint(self):
        self.client.force_authenticate(self.admin)
        self.client.patch(self.url('tasks', 'T900'), {'title': 'Audited'}, format='json')
        rows = self.client.get('/api/admin/audit-log/').data
        self.assertEqual(rows[0]['recordType'], 'tasks')
        self.assertEqual(rows[0]['actorName'], 'Raiden')
        self.assertIn('title', rows[0]['changes'])


class AdminAccountEditTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            username='admin@admin.com', email='admin@admin.com', password='pw-admin-1234', is_staff=True,
        )
        self.nurse = make_user('nurse@hospital.com', 'Sarah', 'Johnson')
        make_user('taken@hospital.com', 'Tak', 'En')

    def test_admin_edits_account_details_and_nurse_sees_them(self):
        self.client.force_authenticate(self.admin)
        response = self.client.patch(f'/api/admin/users/{self.nurse.pk}/', {
            'firstName': 'Sara', 'middleName': 'Lee', 'phoneNumber': '09170000000', 'department': 'ICU',
        }, format='json')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.data['name'], 'Sara Lee Johnson')
        self.client.force_authenticate(User.objects.get(pk=self.nurse.pk))
        me = self.client.get('/api/auth/me/').data
        self.assertEqual(me['name'], 'Sara Lee Johnson')
        self.assertEqual(me['phoneNumber'], '09170000000')
        self.assertTrue(AdminAuditLog.objects.filter(record_type='accounts', action='update').exists())

    def test_duplicate_email_rejected(self):
        self.client.force_authenticate(self.admin)
        response = self.client.patch(f'/api/admin/users/{self.nurse.pk}/', {'email': 'taken@hospital.com'}, format='json')
        self.assertEqual(response.status_code, 400)

    def test_nurse_cannot_edit_accounts(self):
        self.client.force_authenticate(self.nurse)
        response = self.client.patch(f'/api/admin/users/{self.nurse.pk}/', {'firstName': 'X'}, format='json')
        self.assertEqual(response.status_code, 403)
