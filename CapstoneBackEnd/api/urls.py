from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register(r'patients', views.PatientViewSet, basename='patient')
router.register(r'tasks', views.TaskViewSet, basename='task')
router.register(r'handovers', views.HandoverViewSet, basename='handover')
router.register(r'task-handovers', views.TaskHandoverViewSet, basename='task-handover')
router.register(r'charting', views.ChartingViewSet, basename='charting')
router.register(r'vital-signs', views.VitalSignsViewSet, basename='vital-signs')
router.register(r'notifications', views.NotificationViewSet, basename='notification')
router.register(r'assignments', views.AssignmentViewSet, basename='assignment')
router.register(r'duty-assignments', views.DutyAssignmentViewSet, basename='duty-assignment')
router.register(r'kardex', views.KardexViewSet, basename='kardex')
router.register(r'kardex-laboratories', views.KardexLaboratoryViewSet, basename='kardex-laboratory')
router.register(r'kardex-medications', views.KardexMedicationViewSet, basename='kardex-medication')
router.register(r'medication-intakes', views.MedicationIntakeViewSet, basename='medication-intake')
router.register(r'nurses', views.NurseViewSet, basename='nurse')
router.register(r'departments', views.DepartmentViewSet, basename='department')
router.register(r'doctors', views.DoctorViewSet, basename='doctor')
router.register(r'admin/users', views.AdminUserViewSet, basename='admin-user')
router.register(r'admin/corrections', views.AdminCorrectionViewSet, basename='admin-correction')
router.register(
    r'admin/registration-sessions', views.RegistrationSessionViewSet, basename='admin-registration-session'
)
router.register(
    r'admin/face-verification-attempts',
    views.FaceVerificationAttemptViewSet,
    basename='admin-face-verification-attempt',
)

urlpatterns = [
    path('preferences/', views.PreferencesView.as_view(), name='preferences'),
    path('live/', views.LiveStateView.as_view(), name='live-state'),
    path('auth/signup/', views.SignupView.as_view(), name='signup'),
    path('auth/verify-id/', views.VerifyIdView.as_view(), name='verify-id'),
    path('auth/verify-prc/', views.VerifyPrcLicenseView.as_view(), name='verify-prc'),
    path('auth/face-verification/', views.FaceVerificationView.as_view(), name='face-verification'),
    path(
        'auth/face-verification/status/',
        views.FaceVerificationStatusView.as_view(),
        name='face-verification-status',
    ),
    path('auth/registration-email/', views.RegistrationEmailView.as_view(), name='registration-email'),
    path('auth/send-registration-otp/', views.SendRegistrationOtpView.as_view(), name='send-registration-otp'),
    path(
        'auth/verify-registration-otp/',
        views.VerifyRegistrationOtpView.as_view(),
        name='verify-registration-otp',
    ),
    path(
        'auth/resend-registration-otp/',
        views.ResendRegistrationOtpView.as_view(),
        name='resend-registration-otp',
    ),
    path('auth/login/', views.LoginView.as_view(), name='login'),
    path('auth/token/', views.OAuthTokenView.as_view(), name='oauth-token'),
    path('auth/logout/', views.LogoutView.as_view(), name='logout'),
    path('auth/logout-all/', views.LogoutAllView.as_view(), name='logout-all'),
    path('auth/ws-ticket/', views.WsTicketView.as_view(), name='ws-ticket'),
    path('auth/email-change/', views.EmailChangeView.as_view(), name='email-change'),
    path('auth/email-change/confirm/', views.EmailChangeConfirmView.as_view(), name='email-change-confirm'),
    path('auth/corrections/', views.CorrectionRequestView.as_view(), name='correction-request'),
    path('admin/face-unlock/', views.AdminFaceUnlockView.as_view(), name='admin-face-unlock'),
    path('auth/me/', views.MeView.as_view(), name='me'),
    path('auth/change-password/', views.ChangePasswordView.as_view(), name='change-password'),
    path('workload/', views.WorkloadView.as_view(), name='workload'),
    path('analytics/', views.AnalyticsView.as_view(), name='analytics'),
    path('', include(router.urls)),
]
