"""
Referral (HandoverNote) status flow: sent -> received -> accepted|declined
-> completed. Nurse-to-nurse only — there is no head-nurse approval gate.

These tests pin: the new transitions and their guards, that only the
receiving nurse can drive them (never the sender, never a head nurse), that
head nurses get an FYI-only notification (never actionable) on create/
accept/decline/complete but not on the lightweight "received" step, and that
head nurses can list/retrieve every referral regardless of department but
cannot write to them at all.
"""

import datetime
from zoneinfo import ZoneInfo

from django.conf import settings
from django.contrib.auth.models import User
from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APITestCase

from .models import Department, DutyAssignment, HandoverNote, Notification, NurseProfile, Patient


def make_nurse(email, first, last, *, role='staff_nurse', department='Med-Surg'):
    user = User.objects.create_user(
        username=email, email=email, password='pw-test-1234',
        first_name=first, last_name=last,
    )
    NurseProfile.objects.create(user=user, role=role, department=department)
    return user


def give_current_shift(nurse, department, shift='morning'):
    """
    A DutyAssignment covering right now, regardless of the real wall clock
    — the shift-rotation rule (see api/referral_shifts.py) requires the
    sender to actually be on duty to create a referral at all, which these
    tests otherwise have no reason to fake the clock for.
    """
    today = timezone.now().astimezone(ZoneInfo(settings.DUTY_LOCAL_TIMEZONE)).date()
    return DutyAssignment.objects.create(
        nurse=nurse, department=department, duty_date=today, shift=shift,
        start_time=datetime.time(0, 0), end_time=datetime.time(23, 59, 59),
    )


class ReferralWorkflowTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.sender = make_nurse('out@hospital.com', 'Ana', 'Cruz', department='ICU')
        self.recipient = make_nurse('in@hospital.com', 'Ben', 'Diaz', department='ICU')
        self.other_nurse = make_nurse('other@hospital.com', 'Cara', 'Reyes', department='ICU')
        self.head_nurse = make_nurse('head@hospital.com', 'Head', 'Nurse', role='head_nurse', department='ICU')
        self.patient = Patient.objects.create(
            patient_code='P600', name='Juan Dela Cruz', age=61, gender='Male',
            room='204-B', diagnosis='CHF', admission_date=datetime.date(2026, 3, 2),
            risk_level='medium', attending_physician='Dr. Lim',
        )
        # Duty Roster coverage for the shift-rotation rule: sender on
        # Morning (covers "now"), recipient on Afternoon (the next shift) —
        # both in the same department, per api/referral_shifts.py.
        self.duty_dept = Department.objects.get_or_create(name='Referral Workflow Test Ward')[0]
        give_current_shift(self.sender, self.duty_dept, 'morning')
        today = timezone.now().astimezone(ZoneInfo(settings.DUTY_LOCAL_TIMEZONE)).date()
        DutyAssignment.objects.create(
            nurse=self.recipient, department=self.duty_dept, duty_date=today, shift='afternoon',
            start_time=DutyAssignment.SHIFT_DEFAULT_TIMES['afternoon'][0],
            end_time=DutyAssignment.SHIFT_DEFAULT_TIMES['afternoon'][1],
        )

    def make_handover(self, **extra):
        # Goes through the real create path (POST, as the sender) rather than
        # HandoverNote.objects.create() directly, so the serializer-side
        # effects under test here — status_history seeding, notify_handover_
        # created, notify_referral_head_nurse_fyi — actually fire, exactly as
        # they do for a referral created through the app.
        body = {
            'patientId': self.patient.patient_code, 'shift': 'morning', 'date': '2026-03-03',
            'dueAt': (timezone.now() + datetime.timedelta(hours=2)).isoformat(),
            'nurseFrom': 'Ana Cruz', 'nurseTo': 'Ben Diaz', 'nurseToId': str(self.recipient.pk),
            'sbar': {'situation': 's', 'background': 'b', 'assessment': 'a', 'recommendation': 'r'},
        }
        body.update(extra)
        self.client.force_authenticate(user=self.sender)
        response = self.client.post('/api/handovers/', body, format='json')
        assert response.status_code == 201, response.content
        return HandoverNote.objects.get(handover_code=response.data['id'])

    # --- creation: no approval gate ---------------------------------------

    def test_created_referral_is_immediately_sent_and_visible(self):
        handover = self.make_handover()
        self.assertEqual(handover.status, 'sent')

    def test_created_referral_is_actionable_by_the_receiving_nurse_immediately(self):
        handover = self.make_handover()
        self.client.force_authenticate(user=self.recipient)
        response = self.client.post(f'/api/handovers/{handover.handover_code}/accept/')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.data['status'], 'accepted')

    # --- state machine -------------------------------------------------

    def test_full_flow_sent_received_accepted_completed(self):
        handover = self.make_handover()
        self.client.force_authenticate(user=self.recipient)

        r1 = self.client.post(f'/api/handovers/{handover.handover_code}/acknowledge/')
        self.assertEqual(r1.data['status'], 'received')

        r2 = self.client.post(f'/api/handovers/{handover.handover_code}/accept/')
        self.assertEqual(r2.data['status'], 'accepted')

        r3 = self.client.post(f'/api/handovers/{handover.handover_code}/complete/')
        self.assertEqual(r3.data['status'], 'completed')

        handover.refresh_from_db()
        statuses = [entry['status'] for entry in handover.status_history]
        self.assertEqual(statuses, ['sent', 'received', 'accepted', 'completed'])

    def test_decline_from_sent_is_terminal(self):
        handover = self.make_handover()
        self.client.force_authenticate(user=self.recipient)

        response = self.client.post(
            f'/api/handovers/{handover.handover_code}/decline/', {'reason': 'Already caring for this patient'},
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.data['status'], 'declined')
        self.assertEqual(response.data['declinedReason'], 'Already caring for this patient')

        # A declined referral cannot then be accepted.
        accept = self.client.post(f'/api/handovers/{handover.handover_code}/accept/')
        self.assertEqual(accept.status_code, 400)

    def test_complete_requires_accepted_first(self):
        handover = self.make_handover()
        self.client.force_authenticate(user=self.recipient)
        response = self.client.post(f'/api/handovers/{handover.handover_code}/complete/')
        self.assertEqual(response.status_code, 400)

    def test_accept_is_idempotent(self):
        handover = self.make_handover()
        self.client.force_authenticate(user=self.recipient)
        self.client.post(f'/api/handovers/{handover.handover_code}/accept/')
        second = self.client.post(f'/api/handovers/{handover.handover_code}/accept/')
        self.assertEqual(second.status_code, 200)
        self.assertEqual(second.data['status'], 'accepted')

    # --- permissions: nurse-to-nurse only, no middle-tier check -----------

    def test_head_nurse_cannot_accept(self):
        handover = self.make_handover()
        self.client.force_authenticate(user=self.head_nurse)
        response = self.client.post(f'/api/handovers/{handover.handover_code}/accept/')
        self.assertEqual(response.status_code, 403)

    def test_head_nurse_cannot_decline(self):
        handover = self.make_handover()
        self.client.force_authenticate(user=self.head_nurse)
        response = self.client.post(f'/api/handovers/{handover.handover_code}/decline/')
        self.assertEqual(response.status_code, 403)

    def test_head_nurse_cannot_create_a_referral(self):
        self.client.force_authenticate(user=self.head_nurse)
        response = self.client.post('/api/handovers/', {
            'patientId': self.patient.patient_code, 'shift': 'morning', 'date': '2026-03-03',
            'nurseFrom': 'Head Nurse', 'nurseTo': 'Ben Diaz', 'nurseToId': str(self.recipient.pk),
            'sbar': {'situation': 's', 'background': 'b', 'assessment': 'a', 'recommendation': 'r'},
        }, format='json')
        self.assertEqual(response.status_code, 403)

    def test_head_nurse_cannot_delete_a_referral(self):
        handover = self.make_handover()
        self.client.force_authenticate(user=self.head_nurse)
        response = self.client.delete(f'/api/handovers/{handover.handover_code}/')
        self.assertEqual(response.status_code, 403)

    def test_sender_cannot_accept_their_own_referral(self):
        handover = self.make_handover()
        self.client.force_authenticate(user=self.sender)
        response = self.client.post(f'/api/handovers/{handover.handover_code}/accept/')
        self.assertEqual(response.status_code, 403)

    def test_an_unrelated_nurse_cannot_accept(self):
        handover = self.make_handover()
        self.client.force_authenticate(user=self.other_nurse)
        response = self.client.post(f'/api/handovers/{handover.handover_code}/accept/')
        # The referral isn't visible to a nurse who isn't part of it.
        self.assertEqual(response.status_code, 404)
        handover.refresh_from_db()
        self.assertNotEqual(handover.status, 'accepted')

    def test_status_cannot_be_set_by_direct_patch(self):
        handover = self.make_handover()
        # Only the sender may edit a referral at all, and even they cannot
        # move its status: only accept/decline/complete may change it.
        self.client.force_authenticate(user=self.sender)
        response = self.client.patch(
            f'/api/handovers/{handover.handover_code}/', {'status': 'accepted'}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.content)
        handover.refresh_from_db()
        self.assertEqual(handover.status, 'sent', 'status is read-only; only accept/decline/complete may change it')

    def test_receiving_nurse_cannot_edit_referral_directly(self):
        handover = self.make_handover()
        self.client.force_authenticate(user=self.recipient)
        response = self.client.patch(
            f'/api/handovers/{handover.handover_code}/', {'status': 'accepted'}, format='json',
        )
        self.assertEqual(response.status_code, 403, response.content)
        handover.refresh_from_db()
        self.assertEqual(handover.status, 'sent')
    # --- head-nurse visibility: read-only, FYI notifications --------------

    def test_head_nurse_can_list_all_referrals(self):
        self.make_handover()
        self.client.force_authenticate(user=self.head_nurse)
        response = self.client.get('/api/handovers/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 1)

    def test_head_nurse_with_no_department_sees_all_referrals(self):
        self.make_handover()
        unscoped_head_nurse = make_nurse('head2@hospital.com', 'Other', 'Head', role='head_nurse', department='')
        self.client.force_authenticate(user=unscoped_head_nurse)
        response = self.client.get('/api/handovers/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 1)

    def test_head_nurse_of_a_different_department_still_sees_the_referral(self):
        # Regression test for the bug where a head nurse only saw referrals
        # whose sender/recipient department string exactly matched their
        # own — silently hiding every referral for a head nurse with an
        # admin-only or differently-worded department. Head nurse oversight
        # is global now, same as the ward roster and Kardex.
        self.make_handover()
        other_dept_head_nurse = make_nurse('head3@hospital.com', 'Far', 'Head', role='head_nurse', department='ER')
        self.client.force_authenticate(user=other_dept_head_nurse)
        response = self.client.get('/api/handovers/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 1)

    def test_head_nurse_is_notified_on_create_as_fyi_not_actionable(self):
        self.make_handover()
        note = Notification.objects.get(recipient=self.head_nurse)
        self.assertIn('For your information', note.title)
        self.assertEqual(note.action_label, '')
        self.assertEqual(note.action_path, '')

    def test_head_nurse_is_notified_on_accept_decline_and_complete(self):
        handover = self.make_handover()
        self.client.force_authenticate(user=self.recipient)
        self.client.post(f'/api/handovers/{handover.handover_code}/accept/')
        self.client.post(f'/api/handovers/{handover.handover_code}/complete/')

        events = list(
            Notification.objects.filter(recipient=self.head_nurse).order_by('created_at').values_list('event', flat=True)
        )
        self.assertEqual(events, ['referral_head_nurse_fyi', 'referral_head_nurse_fyi', 'referral_head_nurse_fyi'])

    def test_head_nurse_is_not_notified_on_the_lightweight_received_step(self):
        handover = self.make_handover()
        self.client.force_authenticate(user=self.recipient)
        self.client.post(f'/api/handovers/{handover.handover_code}/acknowledge/')

        # Only the "sent" (created) FYI exists — "received" raises none.
        count = Notification.objects.filter(
            recipient=self.head_nurse, event='referral_head_nurse_fyi'
        ).count()
        self.assertEqual(count, 1)
