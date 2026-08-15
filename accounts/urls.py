from django.urls import path
from .views import (
    RegisterView, LoginView, LogoutView, ProfileView,
    TwoFASetupView, TwoFAVerifyView, TwoFADisableView,
    EmailVerifyView, ResendVerificationView,
    PasswordResetRequestView, PasswordResetConfirmView,
    LoginActivityAPIView, ChangePasswordView,
    UniversityRegisterAPIView
)

app_name = 'accounts'

urlpatterns = [
    path("register/", RegisterView.as_view(), name="register"),
    path("university-register/", UniversityRegisterAPIView.as_view(), name="university-register-api"),
    path("login/",    LoginView.as_view(),    name="login"),
    path("logout/",   LogoutView.as_view(),   name="logout"),
    path("profile/",  ProfileView.as_view(),  name="profile"),
    path("login-activity/", LoginActivityAPIView.as_view(), name="login-activity"),

    # Email verification
    path("verify-email/<uuid:token>/",   EmailVerifyView.as_view(),        name="verify-email"),
    path("resend-verification/",         ResendVerificationView.as_view(), name="resend-verification"),

    # Password reset/change
    path("password-change/",         ChangePasswordView.as_view(),       name="password-change"),
    path("password-reset/",          PasswordResetRequestView.as_view(), name="password-reset-request"),
    path("password-reset/confirm/",  PasswordResetConfirmView.as_view(), name="password-reset-confirm"),

    # 2FA
    path("2fa/setup/",   TwoFASetupView.as_view(),   name="2fa-setup"),
    path("2fa/verify/",  TwoFAVerifyView.as_view(),  name="2fa-verify"),
    path("2fa/disable/", TwoFADisableView.as_view(), name="2fa-disable"),
]