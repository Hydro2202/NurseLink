from rest_framework.permissions import BasePermission, SAFE_METHODS


def get_user_role(user):
    profile = getattr(user, 'nurse_profile', None)
    return profile.role if profile else None


def _is_approved(user) -> bool:
    """
    True only for a profile an admin has actually approved and not deactivated.

    Identity verification at signup (PRC licence + face/OTP) proves *who*
    someone is; it does not prove they work at the hospital they claimed.
    approval_status is the second, human gate on top of that — checked here,
    server-side, so a request that reaches the API directly is rejected the
    same way a request through the app would be. See admin.py for the
    reviewer side (approve/reject actions on NurseProfile).
    """
    profile = getattr(user, 'nurse_profile', None)
    return bool(profile and profile.approval_status == 'approved' and profile.is_active_staff)


def _denial_context(user) -> str:
    """
    Names exactly which account/role was checked, so a 403 is self-diagnosing
    instead of a bare "you do not have permission" — this codebase has many
    lookalike test accounts (several "Raiden Villapando"/"Lawrence Cortez"
    logins split across staff_nurse and supervisor), so "which account am I
    actually signed in as right now" is the real question behind most
    permission reports, not a bug in the check itself.
    """
    role = get_user_role(user) or 'no role assigned'
    return f"Signed in as {user.email or user.username} ({role})."


class IsSupervisor(BasePermission):
    """Allow only approved supervisors."""

    def has_permission(self, request, view):
        if not (request.user and request.user.is_authenticated):
            self.message = 'You must be signed in to do this.'
            return False
        if get_user_role(request.user) != 'supervisor':
            self.message = f'This action requires a supervisor account. {_denial_context(request.user)}'
            return False
        if not _is_approved(request.user):
            self.message = f'Your supervisor account is not approved or has been deactivated. {_denial_context(request.user)}'
            return False
        return True


class IsApprovedNurse(BasePermission):
    """Any authenticated, admin-approved nurse (staff or supervisor)."""

    def has_permission(self, request, view):
        if not (request.user and request.user.is_authenticated):
            self.message = 'You must be signed in to do this.'
            return False
        if get_user_role(request.user) not in ('staff_nurse', 'supervisor'):
            self.message = f'This action requires a nurse or supervisor account. {_denial_context(request.user)}'
            return False
        if not _is_approved(request.user):
            self.message = (
                'Your account is pending admin approval. Hospital records are not '
                f'available until an administrator approves your registration. {_denial_context(request.user)}'
            )
            return False
        return True


class IsSupervisorOrReadOnly(BasePermission):
    """Supervisors can write; authenticated users can read."""

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            self.message = 'You must be signed in to do this.'
            return False
        if request.method in SAFE_METHODS:
            return True
        if get_user_role(request.user) != 'supervisor':
            self.message = f'This action requires a supervisor account. {_denial_context(request.user)}'
            return False
        return True


class IsAdmin(BasePermission):
    """
    Allow only real Django staff accounts (User.is_staff), never a claim
    made through the public API.

    Deliberately NOT based on email domain/pattern — a nurse can put
    anything in the email field of the ordinary signup form, so "looks like
    an admin email" is not something a permission check can trust. is_staff
    can only be set by an existing admin (Django admin, or the createsuperuser/
    shell path used to create the first one) — the public SignupSerializer
    never touches it.
    """

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.is_staff)
