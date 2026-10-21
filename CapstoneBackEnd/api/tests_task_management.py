"""
Tasks page workflow: Procedure/Referral task types, Done with completion
remarks (once, never twice), the task history log, My Patients folders, and
vital signs schedules that generate one monitoring task per scheduled check.
"""

import datetime
from unittest.mock import patch

from django.contrib.auth.models import User
from django.core.management import call_command
from django.db import connection
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from .duty_status import local_today
from .encryption import PREFIX
from .models import (
    Department, HandoverNote, NurseProfile, Patient, Task, TaskEvent, VitalSigns, VitalSignsSchedule,
)
from .tests_patient_discharge import DISCHARGE_PLAN_PAYLOAD
from .vitals_schedule import generate_all, generate_for_schedule


DUE = {'dueDate': (local_today() + datetime.timedelta(days=1)).isoformat(), 'dueTime': '10:00'}


def make_user(email, first, last, role='staff_nurse'):
    user = User.objects.create_user(username=email, email=email, password='Pw-test-1234', first_name=first, last_name=last)
    NurseProfile.objects.create(user=user, role=role, approval_status='approved', is_active_staff=True)
    return user


class Base(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.head = make_user('head@hospital.com', 'Maria', 'Santos', role='head_nurse')
        self.nurse = make_user('nurse@hospital.com', 'Ana', 'Cruz')
        self.other = make_user('other@hospital.com', 'Ben', 'Diaz')
        self.dept = Department.objects.create(name='Medical Ward T')
        self.patient = Patient.objects.create(
            patient_code='P900', name='Juan Dela Cruz', age=60, gender='Male', room='301',
            diagnosis='CHF', admission_date=local_today(), assigned_nurse=self.nurse,
            department=self.dept, risk_level='high',
        )
        self.other_patient = Patient.objects.create(
            patient_code='P901', name='Lito Reyes', age=40, gender='Male', room='302',
            diagnosis='x', admission_date=local_today(), assigned_nurse=self.other, department=self.dept,
        )

    def task(self, title='Wound care', nurse=None, patient=None, **extra):
        nurse = nurse or self.nurse
        defaults = dict(
            task_code=f'T{Task.objects.count() + 100}', title=title, patient=patient or self.patient,
            assigned_nurse=nurse, assigned_to=f'{nurse.first_name} {nurse.last_name}', checklist=[],
        )
        defaults.update(extra)
        return Task.objects.create(**defaults)

    def complete(self, task, remarks='Dressing changed, wound clean, patient tolerated well.', user=None):
        self.client.force_authenticate(user or self.nurse)
        return self.client.post(f'/api/tasks/{task.task_code}/complete/', {'remarks': remarks}, format='json')


class TaskTypeTests(Base):
    def test_create_with_type_and_filter_by_type(self):
        self.client.force_authenticate(self.nurse)
        res = self.client.post('/api/tasks/', {
            'title': 'Specialist consult follow-up', 'patientId': 'P900', 'priority': 'medium',
            'category': 'care', 'taskType': 'referral', **DUE,
        }, format='json')
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(res.data['taskType'], 'referral')
        self.task('Vitals')  # default: procedure
        refs = self.client.get('/api/tasks/', {'taskType': 'referral'}).data
        procs = self.client.get('/api/tasks/', {'taskType': 'procedure'}).data
        self.assertEqual([t['taskType'] for t in refs], ['referral'])
        self.assertEqual({t['taskType'] for t in procs}, {'procedure'})

    def test_tasks_created_from_a_referral_are_referral_tasks(self):
        from .handover_tasks import _create_summary_task

        handover = HandoverNote.objects.create(
            handover_code='H900', patient=self.patient, patient_name=self.patient.name,
            nurse_from='Ben Diaz', nurse_to='Ana Cruz', shift='morning', date=local_today(),
            recommendation='Follow up cardiology consult',
        )
        task = _create_summary_task(handover, self.nurse, 'Ana Cruz')
        self.assertEqual(task.task_type, 'referral')
        self.assertTrue(task.events.filter(event='created').exists())


class CompletionTests(Base):
    def test_done_requires_remarks_and_saves_them_encrypted(self):
        task = self.task()
        self.assertEqual(self.complete(task, remarks='  ').status_code, 400)
        task.refresh_from_db()
        self.assertNotEqual(task.status, 'completed')

        res = self.complete(task)
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data['status'], 'completed')
        self.assertEqual(res.data['completedBy'], 'Ana Cruz')
        self.assertIn('Dressing changed', res.data['completionRemarks'])
        with connection.cursor() as cursor:
            cursor.execute('SELECT completion_remarks FROM api_task WHERE id = %s', [task.pk])
            self.assertTrue(cursor.fetchone()[0].startswith(PREFIX))
        # Survives a fresh read (refresh / new login).
        self.client.force_authenticate(self.nurse)
        again = self.client.get(f'/api/tasks/{task.task_code}/').data
        self.assertIn('Dressing changed', again['completionRemarks'])

    def test_a_second_done_is_rejected_and_records_one_event(self):
        task = self.task()
        self.assertEqual(self.complete(task).status_code, 200)
        self.assertEqual(self.complete(task, remarks='again').status_code, 409)
        self.assertEqual(task.events.filter(event='completed').count(), 1)

    def test_failed_completion_leaves_the_task_open(self):
        task = self.task(checklist=[{'text': 'Verify patient identity', 'done': False}])
        res = self.complete(task)
        self.assertEqual(res.status_code, 400)
        task.refresh_from_db()
        self.assertEqual(task.status, 'pending')
        self.assertEqual(task.completion_remarks, '')
        self.assertFalse(task.events.filter(event='completed').exists())

    def test_a_nurse_cannot_complete_another_nurses_task(self):
        task = self.task(nurse=self.other, patient=self.other_patient)
        self.assertEqual(self.complete(task).status_code, 404)

    def test_completion_cannot_bypass_done_through_patch(self):
        task = self.task()
        self.client.force_authenticate(self.nurse)
        res = self.client.patch(f'/api/tasks/{task.task_code}/', {'status': 'completed'}, format='json')
        self.assertEqual(res.status_code, 400)

    def test_only_a_head_nurse_reopens_and_the_completion_stays_in_history(self):
        task = self.task()
        self.complete(task)
        self.client.force_authenticate(self.nurse)
        self.assertEqual(
            self.client.patch(f'/api/tasks/{task.task_code}/', {'status': 'pending'}, format='json').status_code, 400
        )
        self.client.force_authenticate(self.head)
        res = self.client.patch(f'/api/tasks/{task.task_code}/', {'status': 'pending'}, format='json')
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data['completionRemarks'], '')
        completed = task.events.get(event='completed')
        self.assertIn('Dressing changed', completed.remarks)
        self.assertTrue(task.events.filter(event='status_changed', details__reopened=True).exists())

    def test_amending_remarks_keeps_the_previous_version(self):
        task = self.task()
        self.complete(task, remarks='First version of the note.')
        self.client.force_authenticate(self.nurse)
        res = self.client.post(
            f'/api/tasks/{task.task_code}/amend-remarks/', {'remarks': 'Corrected note.'}, format='json'
        )
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data['completionRemarks'], 'Corrected note.')
        amended = task.events.get(event='remarks_amended')
        self.assertEqual(amended.previous_remarks, 'First version of the note.')
        self.client.force_authenticate(self.other)
        self.assertEqual(
            self.client.post(f'/api/tasks/{task.task_code}/amend-remarks/', {'remarks': 'x y z'}).status_code, 404
        )


