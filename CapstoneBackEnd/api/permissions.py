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


class IsSupervisor(BasePermission):
    """Allow only approved supervisors."""

    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and get_user_role(request.user) == 'supervisor'
            and _is_approved(request.user)
        )


class IsApprovedNurse(BasePermission):
    """Any authenticated, admin-approved nurse (staff or supervisor)."""

    message = (
        'Your account is pending admin approval. Hospital records are not '
        'available until an administrator approves your registration.'
    )

    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and get_user_role(request.user) in ('staff_nurse', 'supervisor')
            and _is_approved(request.user)
        )


class IsSupervisorOrReadOnly(BasePermission):
    """Supervisors can write; authenticated users can read."""

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        if request.method in SAFE_METHODS:
            return True
        return get_user_role(request.user) == 'supervisor'


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
