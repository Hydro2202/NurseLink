from rest_framework.permissions import BasePermission, SAFE_METHODS


def get_user_role(user):
    profile = getattr(user, 'nurse_profile', None)
    return profile.role if profile else None


class IsSupervisor(BasePermission):
    """Allow only supervisors."""

    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and get_user_role(request.user) == 'supervisor'
        )


class IsStaffNurseOrSupervisor(BasePermission):
    """Any authenticated nurse with a profile."""

    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and get_user_role(request.user) in ('staff_nurse', 'supervisor')
        )


class IsSupervisorOrReadOnly(BasePermission):
    """Supervisors can write; authenticated users can read."""

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        if request.method in SAFE_METHODS:
            return True
        return get_user_role(request.user) == 'supervisor'
