"""
URL configuration for CapstoneBackEnd project.
"""

from django.contrib import admin
from django.http import HttpResponse
from django.urls import include, path, reverse
from drf_spectacular.views import (
    SpectacularAPIView,
    SpectacularSwaggerView,
    SpectacularRedocView,
)
from rest_framework.permissions import AllowAny


def scalar_docs(request):
    schema_url = request.build_absolute_uri(reverse('schema'))
    html = f"""<!DOCTYPE html>
<html lang=\"en\">
  <head>
    <meta charset=\"utf-8\" />
    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />
    <title>NurseLink API Docs</title>
    <link rel=\"stylesheet\" href=\"https://cdn.jsdelivr.net/npm/@scalar/api-reference/dist/style.css\" />
  </head>
  <body>
    <div id=\"app\"></div>
    <script src=\"https://cdn.jsdelivr.net/npm/@scalar/api-reference\"></script>
    <script>
      Scalar.createApiReference('#app', {{
        url: '{schema_url}',
        title: 'NurseLink API',
        layout: 'modern'
      }});
    </script>
  </body>
</html>"""
    return HttpResponse(html, content_type='text/html')


urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/schema/', SpectacularAPIView.as_view(permission_classes=[AllowAny]), name='schema'),
    path('api/docs/', scalar_docs, name='scalar-docs'),
    path('api/swagger/', SpectacularSwaggerView.as_view(url_name='schema'), name='swagger-ui'),
    path('api/redoc/', SpectacularRedocView.as_view(url_name='schema'), name='redoc'),
    path('api/', include('api.urls')),
]
