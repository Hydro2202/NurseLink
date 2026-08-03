from django.contrib.auth.models import User
from rest_framework import generics, permissions, status
from rest_framework.authtoken.models import Token
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Patient
from .serializers import (
    LoginSerializer,
    PatientSerializer,
    SignupSerializer,
    UserSerializer,
)


class SignupView(APIView):
    permission_classes = [permissions.AllowAny]
    serializer_class = SignupSerializer

    def post(self, request):
        serializer = self.serializer_class(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        return Response(
            {
                'detail': (
                    'Registration submitted. Your account is awaiting administrator approval.'
                ),
                'status': 'pending',
                'user': UserSerializer(user).data,
            },
            status=status.HTTP_201_CREATED,
        )


class LoginView(APIView):
    permission_classes = [permissions.AllowAny]
    serializer_class = LoginSerializer

    def post(self, request):
        serializer = self.serializer_class(data=request.data)
        serializer.is_valid(raise_exception=True)

        email = serializer.validated_data['email'].lower()
        password = serializer.validated_data['password']
        requested_role = serializer.validated_data.get('role')

        matched = None
        try:
            matched = User.objects.get(username__iexact=email)
        except User.DoesNotExist:
            try:
                matched = User.objects.get(email__iexact=email)
            except User.DoesNotExist:
                matched = None

        if matched is None or not matched.check_password(password):
            return Response(
                {'detail': 'Invalid email or password.'},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        profile = getattr(matched, 'nurse_profile', None)
        account_status = profile.account_status if profile else 'approved'

        if account_status == 'pending' or not matched.is_active:
            return Response(
                {
                    'detail': (
                        'Your registration is pending administrator approval. '
                        'Please try again after you are notified.'
                    ),
                    'status': 'pending',
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        if account_status == 'rejected':
            reason = (profile.rejection_reason if profile else '') or (
                'Your registration was rejected by an administrator.'
            )
            return Response(
                {
                    'detail': reason,
                    'status': 'rejected',
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        if requested_role and profile and profile.role != requested_role:
            return Response(
                {
                    'detail': (
                        f'This account is registered as {profile.role.replace("_", " ")}, '
                        f'not {requested_role.replace("_", " ")}.'
                    )
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        # authenticate() requires is_active=True; we already validated password above
        token, _ = Token.objects.get_or_create(user=matched)
        return Response(
            {
                'token': token.key,
                'user': UserSerializer(matched).data,
            }
        )


class MeView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        return Response(UserSerializer(request.user).data)

    def patch(self, request):
        user = request.user
        profile = getattr(user, 'nurse_profile', None)

        first_name = request.data.get('firstName')
        last_name = request.data.get('lastName')
        if first_name is not None:
            user.first_name = first_name
        if last_name is not None:
            user.last_name = last_name
        user.save()

        if profile:
            if 'middleName' in request.data:
                profile.middle_name = request.data.get('middleName') or ''
            if 'department' in request.data:
                profile.department = request.data.get('department') or ''
            if 'licenseNumber' in request.data:
                profile.license_number = request.data.get('licenseNumber') or ''
            if 'avatar' in request.data:
                profile.avatar = request.data.get('avatar') or ''
            profile.save()

        return Response(UserSerializer(user).data)


class LogoutView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        Token.objects.filter(user=request.user).delete()
        return Response({'detail': 'Logged out.'})


class PatientListView(generics.ListAPIView):
    serializer_class = PatientSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        qs = Patient.objects.all()
        mine = self.request.query_params.get('mine')
        if mine in ('1', 'true', 'True'):
            qs = qs.filter(assigned_nurse=self.request.user)
        return qs


class PatientDetailView(generics.RetrieveAPIView):
    serializer_class = PatientSerializer
    permission_classes = [permissions.IsAuthenticated]
    lookup_field = 'patient_code'
    lookup_url_kwarg = 'patient_code'

    def get_queryset(self):
        return Patient.objects.all()
