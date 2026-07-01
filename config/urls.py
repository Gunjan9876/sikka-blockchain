from django.contrib import admin
from django.urls import path, include

urlpatterns = [
    path("admin/", admin.site.urls),

    # Landing Page
    path("", include("landing.urls")),

    # Authentication APIs
    path("api/accounts/", include("accounts.urls")),

    # Mining APIs
    path("api/mining/", include("mining.urls")),
]