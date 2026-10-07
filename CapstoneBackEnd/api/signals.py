"""
Any path that leaves an account unable to use the app — admin action, API,
Django admin save, bulk approve/reject — revokes its sessions and closes its
open sockets. Hooked on save so no path can forget it.
"""

from django.contrib.auth.models import User
from django.db.models.signals import post_save
from django.dispatch import receiver

from .access import user_is_active_member
from .auth_sessions import close_user_sockets, revoke_all_sessions
from .models import NurseProfile


def _revoke_if_blocked(user):
    if user_is_active_member(user):
        return
    revoke_all_sessions(user)
    close_user_sockets(user)


@receiver(post_save, sender=NurseProfile)
def revoke_when_profile_blocked(sender, instance, **kwargs):
    _revoke_if_blocked(instance.user)


@receiver(post_save, sender=User)
def revoke_when_user_blocked(sender, instance, **kwargs):
    _revoke_if_blocked(instance)
