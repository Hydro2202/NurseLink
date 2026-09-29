"""
seed_patients management command: tops up Patient to exactly
TARGET_PATIENT_COUNT (103), distributed evenly across active staff nurses,
idempotently and without ever touching existing patient content.
"""

from django.contrib.auth.models import User
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase
from django.utils import timezone

from .management.commands.seed_patients import TARGET_PATIENT_COUNT
from .models import NurseProfile, Patient, PatientAssignment, PatientDoctor, PatientVisit


def make_nurse(email, first, last):
    user = User.objects.create_user(
        username=email, email=email, password='pw-test-1234', first_name=first, last_name=last,
    )
    NurseProfile.objects.create(
        user=user, role='staff_nurse', department='ICU', approval_status='approved', is_active_staff=True,
    )
    return user


def make_patient(code, **extra):
    fields = dict(
        patient_code=code, name='Existing Patient', age=50, gender='Male',
        room='100', diagnosis='Observation', admission_date=timezone.localdate(),
    )
    fields.update(extra)
    return Patient.objects.create(**fields)


class SeedPatientsCommandTests(TestCase):
    def test_requires_at_least_one_active_nurse(self):
        with self.assertRaises(CommandError):
            call_command('seed_patients')
        self.assertEqual(Patient.objects.count(), 0)

    def test_creates_exactly_target_from_empty_with_correct_distribution(self):
        nurses = [make_nurse(f'nurse{i}@hospital.com', f'Nurse{i}', 'Test') for i in range(10)]

        call_command('seed_patients')

        self.assertEqual(Patient.objects.count(), TARGET_PATIENT_COUNT)
        self.assertEqual(Patient.objects.filter(assigned_nurse__isnull=True).count(), 0)

        counts = sorted(
            Patient.objects.filter(assigned_nurse=n).count() for n in nurses
        )
        # base=10, remainder=3 -> 7 nurses at 10, 3 nurses at 11 (spec's own example).
        self.assertEqual(counts, [10] * 7 + [11] * 3)

        # Every created patient carries the required real relationships, not
        # just denormalized display fields.
        sample = Patient.objects.first()
        self.assertTrue(sample.medical_record_number)
        self.assertTrue(sample.patient_code)
        self.assertTrue(sample.first_name and sample.last_name)
        self.assertIsNotNone(sample.date_of_birth)
        self.assertTrue(PatientVisit.objects.filter(patient=sample).exists())

        # No duplicate identifiers.
        codes = list(Patient.objects.values_list('patient_code', flat=True))
        self.assertEqual(len(codes), len(set(codes)))
        mrns = list(Patient.objects.values_list('medical_record_number', flat=True))
        self.assertEqual(len(mrns), len(set(mrns)))

    def test_idempotent_rerun_creates_nothing(self):
        for i in range(5):
            make_nurse(f'nurse{i}@hospital.com', f'Nurse{i}', 'Test')
        call_command('seed_patients')
        self.assertEqual(Patient.objects.count(), TARGET_PATIENT_COUNT)

        call_command('seed_patients')
        self.assertEqual(Patient.objects.count(), TARGET_PATIENT_COUNT)

    def test_tops_up_an_existing_deficit_without_touching_existing_patients(self):
        nurse = make_nurse('nurse0@hospital.com', 'Nurse', 'Zero')
        existing = make_patient('PEXIST1', diagnosis='Do Not Touch', assigned_nurse=nurse)

        call_command('seed_patients')

        self.assertEqual(Patient.objects.count(), TARGET_PATIENT_COUNT)
        existing.refresh_from_db()
        self.assertEqual(existing.diagnosis, 'Do Not Touch')
        self.assertEqual(existing.patient_code, 'PEXIST1')

    def test_never_creates_beyond_target_when_already_at_or_over(self):
        make_nurse('nurse0@hospital.com', 'Nurse', 'Zero')
        call_command('seed_patients')
        total_after_first = Patient.objects.count()
        self.assertEqual(total_after_first, TARGET_PATIENT_COUNT)

        call_command('seed_patients')
        self.assertEqual(Patient.objects.count(), TARGET_PATIENT_COUNT)

    def test_backfills_assigned_nurse_on_unassigned_non_discharged_patients(self):
        nurse = make_nurse('nurse0@hospital.com', 'Nurse', 'Zero')
        unassigned = make_patient('PUNASSIGNED', status='admitted', assigned_nurse=None)

        call_command('seed_patients')

        unassigned.refresh_from_db()
        self.assertIsNotNone(unassigned.assigned_nurse)
        self.assertTrue(
            PatientAssignment.objects.filter(patient=unassigned, status='active').exists()
        )

    def test_never_backfills_discharged_patients(self):
        make_nurse('nurse0@hospital.com', 'Nurse', 'Zero')
        discharged = make_patient(
            'PDISCHARGED', status='discharged', assigned_nurse=None,
            discharged_at=timezone.now(),
        )

        call_command('seed_patients')

        discharged.refresh_from_db()
        self.assertIsNone(discharged.assigned_nurse)

    def test_assigns_a_real_doctor_relationship(self):
        make_nurse('nurse0@hospital.com', 'Nurse', 'Zero')
        call_command('seed_patients')

        with_doctor = PatientDoctor.objects.filter(status='active').count()
        # Every seeded patient's ward maps to a specialty with seeded
        # doctors (0020_seed_departments_and_doctors.py), so this should be
        # essentially all of them.
        self.assertGreater(with_doctor, 0)
