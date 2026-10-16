from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0066_preferences_vibration_and_email_default'),
    ]

    operations = [
        migrations.AddField(
            model_name='task',
            name='due_date',
            field=models.DateField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='task',
            name='reminder_sent_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
