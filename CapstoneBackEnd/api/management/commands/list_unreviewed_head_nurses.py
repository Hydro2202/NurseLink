"""
Read-only: list head nurse accounts that no admin ever granted.

Accounts created before role-grant tracking have no role_granted_by/at, and
an account that self-selected head nurse at signup would have been created
with that role. This prints them so a human can review each one. It never
changes any account.
"""

from django.core.management.base import BaseCommand

from api.models import NurseProfile


class Command(BaseCommand):
    help = 'List head nurse accounts with no recorded admin grant (read-only).'

    def handle(self, *args, **options):
        unreviewed = (
            NurseProfile.objects.filter(role='head_nurse', role_granted_by__isnull=True)
            .select_related('user')
            .order_by('user__date_joined')
        )
        if not unreviewed:
            self.stdout.write('No head nurse accounts without a recorded admin grant.')
            return
        self.stdout.write(f'{unreviewed.count()} head nurse account(s) with no recorded admin grant:')
        for profile in unreviewed:
            user = profile.user
            self.stdout.write(
                f'  id={user.pk} email={user.email} name={user.get_full_name() or user.username} '
                f'approval={profile.approval_status} requested_role={profile.requested_role or "-"} '
                f'joined={user.date_joined:%Y-%m-%d}'
            )
        self.stdout.write('Nothing was changed. Review each account, then grant or demote it via the admin screen.')
