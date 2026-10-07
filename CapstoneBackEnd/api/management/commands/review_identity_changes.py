"""
Read-only review of verified-identity changes. Changes nothing.

    python manage.py review_identity_changes

Lists:
  1. Accounts whose name contains a blocked role word (settings.NAME_BLOCKED_WORDS).
  2. Login-email changes that completed through the verification-code flow.
  3. Approved correction requests (name, licence number or clinical role).
  4. Clinical role values outside the four allowed ones.

Limitation: changes made before this flow existed (direct edits by nurses, or
Django-admin edits) left no record, so they cannot be listed here. Review
those by hand against the paper registration, or treat the current values as
the baseline.
"""

from django.contrib.auth.models import User
from django.core.management.base import BaseCommand

from api.identity import blocked_name_terms
from api.models import ClinicalRole, CorrectionRequest, EmailChangeRequest, NurseProfile


class Command(BaseCommand):
    help = 'List identity changes and suspicious names for review (read-only).'

    def handle(self, *args, **options):
        out = self.stdout

        out.write('== Names containing blocked role words ==')
        found = 0
        for user in User.objects.all():
            terms = blocked_name_terms(user.get_full_name())
            if terms:
                found += 1
                out.write(f'  id={user.pk} name={user.get_full_name()!r} email={user.email} terms={terms}')
        out.write(f'  {found} account(s).')

        out.write('== Login-email changes completed through verification ==')
        changes = EmailChangeRequest.objects.filter(used_at__isnull=False).select_related('user').order_by('used_at')
        for c in changes:
            out.write(f'  user={c.user_id} {c.old_email} -> {c.new_email} at={c.used_at:%Y-%m-%d %H:%M}')
        out.write(f'  {changes.count()} change(s).')

        out.write('== Approved correction requests ==')
        corrections = CorrectionRequest.objects.filter(status='approved').select_related('user', 'reviewed_by')
        for c in corrections:
            reviewer = c.reviewed_by.get_full_name() if c.reviewed_by_id else 'unknown'
            out.write(f'  request={c.pk} user={c.user_id} fields={sorted(c.requested)} '
                      f'approved_by={reviewer} at={c.reviewed_at:%Y-%m-%d %H:%M}')
        out.write(f'  {corrections.count()} correction(s).')

        out.write('== Clinical roles outside the four allowed values ==')
        allowed = set(ClinicalRole.values)
        bad = [
            (p.user_id, p.clinical_role)
            for p in NurseProfile.objects.all()
            if p.clinical_role not in allowed
        ]
        for user_id, value in bad:
            out.write(f'  user={user_id} clinical_role={value!r}')
        out.write(f'  {len(bad)} account(s).')

        out.write('Nothing was changed.')