class HistoryTests(Base):
    def test_history_lists_recorded_events_within_scope(self):
        self.client.force_authenticate(self.nurse)
        created = self.client.post('/api/tasks/', {
            'title': 'IV site check', 'patientId': 'P900', 'priority': 'high', 'category': 'care', **DUE,
        }, format='json').data
        Task.objects.filter(task_code=created['id']).update(checklist=[])
        self.complete(Task.objects.get(task_code=created['id']), remarks='IV site clean and patent.')
        self.task('Someone else', nurse=self.other, patient=self.other_patient)

        self.client.force_authenticate(self.nurse)
        rows = self.client.get('/api/tasks/history/').data
        events = [(r['taskId'], r['event']) for r in rows]
        self.assertIn((created['id'], 'created'), events)
        self.assertIn((created['id'], 'completed'), events)
        self.assertNotIn('Someone else', {r['taskTitle'] for r in rows})
        completed = next(r for r in rows if r['event'] == 'completed')
        self.assertEqual(completed['remarks'], 'IV site clean and patent.')
        self.assertEqual(completed['actorName'], 'Ana Cruz')

        self.assertEqual(self.client.get('/api/tasks/history/', {'q': 'patent'}).data[0]['event'], 'completed')
        self.assertEqual(self.client.get('/api/tasks/history/', {'taskType': 'referral'}).data, [])
        self.assertEqual(self.client.get('/api/tasks/history/', {'event': 'completed'}).data[0]['event'], 'completed')
        tomorrow = (local_today() + datetime.timedelta(days=1)).isoformat()
        self.assertEqual(self.client.get('/api/tasks/history/', {'dateFrom': tomorrow}).data, [])

    def test_tasks_from_before_the_log_show_only_what_they_recorded(self):
        old = self.task('Old task', status='completed', completed_at=timezone.now())
        TaskEvent.objects.filter(task=old).delete()
        self.client.force_authenticate(self.nurse)
        rows = [r for r in self.client.get('/api/tasks/history/').data if r['taskId'] == old.task_code]
        self.assertEqual({r['event'] for r in rows}, {'created', 'completed'})
        self.assertTrue(all(r['source'] == 'task_record' for r in rows))
        # Nobody is credited with an action that was never recorded.
        self.assertTrue(all(r['actorName'] == '' for r in rows))


