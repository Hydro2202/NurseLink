"""
Prove the registration OTP can actually reach an inbox.

    python manage.py check_email                    # send to EMAIL_HOST_USER
    python manage.py check_email someone@gmail.com  # send to anyone

Reports what is configured, then sends one real message. Distinguishes the
common Gmail failures by name so the fix is obvious rather than a guess.
"""

import smtplib

from django.conf import settings
from django.core.mail import send_mail
from django.core.management.base import BaseCommand

PLACEHOLDER = 'PASTE_16_CHAR_APP_PASSWORD_HERE'


class Command(BaseCommand):
    help = 'Send a test email to verify SMTP is configured correctly.'

    def add_arguments(self, parser):
        parser.add_argument(
            'recipient',
            nargs='?',
            help='Where to send. Defaults to EMAIL_HOST_USER.',
        )

    def handle(self, *args, **options):
        host = (settings.EMAIL_HOST or '').strip()
        user = (settings.EMAIL_HOST_USER or '').strip()
        password = (settings.EMAIL_HOST_PASSWORD or '').strip()
        recipient = options.get('recipient') or user

        self.stdout.write('')
        self.stdout.write(f'  host       {host or "(not set)"}:{settings.EMAIL_PORT}')
        self.stdout.write(f'  from       {settings.DEFAULT_FROM_EMAIL}')
        self.stdout.write(f'  username   {user or "(not set)"}')
        self.stdout.write(
            f'  password   {"set (%d chars)" % len(password) if password else "(not set)"}'
        )
        self.stdout.write(f'  TLS        {settings.EMAIL_USE_TLS}')
        self.stdout.write(f'  to         {recipient or "(nobody)"}')
        self.stdout.write('')

        if not host:
            raise SystemExit(self._fail('EMAIL_HOST is not set in CapstoneBackEnd/.env.'))
        if not password or password == PLACEHOLDER:
            raise SystemExit(
                self._fail(
                    'EMAIL_HOST_PASSWORD is still the placeholder. Generate a Gmail App '
                    'Password (myaccount.google.com -> Security -> 2-Step Verification -> '
                    'App passwords) and paste the 16 characters into .env.'
                )
            )
        if not recipient:
            raise SystemExit(self._fail('No recipient. Pass one, or set EMAIL_HOST_USER.'))
        if len(password) != 16:
            # Not fatal — some providers differ — but it is the usual mistake.
            self.stdout.write(
                self.style.WARNING(
                    f'  note: Gmail App Passwords are 16 characters; this one is {len(password)}. '
                    'A normal account password will be rejected.'
                )
            )

        try:
            sent = send_mail(
                subject='NurseLink — SMTP test',
                message=(
                    'This is a test from NurseLink.\n\n'
                    'If you are reading this in your inbox, registration OTP codes will '
                    'be delivered the same way.\n'
                ),
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=[recipient],
                fail_silently=False,
            )
        except smtplib.SMTPAuthenticationError as exc:
            raise SystemExit(
                self._fail(
                    'Gmail rejected the credentials. This almost always means a normal '
                    'account password was used instead of an App Password, or 2-Step '
                    f'Verification is off.\n         {exc}'
                )
            )
        except smtplib.SMTPException as exc:
            raise SystemExit(self._fail(f'SMTP error: {exc}'))
        except OSError as exc:
            raise SystemExit(
                self._fail(f'Could not reach {host}:{settings.EMAIL_PORT} — {exc}')
            )

        if sent:
            self.stdout.write(self.style.SUCCESS(f'  Sent. Check the inbox for {recipient}.'))
            if settings.ALLOW_CONSOLE_OTP:
                self.stdout.write('')
                self.stdout.write(
                    self.style.WARNING(
                        '  ALLOW_CONSOLE_OTP is still True, so OTP codes go to the server log '
                        'rather than email. Set it to False in .env to use real delivery.'
                    )
                )
        else:
            raise SystemExit(self._fail('send_mail reported 0 messages sent.'))

    def _fail(self, message):
        self.stdout.write(self.style.ERROR(f'  FAILED: {message}'))
        return 1
