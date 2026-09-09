"""
Duty Roster — supervisor-managed nurse shift scheduling.

Hours are always the backend's numbers (DutyAssignment.save() derives them
from the stored times), and schedule conflicts are rejected server-side
(DutyAssignmentSerializer.validate()) — a nurse must never be double-booked
just because the frontend forgot to check.
"""

from django.contrib.auth.models import User
from rest_framework.test import APITestCase

from .models import Department, DutyAssignment, NurseProfile


def make_user(email, first, last, *, role='staff_nurse', approval_status='approved'):
    user = User.objects.create_user(
        username=email, email=email, password='pw-test-1234',
        first_name=first, last_name=last,
    )
    NurseProfile.objects.create(
        user=user, role=role, department='ICU', shift='morning',
        approval_status=approval_status, is_active_staff=True,
    )
    return user


class DutyAssignmentApiTests(APITestCase):
    def setUp(self):
        self.supervisor = make_user('sup@hospital.com', 'Ana', 'Cruz', role='supervisor')
        self.nurse = make_user('nurse@hospital.com', 'Juan', 'Dela Cruz')
        self.other_nurse = make_user('other@hospital.com', 'Maria', 'Santos')
        # The department-seed migration already puts these rows in place on
        # every fresh (including test) database — get_or_create so this
        # doesn't collide with that real seed data.
        self.dept_icu, _ = Department.objects.get_or_create(name='Intensive Care Unit (ICU)')
        self.dept_er, _ = Department.objects.get_or_create(name='Emergency Department (ER)')

    def _payload(self, **overrides):
        payload = {
            'nurseId': self.nurse.pk,
            'departmentId': self.dept_icu.pk,
            'dutyDate': '2026-09-10',
            'shift': 'morning',
            'startTime': '07:00',
            'endTime': '15:00',
        }
        payload.update(overrides)
        return payload

    # ---- CRUD + permissions ----

    def test_supervisor_can_create_assignment(self):
        self.client.force_authenticate(user=self.supervisor)
        response = self.client.post('/api/duty-assignments/', self._payload(), format='json')
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data['nurseName'], 'Juan Dela Cruz')
        self.assertEqual(response.data['departmentName'], 'Intensive Care Unit (ICU)')
        self.assertEqual(response.data['regularHours'], 8)
        self.assertEqual(response.data['overtimeHours'], 0)
        self.assertEqual(response.data['totalHours'], 8)
        self.assertEqual(response.data['status'], 'scheduled')
        self.assertEqual(response.data['createdBy'], 'Ana Cruz')
        self.assertEqual(DutyAssignment.objects.count(), 1)

    def test_nurse_cannot_create_assignment(self):
        self.client.force_authenticate(user=self.nurse)
        response = self.client.post('/api/duty-assignments/', self._payload(), format='json')
        self.assertEqual(response.status_code, 403)
        self.assertEqual(DutyAssignment.objects.count(), 0)

    def test_nurse_can_list_the_roster(self):
        self.client.force_authenticate(user=self.supervisor)
        self.client.post('/api/duty-assignments/', self._payload(), format='json')
        self.client.force_authenticate(user=self.nurse)
        response = self.client.get('/api/duty-assignments/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 1)

    def test_nurse_only_sees_their_own_assignments(self):
        self.client.force_authenticate(user=self.supervisor)
        self.client.post('/api/duty-assignments/', self._payload(), format='json')
        self.client.post(
            '/api/duty-assignments/',
            self._payload(nurseId=self.other_nurse.pk, departmentId=self.dept_er.pk),
            format='json',
        )
        self.client.force_authenticate(user=self.nurse)
        response = self.client.get('/api/duty-assignments/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]['nurseName'], 'Juan Dela Cruz')

    def test_nurse_cannot_use_nurseid_param_to_see_someone_elses_schedule(self):
        self.client.force_authenticate(user=self.supervisor)
        self.client.post(
            '/api/duty-assignments/',
            self._payload(nurseId=self.other_nurse.pk),
            format='json',
        )
        self.client.force_authenticate(user=self.nurse)
        response = self.client.get('/api/duty-assignments/', {'nurseId': self.other_nurse.pk})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 0)

    def test_supervisor_can_filter_by_nurseid(self):
        self.client.force_authenticate(user=self.supervisor)
        self.client.post('/api/duty-assignments/', self._payload(), format='json')
        self.client.post(
            '/api/duty-assignments/',
            self._payload(nurseId=self.other_nurse.pk, departmentId=self.dept_er.pk),
            format='json',
        )
        response = self.client.get('/api/duty-assignments/', {'nurseId': self.other_nurse.pk})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]['nurseName'], 'Maria Santos')

    def test_unauthenticated_request_is_rejected(self):
        response = self.client.post('/api/duty-assignments/', self._payload(), format='json')
        self.assertEqual(response.status_code, 401)

    def test_supervisor_can_update_without_creating_a_duplicate(self):
        self.client.force_authenticate(user=self.supervisor)
        created = self.client.post('/api/duty-assignments/', self._payload(), format='json').data
        response = self.client.patch(
            f"/api/duty-assignments/{created['id']}/",
            {'departmentId': self.dept_er.pk}, format='json',
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['departmentName'], 'Emergency Department (ER)')
        self.assertEqual(DutyAssignment.objects.count(), 1)

    def test_nurse_cannot_update_assignment(self):
        self.client.force_authenticate(user=self.supervisor)
        created = self.client.post('/api/duty-assignments/', self._payload(), format='json').data
        self.client.force_authenticate(user=self.nurse)
        response = self.client.patch(
            f"/api/duty-assignments/{created['id']}/", {'status': 'completed'}, format='json'
        )
        self.assertEqual(response.status_code, 403)

    def test_supervisor_can_delete_assignment(self):
        self.client.force_authenticate(user=self.supervisor)
        created = self.client.post('/api/duty-assignments/', self._payload(), format='json').data
        response = self.client.delete(f"/api/duty-assignments/{created['id']}/")
        self.assertEqual(response.status_code, 204)
        self.assertEqual(DutyAssignment.objects.count(), 0)

    def test_nurse_cannot_delete_assignment(self):
        self.client.force_authenticate(user=self.supervisor)
        created = self.client.post('/api/duty-assignments/', self._payload(), format='json').data
        self.client.force_authenticate(user=self.nurse)
        response = self.client.delete(f"/api/duty-assignments/{created['id']}/")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(DutyAssignment.objects.count(), 1)

    # ---- hours + overtime ----

    def test_overnight_shift_hours_do_not_go_negative(self):
        self.client.force_authenticate(user=self.supervisor)
        response = self.client.post(
            '/api/duty-assignments/',
            self._payload(shift='night', startTime='23:00', endTime='07:00'),
            format='json',
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data['regularHours'], 8)

    def test_overtime_is_calculated_by_the_backend(self):
        self.client.force_authenticate(user=self.supervisor)
        created = self.client.post('/api/duty-assignments/', self._payload(), format='json').data
        response = self.client.patch(
            f"/api/duty-assignments/{created['id']}/",
            {'overtimeStart': '15:00', 'overtimeEnd': '17:00'}, format='json',
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['regularHours'], 8)
        self.assertEqual(response.data['overtimeHours'], 2)
        self.assertEqual(response.data['totalHours'], 10)

    # ---- conflicts ----

    def test_overlapping_assignment_for_the_same_nurse_is_rejected(self):
        self.client.force_authenticate(user=self.supervisor)
        self.client.post('/api/duty-assignments/', self._payload(), format='json')
        response = self.client.post(
            '/api/duty-assignments/',
            self._payload(departmentId=self.dept_er.pk, startTime='13:00', endTime='21:00'),
            format='json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('conflicting duty assignment', str(response.data))
        self.assertEqual(DutyAssignment.objects.count(), 1)

    def test_non_overlapping_assignment_same_day_is_allowed(self):
        self.client.force_authenticate(user=self.supervisor)
        self.client.post('/api/duty-assignments/', self._payload(), format='json')
        response = self.client.post(
            '/api/duty-assignments/',
            self._payload(departmentId=self.dept_er.pk, startTime='15:00', endTime='23:00'),
            format='json',
        )
        self.assertEqual(response.status_code, 201)

    def test_different_nurse_can_take_the_overlapping_slot(self):
        self.client.force_authenticate(user=self.supervisor)
        self.client.post('/api/duty-assignments/', self._payload(), format='json')
        response = self.client.post(
            '/api/duty-assignments/',
            self._payload(nurseId=self.other_nurse.pk),
            format='json',
        )
        self.assertEqual(response.status_code, 201)

    def test_editing_an_assignment_does_not_conflict_with_itself(self):
        self.client.force_authenticate(user=self.supervisor)
        created = self.client.post('/api/duty-assignments/', self._payload(), format='json').data
        response = self.client.patch(
            f"/api/duty-assignments/{created['id']}/", {'endTime': '16:00'}, format='json'
        )
        self.assertEqual(response.status_code, 200)

    def test_overnight_shift_conflicts_with_next_morning(self):
        self.client.force_authenticate(user=self.supervisor)
        # Sept 10, 23:00 -> Sept 11, 07:00
        self.client.post(
            '/api/duty-assignments/',
            self._payload(shift='night', startTime='23:00', endTime='07:00'),
            format='json',
        )
        # Sept 11, 06:00 -> Sept 11, 14:00 overlaps the tail of the night shift
        response = self.client.post(
            '/api/duty-assignments/',
            self._payload(dutyDate='2026-09-11', startTime='06:00', endTime='14:00'),
            format='json',
        )
        self.assertEqual(response.status_code, 400)

    def test_cancelled_assignment_does_not_block_a_new_one(self):
        self.client.force_authenticate(user=self.supervisor)
        created = self.client.post('/api/duty-assignments/', self._payload(), format='json').data
        self.client.patch(
            f"/api/duty-assignments/{created['id']}/", {'status': 'cancelled'}, format='json'
        )
        response = self.client.post(
            '/api/duty-assignments/',
            self._payload(departmentId=self.dept_er.pk),
            format='json',
        )
        self.assertEqual(response.status_code, 201)

    # ---- filters ----

    def test_filter_by_department_shift_and_date(self):
        self.client.force_authenticate(user=self.supervisor)
        self.client.post('/api/duty-assignments/', self._payload(), format='json')
        self.client.post(
            '/api/duty-assignments/',
            self._payload(nurseId=self.other_nurse.pk, departmentId=self.dept_er.pk,
                           shift='night', startTime='23:00', endTime='07:00'),
            format='json',
        )
        response = self.client.get(
            '/api/duty-assignments/',
            {'departmentId': self.dept_icu.pk, 'shift': 'morning', 'date': '2026-09-10'},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]['nurseName'], 'Juan Dela Cruz')

    def test_search_by_nurse_name(self):
        self.client.force_authenticate(user=self.supervisor)
        self.client.post('/api/duty-assignments/', self._payload(), format='json')
        response = self.client.get('/api/duty-assignments/', {'search': 'dela cruz'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 1)