class MyPatientsTests(Base):
    def test_only_assigned_patients_with_counts(self):
        done = self.task('Done one')
        self.complete(done)
        self.task('Open one')
        self.task('Not mine', nurse=self.other, patient=self.other_patient)

        self.client.force_authenticate(self.nurse)
        rows = self.client.get('/api/tasks/my-patients/').data
        self.assertEqual([r['patientId'] for r in rows], ['P900'])
        self.assertEqual(rows[0]['unfinishedTasks'], 1)
        self.assertEqual(rows[0]['finishedTasks'], 1)

        # A nurse can't read another nurse's patient's tasks through the API either.
        other_tasks = self.client.get('/api/tasks/', {'patientId': 'P901'}).data
        self.assertEqual(other_tasks, [])


class VitalsScheduleTests(Base):
    def set_schedule(self, user, **body):
        self.client.force_authenticate(user)
        return self.client.post('/api/patients/P900/vitals-schedule/', body, format='json')

    def test_frequency_must_be_1_2_or_4_and_scope_is_enforced(self):
        self.assertEqual(self.set_schedule(self.nurse, frequencyHours=3).status_code, 400)
        self.assertEqual(self.set_schedule(self.other, frequencyHours=2).status_code, 403)
        res = self.set_schedule(self.nurse, frequencyHours=2, basis='Dr. Reyes order')
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data['active']['frequencyHours'], 2)
        self.assertEqual(res.data['active']['setBy'], 'Ana Cruz')
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get('/api/patients/P900/vitals-schedule/').status_code, 200)

    def test_each_interval_generates_one_task_per_check_without_duplicates(self):
        for hours in (1, 2, 4):
            VitalSignsSchedule.objects.all().delete()
            Task.objects.all().delete()
            start = timezone.now() - datetime.timedelta(minutes=59)
            schedule = VitalSignsSchedule.objects.create(
                patient=self.patient, frequency_hours=hours, start_at=start, set_by=self.nurse,
            )
            later = start + datetime.timedelta(hours=8)
            generate_for_schedule(schedule, now=later)
            generate_for_schedule(schedule, now=later)  # repeated run
            generate_all(now=later)
            times = list(Task.objects.filter(vitals_schedule=schedule).order_by('scheduled_for')
                         .values_list('scheduled_for', flat=True))
            # Every check from start through the next one inside the 30-minute lead.
            expected = [start + datetime.timedelta(hours=hours * k) for k in range(8 // hours + 1)]
            self.assertEqual(times, expected, f'every {hours}h')
            task = Task.objects.filter(vitals_schedule=schedule).first()
            self.assertEqual(task.assigned_nurse, self.nurse)
            self.assertEqual(task.category, 'vital_signs')
            self.assertEqual(task.task_type, 'procedure')
            self.assertEqual(task.vital_readings_required, 1)

    def test_changing_the_schedule_keeps_past_checks_and_drops_future_untouched_ones(self):
        start = timezone.now() - datetime.timedelta(hours=3)
        old = VitalSignsSchedule.objects.create(patient=self.patient, frequency_hours=1, start_at=start)
        generate_for_schedule(old)
        past = Task.objects.filter(vitals_schedule=old, scheduled_for__lte=timezone.now())
        past_ids = set(past.values_list('pk', flat=True))
        self.assertTrue(past_ids)
        Task.objects.filter(pk=min(past_ids)).update(status='completed', completion_remarks='BP 120/80')

        res = self.set_schedule(self.head, frequencyHours=4, reason='Stable per physician')
        self.assertEqual(res.status_code, 200, res.content)
        old.refresh_from_db()
        self.assertIsNotNone(old.ended_at)
        self.assertEqual(old.end_reason, 'Stable per physician')
        self.assertTrue(past_ids <= set(Task.objects.values_list('pk', flat=True)))
        self.assertFalse(Task.objects.filter(vitals_schedule=old, scheduled_for__gt=timezone.now()).exists())
        self.assertEqual(Task.objects.get(pk=min(past_ids)).completion_remarks, 'BP 120/80')
        self.assertEqual(len(res.data['history']), 2)
        self.assertEqual(VitalSignsSchedule.objects.filter(patient=self.patient, ended_at__isnull=True).count(), 1)

    def test_a_scheduled_check_completes_after_one_reading(self):
        schedule = VitalSignsSchedule.objects.create(
            patient=self.patient, frequency_hours=2, start_at=timezone.now() - datetime.timedelta(minutes=5),
        )
        generate_for_schedule(schedule)
        task = Task.objects.get(vitals_schedule=schedule)
        self.client.force_authenticate(self.nurse)
        url = f'/api/tasks/{task.task_code}/'
        self.assertEqual(
            self.client.patch(url, {'checklist': [{'text': 'Vital Signs Check', 'done': True}]}, format='json').status_code,
            400,
        )
        VitalSigns.objects.create(patient=self.patient, task=task, heart_rate=80, recorded_by=self.nurse)
        self.assertEqual(
            self.client.patch(url, {'checklist': [{'text': 'Vital Signs Check', 'done': True}]}, format='json').status_code,
            200,
        )
        self.assertEqual(self.complete(task, remarks='HR 80, BP 120/80, afebrile.').status_code, 200)

    def test_summary_and_discharge_end_the_schedule(self):
        self.set_schedule(self.nurse, frequencyHours=1, startAt=(timezone.now() - datetime.timedelta(minutes=30)).isoformat())
        data = self.client.get('/api/patients/P900/vitals-schedule/').data['active']
        self.assertIn(data['monitoringStatus'], ('on_schedule', 'overdue'))
        self.assertIsNotNone(data['nextCheckAt'])
        self.assertEqual(self.set_schedule(self.nurse, frequencyHours=1, startAt='not a date').status_code, 400)
        self.assertEqual(
            self.set_schedule(
                self.nurse, frequencyHours=1, startAt=(timezone.now() - datetime.timedelta(hours=5)).isoformat()
            ).status_code,
            400,
        )

        self.client.force_authenticate(self.head)
        res = self.client.post('/api/patients/P900/discharge/', DISCHARGE_PLAN_PAYLOAD, format='json')
        self.assertEqual(res.status_code, 200, res.content)
        self.assertFalse(VitalSignsSchedule.objects.filter(patient=self.patient, ended_at__isnull=True).exists())
        self.assertEqual(VitalSignsSchedule.objects.get(patient=self.patient).end_reason, 'Patient discharged')

    def test_management_command_and_live_poll_generate(self):
        VitalSignsSchedule.objects.create(
            patient=self.patient, frequency_hours=4, start_at=timezone.now() - datetime.timedelta(minutes=1),
        )
        call_command('generate_vitals_tasks', verbosity=0)
        self.assertEqual(Task.objects.filter(vitals_schedule__isnull=False).count(), 1)
        with patch('api.vitals_schedule.cache.add', return_value=True):
            self.client.force_authenticate(self.nurse)
            self.client.get('/api/tasks/')
        self.assertEqual(Task.objects.filter(vitals_schedule__isnull=False).count(), 1)


class VitalsReminderTests(Base):
    def test_assigned_nurse_is_reminded_five_minutes_before_with_the_time(self):
        from zoneinfo import ZoneInfo

        from django.conf import settings

        from .models import Notification
        from .notifications import check_due_task_reminders

        tz = ZoneInfo(settings.DUTY_LOCAL_TIMEZONE)
        check_at = timezone.now().astimezone(tz).replace(second=0, microsecond=0) + datetime.timedelta(minutes=20)
        schedule = VitalSignsSchedule.objects.create(patient=self.patient, frequency_hours=1, start_at=check_at)
        generate_for_schedule(schedule)
        task = Task.objects.get(vitals_schedule=schedule)

        # 20 minutes out: no reminder yet.
        check_due_task_reminders(self.nurse)
        self.assertFalse(Notification.objects.filter(recipient=self.nurse).exists())

        # 4 minutes before: one reminder naming the patient and the time.
        with patch('api.notifications.timezone.now', return_value=check_at - datetime.timedelta(minutes=4)):
            check_due_task_reminders(self.nurse)
            check_due_task_reminders(self.nurse)
        notes = Notification.objects.filter(recipient=self.nurse)
        self.assertEqual(notes.count(), 1)
        note = notes.get()
        at = check_at.strftime('%I:%M %p').lstrip('0')
        self.assertIn(at, note.title)
        self.assertIn('Juan Dela Cruz', note.message)
        self.assertEqual(note.action_path, '/tasks?openVitals=1')
        self.assertEqual(note.action_highlight_id, task.task_code)
        self.assertFalse(Notification.objects.filter(recipient=self.other).exists())

        # Past the due time: no second "due now" for the same check.
        with patch('api.notifications.timezone.now', return_value=check_at + datetime.timedelta(minutes=2)):
            check_due_task_reminders(self.nurse)
        self.assertEqual(Notification.objects.filter(recipient=self.nurse).count(), 1)
        task.refresh_from_db()
        self.assertEqual(task.status, 'overdue')
