from django.core.management.base import BaseCommand

from api.vitals_schedule import generate_all


class Command(BaseCommand):
    help = (
        "Create the Vital Signs Monitoring tasks that have come due under each patient's "
        'vital signs schedule. Safe to run as often as you like (e.g. a Render cron job every '
        '15 minutes): an occurrence that already exists is never created twice.'
    )

    def handle(self, *args, **options):
        created = generate_all()
        self.stdout.write(self.style.SUCCESS(f'Created {created} vital signs task(s).'))
