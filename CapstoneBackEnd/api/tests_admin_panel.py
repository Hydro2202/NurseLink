"""
The in-app Admin panel's data-access surface: a real is_staff account gets
read-only oversight across hospital records it previously got a flat 403 on
(IsApprovedNurse required a NurseProfile, which an admin account never has —
see permissions.IsApprovedNurseOrAdminReadOnly), plus admin-only endpoints
for the registration/identity-verification audit trail and write access to
the Doctor directory (previously Django-admin-only reference data).

Existing nurse/supervisor permission behavior is covered exhaustively
elsewhere (tests_patient_edit.py, tests_nurse_assignment.py, etc.) — this
file only pins the new admin-facing behavior plus one guard per viewset
that a regular approved nurse's access hasn't changed.
"""

import datetime
import uuid

from django.contrib.auth.models import User
from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APITestCase

from .models import (
    Department,
    Doctor,
    FaceVerificationAttempt,
    Notification,
    NurseProfile,
    Patient,
    RegistrationSession,
)


def make_admin(email='admin@admin.com'):
    return User.objects.create_user(username=email, email=email, password='pw-admin-1234', is_staff=True)


def make_registration_session(**extra):
    """A session as it stands after a successful scan on Step 1 — same
    shape tests_signup_department.py uses."""
    fields = dict(
        session_id=uuid.uuid4(),
        face_verified=True,
        id_verification_status='verified', id_portrait='data:image/jpeg;base64,PORTRAIT',
        verification_method='face',
        id_last_name='CRUZ',
        id_first_name='ANA',
        id_middle_name='',
        id_registration_no='1234567',
        id_registration_date=datetime.date(2025, 1, 1),
        id_valid_until=datetime.date(2029, 1, 1),
    )
    fields.update(extra)
    return RegistrationSession.objects.create(**fields)


def make_nurse(email, first, last, *, role='staff_nurse', department='ICU'):
    user = User.objects.create_user(
        username=email, email=email, password='pw-test-1234', first_name=first, last_name=last,
    )
    NurseProfile.objects.create(
        user=user, role=role, department=department, approval_status='approved', is_active_staff=True,
    )
    return user


class AdminReadOnlyOversightTests(APITestCase):
    """Admin gets list access on hospital-record endpoints it previously
    couldn't reach at all, and never gets write access through them."""

    def setUp(self):
        cache.clear()
        self.admin = make_admin()
        self.nurse = make_nurse('nurse@hospital.com', 'Ana', 'Cruz')
        self.department = Department.objects.first() or Department.objects.create(name='ICU')
        self.patient = Patient.objects.create(
            patient_code='P9001', name='Test Patient', age=40, gender='Male',
            room='101', diagnosis='Observation', admission_date=timezone.localdate(),
            assigned_nurse=self.nurse,
        )
        self.client.force_authenticate(self.admin)

    def test_admin_can_list_patients(self):
        response = self.client.get('/api/patients/')
        self.assertEqual(response.status_code, 200, response.content)
        codes = {p['id'] for p in response.data}
        self.assertIn('P9001', codes)

    def test_admin_cannot_create_a_patient(self):
        response = self.client.post('/api/patients/', {
            'name': 'Should Not Save', 'age': 30, 'gender': 'Female', 'room': '202',
        }, format='json')
        self.assertEqual(response.status_code, 403)

    def test_admin_cannot_discharge_a_patient(self):
        response = self.client.post(f'/api/patients/{self.patient.patient_code}/discharge/')
        self.assertEqual(response.status_code, 403)

    def test_admin_can_list_tasks_handovers_and_duty(self):
        for path in ('/api/tasks/', '/api/handovers/', '/api/task-handovers/', '/api/duty-assignments/'):
            response = self.client.get(path)
            self.assertEqual(response.status_code, 200, f'{path} -> {response.content}')

    def test_admin_cannot_create_a_task(self):
        response = self.client.post('/api/tasks/', {'title': 'Should not save'}, format='json')
        self.assertEqual(response.status_code, 403)

    def test_pending_nurse_still_gets_no_access(self):
        pending = make_nurse('pending@hospital.com', 'Ben', 'Diaz')
        pending.nurse_profile.approval_status = 'pending'
        pending.nurse_profile.save(update_fields=['approval_status'])
        self.client.force_authenticate(pending)
        response = self.client.get('/api/patients/')
        self.assertEqual(response.status_code, 403)

    def test_approved_nurse_access_is_unchanged(self):
        self.client.force_authenticate(self.nurse)
        response = self.client.get('/api/patients/')
        self.assertEqual(response.status_code, 200)

    def test_approved_supervisor_can_still_create_a_patient(self):
        supervisor = make_nurse('sup2@hospital.com', 'Maria', 'Santos', role='head_nurse')
        self.client.force_authenticate(supervisor)
        create = self.client.post('/api/patients/', {
            'name': 'Supervisor Created Patient', 'age': 55, 'gender': 'Male', 'room': '303',
            'diagnosis': 'Observation', 'admissionDate': str(timezone.localdate()), 'riskLevel': 'low',
        }, format='json')
        self.assertEqual(create.status_code, 201, create.content)


class DoctorAdminWriteTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.admin = make_admin()
        self.nurse = make_nurse('nurse2@hospital.com', 'Cora', 'Reyes')
        self.department = Department.objects.first() or Department.objects.create(name='ICU')

    def test_admin_can_create_and_update_a_doctor(self):
        self.client.force_authenticate(self.admin)
        create = self.client.post('/api/doctors/', {
            'fullName': 'New Doctor', 'specialization': 'Neurology',
            'departmentId': self.department.pk, 'status': 'active',
        }, format='json')
        self.assertEqual(create.status_code, 201, create.content)
        doctor_id = create.data['id']

        update = self.client.patch(f'/api/doctors/{doctor_id}/', {'status': 'inactive'}, format='json')
        self.assertEqual(update.status_code, 200)
        self.assertEqual(update.data['status'], 'inactive')

    def test_approved_nurse_can_read_but_not_write_doctors(self):
        self.client.force_authenticate(self.nurse)
        listing = self.client.get('/api/doctors/')
        self.assertEqual(listing.status_code, 200)

        create = self.client.post('/api/doctors/', {
            'fullName': 'Should Not Save', 'specialization': 'x',
            'departmentId': self.department.pk, 'status': 'active',
        }, format='json')
        self.assertEqual(create.status_code, 403)


class RegistrationSessionAdminTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.admin = make_admin()
        self.nurse = make_nurse('nurse3@hospital.com', 'Dex', 'Uy')
        self.session = RegistrationSession.objects.create(
            session_id=uuid.uuid4(), email='applicant@hospital.com',
            face_attempts=2, face_verified=True,
            id_first_name='ANA', id_last_name='CRUZ',
            id_registration_date=datetime.date(2025, 1, 1), id_valid_until=datetime.date(2029, 1, 1),
        )
        FaceVerificationAttempt.objects.create(session=self.session, matched=False, reason='NO_FACE')
        FaceVerificationAttempt.objects.create(session=self.session, matched=True, confidence=0.94)

    def test_admin_can_list_registration_sessions(self):
        self.client.force_authenticate(self.admin)
        response = self.client.get('/api/admin/registration-sessions/')
        self.assertEqual(response.status_code, 200, response.content)
        emails = {row['email'] for row in response.data}
        self.assertIn('applicant@hospital.com', emails)
        row = next(row for row in response.data if row['email'] == 'applicant@hospital.com')
        self.assertEqual(row['idFirstName'], 'ANA')
        self.assertTrue(row['isVerified'])

    def test_the_generic_create_action_is_blocked_even_for_an_admin(self):
        # The class docstring says sessions are only ever created by the
        # signup flow itself, "never edited by hand" — this pins that the
        # generic ModelViewSet POST is actually disabled, not just
        # documented as unwanted. clear-abandoned (a different, custom POST
        # action) is unaffected — see test_clear_abandoned_deletes_only_
        # truly_empty_sessions below.
        self.client.force_authenticate(self.admin)
        response = self.client.post('/api/admin/registration-sessions/', {'email': 'new@hospital.com'})
        self.assertEqual(response.status_code, 405)
        self.assertFalse(RegistrationSession.objects.filter(email='new@hospital.com').exists())

    def test_admin_can_list_face_verification_attempts_for_a_session(self):
        self.client.force_authenticate(self.admin)
        response = self.client.get(f'/api/admin/face-verification-attempts/?sessionId={self.session.session_id}')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(len(response.data), 2)
        reasons = {row['reason'] for row in response.data}
        self.assertIn('NO_FACE', reasons)

    def test_non_admin_cannot_reach_registration_sessions(self):
        self.client.force_authenticate(self.nurse)
        response = self.client.get('/api/admin/registration-sessions/')
        self.assertEqual(response.status_code, 403)

    def test_non_admin_cannot_reach_face_verification_attempts(self):
        self.client.force_authenticate(self.nurse)
        response = self.client.get('/api/admin/face-verification-attempts/')
        self.assertEqual(response.status_code, 403)

    def test_anonymous_cannot_reach_either(self):
        response = self.client.get('/api/admin/registration-sessions/')
        self.assertEqual(response.status_code, 401)
        response = self.client.get('/api/admin/face-verification-attempts/')
        self.assertEqual(response.status_code, 401)

    def test_admin_can_delete_a_registration_session(self):
        self.client.force_authenticate(self.admin)
        response = self.client.delete(f'/api/admin/registration-sessions/{self.session.pk}/')
        self.assertEqual(response.status_code, 204, response.content)
        self.assertFalse(RegistrationSession.objects.filter(pk=self.session.pk).exists())
        # The attempts hanging off it (CASCADE) go with it — nothing an
        # admin can browse should point at a deleted session.
        self.assertFalse(FaceVerificationAttempt.objects.filter(session_id=self.session.pk).exists())

    def test_non_admin_cannot_delete_a_registration_session(self):
        self.client.force_authenticate(self.nurse)
        response = self.client.delete(f'/api/admin/registration-sessions/{self.session.pk}/')
        self.assertEqual(response.status_code, 403)
        self.assertTrue(RegistrationSession.objects.filter(pk=self.session.pk).exists())

    def test_deleting_a_session_never_touches_the_linked_account(self):
        # SET_NULL on RegistrationSession.user, so wiping the audit trail
        # can never take the real account down with it.
        applicant = User.objects.create_user(username='applicant@hospital.com', email='applicant@hospital.com')
        self.session.user = applicant
        self.session.save(update_fields=['user'])

        self.client.force_authenticate(self.admin)
        response = self.client.delete(f'/api/admin/registration-sessions/{self.session.pk}/')
        self.assertEqual(response.status_code, 204)
        self.assertTrue(User.objects.filter(pk=applicant.pk).exists())

    def test_clear_abandoned_deletes_only_truly_empty_sessions(self):
        # A real signup session, and a genuinely abandoned one (Step 1 only,
        # nobody ever completed anything).
        abandoned = RegistrationSession.objects.create(session_id=uuid.uuid4())
        partial_progress = RegistrationSession.objects.create(
            session_id=uuid.uuid4(), id_first_name='SOMEONE',
        )

        self.client.force_authenticate(self.admin)
        response = self.client.post('/api/admin/registration-sessions/clear-abandoned/')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.data['deleted'], 1)

        self.assertFalse(RegistrationSession.objects.filter(pk=abandoned.pk).exists())
        self.assertTrue(RegistrationSession.objects.filter(pk=self.session.pk).exists())
        self.assertTrue(RegistrationSession.objects.filter(pk=partial_progress.pk).exists())

    def test_non_admin_cannot_clear_abandoned(self):
        RegistrationSession.objects.create(session_id=uuid.uuid4())
        self.client.force_authenticate(self.nurse)
        response = self.client.post('/api/admin/registration-sessions/clear-abandoned/')
        self.assertEqual(response.status_code, 403)


