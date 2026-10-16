from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0065_backfill_kardex_medication_status'),
    ]

    operations = [
        migrations.AddField(
            model_name='userpreferences',
            name='vibration_alerts',
            field=models.BooleanField(default=True),
        ),
        migrations.AlterField(
            model_name='userpreferences',
            name='email_notifications',
            field=models.BooleanField(default=True),
        ),
    ]
