from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='nurseprofile',
            name='account_status',
            field=models.CharField(
                choices=[
                    ('pending', 'Pending'),
                    ('approved', 'Approved'),
                    ('rejected', 'Rejected'),
                ],
                default='approved',
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name='nurseprofile',
            name='employee_id',
            field=models.CharField(blank=True, default='', max_length=50),
        ),
        migrations.AddField(
            model_name='nurseprofile',
            name='hospital_name',
            field=models.CharField(blank=True, default='', max_length=200),
        ),
        migrations.AddField(
            model_name='nurseprofile',
            name='ocr_position',
            field=models.CharField(blank=True, default='', max_length=120),
        ),
        migrations.AddField(
            model_name='nurseprofile',
            name='rejection_reason',
            field=models.TextField(blank=True, default=''),
        ),
    ]
