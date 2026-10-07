"""Create the database cache table used by api/ws_tickets.py.

createcachetable is idempotent and skips caches that are not database-backed,
so this is a no-op when WS_TICKET_REDIS_URL points the ticket store at Redis.
"""

from django.core.management import call_command
from django.db import migrations


def create_cache_table(apps, schema_editor):
    call_command('createcachetable', database=schema_editor.connection.alias, verbosity=0)


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0054_registration_id_portrait'),
    ]

    operations = [
        migrations.RunPython(create_cache_table, migrations.RunPython.noop),
    ]
