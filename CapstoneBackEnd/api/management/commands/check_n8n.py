"""
Prove each n8n workflow is really reachable from this backend.

    python manage.py check_n8n              # ping all three
    python manage.py check_n8n face_verify  # just one
    python manage.py check_n8n --prefix webhook   # test the production URLs

Sends a small probe payload to each configured workflow and reports what
came back. This is a live network call — it is the difference between "the
code looks right" and "the integration works".
"""

import json
import time

from django.conf import settings
from django.core.management.base import BaseCommand

from api.n8n_client import (
    N8nError,
    N8nWorkflowOffline,
    call_workflow,
    configured_workflows,
    webhook_url,
)

# Minimal but shape-correct probes, so a workflow that inspects its input
# still reaches its response node instead of erroring on a missing field.
PROBES = {
    'structure_chart': {
        'patient': {'id': 'PROBE', 'name': 'Connectivity Probe', 'age': 0},
        'vitalSigns': {},
        'assessment': 'Connectivity probe from manage.py check_n8n.',
        'interventions': [],
        'noteType': 'progress',
        'probe': True,
    },
    'verify_id': {
        'idImage': '',
        'documentType': 'hospital_id',
        'probe': True,
    },
    'face_verify': {
        'image': '',
        'idImage': '',
        'probe': True,
    },
}


class Command(BaseCommand):
    help = 'Send a probe request to each configured n8n workflow and report the result.'

    def add_arguments(self, parser):
        parser.add_argument(
            'workflow',
            nargs='?',
            choices=sorted(PROBES),
            help='Only check this workflow. Default: all of them.',
        )
        parser.add_argument(
            '--prefix',
            help='Override N8N_WEBHOOK_PREFIX for this run (e.g. "webhook" to test production).',
        )
        parser.add_argument(
            '--timeout',
            type=float,
            help='Override the per-call timeout in seconds.',
        )

    def handle(self, *args, **options):
        if options.get('prefix'):
            settings.N8N_WEBHOOK_PREFIX = options['prefix'].strip('/')

        targets = [options['workflow']] if options.get('workflow') else sorted(PROBES)

        self.stdout.write('')
        self.stdout.write(f'n8n base     : {settings.N8N_BASE_URL}')
        self.stdout.write(f'URL space    : /{settings.N8N_WEBHOOK_PREFIX}/')
        self.stdout.write(f'timeout      : {settings.N8N_TIMEOUT_SECONDS:g}s')
        self.stdout.write(
            f'shared token : {"set" if settings.N8N_WEBHOOK_TOKEN else "not set"}'
        )
        self.stdout.write('')

        failures = 0
        for name in targets:
            url = webhook_url(name)
            self.stdout.write(self.style.MIGRATE_HEADING(name))
            self.stdout.write(f'  url    {url or "(not configured)"}')

            started = time.monotonic()
            try:
                result = call_workflow(name, PROBES[name], timeout=options.get('timeout'))
            except N8nWorkflowOffline as exc:
                failures += 1
                self.stdout.write(self.style.WARNING('  status OFFLINE — reachable but nothing listening'))
                self.stdout.write(f'         {exc}')
            except N8nError as exc:
                failures += 1
                self.stdout.write(self.style.ERROR(f'  status FAILED ({type(exc).__name__})'))
                self.stdout.write(f'         {exc}')
            else:
                elapsed = time.monotonic() - started
                self.stdout.write(self.style.SUCCESS(f'  status OK in {elapsed:.2f}s'))
                body = json.dumps(result, default=str)
                self.stdout.write(f'  body   {body[:300]}{"…" if len(body) > 300 else ""}')
            self.stdout.write('')

        total = len(targets)
        if failures:
            self.stdout.write(
                self.style.WARNING(f'{total - failures}/{total} workflows responded.')
            )
            self.stdout.write('')
            self.stdout.write('If a workflow is OFFLINE:')
            self.stdout.write(
                '  test mode  — open the workflow in n8n, press "Execute workflow", then re-run '
                'this command. It accepts exactly one call per press.'
            )
            self.stdout.write(
                '  production — toggle the workflow Active in n8n, then set '
                'N8N_WEBHOOK_PREFIX=webhook in CapstoneBackEnd/.env.'
            )
        else:
            self.stdout.write(self.style.SUCCESS(f'All {total} workflows responded.'))

        # Non-zero exit so this can gate a deploy or CI step.
        if failures:
            raise SystemExit(1)
