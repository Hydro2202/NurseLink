"""
manage.py cleanup_abandoned_registrations — age-based cleanup of unfinished
signup sessions (and the ID portrait image they hold), for the realistic
"scanned an ID, never came back" case that the admin API's clear-abandoned
action (content-emptiness based) does not catch. See issue 15.
"""

from datetime import timedelta
from io import StringIO

from django.contrib.auth.models import User
from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone

from api.models import RegistrationSession


def make_session(**overrides):
    defaults = dict(email='', face_verified=False, otp_verified=False, id_portrait='')
    defaults.update(overrides)
    session = RegistrationSession.objects.create(**defaults)
    if 'updated_at' in overrides:
        RegistrationSession.objects.filter(pk=session.pk).update(updated_at=overrides['updated_at'])
        session.refresh_from_db()
    return session


class CleanupAbandonedRegistrationsTests(TestCase):
    def test_an_old_unverified_session_with_a_stored_portrait_is_deleted(self):
        old = make_session(
            email='someone@hospital.com', id_portrait='data:image/jpeg;base64,abc',
            updated_at=timezone.now() - timedelta(days=10),
        )
        call_command('cleanup_abandoned_registrations', stdout=StringIO())
        self.assertFalse(RegistrationSession.objects.filter(pk=old.pk).exists())

    def test_a_recent_unverified_session_is_kept(self):
        recent = make_session(
            email='someone@hospital.com', id_portrait='data:image/jpeg;base64,abc',
            updated_at=timezone.now() - timedelta(hours=1),
        )
        call_command('cleanup_abandoned_registrations', stdout=StringIO())
        self.assertTrue(RegistrationSession.objects.filter(pk=recent.pk).exists())

    def test_a_verified_session_is_never_deleted_regardless_of_age(self):
        verified = make_session(
            email='someone@hospital.com', id_portrait='data:image/jpeg;base64,abc',
            face_verified=True, updated_at=timezone.now() - timedelta(days=365),
        )
        call_command('cleanup_abandoned_registrations', stdout=StringIO())
        self.assertTrue(RegistrationSession.objects.filter(pk=verified.pk).exists())

    def test_a_session_linked_to_a_real_account_is_never_deleted(self):
        user = User.objects.create_user(username='n@hospital.com', email='n@hospital.com', password='pw-test-1234')
        linked = make_session(
            email='n@hospital.com', user=user, updated_at=timezone.now() - timedelta(days=365),
        )
        call_command('cleanup_abandoned_registrations', stdout=StringIO())
        self.assertTrue(RegistrationSession.objects.filter(pk=linked.pk).exists())

    def test_dry_run_deletes_nothing(self):
        old = make_session(
            email='someone@hospital.com', updated_at=timezone.now() - timedelta(days=10),
        )
        out = StringIO()
        call_command('cleanup_abandoned_registrations', '--dry-run', stdout=out)
        self.assertTrue(RegistrationSession.objects.filter(pk=old.pk).exists())
        self.assertIn('Dry run', out.getvalue())

    def test_days_argument_overrides_the_default_cutoff(self):
        three_days_old = make_session(
            email='someone@hospital.com', updated_at=timezone.now() - timedelta(days=3),
        )
        call_command('cleanup_abandoned_registrations', '--days', '1', stdout=StringIO())
        self.assertFalse(RegistrationSession.objects.filter(pk=three_days_old.pk).exists())
