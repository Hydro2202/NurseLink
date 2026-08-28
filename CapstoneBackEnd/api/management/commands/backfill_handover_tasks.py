"""
Give existing handovers the tasks they would have had.

Handovers written before tasks were created up front have no task attached, so
their work shows on nobody's list: a pending handover is invisible to the nurse
who still owns it, and an acknowledged one is invisible to the nurse who took
it. This walks the existing handovers and creates the missing task, assigning it
to whoever is responsible right now.

Run with --dry-run first to see what it would do.
"""

from django.core.management.base import BaseCommand
from django.db import transaction

from api.handover_tasks import create_handover_tasks
from api.models import HandoverNote

ACKNOWLEDGED_STATUSES = ('acknowledged', 'received', 'completed')


class Command(BaseCommand):
    help = 'Create the missing tasks for handovers that predate automatic task creation.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Show what would be created without writing anything.',
        )

    def handle(self, *args, **options):
        dry_run = options['dry_run']
        created_total = 0
        skipped = 0

        # Only handovers with no task at all: anything already linked has been
        # handled, and re-running must never add a second copy of the same work.
        candidates = (
            HandoverNote.objects.filter(tasks__isnull=True)
            .select_related('created_by', 'acknowledged_by', 'nurse_to_user', 'patient')
            .order_by('handover_code')
        )

        for handover in candidates:
            # Who owns this work now? An accepted handover belongs to whoever
            # accepted it; anything else is still the sender's responsibility.
            if handover.status in ACKNOWLEDGED_STATUSES:
                owner = handover.acknowledged_by or handover.nurse_to_user
            else:
                owner = handover.created_by

            if owner is None:
                self.stdout.write(
                    self.style.WARNING(
                        '%s (%s): no account to assign to, skipped.'
                        % (handover.handover_code, handover.status)
                    )
                )
                skipped += 1
                continue

            if dry_run:
                self.stdout.write(
                    '%s (%s) -> would create a task for %s'
                    % (
                        handover.handover_code,
                        handover.status,
                        owner.get_full_name().strip() or owner.username,
                    )
                )
                created_total += 1
                continue

            with transaction.atomic():
                # create_handover_tasks assigns to handover.created_by, so point
                # it at the current owner for the duration of the call rather
                # than duplicating its task-building logic here.
                original_creator = handover.created_by
                handover.created_by = owner
                tasks = create_handover_tasks(handover)
                handover.created_by = original_creator

            for task in tasks:
                self.stdout.write(
                    self.style.SUCCESS(
                        '%s -> %s "%s" for %s'
                        % (
                            handover.handover_code,
                            task.task_code,
                            task.title,
                            task.assigned_to,
                        )
                    )
                )
            created_total += len(tasks)

        verb = 'Would create' if dry_run else 'Created'
        self.stdout.write(
            self.style.SUCCESS('\n%s %d task(s); skipped %d handover(s).'
                               % (verb, created_total, skipped))
        )
