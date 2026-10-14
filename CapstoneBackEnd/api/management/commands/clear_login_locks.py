"""
Lift sign-in lockouts right away (they otherwise expire on their own).

    python manage.py clear_login_locks                 # every lock and counter
    python manage.py clear_login_locks --email a@b.com # one account only
"""

from django.core.cache import caches
from django.core.management.base import BaseCommand

from api import login_throttle


class Command(BaseCommand):
    help = 'Clear "too many sign-in attempts" lockouts.'

    def add_arguments(self, parser):
        parser.add_argument('--email', help='Only clear this account.')

    def handle(self, *args, **options):
        cache = caches[login_throttle._conf('CACHE_ALIAS')]
        email = options.get('email')
        if email:
            login_throttle.clear_account(email)
            self.stdout.write(self.style.SUCCESS(f'Cleared sign-in lockout for {email}.'))
        elif cache.__class__.__name__ == 'DatabaseCache':
            # Its own table, holding nothing but login counters.
            cache.clear()
            self.stdout.write(self.style.SUCCESS('Cleared every sign-in lockout.'))
        else:
            # A shared Redis may hold other data; never flush it wholesale.
            self.stderr.write('Login counters are in Redis here; pass --email to clear one account.')
