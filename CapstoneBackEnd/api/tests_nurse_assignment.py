"""
Supervisor-controlled department/shift assignment for nurses.

Department and shift used to be self-editable through PATCH /api/auth/me/
(UpdateMeSerializer), which made a supervisor's staffing decision
meaningless — a nurse could just set themselves to any department or
shift. Both fields are now supervisor-only, changed through
PATCH /api/nurses/{id}/assign/.
"""

from django.contrib.auth.models import User
from django.core.cache import cache
from rest_framework.test import APITestCase

from .models import NurseProfile, Notification


def make_nurse(email, first, last, role='staff_nurse', department='Med-Surg', shift='morning'):
    user = User.objects.create_user(
        username=email, email=email, password='pw-test-1234',
        first_name=first, last_name=last,
    )
    NurseProfile.objects.create(
        user=user, role=role, department=department, shift=shift,
        approval_status='approved', is_active_staff=True,
    )
    return user


class NurseSelfEditCannotChangeAssignmentTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.nurse = make_nurse('nurse@hospital.com', 'Ben', 'Diaz', department='ICU', shift='morning')
        self.client.force_authenticate(user=self.nurse)

    def test_patching_me_with_department_is_silently_ignored(self):
        response = self.client.patch('/api/auth/me/', {'department': 'ER'}, format='json')
        self.assertEqual(response.status_code, 200)
        self.nurse.nurse_profile.refresh_from_db()
        self.assertEqual(self.nurse.nurse_profile.department, 'ICU')

    def test_patching_me_with_shift_is_silently_ignored(self):
        response = self.client.patch('/api/auth/me/', {'shift': 'night'}, format='json')
        self.assertEqual(response.status_code, 200)
        self.nurse.nurse_profile.refresh_from_db()
        self.assertEqual(self.nurse.nurse_profile.shift, 'morning')

    def test_other_self_edit_fields_still_work(self):
        response = self.client.patch('/api/auth/me/', {'specialization': 'Cardiac'}, format='json')
        self.assertEqual(response.status_code, 200)
        self.nurse.nurse_profile.refresh_from_db()
        self.assertEqual(self.nurse.nurse_profile.specialization, 'Cardiac')

    def test_licence_number_is_locked_for_self_edit(self):
        before = self.nurse.nurse_profile.license_number
        response = self.client.patch('/api/auth/me/', {'licenseNumber': 'RN-12345'}, format='json')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['code'], 'field_locked')
        self.nurse.nurse_profile.refresh_from_db()
        self.assertEqual(self.nurse.nurse_profile.license_number, before)


class NurseAssignmentTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.supervisor = make_nurse('sup@hospital.com', 'Ana', 'Cruz', role='head_nurse')
        self.nurse = make_nurse('nurse@hospital.com', 'Ben', 'Diaz', department='ICU', shift='morning')

    def test_supervisor_can_change_department_and_shift(self):
        self.client.force_authenticate(user=self.supervisor)
        response = self.client.patch(
            f'/api/nurses/{self.nurse.pk}/assign/',
            {'department': 'ER', 'shift': 'night'}, format='json',
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['department'], 'ER')
        self.assertEqual(response.data['shift'], 'night')
        self.nurse.nurse_profile.refresh_from_db()
        self.assertEqual(self.nurse.nurse_profile.department, 'ER')
        self.assertEqual(self.nurse.nurse_profile.shift, 'night')

    def test_supervisor_can_change_only_one_field(self):
        self.client.force_authenticate(user=self.supervisor)
        response = self.client.patch(
            f'/api/nurses/{self.nurse.pk}/assign/', {'shift': 'afternoon'}, format='json',
        )
        self.assertEqual(response.status_code, 200)
        self.nurse.nurse_profile.refresh_from_db()
        self.assertEqual(self.nurse.nurse_profile.department, 'ICU')
        self.assertEqual(self.nurse.nurse_profile.shift, 'afternoon')

    def test_nurse_cannot_assign_another_nurse(self):
        other = make_nurse('cora@hospital.com', 'Cora', 'Reyes')
        self.client.force_authenticate(user=self.nurse)
        response = self.client.patch(
            f'/api/nurses/{other.pk}/assign/', {'department': 'ER'}, format='json',
        )
        self.assertEqual(response.status_code, 403)

    def test_blank_department_is_rejected(self):
        self.client.force_authenticate(user=self.supervisor)
        response = self.client.patch(
            f'/api/nurses/{self.nurse.pk}/assign/', {'department': ''}, format='json',
        )
        self.assertEqual(response.status_code, 400)

    def test_empty_body_is_rejected(self):
        self.client.force_authenticate(user=self.supervisor)
        response = self.client.patch(f'/api/nurses/{self.nurse.pk}/assign/', {}, format='json')
        self.assertEqual(response.status_code, 400)

    def test_reassignment_notifies_the_nurse(self):
        self.client.force_authenticate(user=self.supervisor)
        self.client.patch(
            f'/api/nurses/{self.nurse.pk}/assign/', {'department': 'ER'}, format='json',
        )
        note = Notification.objects.filter(recipient=self.nurse, event='nurse_reassigned').first()
        self.assertIsNotNone(note)
        self.assertIn('ER', note.message)

    def test_unauthenticated_request_is_rejected(self):
        response = self.client.patch(
            f'/api/nurses/{self.nurse.pk}/assign/', {'department': 'ER'}, format='json',
        )
        self.assertEqual(response.status_code, 401)
