import pyotp
import qrcode
import qrcode.image.svg
from io import BytesIO
import base64
import logging
logger = logging.getLogger(__name__)

from django.contrib.auth import authenticate
from django.contrib.sites.shortcuts import get_current_site
from django.core.cache import cache
from django.core.mail import send_mail
from django.shortcuts import render
from django.template.loader import render_to_string
from django.utils.html import strip_tags

from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.tokens import RefreshToken

from core.throttles import LoginRateThrottle
from .models import User
from .serializers import (
    RegisterSerializer,
    PasswordResetRequestSerializer,
    PasswordResetConfirmSerializer,
    ChangePasswordSerializer,
    UniversityRegisterSerializer,
)

# ── Lockout config ─────────────────────────────────────────────────────────────
LOCKOUT_MAX    = 5
LOCKOUT_WINDOW = 60 * 15


# AFTER
def _get_client_ip(request):
    return request.META.get("REMOTE_ADDR")


def _write_audit(action, user=None, details=None, ip=None):
    try:
        from core.models import AuditLog
        AuditLog.objects.create(
            user=user,
            action=action,
            entity_type="User",
            entity_id=str(user.pk) if user else "",
            details=details or {},
            ip_address=ip,
        )
    except Exception:
        pass


def _issue_tokens(user):
    refresh = RefreshToken.for_user(user)
    return str(refresh.access_token), str(refresh)


def _send_verification_email(request, user):
    """Send HTML email verification link to the user."""
    domain = request.get_host()
    scheme = "https" if request.is_secure() else "http"
    verify_url = f"{scheme}://{domain}/accounts/verify-email/{user.email_verify_token}/"

    subject = "Verify your SIKKA email address"
    html_message = render_to_string("accounts/email_verify.html", {
        "user": user,
        "verify_url": verify_url,
    })
    plain_message = strip_tags(html_message)

    send_mail(
        subject=subject,
        message=plain_message,
        from_email=None,   # uses DEFAULT_FROM_EMAIL from settings
        recipient_list=[user.email],
        html_message=html_message,
        fail_silently=False,
    )


def _send_password_reset_email(request, user):
    """Send HTML password reset link to the user."""
    domain = request.get_host()
    scheme = "https" if request.is_secure() else "http"
    reset_url = f"{scheme}://{domain}/accounts/reset-password/{user.password_reset_token}/"

    subject = "Reset your SIKKA password"
    html_message = render_to_string("accounts/email_password_reset.html", {
        "user": user,
        "reset_url": reset_url,
    })
    plain_message = strip_tags(html_message)

    send_mail(
        subject=subject,
        message=plain_message,
        from_email=None,
        recipient_list=[user.email],
        html_message=html_message,
        fail_silently=False,
    )


# ── Auth Views ─────────────────────────────────────────────────────────────────

