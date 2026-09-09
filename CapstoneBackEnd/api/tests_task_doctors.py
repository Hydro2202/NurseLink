"""
Multiple-doctor task assignment.

A task belongs to one department, and can have many doctors — via TaskDoctor,
never a comma-separated field. The backend never trusts doctorIds sent by the
client: every id must exist, be active, belong to the selected department,
AND already be on the selected patient's Kardex care team (PatientDoctor) —
task assignment is not a hospital-wide doctor picker.
"""

import datetime

from django.contrib.auth.models import User
from django.core.cache import cache
from rest_framework.test import APITestCase

from .models import Department, Doctor, NurseProfile, Patient, PatientDoctor, Task, TaskDoctor


def make_nurse(email, first, last):
    user = User.objects.create_user(
        username=email, email=email, password='pw-test-1234',
        first_name=first, last_name=last,
    )
    NurseProfile.objects.create(user=user, role='staff_nurse', department='Med-Surg')
    return user


class TaskDoctorTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.nurse = make_nurse('nina@hospital.com', 'Nina', 'Reyes')
        self.cardiology = Department.objects.create(name='Test Cardiology')
        self.pediatrics = Department.objects.create(name='Test Pediatrics')
        self.doc_a = Doctor.objects.create(
            full_name='Dr. Alpha', department=self.cardiology, status='active',
        )
        self.doc_b = Doctor.objects.create(
            full_name='Dr. Beta', department=self.cardiology, status='active',
        )
        self.doc_inactive = Doctor.objects.create(
            full_name='Dr. Gamma', department=self.cardiology, status='inactive',
        )
        self.doc_other_dept = Doctor.objects.create(
            full_name='Dr. Delta', department=self.pediatrics, status='active',
        )
        self.patient = Patient.objects.create(
            patient_code='PT01', name='Test Patient', age=50, gender='Male',
            room='101', diagnosis='Test', admission_date=datetime.date(2026, 1, 1),
            risk_level='low',
        )
        # doc_a/doc_b are this patient's actual Kardex-assigned doctors.
        # doc_inactive and doc_other_dept deliberately are NOT, so those
        # tests exercise the active/department checks, not this one.
        PatientDoctor.objects.create(patient=self.patient, doctor=self.doc_a, status='active')
        PatientDoctor.objects.create(patient=self.patient, doctor=self.doc_b, status='active')
        self.client.force_authenticate(user=self.nurse)

    def base_payload(self, **extra):
        body = {
            'title': 'Cardiac review',
            'patientId': 'PT01',
            'priority': 'routine',
            'dueTime': '14:30',
            'patientRoom': '101',
        }
        body.update(extra)
        return body

    def test_creating_a_task_with_multiple_doctors_creates_one_taskdoctor_row_each(self):
        resp = self.client.post('/api/tasks/', self.base_payload(
            departmentId=self.cardiology.pk, doctorIds=[self.doc_a.pk, self.doc_b.pk],
        ), format='json')
        self.assertEqual(resp.status_code, 201, resp.content)
        task = Task.objects.get(task_code=resp.data['id'])
        self.assertEqual(TaskDoctor.objects.filter(task=task).count(), 2)
        ids = set(TaskDoctor.objects.filter(task=task).values_list('doctor_id', flat=True))
        self.assertEqual(ids, {self.doc_a.pk, self.doc_b.pk})

    def test_assigned_doctors_are_returned_in_the_response(self):
        resp = self.client.post('/api/tasks/', self.base_payload(
            departmentId=self.cardiology.pk, doctorIds=[self.doc_a.pk, self.doc_b.pk],
        ), format='json')
        names = {d['name'] for d in resp.data['assignedDoctors']}
        self.assertEqual(names, {'Dr. Alpha', 'Dr. Beta'})

    def test_a_second_doctor_does_not_overwrite_the_first(self):
        resp = self.client.post('/api/tasks/', self.base_payload(
            departmentId=self.cardiology.pk, doctorIds=[self.doc_a.pk],
        ), format='json')
        task_code = resp.data['id']
        patch = self.client.patch(
            f'/api/tasks/{task_code}/',
            {'doctorIds': [self.doc_a.pk, self.doc_b.pk]},
            format='json',
        )
        self.assertEqual(patch.status_code, 200, patch.content)
        names = {d['name'] for d in patch.data['assignedDoctors']}
        self.assertEqual(names, {'Dr. Alpha', 'Dr. Beta'})

    def test_updating_doctor_selection_removes_deselected_doctors(self):
        resp = self.client.post('/api/tasks/', self.base_payload(
            departmentId=self.cardiology.pk, doctorIds=[self.doc_a.pk, self.doc_b.pk],
        ), format='json')
        task_code = resp.data['id']
        patch = self.client.patch(
            f'/api/tasks/{task_code}/', {'doctorIds': [self.doc_b.pk]}, format='json',
        )
        self.assertEqual(patch.status_code, 200)
        ids = {d['id'] for d in patch.data['assignedDoctors']}
        self.assertEqual(ids, {self.doc_b.pk})

    def test_a_doctor_not_assigned_to_this_patient_is_rejected(self):
        # Active, correct department, but never added to PT01's Kardex —
        # this is exactly the "P001 doctor used for P002" attack the spec
        # calls out, and must be rejected even though every other check passes.
        unassigned_doc = Doctor.objects.create(
            full_name='Dr. Not Yours', department=self.cardiology, status='active',
        )
        resp = self.client.post('/api/tasks/', self.base_payload(
            departmentId=self.cardiology.pk, doctorIds=[unassigned_doc.pk],
        ), format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('not assigned to this patient', str(resp.data))

    def test_a_doctor_from_another_department_is_rejected(self):
        resp = self.client.post('/api/tasks/', self.base_payload(
            departmentId=self.cardiology.pk, doctorIds=[self.doc_a.pk, self.doc_other_dept.pk],
        ), format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('Dr. Delta', str(resp.data))
        self.assertEqual(TaskDoctor.objects.count(), 0)

    def test_an_inactive_doctor_is_rejected(self):
        resp = self.client.post('/api/tasks/', self.base_payload(
            departmentId=self.cardiology.pk, doctorIds=[self.doc_inactive.pk],
        ), format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('Dr. Gamma', str(resp.data))

    def test_a_nonexistent_doctor_id_is_rejected(self):
        resp = self.client.post('/api/tasks/', self.base_payload(
            departmentId=self.cardiology.pk, doctorIds=[999999],
        ), format='json')
        self.assertEqual(resp.status_code, 400)

    def test_an_empty_doctor_list_is_rejected_when_department_is_set(self):
        resp = self.client.post('/api/tasks/', self.base_payload(
            departmentId=self.cardiology.pk, doctorIds=[],
        ), format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('at least one doctor', str(resp.data))

    def test_doctor_ids_without_a_department_is_rejected(self):
        resp = self.client.post('/api/tasks/', self.base_payload(
            doctorIds=[self.doc_a.pk],
        ), format='json')
        self.assertEqual(resp.status_code, 400)

    def test_legacy_task_creation_without_department_or_doctors_still_works(self):
        # TaskAssignmentModal's "Assign Nurse" flow — unrelated to this
        # feature — must keep working exactly as before.
        resp = self.client.post('/api/tasks/', self.base_payload(
            attendingPhysician='Dr. Free Text',
        ), format='json')
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual(resp.data['assignedDoctors'], [])
        self.assertEqual(resp.data['attendingPhysician'], 'Dr. Free Text')


class DepartmentDoctorListTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.nurse = make_nurse('omar@hospital.com', 'Omar', 'Diaz')
        self.cardiology = Department.objects.create(name='Test Cardiology 2')
        self.pediatrics = Department.objects.create(name='Test Pediatrics 2')
        self.doc_a = Doctor.objects.create(
            full_name='Dr. Juan Alpha', specialization='Cardiologist',
            department=self.cardiology, license_number='LIC-1', status='active',
        )
        self.doc_b = Doctor.objects.create(
            full_name='Dr. Beta', department=self.pediatrics, status='active',
        )
        self.client.force_authenticate(user=self.nurse)

    def test_doctor_list_filters_by_department(self):
        resp = self.client.get(f'/api/doctors/?department={self.cardiology.pk}')
        self.assertEqual(resp.status_code, 200)
        names = [d['fullName'] for d in resp.data]
        self.assertIn('Dr. Juan Alpha', names)
        self.assertNotIn('Dr. Beta', names)

    def test_doctor_search_matches_name_specialization_or_license(self):
        resp = self.client.get('/api/doctors/?search=Cardiologist')
        names = [d['fullName'] for d in resp.data]
        self.assertIn('Dr. Juan Alpha', names)

        resp2 = self.client.get('/api/doctors/?search=LIC-1')
        self.assertIn('Dr. Juan Alpha', [d['fullName'] for d in resp2.data])

    def test_departments_endpoint_lists_seeded_departments(self):
        resp = self.client.get('/api/departments/')
        self.assertEqual(resp.status_code, 200)
        names = [d['name'] for d in resp.data]
        self.assertIn('Department of Cardiology', names)
        self.assertIn('Department of Internal Medicine', names)
        self.assertEqual(len(names), len(set(names)))


class PatientAssignedDoctorsTests(APITestCase):
    """The Kardex-facing half: GET/POST /api/patients/<code>/assigned-doctors/."""

    def setUp(self):
        cache.clear()
        self.nurse = make_nurse('priya@hospital.com', 'Priya', 'Cruz')
        self.cardiology = Department.objects.create(name='Test Cardiology 3')
        self.pediatrics = Department.objects.create(name='Test Pediatrics 3')
        self.doc_a = Doctor.objects.create(
            full_name='Dr. One', department=self.cardiology, status='active',
        )
        self.doc_b = Doctor.objects.create(
            full_name='Dr. Two', department=self.pediatrics, status='active',
        )
        self.doc_inactive = Doctor.objects.create(
            full_name='Dr. Three', department=self.cardiology, status='inactive',
        )
        self.patient = Patient.objects.create(
            patient_code='PT02', name='Another Patient', age=40, gender='Female',
            room='201', diagnosis='Test', admission_date=datetime.date(2026, 1, 1),
            risk_level='low',
        )
        self.client.force_authenticate(user=self.nurse)

    def test_get_returns_empty_list_when_none_assigned(self):
        resp = self.client.get(f'/api/patients/{self.patient.patient_code}/assigned-doctors/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data, [])

    def test_post_assigns_multiple_doctors_across_departments(self):
        resp = self.client.post(
            f'/api/patients/{self.patient.patient_code}/assigned-doctors/',
            {'doctorIds': [self.doc_a.pk, self.doc_b.pk]},
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        ids = {d['id'] for d in resp.data}
        self.assertEqual(ids, {self.doc_a.pk, self.doc_b.pk})

        get_resp = self.client.get(f'/api/patients/{self.patient.patient_code}/assigned-doctors/')
        self.assertEqual({d['id'] for d in get_resp.data}, {self.doc_a.pk, self.doc_b.pk})

    def test_posting_a_smaller_set_removes_the_deselected_doctor(self):
        self.client.post(
            f'/api/patients/{self.patient.patient_code}/assigned-doctors/',
            {'doctorIds': [self.doc_a.pk, self.doc_b.pk]},
            format='json',
        )
        resp = self.client.post(
            f'/api/patients/{self.patient.patient_code}/assigned-doctors/',
            {'doctorIds': [self.doc_a.pk]},
            format='json',
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual([d['id'] for d in resp.data], [self.doc_a.pk])

    def test_an_inactive_doctor_cannot_be_assigned(self):
        resp = self.client.post(
            f'/api/patients/{self.patient.patient_code}/assigned-doctors/',
            {'doctorIds': [self.doc_inactive.pk]},
            format='json',
        )
        self.assertEqual(resp.status_code, 400)

    def test_a_doctor_assigned_to_one_patient_does_not_leak_to_another(self):
        other_patient = Patient.objects.create(
            patient_code='PT03', name='Third Patient', age=30, gender='Male',
            room='301', diagnosis='Test', admission_date=datetime.date(2026, 1, 1),
            risk_level='low',
        )
        self.client.post(
            f'/api/patients/{self.patient.patient_code}/assigned-doctors/',
            {'doctorIds': [self.doc_a.pk]},
            format='json',
        )
        resp = self.client.get(f'/api/patients/{other_patient.patient_code}/assigned-doctors/')
        self.assertEqual(resp.data, [])

    def test_removing_a_doctor_deactivates_rather_than_deletes_the_row(self):
        # History (and any task already created against this doctor) must
        # survive a removal from the care team.
        self.client.post(
            f'/api/patients/{self.patient.patient_code}/assigned-doctors/',
            {'doctorIds': [self.doc_a.pk, self.doc_b.pk]},
            format='json',
        )
        self.client.post(
            f'/api/patients/{self.patient.patient_code}/assigned-doctors/',
            {'doctorIds': [self.doc_a.pk]},
            format='json',
        )
        row = PatientDoctor.objects.get(patient=self.patient, doctor=self.doc_b)
        self.assertEqual(row.status, 'inactive')

    def test_re_adding_a_removed_doctor_reactivates_the_same_row(self):
        self.client.post(
            f'/api/patients/{self.patient.patient_code}/assigned-doctors/',
            {'doctorIds': [self.doc_a.pk]},
            format='json',
        )
        self.client.post(
            f'/api/patients/{self.patient.patient_code}/assigned-doctors/',
            {'doctorIds': []},
            format='json',
        )
        resp = self.client.post(
            f'/api/patients/{self.patient.patient_code}/assigned-doctors/',
            {'doctorIds': [self.doc_a.pk]},
            format='json',
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual([d['id'] for d in resp.data], [self.doc_a.pk])
        self.assertEqual(
            PatientDoctor.objects.filter(patient=self.patient, doctor=self.doc_a).count(), 1,
        )

    def test_an_already_assigned_doctor_who_later_goes_inactive_can_still_be_kept(self):
        # Assign while active.
        self.client.post(
            f'/api/patients/{self.patient.patient_code}/assigned-doctors/',
            {'doctorIds': [self.doc_a.pk]},
            format='json',
        )
        self.doc_a.status = 'inactive'
        self.doc_a.save(update_fields=['status'])
        # Re-submitting the same set (e.g. the Kardex form saving again with
        # no changes to this doctor) must not be rejected just because the
        # doctor went inactive in the meantime.
        resp = self.client.post(
            f'/api/patients/{self.patient.patient_code}/assigned-doctors/',
            {'doctorIds': [self.doc_a.pk]},
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual([d['id'] for d in resp.data], [self.doc_a.pk])
