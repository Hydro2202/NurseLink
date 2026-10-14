"""
Accounts approved before approval applied the requested role: someone who
signed up as Head Nurse was approved but left as a staff nurse, and could not
sign in as head nurse. Promote exactly those -- approved, asked for
head_nurse, still staff_nurse, and never given a role by an admin
(role_granted_at empty, so no deliberate admin choice is overridden).
"""

from django.db import migrations
from django.utils import timezone


def promote(apps, schema_editor):
    NurseProfile = apps.get_model('api', 'NurseProfile')
    NurseProfile.objects.filter(
        approval_status='approved',
        requested_role='head_nurse',
        role='staff_nurse',
        role_granted_at__isnull=True,
    ).update(role='head_nurse', role_granted_at=timezone.now())


class Migration(migrations.Migration):
    dependencies = [
        ('api', '0058_admin_audit_log'),
    ]

    operations = [
        migrations.RunPython(promote, migrations.RunPython.noop),
    ]
