from django.contrib.auth import authenticate
from django.contrib.auth.models import User
from drf_spectacular.utils import OpenApiExample, extend_schema, inline_serializer
from rest_framework import generics, permissions, serializers, status
from rest_framework.authtoken.models import Token
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Patient
from .serializers import (
    FaceVerificationSerializer,
    IDDocumentUploadSerializer,
    LoginSerializer,
    PatientSerializer,
    RequestOtpSerializer,  # I change this by rai
    SignupSerializer,
    UserSerializer,
    VerifyOtpSerializer,  # I change this by rai
)


AuthResponseSerializer = inline_serializer(
    name='AuthResponse',
    fields={
        'token': serializers.CharField(),
        'user': UserSerializer(),
    },
)


class SignupView(APIView):
    permission_classes = [permissions.AllowAny]

    @extend_schema(
        request=SignupSerializer,
        responses={201: AuthResponseSerializer},
        tags=['Auth'],
        summary='Sign up',
        description='Create a new nurse account and receive an auth token.',
        auth=None,
    )
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

    @extend_schema(
        request=LoginSerializer,
        responses={
            200: AuthResponseSerializer,
            401: inline_serializer(
                name='LoginError',
                fields={'detail': serializers.CharField()},
            ),
        },
        tags=['Auth'],
        summary='Log in',
        description='Sign in with email and password. Optional role must match the account.',
        auth=None,
        examples=[
            OpenApiExample(
                'Nurse login',
                value={
                    'email': 'nurse@hospital.com',
                    'password': 'password123',
                    'role': 'staff_nurse',
                },
                request_only=True,
            ),
            OpenApiExample(
                'Supervisor login',
                value={
                    'email': 'head@hospital.com',
                    'password': 'password123',
                    'role': 'supervisor',
                },
                request_only=True,
            ),
        ],
    )
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

    @extend_schema(
        responses={200: UserSerializer},
        tags=['Auth'],
        summary='Current user',
    )
    def get(self, request):
        return Response(UserSerializer(request.user).data)

    @extend_schema(
        request=inline_serializer(
            name='UpdateMeRequest',
            fields={
                'firstName': serializers.CharField(required=False),
                'middleName': serializers.CharField(required=False),
                'lastName': serializers.CharField(required=False),
                'department': serializers.CharField(required=False),
                'licenseNumber': serializers.CharField(required=False),
                'avatar': serializers.CharField(required=False),
            },
        ),
        responses={200: UserSerializer},
        tags=['Auth'],
        summary='Update current user',
    )
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


class UploadIdView(APIView):
    permission_classes = [permissions.AllowAny]
    parser_classes = [FormParser, MultiPartParser]

    @extend_schema(
        request=IDDocumentUploadSerializer,
        responses={201: inline_serializer(
            name='UploadIdResponse',
            fields={
                'idDocumentId': serializers.IntegerField(),
                'fileUrl': serializers.CharField(),
                'uploadedAt': serializers.DateTimeField(),
                # I change this by rai
                'ocrData': inline_serializer(
                    name='OcrData',
                    fields={
                        'fullName': serializers.CharField(),
                        'employeeId': serializers.CharField(),
                        'hospitalName': serializers.CharField(),
                        'department': serializers.CharField(),
                        'position': serializers.CharField(),
                        'rawText': serializers.CharField(),
                    },
                ),
            },
        )},
        tags=['Auth'],
        summary='Upload ID document',
        description='Upload an ID image, OCR-scan it for name/employee ID/department/position, and return an ID reference for face verification.',
        auth=None,
    )
    def post(self, request):
        serializer = IDDocumentUploadSerializer(data=request.data, context={'request': request})
        serializer.is_valid(raise_exception=True)
        document = serializer.save()
        return Response(
            {
                'idDocumentId': document.pk,
                'fileUrl': document.image.url,
                'uploadedAt': document.uploaded_at,
                'ocrData': document.extracted_text,  # I change this by rai
            },
            status=status.HTTP_201_CREATED,
        )


class VerifyFaceView(APIView):
    permission_classes = [permissions.AllowAny]
    parser_classes = [FormParser, MultiPartParser]

    @extend_schema(
        request=FaceVerificationSerializer,
        responses={200: inline_serializer(
            name='FaceVerificationResponse',
            fields={
                'faceVerificationId': serializers.IntegerField(),
                'matchScore': serializers.FloatField(),
                'confidence': serializers.CharField(),
                'status': serializers.CharField(),
                'message': serializers.CharField(),
            },
        )},
        tags=['Auth'],
        summary='Verify face against ID image',
        description='Submit live captured face images and compare them against the uploaded ID to determine a match score and verification status.',
        auth=None,
    )
    def post(self, request):
        serializer = FaceVerificationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        verification = serializer.save()
        return Response(
            {
                'faceVerificationId': verification.pk,
                'matchScore': verification.match_score,
                'confidence': verification.confidence,
                'status': verification.status,
                'message': verification.message,
            }
        )


# I change this by rai
class RequestOtpView(APIView):
    permission_classes = [permissions.AllowAny]

    @extend_schema(
        request=RequestOtpSerializer,
        responses={201: inline_serializer(
            name='RequestOtpResponse',
            fields={'message': serializers.CharField()},
        )},
        tags=['Auth'],
        summary='Request an email OTP',
        description='Sends a 6-digit verification code to the given email. Used as a fallback when face verification repeatedly fails during signup.',
        auth=None,
    )
    def post(self, request):
        serializer = RequestOtpSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response({'message': 'Verification code sent.'}, status=status.HTTP_201_CREATED)


# I change this by rai
class VerifyOtpView(APIView):
    permission_classes = [permissions.AllowAny]

    @extend_schema(
        request=VerifyOtpSerializer,
        responses={200: inline_serializer(
            name='VerifyOtpResponse',
            fields={'otpVerificationId': serializers.IntegerField()},
        )},
        tags=['Auth'],
        summary='Verify an email OTP',
        description='Checks a submitted code against the most recent pending code for that email. Returns an id to attach to the signup request.',
        auth=None,
    )
    def post(self, request):
        serializer = VerifyOtpSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        otp = serializer.save()
        return Response({'otpVerificationId': otp.pk})


class LogoutView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(
        request=None,
        responses={
            200: inline_serializer(
                name='LogoutResponse',
                fields={'detail': serializers.CharField()},
            )
        },
        tags=['Auth'],
        summary='Log out',
    )
    def post(self, request):
        Token.objects.filter(user=request.user).delete()
        return Response({'detail': 'Logged out.'})


class PatientListView(generics.ListAPIView):
    serializer_class = PatientSerializer
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(tags=['Patients'], summary='List patients')
    def get(self, request, *args, **kwargs):
        return super().get(request, *args, **kwargs)

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

    @extend_schema(tags=['Patients'], summary='Get patient')
    def get(self, request, *args, **kwargs):
        return super().get(request, *args, **kwargs)

    def get_queryset(self):
        return Patient.objects.all()