# AFTER
class RegisterView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = RegisterSerializer(data=request.data)
        if serializer.is_valid():
            user = serializer.save()
            # Email verification disabled — mark verified immediately
            user.email_verified = True
            user.save(update_fields=["email_verified"])

            _write_audit("register", user=user,
                         details={"username": user.username},
                         ip=_get_client_ip(request))
            return Response(
                {
                    "message": "Registered successfully. You can now log in.",
                    "email_verified": user.email_verified,
                },
                status=status.HTTP_201_CREATED,
            )
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class UniversityRegisterAPIView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = UniversityRegisterSerializer(data=request.data)
        if serializer.is_valid():
            from django.db import transaction
            with transaction.atomic():
                user = serializer.save()
            # Send verification email
            try:
                _send_verification_email(request, user) 
                
            except Exception as e:
                logger.error("Failed to send verification email for user '%s': %s", user.username, e)
                # Don't fail the registration if email fails
            
            access, refresh = _issue_tokens(user)
            _write_audit("register_university", user=user,
                         details={"username": user.username, "university": request.data.get("university_name")},
                         ip=_get_client_ip(request))
            return Response(
                {
                    "message": "University registered successfully. Please check your email to verify your account.",
                    "access": access,
                    "refresh": refresh,
                    "email_verified": user.email_verified,
                },
                status=status.HTTP_201_CREATED,
            )
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class LoginView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [LoginRateThrottle]

    def post(self, request):
        login    = request.data.get("login", "").strip()
        password = request.data.get("password", "").strip()
        ip       = _get_client_ip(request)

        if not login or not password:
            return Response({"error": "login and password are required."},
                            status=status.HTTP_400_BAD_REQUEST)

        # ── Lockout check ──────────────────────────────────────────────────────
        cache_key = f"login_attempts:{ip}"
        attempts  = cache.get(cache_key, 0)
        if attempts >= LOCKOUT_MAX:
            _write_audit("login_locked",
                         details={"attempted_login": login, "attempts": attempts},
                         ip=ip)
            return Response(
                {"error": "Too many failed attempts. Try again in 15 minutes."},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        # ── Authenticate ───────────────────────────────────────────────────────
        user = authenticate(request, username=login, password=password)
        if user is None:
            try:
                matched = User.objects.get(email=login)
                user = authenticate(request, username=matched.username, password=password)
            except User.DoesNotExist:
                pass

        if user is None:
            cache.set(cache_key, attempts + 1, LOCKOUT_WINDOW)
            _write_audit("login_failed",
                         details={"attempted_login": login, "attempts": attempts + 1},
                         ip=ip)
            return Response(
                {"error": "Invalid credentials.",
                 "attempts_remaining": max(0, LOCKOUT_MAX - (attempts + 1))},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        cache.delete(cache_key)

        # ── 2FA check ──────────────────────────────────────────────────────────
        if user.totp_enabled:
            otp = request.data.get("otp", "").strip()
            if not otp:
                return Response(
                    {"2fa_required": True,
                     "message": "OTP required. Submit login again with otp field."},
                    status=status.HTTP_200_OK,
                )
            totp = pyotp.TOTP(user.totp_secret)
            if not totp.verify(otp, valid_window=1):
                _write_audit("login_2fa_failed", user=user, ip=ip)
                return Response({"error": "Invalid OTP."},
                                status=status.HTTP_401_UNAUTHORIZED)

        access, refresh = _issue_tokens(user)
        _write_audit("login", user=user,
                     details={"username": user.username}, ip=ip)

        from wallet.models import Organisation
        has_org = False
        if hasattr(user, 'wallet'):
            has_org = Organisation.objects.filter(wallet=user.wallet, is_active=True).exists()

        return Response(
            {
                "message": "Login successful.",
                "access": access,
                "refresh": refresh,
                "username": user.username,
                "email_verified": user.email_verified,
                "is_superuser": user.is_superuser,
                "has_org": has_org,
            },
            status=status.HTTP_200_OK,
        )


class LogoutView(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated]

    def post(self, request):
        _write_audit("logout", user=request.user, ip=_get_client_ip(request))
        try:
            refresh_token = request.data.get("refresh")
            if refresh_token:
                token = RefreshToken(refresh_token)
                token.blacklist()
        except Exception:
            pass
        return Response({"message": "Logged out successfully."}, status=status.HTTP_200_OK)


class ProfileView(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        profile_image_url = None
        if user.profile_image:
            profile_image_url = request.build_absolute_uri(user.profile_image.url)
        wallet_status = "not_created"
        has_org = False
        if hasattr(user, "wallet"):
            wallet_status = user.wallet.wallet_status
            from wallet.models import Organisation
            has_org = Organisation.objects.filter(wallet=user.wallet, is_active=True).exists()
            
        return Response(
            {
                "id": user.id,
                "username": user.username,
                "email": user.email,
                "phone": user.phone,
                "profile_image": profile_image_url,
                "wallet_status": wallet_status,
                "totp_enabled": user.totp_enabled,
                "email_verified": user.email_verified,
                "has_org": has_org,
            },
            status=status.HTTP_200_OK,
        )
    def post(self, request):
        user = request.user
        
        # We can update phone, first_name, last_name, and profile_image
        if "phone" in request.data:
            user.phone = request.data["phone"].strip()
        if "first_name" in request.data:
            user.first_name = request.data["first_name"].strip()
        if "last_name" in request.data:
            user.last_name = request.data["last_name"].strip()
            
        # Profile image upload
        if "profile_image" in request.FILES:
            user.profile_image = request.FILES["profile_image"]
            
        user.save()
        
        profile_image_url = None
        if user.profile_image:
            profile_image_url = request.build_absolute_uri(user.profile_image.url)
            
        return Response({
            "message": "Profile updated successfully.",
            "profile_image": profile_image_url
        }, status=status.HTTP_200_OK)


class LoginActivityAPIView(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request):
        from core.models import AuditLog
        logs = AuditLog.objects.filter(
            user=request.user, 
            action__in=["login", "login_failed", "login_locked", "logout", "login_2fa_failed"]
        ).order_by("-created_at")[:50]
        
        data = []
        for log in logs:
            data.append({
                "action": log.get_action_display(),
                "ip_address": log.ip_address,
                "created_at": log.created_at.strftime("%Y-%m-%d %H:%M:%S"),
                "status": "Success" if log.action in ["login", "logout"] else "Failed"
            })
        return Response(data, status=status.HTTP_200_OK)

# ── Email Verification Views ───────────────────────────────────────────────────

class EmailVerifyView(APIView):
    """GET /api/v1/accounts/verify-email/<token>/"""
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request, token):
        try:
            user = User.objects.get(email_verify_token=token)
        except User.DoesNotExist:
            _write_audit("email_verify_failed",
                         details={"token": str(token)},
                         ip=_get_client_ip(request))
            return Response({"error": "Invalid verification link."},
                            status=status.HTTP_400_BAD_REQUEST)

        if user.email_verified:
            return Response({"message": "Email already verified."}, status=status.HTTP_200_OK)

        if not user.is_email_token_valid():
            _write_audit("email_verify_failed", user=user,
                         details={"reason": "token_expired"},
                         ip=_get_client_ip(request))
            return Response(
                {"error": "Verification link has expired. Request a new one."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user.email_verified = True
        user.save(update_fields=["email_verified"])
        _write_audit("email_verified", user=user, ip=_get_client_ip(request))
        return Response({"message": "Email verified successfully. You can now login."},
                        status=status.HTTP_200_OK)


class ResendVerificationView(APIView):
    """POST /api/v1/accounts/resend-verification/"""
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        email = request.data.get("email", "").strip()
        if not email:
            return Response({"error": "Email is required."},
                            status=status.HTTP_400_BAD_REQUEST)
        try:
            user = User.objects.get(email=email)
        except User.DoesNotExist:
            # Don't reveal whether email exists
            return Response(
                {"message": "If that email exists, a verification link has been sent."},
                status=status.HTTP_200_OK,
            )

        if user.email_verified:
            return Response({"message": "Email is already verified."},
                            status=status.HTTP_200_OK)

        # Refresh token
        import uuid
        from .models import _token_expiry
        user.email_verify_token = uuid.uuid4()
        user.email_token_expiry  = _token_expiry()
        user.save(update_fields=["email_verify_token", "email_token_expiry"])

        try:
            _send_verification_email(request, user)
            _write_audit("email_verify_sent", user=user,
                         details={"email": user.email},
                         ip=_get_client_ip(request))
        except Exception:
            pass

        return Response(
            {"message": "If that email exists, a verification link has been sent."},
            status=status.HTTP_200_OK,
        )


# ── Password Reset Views ───────────────────────────────────────────────────────

class PasswordResetRequestView(APIView):
    """POST /api/v1/accounts/password-reset/"""
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = PasswordResetRequestSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        email = serializer.validated_data["email"]
        try:
            user = User.objects.get(email=email)
            user.generate_reset_token()
            _send_password_reset_email(request, user)
            _write_audit("password_reset_request", user=user,
                         details={"email": email},
                         ip=_get_client_ip(request))
        except User.DoesNotExist:
            pass  # Don't reveal whether email exists
        except Exception:
            pass

        return Response(
            {"message": "If that email is registered, a password reset link has been sent."},
            status=status.HTTP_200_OK,
        )


class PasswordResetConfirmView(APIView):
    """POST /api/v1/accounts/password-reset/confirm/"""
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = PasswordResetConfirmSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        token    = serializer.validated_data["token"]
        password = serializer.validated_data["password"]

        try:
            user = User.objects.get(password_reset_token=token)
        except User.DoesNotExist:
            _write_audit("password_reset_failed",
                         details={"reason": "invalid_token"},
                         ip=_get_client_ip(request))
            return Response({"error": "Invalid or expired reset link."},
                            status=status.HTTP_400_BAD_REQUEST)

        if not user.is_reset_token_valid():
            _write_audit("password_reset_failed", user=user,
                         details={"reason": "token_expired"},
                         ip=_get_client_ip(request))
            return Response({"error": "Reset link has expired. Please request a new one."},
                            status=status.HTTP_400_BAD_REQUEST)

        user.set_password(password)
        user.password_reset_token  = None
        user.password_reset_expiry = None
        user.save(update_fields=["password", "password_reset_token", "password_reset_expiry"])
        _write_audit("password_reset_done", user=user, ip=_get_client_ip(request))

        return Response({"message": "Password reset successful. You can now login."},
                        status=status.HTTP_200_OK)


class ChangePasswordView(APIView):
    """POST /api/v1/accounts/password-change/"""
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = ChangePasswordSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        user = request.user
        if not user.check_password(serializer.validated_data["old_password"]):
            return Response({"old_password": ["Current password is incorrect."]}, status=status.HTTP_400_BAD_REQUEST)
        
        user.set_password(serializer.validated_data["new_password"])
        user.save(update_fields=["password"])
        _write_audit("password_changed", user=user, ip=_get_client_ip(request))
        
        return Response({"message": "Password changed successfully."}, status=status.HTTP_200_OK)


# ── 2FA Setup Views ────────────────────────────────────────────────────────────

class TwoFASetupView(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        if not user.totp_secret:
            user.totp_secret = pyotp.random_base32()
            user.save(update_fields=["totp_secret"])

        totp = pyotp.TOTP(user.totp_secret)
        uri  = totp.provisioning_uri(
            name=user.email or user.username,
            issuer_name="SIKKA Blockchain"
        )

        img    = qrcode.make(uri)
        buffer = BytesIO()
        img.save(buffer, format="PNG")
        qr_b64 = base64.b64encode(buffer.getvalue()).decode()

        return Response({
            "secret":  user.totp_secret,
            "qr_code": f"data:image/png;base64,{qr_b64}",
            "uri":     uri,
        })


class TwoFAVerifyView(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated]

    def post(self, request):
        user = request.user
        otp  = request.data.get("otp", "").strip()

        if not otp:
            return Response({"error": "OTP is required."},
                            status=status.HTTP_400_BAD_REQUEST)

        if not user.totp_secret:
            return Response({"error": "Run GET /api/v1/accounts/2fa/setup/ first."},
                            status=status.HTTP_400_BAD_REQUEST)

        totp = pyotp.TOTP(user.totp_secret)
        if not totp.verify(otp, valid_window=1):
            return Response({"error": "Invalid OTP. Try again."},
                            status=status.HTTP_400_BAD_REQUEST)

        user.totp_enabled = True
        user.save(update_fields=["totp_enabled"])
        _write_audit("2fa_enabled", user=user, ip=_get_client_ip(request))

        return Response({"message": "2FA enabled successfully."})


class TwoFADisableView(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated]

    def post(self, request):
        user = request.user
        otp  = request.data.get("otp", "").strip()

        if not user.totp_enabled:
            return Response({"error": "2FA is not enabled."},
                            status=status.HTTP_400_BAD_REQUEST)

        totp = pyotp.TOTP(user.totp_secret)
        if not totp.verify(otp, valid_window=1):
            return Response({"error": "Invalid OTP."},
                            status=status.HTTP_401_UNAUTHORIZED)

        user.totp_enabled = False
        user.totp_secret  = ""
        user.save(update_fields=["totp_enabled", "totp_secret"])
        _write_audit("2fa_disabled", user=user, ip=_get_client_ip(request))

        return Response({"message": "2FA disabled."})


# ── Template views ─────────────────────────────────────────────────────────────

def register_page(request):
    return render(request, "accounts/register.html")

def university_register_page(request):
    return render(request, "accounts/university_register.html")

def login_page(request):
    return render(request, "accounts/login.html")

def verify_email_page(request, token):
    return render(request, "accounts/verify_email_page.html", {"token": token})

def forgot_password_page(request):
    return render(request, "accounts/forgot_password_page.html")

def reset_password_page(request, token):
    return render(request, "accounts/reset_password_page.html", {"token": token})

def terms_page(request):
    return render(request, "accounts/terms.html")

def privacy_page(request):
    return render(request, "accounts/privacy.html")

def cookies_page(request):
    return render(request, "accounts/cookies.html")
