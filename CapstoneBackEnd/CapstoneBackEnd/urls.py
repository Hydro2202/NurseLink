"""
URL configuration for CapstoneBackEnd project.
"""

from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.shortcuts import render
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView


def scalar_docs(request):
    return render(
        request,
        'scalar.html',
        {
            'title': 'NurseLink API',
            'openapi_url': '/api/schema/',
        },
    )


urlpatterns = [
    path('', scalar_docs, name='api-docs-root'),
    path('admin/', admin.site.urls),
    path('api/schema/', SpectacularAPIView.as_view(), name='schema'),
    path('api/docs/', scalar_docs, name='api-docs'),
    path('api/', include('api.urls')),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
