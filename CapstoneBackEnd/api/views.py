from django.contrib.auth import authenticate
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

    def post(self, request):
        serializer = SignupSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        token, _ = Token.objects.get_or_create(user=user)
        return Response(
            {
                'token': token.key,
                'user': UserSerializer(user).data,
            },
            status=status.HTTP_201_CREATED,
        )


class LoginView(APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        email = serializer.validated_data['email'].lower()
        password = serializer.validated_data['password']
        requested_role = serializer.validated_data.get('role')

        user = authenticate(username=email, password=password)
        if user is None:
            # Also try looking up by email field in case username differs
            try:
                matched = User.objects.get(email__iexact=email)
                user = authenticate(username=matched.username, password=password)
            except User.DoesNotExist:
                user = None

        if user is None:
            return Response(
                {'detail': 'Invalid email or password.'},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        profile = getattr(user, 'nurse_profile', None)
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

        token, _ = Token.objects.get_or_create(user=user)
        return Response(
            {
                'token': token.key,
                'user': UserSerializer(user).data,
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
