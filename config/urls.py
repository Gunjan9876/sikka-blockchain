from django.contrib import admin
from django.urls import path, include, re_path
from django.conf import settings
from django.conf.urls.static import static
from django.http import HttpResponsePermanentRedirect
from accounts import views as accounts_views
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView, SpectacularRedocView
from api import views as api_views


def _redirect_to_v1(request, subpath=""):
    return HttpResponsePermanentRedirect(f"/api/v1/{subpath}")


urlpatterns = [
    path("admin/", admin.site.urls),

    # ── Landing ───────────────────────────────────────────────────────────────
    path("", include("landing.urls")),

    # ── Auth pages (HTML) ─────────────────────────────────────────────────────
    path("accounts/register/",                          accounts_views.register_page,      name="register_page"),
    path("accounts/university-register/",               accounts_views.university_register_page, name="university_register_page"),
    path("accounts/login/",                             accounts_views.login_page,         name="login_page"),
    path("accounts/verify-email/<uuid:token>/",         accounts_views.verify_email_page,  name="verify_email_page"),    # ← NEW
    path("accounts/forgot-password/",                   accounts_views.forgot_password_page, name="forgot_password_page"),
    path("accounts/reset-password/<uuid:token>/",       accounts_views.reset_password_page, name="reset_password_page"),
    path("terms/",                                      accounts_views.terms_page,         name="terms_page"),
    path("privacy/",                                    accounts_views.privacy_page,       name="privacy_page"),
    path("cookies/",                                    accounts_views.cookies_page,       name="cookies_page"),

    # ── Dashboard ─────────────────────────────────────────────────────────────
    path("dashboard/", include("dashboard.urls")),

    # ── Versioned API (v1) — canonical URLs ───────────────────────────────────
    path("api/v1/accounts/",     include(("accounts.urls",     "accounts"),     namespace="accounts")),
    path("api/v1/wallet/",       include(("wallet.urls",       "wallet"),       namespace="wallet")),
    path("api/v1/mining/",       include(("mining.urls",       "mining"),       namespace="mining")),
    path("api/v1/transactions/", include(("transactions.urls", "transactions"), namespace="transactions")),
    path("api/v1/blockchain/",   include(("blockchain.urls",   "blockchain"),   namespace="blockchain")),
    path("api/v1/rewards/org/",   api_views.OrgInfoView.as_view(),              name="org_info"),
    path("api/v1/rewards/issue/", api_views.IssueRewardView.as_view(),          name="issue_reward"),
    path("api/v1/rewards/review/", api_views.ReviewRewardView.as_view(),        name="review_reward"),
    path("api/v1/rewards/student/", api_views.StudentRewardHistoryView.as_view(), name="student_rewards_api"),
    path("api/v1/org/notifications/", api_views.NotificationListView.as_view(),   name="notifications_list"),
    path("api/v1/org/notifications/read/", api_views.NotificationReadView.as_view(), name="notifications_read"),
    path("api/v1/org/notifications/read-all/", api_views.NotificationReadAllView.as_view(), name="notifications_read_all"),
    path("api/v1/org/students/", api_views.OrgStudentsView.as_view(), name="org_students_api"),
    path("api/v1/org/analytics/", api_views.OrgAnalyticsView.as_view(), name="org_analytics_api"),

    # ── Legacy /api/ → /api/v1/ redirects (no duplicate includes) ────────────
    re_path(r"^api/accounts/(?P<subpath>.*)$",     _redirect_to_v1),
    re_path(r"^api/wallet/(?P<subpath>.*)$",       _redirect_to_v1),
    re_path(r"^api/mining/(?P<subpath>.*)$",       _redirect_to_v1),
    re_path(r"^api/transactions/(?P<subpath>.*)$", _redirect_to_v1),
    re_path(r"^api/blockchain/(?P<subpath>.*)$",   _redirect_to_v1),

    path("api/v1/auth/token/",         TokenObtainPairView.as_view(),  name="token_obtain"),
    path("api/v1/auth/token/refresh/", TokenRefreshView.as_view(),     name="token_refresh"),

    # ── API Docs ──────────────────────────────────────────────────────────────
    path("api/schema/",  SpectacularAPIView.as_view(),                      name="schema"),
    path("api/docs/",    SpectacularSwaggerView.as_view(url_name="schema"), name="swagger-ui"),
    path("api/redoc/",   SpectacularRedocView.as_view(url_name="schema"),   name="redoc"),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)