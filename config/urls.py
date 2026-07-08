from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from accounts import views as accounts_views

urlpatterns = [
    path("admin/", admin.site.urls),

    # Landing Page
    path("", include("landing.urls")),

    # Authentication APIs
    path("api/accounts/", include("accounts.urls")),
    
    # Frontend Accounts Pages
    path("accounts/register/", accounts_views.register_page, name="register_page"),
    path("accounts/login/", accounts_views.login_page, name="login_page"),

    # Mining APIs
    path("api/mining/", include("mining.urls")),

    # Wallet API
    path("api/wallet/", include("wallet.urls")),

    # Dashboard
    path("dashboard/", include("dashboard.urls")),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)