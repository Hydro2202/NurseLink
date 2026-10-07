"""
Delete stale, unfinished signup sessions — including whatever ID portrait
image they were holding (RegistrationSession.id_portrait, the one image this
app persists; everything else in the identity pipeline is decoded, compared,
and discarded in memory — see face_match.py).

AdminRegistrationSessionViewSet.clear_abandoned (POST /api/admin/registration-
sessions/clear-abandoned/) already covers the "opened the wizard and typed
nothing" case, but only deletes sessions with no email and no name at all —
someone who scanned their ID (so id_portrait is already stored), then
abandoned the flow before verifying, is never touched by it and their photo
sits there indefinitely. This command catches that case on an age basis
instead of a content-emptiness basis.

Never touches a session that is verified or linked to a real account,
regardless of age.

    python manage.py cleanup_abandoned_registrations --dry-run   # counts only
    python manage.py cleanup_abandoned_registrations             # actually deletes
    python manage.py cleanup_abandoned_registrations --days 14   # override the cutoff
"""

import os

from django.core.management.base import BaseCommand
from django.utils import timezone

from api.models import RegistrationSession

DEFAULT_DAYS = int(os.environ.get('ABANDONED_REGISTRATION_DAYS', '7'))


class Command(BaseCommand):
    help = 'Delete unverified, unlinked registration sessions older than N days.'

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true', help='Print counts; delete nothing.')
        parser.add_argument(
            '--days', type=int, default=DEFAULT_DAYS,
            help=f'Age cutoff in days (default {DEFAULT_DAYS}, or ABANDONED_REGISTRATION_DAYS).',
        )

    def handle(self, *args, **options):
        dry_run = options['dry_run']
        cutoff = timezone.now() - timezone.timedelta(days=options['days'])

        stale = RegistrationSession.objects.filter(
            user__isnull=True,
            face_verified=False,
            otp_verified=False,
            updated_at__lt=cutoff,
        )
        count = stale.count()
        with_portrait = stale.exclude(id_portrait='').count()

        self.stdout.write(
            f'{count} abandoned session(s) older than {options["days"]} day(s) '
            f'({with_portrait} holding a stored ID portrait).'
        )
        if dry_run:
            self.stdout.write('Dry run: nothing deleted.')
            return

        stale.delete()
        self.stdout.write(self.style.SUCCESS('Deleted the sessions above.'))