class AdminEditingOwnProfileTests(APITestCase):
    """
    An admin reaching Settings (new: the Admin UI's nav links there too) and
    editing their own name/avatar must not gain a NurseProfile in the
    process — AdminUserViewSet's queryset starts from NurseProfile, so that
    absence is the only thing keeping every admin account out of the
    Accounts list (see its docstring: "nothing here can deactivate or reset
    another admin's password by construction, not just by choice").
    """

    def setUp(self):
        cache.clear()
        self.admin = make_admin()
        self.client.force_authenticate(self.admin)

    def test_editing_name_does_not_create_a_nurse_profile(self):
        response = self.client.patch('/api/auth/me/', {'name': 'New Admin Name'}, format='json')
        self.assertEqual(response.status_code, 200, response.content)
        self.admin.refresh_from_db()
        self.assertEqual(self.admin.first_name, 'New')
        self.assertFalse(NurseProfile.objects.filter(user=self.admin).exists())

    def test_admin_still_never_appears_in_the_accounts_list_after_editing_their_profile(self):
        self.client.patch('/api/auth/me/', {'name': 'New Admin Name', 'clinicalRole': 'RN'}, format='json')
        other_admin_client_check = self.client.get('/api/admin/users/')
        self.assertEqual(other_admin_client_check.status_code, 200)
        emails = {row['email'] for row in other_admin_client_check.data}
        self.assertNotIn(self.admin.email, emails)


class NewRegistrationNotifiesAdminsTests(APITestCase):
    """
    A fresh signup must immediately tell every admin account it's waiting
    for approval — the whole point of the Admin Accounts screen.
    """

    def setUp(self):
        cache.clear()
        self.admin1 = make_admin('admin1@admin.com')
        self.admin2 = make_admin('admin2@admin.com')
        self.nurse = User.objects.create_user(
            username='nurse@hospital.com', email='nurse@hospital.com', password='pw-test-1234',
        )
        NurseProfile.objects.create(user=self.nurse, role='staff_nurse', approval_status='approved')

    def _signup(self, **overrides):
        session = make_registration_session()
        payload = {
            'email': 'newnurse@hospital.com',
            'password': 'Str0ng-Pass-9012',
            'firstName': 'Ana',
            'lastName': 'Cruz',
            'role': 'staff_nurse',
            'licenseNumber': '1234567',
            'registrationSessionId': str(session.session_id),
        }
        payload.update(overrides)
        return self.client.post('/api/auth/signup/', payload, format='json')

    def test_every_admin_gets_a_notification(self):
        response = self._signup()
        self.assertEqual(response.status_code, 201, response.content)

        for admin in (self.admin1, self.admin2):
            notif = Notification.objects.filter(
                recipient=admin, event='new_registration_pending',
            ).first()
            self.assertIsNotNone(notif, f'no notification for {admin.email}')
            # The account name comes from the verified PRC ID, which is printed in capitals.
            self.assertIn('ana cruz', (notif.title + notif.message).lower())
            self.assertIn('Staff Nurse', notif.message)
            self.assertEqual(notif.action_path, '/admin/accounts')

    def test_head_nurse_signup_says_head_nurse_in_the_message(self):
        response = self._signup(email='newsup@hospital.com', requestedRole='head_nurse')
        self.assertEqual(response.status_code, 201, response.content)
        notif = Notification.objects.get(recipient=self.admin1, event='new_registration_pending')
        self.assertIn('Head Nurse', notif.message)

    def test_an_ordinary_nurse_does_not_get_this_notification(self):
        self._signup()
        self.assertFalse(
            Notification.objects.filter(recipient=self.nurse, event='new_registration_pending').exists()
        )

    def test_admin_can_see_it_via_the_notifications_endpoint(self):
        self._signup()
        self.client.force_authenticate(self.admin1)
        response = self.client.get('/api/notifications/')
        self.assertEqual(response.status_code, 200, response.content)
        events = {row['event'] for row in response.data['results']}
        self.assertIn('new_registration_pending', events)
        self.assertEqual(response.data['unreadCount'], 1)

    def test_admin_can_mark_their_own_notification_read(self):
        self._signup()
        notif = Notification.objects.get(recipient=self.admin1, event='new_registration_pending')
        self.client.force_authenticate(self.admin1)
        response = self.client.patch(f'/api/notifications/{notif.pk}/', {'isRead': True}, format='json')
        self.assertEqual(response.status_code, 200, response.content)
        notif.refresh_from_db()
        self.assertTrue(notif.is_read)

    def test_admin_can_mark_all_read(self):
        self._signup()
        self.client.force_authenticate(self.admin1)
        response = self.client.post('/api/notifications/mark_all_read/')
        self.assertEqual(response.status_code, 200, response.content)
