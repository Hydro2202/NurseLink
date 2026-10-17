from django.db import migrations

# One-time conversion of existing Task.priority values to the new risk-level
# vocabulary: urgent->high, routine->medium. 'completed' was a workflow-state
# leftover (status already covers completion) rather than a real risk level,
# so there's no principled risk level to infer it from — it becomes 'low',
# the new default-safe bucket, same as any task this migration can't reason
# about further.
_FORWARD_MAP = {
    'urgent': 'high',
    'routine': 'medium',
    'completed': 'low',
}
_BACKWARD_MAP = {
    'high': 'urgent',
    'medium': 'routine',
    'low': 'routine',
}


def convert_forward(apps, schema_editor):
    Task = apps.get_model('api', 'Task')
    for old, new in _FORWARD_MAP.items():
        Task.objects.filter(priority=old).update(priority=new)


def convert_backward(apps, schema_editor):
    Task = apps.get_model('api', 'Task')
    for old, new in _BACKWARD_MAP.items():
        Task.objects.filter(priority=old).update(priority=new)


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0070_task_risk_level_and_referral_due'),
    ]

    operations = [
        migrations.RunPython(convert_forward, convert_backward),
    ]
