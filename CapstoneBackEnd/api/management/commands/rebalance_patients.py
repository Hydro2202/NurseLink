"""
One-time-use tool: evenly redistribute every non-discharged patient's
assigned_nurse across all currently active staff nurses.

Distinct from seed_patients, which only ever ADDS patients and never
reassigns an already-assigned one (see its own docstring/tests) — this
command exists for the opposite job: the total patient count is already
correct but the existing distribution is uneven (e.g. skewed by ad hoc
manual testing), and every active nurse should end up within one patient of
the mean, same base/remainder split as seed_patients' own distribution
example (total // nurse_count, first `remainder` nurses get one extra).

Minimises churn: a patient already on a nurse who is at or under their
target keeps that nurse. Only patients belonging to an over-target nurse (or
with no nurse at all) move, and only exactly as many as needed to fill every
under-target nurse.

Never touches discharged patients (assigned_nurse=None is the correct,
intentional post-discharge state — see PatientViewSet.discharge) and never
changes the total patient count or creates/deletes any patient.
"""

from django.contrib.auth.models import User
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from api.models import Patient, PatientAssignment
from api.serializers import nurse_display_name


class Command(BaseCommand):
    help = (
        'Evenly redistribute existing non-discharged patients across all active '
        'staff nurses, moving only as many as needed to balance the load.'
    )

    def handle(self, *args, **options):
        with transaction.atomic():
            nurses = list(
                User.objects.filter(
                    nurse_profile__role='staff_nurse', nurse_profile__is_active_staff=True
                ).order_by('id')
            )
            if not nurses:
                raise CommandError('No active staff nurses found.')

            patients = list(
                Patient.objects.exclude(status='discharged')
                .select_related('assigned_nurse')
                .order_by('patient_code')
            )
            if not patients:
                self.stdout.write('No non-discharged patients to rebalance.')
                return

            base, remainder = divmod(len(patients), len(nurses))
            target = {
                nurse.id: base + (1 if i < remainder else 0) for i, nurse in enumerate(nurses)
            }

            nurse_ids = {n.id for n in nurses}
            current_by_nurse: dict[int, list[Patient]] = {n.id: [] for n in nurses}
            pool: list[Patient] = []
            for patient in patients:
                if patient.assigned_nurse_id in nurse_ids:
                    current_by_nurse[patient.assigned_nurse_id].append(patient)
                else:
                    # Unassigned, or assigned to someone no longer an active
                    # staff nurse (deactivated/role-changed since) — always
                    # movable.
                    pool.append(patient)

            for nurse in nurses:
                current = current_by_nurse[nurse.id]
                excess = len(current) - target[nurse.id]
                if excess > 0:
                    pool.extend(current[-excess:])
                    current_by_nurse[nurse.id] = current[:-excess]

            pool_iter = iter(pool)
            reassigned = 0
            for nurse in nurses:
                need = target[nurse.id] - len(current_by_nurse[nurse.id])
                for _ in range(max(0, need)):
                    patient = next(pool_iter, None)
                    if patient is None:
                        break
                    PatientAssignment.objects.filter(patient=patient, status='active').update(
                        status='reassigned'
                    )
                    PatientAssignment.objects.create(
                        patient=patient,
                        assigned_nurse=nurse,
                        assigned_nurse_name=nurse_display_name(nurse),
                        status='active',
                    )
                    reassigned += 1

            self.stdout.write(
                self.style.SUCCESS(
                    f'Rebalanced {len(patients)} patient(s) across {len(nurses)} active nurse(s); '
                    f'{reassigned} reassignment(s) made.'
                )
            )
            self.stdout.write('Per-nurse patient counts:')
            for nurse in nurses:
                count = Patient.objects.filter(assigned_nurse=nurse).count()
                self.stdout.write(f'  {nurse_display_name(nurse)}: {count}')
