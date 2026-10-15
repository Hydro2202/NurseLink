from django.db import migrations


def backfill_status(apps, schema_editor):
    KardexMedication = apps.get_model('api', 'KardexMedication')
    KardexMedication.objects.filter(is_active=True).update(status='ACTIVE')
    KardexMedication.objects.filter(is_active=False).update(status='DISCONTINUED')


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0064_kardex_medication_status_and_department_visit'),
    ]

    operations = [
        migrations.RunPython(backfill_status, noop_reverse),
    ]
