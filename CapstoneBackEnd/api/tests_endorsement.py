"""
Endorsement — bulk, any-shift, any-department patient handover with a real
PatientAssignment transfer on accept. Same model/ViewSet as Referral
(HandoverNote, HandoverViewSet), exposed at /endorsements/, triggered by
sending `patientIds` instead of the legacy singular `patientId` — see
HandoverSerializer.create()'s `bulk` branch and HandoverNote.is_endorsement.
"""

import datetime

from django.contrib.auth.models import User
from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APITestCase

from .models import Department, DutyAssignment, HandoverPatient, NurseProfile, Patient, PatientAssignment


def _shared_department():
    # get_or_create, not module-level caching: each test runs in its own
    # rolled-back transaction, so a PK cached across tests would dangle
    # (FK violation) the moment an earlier test's row is rolled back.
    return Department.objects.get_or_create(name='Endorsement Test Ward')[0]


def make_nurse(username, *, role='staff_nurse', active=True, approved=True, shift=None):
    """`shift` (e.g. 'morning') gives the nurse a real in-progress duty right
    now — required for a nurse to be pickable as an endorsement receiver at
    all (see HandoverViewSet.eligible_receivers / HandoverSerializer.create()'s
    "Receiving nurse has no assigned shift" check). Omit it for a nurse that
    is never used as a receiver in a given test."""
    user = User.objects.create_user(
        username=username, email=f'{username}@hospital.test', password='pw-test-1234',
        first_name=username, last_name='Nurse',
    )
    NurseProfile.objects.create(
        user=user, role=role,
        is_active_staff=active,
        approval_status='approved' if approved else 'pending',
    )
    if shift:
        times = DutyAssignment.SHIFT_DEFAULT_TIMES[shift]
        DutyAssignment.objects.create(
            nurse=user, department=_shared_department(), duty_date=timezone.now().date(),
            shift=shift, start_time=times[0], end_time=times[1], status='in_progress',
        )
    return user


def make_patient(code, name='Test Patient', *, assigned_to=None):
    patient = Patient.objects.create(
        patient_code=code, name=name, age=50, gender='Male',
        room='R-1', diagnosis='Test', admission_date=datetime.date(2026, 9, 1),
    )
    if assigned_to is not None:
        PatientAssignment.objects.create(patient=patient, assigned_nurse=assigned_to, status='active')
        patient.refresh_from_db()
    return patient


class EndorsementTestCase(APITestCase):
    def setUp(self):
        cache.clear()

    def _endorse(self, sender, receiver, patients, *, notes='', patient_notes=None):
        self.client.force_authenticate(user=sender)
        return self.client.post('/api/endorsements/', {
            'patientIds': [p.patient_code for p in patients],
            'patientNotes': patient_notes or {},
            'date': '2026-09-02',
            'nurseFrom': sender.get_full_name(),
            'nurseTo': receiver.get_full_name() if receiver else '',
            'nurseToId': str(receiver.pk) if receiver else '',
            'sbar': {
                'situation': notes, 'background': '', 'assessment': '', 'recommendation': notes or 'See notes',
            },
        }, format='json')


