"""
Delete the API tokens of every account that may not use the app (pending,
rejected, deactivated, or a Django-inactive user). Covers AuthSession rows
and any legacy DRF authtoken rows.

    python manage.py revoke_inactive_tokens --dry-run   # counts only
    python manage.py revoke_inactive_tokens             # actually deletes

Uses the same rule as the live API (api/access.py), so what this removes is
exactly what the API would already refuse. Not safe to run blindly on
production: run --dry-run first and review the counts.
"""

from django.contrib.auth.models import User
from django.core.management.base import BaseCommand
from rest_framework.authtoken.models import Token

from api.access import account_block_code
from api.models import AuthSession


class Command(BaseCommand):
    help = 'Delete tokens for accounts that are not approved, active members.'

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true', help='Print counts; delete nothing.')

    def handle(self, *args, **options):
        dry_run = options['dry_run']

        blocked_user_ids = []
        for user in User.objects.select_related('nurse_profile').iterator():
            if account_block_code(user):
                blocked_user_ids.append(user.pk)

        sessions = AuthSession.objects.filter(user_id__in=blocked_user_ids)
        legacy = Token.objects.filter(user_id__in=blocked_user_ids)
        session_count = sessions.count()
        legacy_count = legacy.count()

        self.stdout.write(
            f'{len(blocked_user_ids)} blocked account(s): '
            f'{session_count} session token(s), {legacy_count} legacy token(s).'
        )
        if dry_run:
            self.stdout.write('Dry run: nothing deleted.')
            return

        sessions.delete()
        legacy.delete()
        self.stdout.write(self.style.SUCCESS('Deleted the tokens above.'))
