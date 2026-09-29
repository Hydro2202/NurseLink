"""rebalance_patients management command: evenly redistributes existing
non-discharged patients across active staff nurses, minimizing churn."""

from django.contrib.auth.models import User
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase
from django.utils import timezone

from .models import NurseProfile, Patient, PatientAssignment


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
        patient_code=code, name='Patient', age=50, gender='Male',
        room='100', diagnosis='Observation', admission_date=timezone.localdate(),
    )
    fields.update(extra)
    return Patient.objects.create(**fields)


class RebalancePatientsCommandTests(TestCase):
    def test_requires_at_least_one_active_nurse(self):
        with self.assertRaises(CommandError):
            call_command('rebalance_patients')

    def test_noop_with_no_patients(self):
        make_nurse('n0@hospital.com', 'Nurse', 'Zero')
        call_command('rebalance_patients')  # should not raise

    def test_evenly_distributes_uneven_existing_assignments(self):
        nurses = [make_nurse(f'n{i}@hospital.com', f'Nurse{i}', 'Test') for i in range(13)]
        # Mirror the real skew found in production: one nurse way overloaded,
        # several with zero.
        overloaded, *rest = nurses
        for i in range(11):
            make_patient(f'P{i:03d}', assigned_nurse=overloaded)
        for i in range(11, 103):
            make_patient(f'P{i:03d}', assigned_nurse=None)

        call_command('rebalance_patients')

        counts = sorted(Patient.objects.filter(assigned_nurse=n).count() for n in nurses)
        # 103 patients / 13 nurses = base 7, remainder 12 -> 12 nurses at 8, 1 at 7.
        self.assertEqual(counts, [7] + [8] * 12)
        self.assertEqual(Patient.objects.filter(assigned_nurse__isnull=True).count(), 0)

    def test_never_touches_discharged_patients(self):
        make_nurse('n0@hospital.com', 'Nurse', 'Zero')
        discharged = make_patient(
            'PDISCHARGED', status='discharged', assigned_nurse=None, discharged_at=timezone.now(),
        )
        call_command('rebalance_patients')
        discharged.refresh_from_db()
        self.assertIsNone(discharged.assigned_nurse)

    def test_minimizes_churn_for_already_well_placed_patients(self):
        nurses = [make_nurse(f'n{i}@hospital.com', f'Nurse{i}', 'Test') for i in range(2)]
        # Already perfectly balanced (2 each) -> nothing should move.
        kept = [make_patient(f'P{i:03d}', assigned_nurse=nurses[i % 2]) for i in range(4)]
        assignment_ids_before = {
            p.patient_code: PatientAssignment.objects.filter(patient=p, status='active').count()
            for p in kept
        }

        call_command('rebalance_patients')

        for p in kept:
            p.refresh_from_db()
        # No new PatientAssignment rows created for already-balanced patients.
        for p in kept:
            self.assertEqual(
                PatientAssignment.objects.filter(patient=p, status='active').count(),
                assignment_ids_before[p.patient_code],
            )
