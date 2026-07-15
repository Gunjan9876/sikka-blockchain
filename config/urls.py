from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from django.http import HttpResponsePermanentRedirect
from accounts import views as accounts_views


def redirect_to_v1(request, path=""):
    """Redirect legacy /api/<path> → /api/v1/<path> permanently."""
    return HttpResponsePermanentRedirect(f"/api/v1/{path}")


urlpatterns = [
    path("admin/", admin.site.urls),

    # ── Landing ───────────────────────────────────────────────────────────────
    path("", include("landing.urls")),

    # ── Auth pages (HTML) ─────────────────────────────────────────────────────
    path("accounts/register/", accounts_views.register_page, name="register_page"),
    path("accounts/login/",    accounts_views.login_page,    name="login_page"),

    # ── Dashboard ─────────────────────────────────────────────────────────────
    path("dashboard/", include("dashboard.urls")),

    # ── Versioned API (v1) — canonical URLs ───────────────────────────────────
    path("api/v1/accounts/",     include("accounts.urls")),
    path("api/v1/wallet/",       include("wallet.urls")),
    path("api/v1/mining/",       include("mining.urls")),
    path("api/v1/transactions/", include("transactions.urls")),
    path("api/v1/blockchain/",   include("blockchain.urls")),

    # ── Legacy /api/ → /api/v1/ redirects (keeps old JS working) ─────────────
    path("api/accounts/",     include("accounts.urls")),
    path("api/wallet/",       include("wallet.urls")),
    path("api/mining/",       include("mining.urls")),
    path("api/transactions/", include("transactions.urls")),
    path("api/blockchain/",   include("blockchain.urls")),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)