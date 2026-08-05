"""
Ensure production-ready test accounts exist with an EMPTY clinical database.

Creates / updates only:
  - nurse@hospital.com      (staff_nurse)
  - headnurse@hospital.com  (supervisor)

Removes all patients, tasks, handovers, charting, assignments, kardex,
notifications, and any other demo users. Never seeds domain records.
"""

from django.contrib.auth.models import User
from django.core.management.base import BaseCommand
from rest_framework.authtoken.models import Token

from api.models import (
    ChartingNote,
    HandoverNote,
    KardexRecord,
    Notification,
    NurseProfile,
    Patient,
    PatientAssignment,
    Task,
)

TEST_ACCOUNTS = [
    {
        'email': 'nurse@hospital.com',
        'password': 'password123',
        'first_name': 'Sarah',
        'last_name': 'Johnson',
        'role': 'staff_nurse',
        'department': 'ICU',
        'license_number': 'RN-10001',
        'clinical_role': 'RN',
        'shift': 'morning',
        'specialization': 'ICU',
    },
    {
        'email': 'headnurse@hospital.com',
        'password': 'password123',
        'first_name': 'Maria',
        'last_name': 'Santos',
        'role': 'supervisor',
        'department': 'Nursing Administration',
        'license_number': 'RN-20001',
        'clinical_role': 'Charge Nurse',
        'shift': 'morning',
        'specialization': 'Administration',
    },
]

# Legacy supervisor email renamed in production phase
LEGACY_SUPERVISOR_EMAIL = 'head@hospital.com'


class Command(BaseCommand):
    help = 'Create empty test accounts and wipe all clinical/demo data.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--keep-data',
            action='store_true',
            help='Only ensure accounts exist; do not wipe patients/tasks/etc.',
        )

    def handle(self, *args, **options):
        keep_data = options['keep_data']

        self._migrate_legacy_supervisor()
        users_by_email = self._ensure_accounts()

        if not keep_data:
            self._wipe_domain_data(keep_emails={u.email.lower() for u in users_by_email.values()})

        self.stdout.write(self.style.SUCCESS('Production seed complete (empty clinical DB).'))
        self.stdout.write('Test accounts:')
        self.stdout.write('  nurse@hospital.com / password123       (staff_nurse)')
        self.stdout.write('  headnurse@hospital.com / password123  (supervisor)')

    def _migrate_legacy_supervisor(self):
        """Rename head@hospital.com → headnurse@hospital.com if needed."""
        try:
            legacy = User.objects.get(email__iexact=LEGACY_SUPERVISOR_EMAIL)
        except User.DoesNotExist:
            return

        if User.objects.filter(email__iexact='headnurse@hospital.com').exists():
            # New account already exists — drop legacy
            Token.objects.filter(user=legacy).delete()
            legacy.delete()
            self.stdout.write('Removed legacy account head@hospital.com')
            return

        legacy.username = 'headnurse@hospital.com'
        legacy.email = 'headnurse@hospital.com'
        legacy.save(update_fields=['username', 'email'])
        self.stdout.write('Renamed head@hospital.com -> headnurse@hospital.com')

    def _ensure_accounts(self):
        users_by_email = {}
        for data in TEST_ACCOUNTS:
            email = data['email'].lower()
            user, created = User.objects.get_or_create(
                username=email,
                defaults={
                    'email': email,
                    'first_name': data['first_name'],
                    'last_name': data['last_name'],
                },
            )
            user.email = email
            user.first_name = data['first_name']
            user.last_name = data['last_name']
            user.set_password(data['password'])
            user.is_active = True
            user.save()

            profile, _ = NurseProfile.objects.get_or_create(user=user)
            profile.role = data['role']
            profile.department = data['department']
            profile.license_number = data['license_number']
            profile.clinical_role = data['clinical_role']
            profile.shift = data['shift']
            profile.specialization = data['specialization']
            profile.overtime_hours = 0
            profile.burnout_risk = 'low'
            profile.is_active_staff = True
            profile.approval_status = 'approved'
            profile.account_status = 'active'
            profile.save()

            Token.objects.get_or_create(user=user)
            users_by_email[email] = user
            self.stdout.write(
                f'{"Created" if created else "Updated"} account: {email} ({data["role"]})'
            )
        return users_by_email

    def _wipe_domain_data(self, keep_emails: set[str]):
        deleted = {
            'notifications': Notification.objects.all().delete()[0],
            'kardex': KardexRecord.objects.all().delete()[0],
            'assignments': PatientAssignment.objects.all().delete()[0],
            'charting': ChartingNote.objects.all().delete()[0],
            'handovers': HandoverNote.objects.all().delete()[0],
            'tasks': Task.objects.all().delete()[0],
            'patients': Patient.objects.all().delete()[0],
        }

        # Remove any non-test users (and their profiles/tokens)
        extras = User.objects.exclude(email__iexact='').exclude(
            email__in=list(keep_emails)
        )
        # Also exclude empty-email superusers if any — keep Django superuser by is_superuser
        extras = extras.filter(is_superuser=False)
        extra_count = extras.count()
        for user in extras:
            Token.objects.filter(user=user).delete()
        extras.delete()

        self.stdout.write(
            'Wiped domain data: '
            + ', '.join(f'{k}={v}' for k, v in deleted.items())
            + f', extra_users={extra_count}'
        )