class EndorsementCreationRulesTests(EndorsementTestCase):
    def test_any_shift_and_department_combination_succeeds(self):
        sender = make_nurse('end_sender1')
        receiver = make_nurse('end_receiver1', shift='morning')
        patient = make_patient('END001', assigned_to=sender)

        response = self._endorse(sender, receiver, [patient])
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data['endorsementStatus'], 'PENDING')

    def test_self_endorsement_rejected(self):
        sender = make_nurse('end_self1')
        patient = make_patient('END002', assigned_to=sender)

        response = self._endorse(sender, sender, [patient])
        self.assertEqual(response.status_code, 400)
        self.assertIn('nurseToId', response.data)

    def test_inactive_receiver_rejected(self):
        sender = make_nurse('end_inactive_sender')
        receiver = make_nurse('end_inactive_receiver', active=False, shift='morning')
        patient = make_patient('END003', assigned_to=sender)

        response = self._endorse(sender, receiver, [patient])
        self.assertEqual(response.status_code, 400)
        self.assertIn('nurseToId', response.data)

    def test_unapproved_receiver_rejected(self):
        sender = make_nurse('end_unapproved_sender')
        receiver = make_nurse('end_unapproved_receiver', approved=False, shift='morning')
        patient = make_patient('END004', assigned_to=sender)

        response = self._endorse(sender, receiver, [patient])
        self.assertEqual(response.status_code, 400)
        self.assertIn('nurseToId', response.data)

    def test_receiver_with_no_shift_rejected(self):
        sender = make_nurse('end_noshift_sender')
        receiver = make_nurse('end_noshift_receiver')  # no shift param -> no duty at all
        patient = make_patient('END021', assigned_to=sender)

        response = self._endorse(sender, receiver, [patient])
        self.assertEqual(response.status_code, 400, response.data)
        self.assertIn('Receiving nurse has no assigned shift', str(response.data))

    def test_patient_not_assigned_to_endorser_rejected(self):
        sender = make_nurse('end_notmine_sender')
        other_nurse = make_nurse('end_notmine_other')
        receiver = make_nurse('end_notmine_receiver', shift='morning')
        patient = make_patient('END005', assigned_to=other_nurse)

        response = self._endorse(sender, receiver, [patient])
        self.assertEqual(response.status_code, 400)
        self.assertIn('patientIds', response.data)

    def test_patient_already_pending_rejected(self):
        sender = make_nurse('end_pending_sender')
        receiver1 = make_nurse('end_pending_receiver1', shift='morning')
        receiver2 = make_nurse('end_pending_receiver2', shift='morning')
        patient = make_patient('END006', assigned_to=sender)

        first = self._endorse(sender, receiver1, [patient])
        self.assertEqual(first.status_code, 201, first.data)

        second = self._endorse(sender, receiver2, [patient])
        self.assertEqual(second.status_code, 400)
        self.assertIn('Patient already has a pending endorsement', str(second.data))

    def test_at_least_one_patient_required(self):
        sender = make_nurse('end_empty_sender')
        receiver = make_nurse('end_empty_receiver', shift='morning')

        self.client.force_authenticate(user=sender)
        response = self.client.post('/api/endorsements/', {
            'patientIds': [],
            'date': '2026-09-02', 'nurseFrom': 'S', 'nurseTo': 'R', 'nurseToId': str(receiver.pk),
            'sbar': {'situation': '', 'background': '', 'assessment': '', 'recommendation': 'r'},
        }, format='json')
        self.assertEqual(response.status_code, 400)

    def test_bulk_endorsement_carries_every_patient_and_its_notes(self):
        sender = make_nurse('end_bulk_sender')
        receiver = make_nurse('end_bulk_receiver', shift='morning')
        p1 = make_patient('END007', assigned_to=sender)
        p2 = make_patient('END008', assigned_to=sender)

        response = self._endorse(
            sender, receiver, [p1, p2], patient_notes={'END007': 'watch sats', 'END008': 'npo'},
        )
        self.assertEqual(response.status_code, 201, response.data)
        notes_by_id = {p['patientId']: p['notes'] for p in response.data['patients']}
        self.assertEqual(notes_by_id, {'END007': 'watch sats', 'END008': 'npo'})


