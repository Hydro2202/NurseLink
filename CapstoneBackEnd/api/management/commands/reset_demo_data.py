"""
Reset the database to a clean "zero" state for the hospital simulation.

    python manage.py reset_demo_data          # show what would be deleted
    python manage.py reset_demo_data --yes    # actually delete

Keeps only the accounts in KEEP_USERNAMES (with their NurseProfile and
UserPreferences rows) plus hospital setup data: Departments and Doctors.
Deletes every patient and everything hanging off one (visits, tasks,
handovers/endorsements, Kardex, charting, vitals), the duty roster,
notifications, login sessions, signup/registration records, the admin audit
log, and every other user account.

Runs in one transaction, so a failure leaves the database untouched. Never
drops tables, never touches migrations, auth groups/permissions or content
types, and never changes the kept accounts' passwords or roles.

No S3/media cleanup is needed: no model has a FileField. Profile photos are
stored inline as data URIs (api/avatar.py) and go with their rows.
"""

from django.contrib.auth.models import User
from django.core.management.base import BaseCommand, CommandError
from django.core.management.color import no_style
from django.db import connection, transaction
from rest_framework.authtoken.models import Token

from api.models import (
    AdminAuditLog,
    AuthSession,
    ChartingNote,
    CorrectionRequest,
    Department,
    Doctor,
    DutyAssignment,
    EmailChangeRequest,
    EndorsementTask,
    FaceVerificationAttempt,
    HandoverNote,
    HandoverPatient,
    IdScanAttempt,
    KardexDepartmentVisit,
    KardexLaboratory,
    KardexMedication,
    KardexRecord,
    MedicationIntake,
    Notification,
    NurseProfile,
    Patient,
    PatientAssignment,
    PatientDoctor,
    PatientVisit,
    RegistrationOTP,
    RegistrationSession,
    Task,
    TaskDoctor,
    TaskEvent,
    TaskHandover,
    UserPreferences,
    VitalSigns,
    VitalSignsSchedule,
)

# The demo accounts that survive the reset.
KEEP_USERNAMES = [
    'nurse@hospital.com',      # demo staff nurse
    'headnurse@hospital.com',  # demo head nurse
    'admin',                   # admin
    'raiden@admin.com',        # admin
]

# Children before parents, so no delete waits on a cascade or hits PROTECT.
CLEARED_MODELS = [
    TaskEvent,
    TaskDoctor,
    MedicationIntake,
    VitalSigns,
    Notification,
    EndorsementTask,
    HandoverPatient,
    TaskHandover,
    PatientAssignment,
    Task,
    VitalSignsSchedule,
    ChartingNote,
    KardexRecord,
    KardexLaboratory,
    KardexMedication,
    KardexDepartmentVisit,
    PatientDoctor,
    HandoverNote,
    PatientVisit,
    Patient,
    DutyAssignment,
    FaceVerificationAttempt,
    IdScanAttempt,
    RegistrationOTP,
    RegistrationSession,
    AuthSession,
    Token,
    EmailChangeRequest,
    CorrectionRequest,
    AdminAuditLog,
]

# Shown for the record but only trimmed to the kept accounts, never emptied.
USER_MODELS = [User, NurseProfile, UserPreferences]
KEPT_MODELS = [Department, Doctor]


class Command(BaseCommand):
    help = 'Delete all operational data, keeping only the demo accounts and hospital setup data.'

    def add_arguments(self, parser):
        parser.add_argument('--yes', action='store_true', help='Actually delete. Without it, only counts are shown.')

    def _counts(self):
        return {m.__name__: m.objects.count() for m in CLEARED_MODELS + USER_MODELS + KEPT_MODELS}

    def handle(self, *args, **options):
        kept = User.objects.filter(username__in=KEEP_USERNAMES)
        missing = sorted(set(KEEP_USERNAMES) - set(kept.values_list('username', flat=True)))
        if missing:
            raise CommandError(f'Kept account(s) not found, refusing to run: {", ".join(missing)}')

        self.stdout.write('Keeping accounts:')
        for user in kept.order_by('id'):
            profile = NurseProfile.objects.filter(user=user).first()
            role = profile.role if profile else ('admin' if user.is_staff else '-')
            self.stdout.write(f'  #{user.id} {user.username} ({role})')

        before = self._counts()
        doomed_users = User.objects.exclude(username__in=KEEP_USERNAMES)
        self.stdout.write(f'\nOther user accounts to delete: {doomed_users.count()}')

        if not options['yes']:
            self._print_table(before, None)
            self.stdout.write(self.style.WARNING('\nDry run. Re-run with --yes to delete.'))
            return

        with transaction.atomic():
            for model in CLEARED_MODELS:
                model.objects.all().delete()
            # Cascades their NurseProfile, UserPreferences, tokens and sessions.
            doomed_users.delete()

            # New rows in the emptied tables start again from id 1. The user
            # table keeps its sequence because the demo accounts stay.
            sql = connection.ops.sequence_reset_sql(no_style(), CLEARED_MODELS)
            with connection.cursor() as cursor:
                for statement in sql:
                    cursor.execute(statement)

        self._print_table(before, self._counts())
        self.stdout.write(self.style.SUCCESS('\nReset complete.'))

    def _print_table(self, before, after):
        self.stdout.write('')
        header = f'{"Model":<24}{"Before":>8}' + (f'{"After":>8}' if after else '')
        self.stdout.write(header)
        self.stdout.write('-' * len(header))
        for name, count in before.items():
            line = f'{name:<24}{count:>8}'
            if after is not None:
                line += f'{after[name]:>8}'
            self.stdout.write(line)
