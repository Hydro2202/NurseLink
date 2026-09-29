"""
Accepting a referral moves the work, and tells people about it.

Until a referral is accepted its unfinished-task list is only text on a
card. Acknowledging ("received") is the lightweight seen-it step and moves
nothing; accepting is what actually transfers responsibility. These tests
pin the moment that changes: the incoming nurse ends up with real tasks, the
outgoing nurse finds out, and doing it twice changes nothing.
"""

import datetime
from zoneinfo import ZoneInfo

from django.conf import settings
from django.contrib.auth.models import User
from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APITestCase

from .models import Department, DutyAssignment, HandoverNote, Notification, NurseProfile, Patient, Task


def make_nurse(email, first, last):
    user = User.objects.create_user(
        username=email, email=email, password='pw-test-1234',
        first_name=first, last_name=last,
    )
    NurseProfile.objects.create(user=user, role='staff_nurse', department='Med-Surg')
    return user


def give_shift_pair(sender, recipient, department):
    """
    Duty Roster coverage for the shift-rotation rule (see
    api/referral_shifts.py): sender on Morning (a wide window, so it covers
    "now" no matter when the suite actually runs), recipient on Afternoon
    (the next shift) — both in `department`, since a referral needs both
    sides on file to succeed via the real create path.
    """
    today = timezone.now().astimezone(ZoneInfo(settings.DUTY_LOCAL_TIMEZONE)).date()
    DutyAssignment.objects.create(
        nurse=sender, department=department, duty_date=today, shift='morning',
        start_time=datetime.time(0, 0), end_time=datetime.time(23, 59, 59),
    )
    DutyAssignment.objects.create(
        nurse=recipient, department=department, duty_date=today, shift='afternoon',
        start_time=DutyAssignment.SHIFT_DEFAULT_TIMES['afternoon'][0],
        end_time=DutyAssignment.SHIFT_DEFAULT_TIMES['afternoon'][1],
    )


class HandoverAcceptTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.outgoing = make_nurse('out@hospital.com', 'Ana', 'Cruz')
        self.incoming = make_nurse('in@hospital.com', 'Ben', 'Diaz')
        self.patient = Patient.objects.create(
            patient_code='P500', name='Juan Dela Cruz', age=61, gender='Male',
            room='204-B', diagnosis='CHF', admission_date=datetime.date(2026, 3, 2),
            risk_level='medium', attending_physician='Dr. Lim',
        )

    def make_handover(self, unfinished):
        return HandoverNote.objects.create(
            handover_code='H500',
            patient=self.patient,
            patient_name=self.patient.name,
            shift='morning',
            date=datetime.date(2026, 3, 3),
            nurse_from='Ana Cruz',
            nurse_to='Ben Diaz',
            nurse_to_user=self.incoming,
            unfinished_tasks=unfinished,
            status='sent',
            created_by=self.outgoing,
        )

    def accept(self, handover, user):
        self.client.force_authenticate(user=user)
        return self.client.post('/api/handovers/%s/accept/' % handover.handover_code)

    def test_free_text_notes_become_tasks_for_the_incoming_nurse(self):
        handover = self.make_handover(['Recheck IV site at 14:00', 'Chase morning bloods'])

        response = self.accept(handover, self.incoming)
        self.assertEqual(response.status_code, 200)

        tasks = Task.objects.filter(assigned_nurse=self.incoming).order_by('task_code')
        self.assertEqual(tasks.count(), 2)
        self.assertCountEqual(
            [task.title for task in tasks],
            ['Recheck IV site at 14:00', 'Chase morning bloods'],
        )

        task = tasks.first()
        self.assertEqual(task.status, 'pending')
        self.assertEqual(task.assigned_to, 'Ben Diaz')
        self.assertEqual(task.patient, self.patient)
        self.assertEqual(task.patient_room, '204-B')
        self.assertIn('H500', task.description)
        self.assertIn('Ana Cruz', task.description)

    def test_an_existing_task_changes_hands_instead_of_being_duplicated(self):
        existing = Task.objects.create(
            task_code='T500', title='Wound dressing', patient=self.patient,
            patient_name=self.patient.name, assigned_to='Ana Cruz',
            assigned_nurse=self.outgoing, status='in_progress',
        )
        handover = self.make_handover(['T500'])

        self.accept(handover, self.incoming)

        existing.refresh_from_db()
        self.assertEqual(existing.assigned_nurse, self.incoming)
        self.assertEqual(existing.assigned_to, 'Ben Diaz')
        self.assertEqual(existing.status, 'in_progress', 'progress should survive the move')
        self.assertEqual(Task.objects.filter(title='Wound dressing').count(), 1)

    def test_already_finished_work_is_not_reassigned(self):
        done = Task.objects.create(
            task_code='T501', title='Morning meds', assigned_to='Ana Cruz',
            assigned_nurse=self.outgoing, status='completed',
        )
        handover = self.make_handover(['T501'])

        self.accept(handover, self.incoming)

        done.refresh_from_db()
        self.assertEqual(done.assigned_nurse, self.outgoing)

    def test_accepting_twice_does_not_duplicate_the_work(self):
        handover = self.make_handover(['Recheck IV site'])

        self.accept(handover, self.incoming)
        self.accept(handover, self.incoming)

        self.assertEqual(Task.objects.filter(assigned_nurse=self.incoming).count(), 1)

    def test_the_outgoing_nurse_is_told_it_was_accepted(self):
        handover = self.make_handover(['Recheck IV site', 'Chase bloods'])

        self.accept(handover, self.incoming)

        note = Notification.objects.get(recipient=self.outgoing)
        self.assertEqual(note.title, 'Referral accepted')
        self.assertIn('Ben Diaz', note.message)
        self.assertIn('2 unfinished tasks', note.message)
        self.assertEqual(note.action_highlight_id, 'H500')
        self.assertFalse(note.is_read)
        # The client adds the (app) route group itself. Storing it here too
        # produced /(app)/(app)/handover and an Unmatched Route screen.
        self.assertEqual(note.action_path, '/handover')
        self.assertNotIn('(app)', note.action_path)

    def test_accepting_your_own_handover_notifies_nobody(self):
        handover = self.make_handover([])

        self.accept(handover, self.outgoing)

        self.assertEqual(Notification.objects.filter(recipient=self.outgoing).count(), 0)

    def test_a_handover_with_no_itemised_tasks_still_lands_on_the_task_list(self):
        # This is the common case on this ward: nobody fills in a separate
        # unfinished-tasks list, they write what needs doing in the SBAR
        # recommendation. Accepting the handover must still leave the nurse
        # with something to act on rather than silently producing nothing.
        handover = self.make_handover([])
        handover.recommendation = 'Recheck IV site at 14:00. Keep strict fluid balance.'
        handover.save()

        response = self.accept(handover, self.incoming)

        self.assertEqual(response.status_code, 200)
        handover.refresh_from_db()
        self.assertEqual(handover.status, 'accepted')
        self.assertIsNotNone(handover.accepted_at)

        task = Task.objects.get(assigned_nurse=self.incoming)
        self.assertEqual(task.title, 'Recheck IV site at 14:00')
        self.assertEqual(task.status, 'pending')
        self.assertEqual(task.patient, self.patient)
        self.assertIn('Keep strict fluid balance', task.description)
        self.assertIn('H500', task.description)

    def test_a_handover_with_no_recommendation_still_produces_a_named_task(self):
        handover = self.make_handover([])

        self.accept(handover, self.incoming)

        task = Task.objects.get(assigned_nurse=self.incoming)
        self.assertEqual(task.title, 'Follow up handover for Juan Dela Cruz')

    def test_a_long_recommendation_is_trimmed_for_the_card(self):
        handover = self.make_handover([])
        handover.recommendation = 'x' * 400
        handover.save()

        self.accept(handover, self.incoming)

        task = Task.objects.get(assigned_nurse=self.incoming)
        self.assertLessEqual(len(task.title), 120)
        self.assertTrue(task.title.endswith('...'))
        # Nothing is lost: the full text is still on the task.
        self.assertIn('x' * 400, task.description)

    def test_itemised_tasks_win_over_the_summary(self):
        handover = self.make_handover(['Recheck IV site'])
        handover.recommendation = 'Monitor closely'
        handover.save()

        self.accept(handover, self.incoming)

        titles = list(Task.objects.filter(assigned_nurse=self.incoming).values_list('title', flat=True))
        self.assertEqual(titles, ['Recheck IV site'])

    def test_response_names_the_tasks_that_moved(self):
        handover = self.make_handover(['Recheck IV site'])

        response = self.accept(handover, self.incoming)

        codes = response.json()['adoptedTasks']
        self.assertEqual(len(codes), 1)
        self.assertTrue(Task.objects.filter(task_code=codes[0]).exists())


class HandoverCreatedNotificationTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.outgoing = make_nurse('out@hospital.com', 'Ana', 'Cruz')
        # Two nurses sharing a display name: the reason handovers carry an id.
        self.incoming = make_nurse('ben1@hospital.com', 'Ben', 'Diaz')
        self.twin = make_nurse('ben2@hospital.com', 'Ben', 'Diaz')
        dept = Department.objects.get_or_create(name='Handover Flow Test Ward')[0]
        give_shift_pair(self.outgoing, self.incoming, dept)
        self.client.force_authenticate(user=self.outgoing)

    def payload(self, **extra):
        body = {
            'patientName': 'Juan Dela Cruz',
            'shift': 'morning',
            'date': '2026-03-03',
            'nurseFrom': 'Ana Cruz',
            'nurseTo': 'Ben Diaz',
            'sbar': {'situation': 's', 'background': 'b', 'assessment': 'a', 'recommendation': 'r'},
            'unfinishedTasks': [],
        }
        body.update(extra)
        return body

    def test_the_named_nurse_is_told_a_handover_is_waiting(self):
        response = self.client.post(
            '/api/handovers/', self.payload(nurseToId=str(self.incoming.pk)), format='json'
        )
        self.assertEqual(response.status_code, 201, response.content)

        note = Notification.objects.get(recipient=self.incoming)
        self.assertEqual(note.title, 'Patient Referral')
        self.assertEqual(note.event, 'handover_received')
        self.assertIn('Ana Cruz', note.message)
        self.assertIn('Juan Dela Cruz', note.message)
        self.assertEqual(note.action_path, '/handover')
        # Real references, so the popup can open the record it names.
        self.assertEqual(note.sender, self.outgoing)
        self.assertEqual(note.handover.handover_code, response.json()['id'])
        # The twin must not be told about work that is not theirs.
        self.assertFalse(Notification.objects.filter(recipient=self.twin).exists())

    def test_an_ambiguous_name_with_no_id_is_rejected(self):
        # A handover that saved but resolved to nobody used to look identical
        # to a working one from the sender's side — it appeared in their list,
        # 201 and all — with a popup that simply never arrived as the only
        # symptom. Rejecting it outright means the sender finds out immediately
        # and picks the right Ben Diaz from the list instead.
        response = self.client.post('/api/handovers/', self.payload(), format='json')

        self.assertEqual(response.status_code, 400)
        self.assertIn('nurseToId', response.json())
        self.assertEqual(Notification.objects.count(), 0)
        self.assertFalse(HandoverNote.objects.exists())

    def test_an_unknown_nurse_id_is_rejected(self):
        response = self.client.post(
            '/api/handovers/', self.payload(nurseToId='999999'), format='json'
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('nurseToId', response.json())


class HandoverSenderTaskTests(APITestCase):
    """
    A handover that nobody has accepted yet is still the sender's problem.

    The work has to be on their task list, where they can act on it or mark it
    done, rather than existing only as text on a card they can read.
    """

    def setUp(self):
        cache.clear()
        self.outgoing = make_nurse('out@hospital.com', 'Ana', 'Cruz')
        self.incoming = make_nurse('in@hospital.com', 'Ben', 'Diaz')
        dept = Department.objects.get_or_create(name='Handover Flow Test Ward 2')[0]
        give_shift_pair(self.outgoing, self.incoming, dept)
        self.client.force_authenticate(user=self.outgoing)

    def create_handover(self, **extra):
        body = {
            'patientName': 'Juan Dela Cruz',
            'shift': 'morning',
            'date': '2026-03-03',
            'nurseFrom': 'Ana Cruz',
            'nurseTo': 'Ben Diaz',
            'nurseToId': str(self.incoming.pk),
            'sbar': {
                'situation': 's', 'background': 'b', 'assessment': 'a',
                'recommendation': 'Wean oxygen as tolerated.',
            },
            'unfinishedTasks': [],
        }
        body.update(extra)
        response = self.client.post('/api/handovers/', body, format='json')
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()['id']

    def accept(self, code, user):
        self.client.force_authenticate(user=user)
        return self.client.post('/api/handovers/%s/accept/' % code)

    def test_writing_a_handover_puts_the_work_on_the_senders_list(self):
        self.create_handover()

        task = Task.objects.get(assigned_nurse=self.outgoing)
        self.assertEqual(task.title, 'Wean oxygen as tolerated')
        self.assertEqual(task.status, 'pending')
        self.assertEqual(task.assigned_to, 'Ana Cruz')
        # Nothing lands on the receiving nurse until they accept it.
        self.assertFalse(Task.objects.filter(assigned_nurse=self.incoming).exists())

    def test_each_itemised_entry_becomes_a_task_for_the_sender(self):
        self.create_handover(unfinishedTasks=['Recheck IV site', 'Chase bloods'])

        titles = set(
            Task.objects.filter(assigned_nurse=self.outgoing).values_list('title', flat=True)
        )
        self.assertEqual(titles, {'Recheck IV site', 'Chase bloods'})

    def test_accepting_moves_that_same_task_rather_than_copying_it(self):
        code = self.create_handover()
        task = Task.objects.get(assigned_nurse=self.outgoing)

        self.accept(code, self.incoming)

        task.refresh_from_db()
        self.assertEqual(task.assigned_nurse, self.incoming)
        self.assertEqual(task.assigned_to, 'Ben Diaz')
        # The ward must never end up with two rows for one job.
        self.assertEqual(Task.objects.count(), 1)

    def test_work_the_sender_finished_first_stays_theirs(self):
        code = self.create_handover()
        task = Task.objects.get(assigned_nurse=self.outgoing)
        task.status = 'completed'
        task.save()

        self.accept(code, self.incoming)

        task.refresh_from_db()
        self.assertEqual(task.assigned_nurse, self.outgoing)
        self.assertEqual(Task.objects.count(), 1)

    def test_progress_made_before_the_transfer_survives_it(self):
        code = self.create_handover()
        task = Task.objects.get(assigned_nurse=self.outgoing)
        task.status = 'in_progress'
        task.save()

        self.accept(code, self.incoming)

        task.refresh_from_db()
        self.assertEqual(task.assigned_nurse, self.incoming)
        self.assertEqual(task.status, 'in_progress')

    def test_the_task_is_linked_back_to_its_handover(self):
        code = self.create_handover()

        task = Task.objects.get(assigned_nurse=self.outgoing)
        self.assertEqual(task.source_handover.handover_code, code)