class EndorsementAcceptTransferTests(EndorsementTestCase):
    def test_accept_transfers_every_patient_to_the_receiver(self):
        sender = make_nurse('end_accept_sender')
        receiver = make_nurse('end_accept_receiver', shift='morning')
        p1 = make_patient('END010', assigned_to=sender)
        p2 = make_patient('END011', assigned_to=sender)

        created = self._endorse(sender, receiver, [p1, p2])
        code = created.data['id']

        self.client.force_authenticate(user=receiver)
        response = self.client.patch(f'/api/endorsements/{code}/accept/')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['endorsementStatus'], 'ACCEPTED')

        p1.refresh_from_db()
        p2.refresh_from_db()
        self.assertEqual(p1.assigned_nurse_id, receiver.pk)
        self.assertEqual(p2.assigned_nurse_id, receiver.pk)

        # Endorser's "my patients" no longer lists them; receiver's does.
        self.client.force_authenticate(user=sender)
        sender_patients = self.client.get('/api/endorsements/my-patients/').data
        self.assertNotIn('END010', [p['id'] for p in sender_patients])

        self.client.force_authenticate(user=receiver)
        receiver_patients = self.client.get('/api/endorsements/my-patients/').data
        self.assertIn('END010', [p['id'] for p in receiver_patients])
        self.assertIn('END011', [p['id'] for p in receiver_patients])

    def test_accept_closes_old_assignment_with_ended_at_and_endorsed_reason(self):
        sender = make_nurse('end_audit_sender')
        receiver = make_nurse('end_audit_receiver', shift='morning')
        patient = make_patient('END012', assigned_to=sender)
        old_assignment = PatientAssignment.objects.get(patient=patient, status='active')

        created = self._endorse(sender, receiver, [patient])
        self.client.force_authenticate(user=receiver)
        self.client.patch(f"/api/endorsements/{created.data['id']}/accept/")

        old_assignment.refresh_from_db()
        self.assertEqual(old_assignment.status, 'reassigned')
        self.assertIsNotNone(old_assignment.ended_at)
        self.assertEqual(old_assignment.end_reason, 'ENDORSED')

        new_assignment = PatientAssignment.objects.get(patient=patient, status='active')
        self.assertEqual(new_assignment.assigned_nurse_id, receiver.pk)
        self.assertIsNotNone(new_assignment.source_handover_id)
        self.assertEqual(new_assignment.source_handover.handover_code, created.data['id'])

    def test_reject_leaves_patients_with_the_endorser(self):
        sender = make_nurse('end_reject_sender')
        receiver = make_nurse('end_reject_receiver', shift='morning')
        patient = make_patient('END013', assigned_to=sender)

        created = self._endorse(sender, receiver, [patient])
        self.client.force_authenticate(user=receiver)
        response = self.client.patch(
            f"/api/endorsements/{created.data['id']}/reject/", {'reason': 'Too busy'}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['endorsementStatus'], 'REJECTED')

        patient.refresh_from_db()
        self.assertEqual(patient.assigned_nurse_id, sender.pk)

    def test_reject_without_a_reason_is_rejected(self):
        sender = make_nurse('end_reject_noreason_sender')
        receiver = make_nurse('end_reject_noreason_receiver', shift='morning')
        patient = make_patient('END014', assigned_to=sender)

        created = self._endorse(sender, receiver, [patient])
        self.client.force_authenticate(user=receiver)
        response = self.client.patch(f"/api/endorsements/{created.data['id']}/reject/", {}, format='json')
        self.assertEqual(response.status_code, 400)

    def test_cancel_leaves_patients_with_the_endorser(self):
        sender = make_nurse('end_cancel_sender')
        receiver = make_nurse('end_cancel_receiver', shift='morning')
        patient = make_patient('END015', assigned_to=sender)

        created = self._endorse(sender, receiver, [patient])
        self.client.force_authenticate(user=sender)
        response = self.client.patch(f"/api/endorsements/{created.data['id']}/cancel/")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['endorsementStatus'], 'CANCELLED')

        patient.refresh_from_db()
        self.assertEqual(patient.assigned_nurse_id, sender.pk)

    def test_receiver_cannot_cancel_only_endorser_can(self):
        sender = make_nurse('end_cancel_perm_sender')
        receiver = make_nurse('end_cancel_perm_receiver', shift='morning')
        patient = make_patient('END016', assigned_to=sender)

        created = self._endorse(sender, receiver, [patient])
        self.client.force_authenticate(user=receiver)
        response = self.client.patch(f"/api/endorsements/{created.data['id']}/cancel/")
        self.assertEqual(response.status_code, 403)

    def test_accept_fails_if_a_patient_was_reassigned_while_pending(self):
        sender = make_nurse('end_race_sender')
        receiver = make_nurse('end_race_receiver', shift='morning')
        someone_else = make_nurse('end_race_someone_else')
        patient = make_patient('END017', assigned_to=sender)

        created = self._endorse(sender, receiver, [patient])

        # The patient gets reassigned to a third nurse while the
        # endorsement sits pending (e.g. a head nurse override).
        PatientAssignment.objects.filter(patient=patient, status='active').update(status='reassigned')
        PatientAssignment.objects.create(patient=patient, assigned_nurse=someone_else, status='active')

        self.client.force_authenticate(user=receiver)
        response = self.client.patch(f"/api/endorsements/{created.data['id']}/accept/")
        self.assertEqual(response.status_code, 400, response.data)

        patient.refresh_from_db()
        self.assertEqual(patient.assigned_nurse_id, someone_else.pk)

    def test_rollback_on_failure_leaves_no_patient_double_owned_or_orphaned(self):
        """If the transfer fails partway (simulated: one of two patients was
        reassigned elsewhere while pending), neither patient's ownership
        changes — not just the one that failed the re-check."""
        sender = make_nurse('end_rollback_sender')
        receiver = make_nurse('end_rollback_receiver', shift='morning')
        someone_else = make_nurse('end_rollback_someone_else')
        p1 = make_patient('END018', assigned_to=sender)
        p2 = make_patient('END019', assigned_to=sender)

        created = self._endorse(sender, receiver, [p1, p2])

        PatientAssignment.objects.filter(patient=p2, status='active').update(status='reassigned')
        PatientAssignment.objects.create(patient=p2, assigned_nurse=someone_else, status='active')

        self.client.force_authenticate(user=receiver)
        response = self.client.patch(f"/api/endorsements/{created.data['id']}/accept/")
        self.assertEqual(response.status_code, 400, response.data)

        p1.refresh_from_db()
        p2.refresh_from_db()
        # p1 was never touched even though it was still validly the
        # endorser's — the whole accept is one transaction.
        self.assertEqual(p1.assigned_nurse_id, sender.pk)
        self.assertEqual(p2.assigned_nurse_id, someone_else.pk)

        created_note = HandoverPatient.objects.filter(handover__handover_code=created.data['id'])
        self.assertEqual(created_note.count(), 2)


class EndorsementMyPatientsTests(EndorsementTestCase):
    def test_pending_endorsement_flag(self):
        sender = make_nurse('end_flag_sender')
        receiver = make_nurse('end_flag_receiver', shift='morning')
        patient = make_patient('END020', assigned_to=sender)

        self.client.force_authenticate(user=sender)
        before = self.client.get('/api/endorsements/my-patients/').data
        self.assertFalse(next(p for p in before if p['id'] == 'END020')['pendingEndorsement'])

        self._endorse(sender, receiver, [patient])

        self.client.force_authenticate(user=sender)
        after = self.client.get('/api/endorsements/my-patients/').data
        self.assertTrue(next(p for p in after if p['id'] == 'END020')['pendingEndorsement'])
