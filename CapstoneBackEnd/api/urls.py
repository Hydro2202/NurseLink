from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register(r'patients', views.PatientViewSet, basename='patient')
router.register(r'tasks', views.TaskViewSet, basename='task')
router.register(r'handovers', views.HandoverViewSet, basename='handover')
router.register(r'charting', views.ChartingViewSet, basename='charting')
router.register(r'notifications', views.NotificationViewSet, basename='notification')
router.register(r'assignments', views.AssignmentViewSet, basename='assignment')
router.register(r'kardex', views.KardexViewSet, basename='kardex')
router.register(r'nurses', views.NurseViewSet, basename='nurse')

urlpatterns = [
    path('auth/signup/', views.SignupView.as_view(), name='signup'),
    path('auth/face-verification/', views.FaceVerificationView.as_view(), name='face-verification'),
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
    path('auth/me/', views.MeView.as_view(), name='me'),
    path('auth/change-password/', views.ChangePasswordView.as_view(), name='change-password'),
    path('workload/', views.WorkloadView.as_view(), name='workload'),
    path('analytics/', views.AnalyticsView.as_view(), name='analytics'),
    path('', include(router.urls)),
]
