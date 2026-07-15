from django.contrib.auth import authenticate
from django.shortcuts import render
from rest_framework import status
from rest_framework.authentication import TokenAuthentication
from rest_framework.authtoken.models import Token
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from core.throttles import LoginRateThrottle
from .models import User
from .serializers import RegisterSerializer


def _get_client_ip(request):
    x_forwarded = request.META.get("HTTP_X_FORWARDED_FOR")
    if x_forwarded:
        return x_forwarded.split(",")[0].strip()
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


class RegisterView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = RegisterSerializer(data=request.data)

        if serializer.is_valid():
            user = serializer.save()
            token, _ = Token.objects.get_or_create(user=user)

            _write_audit(
                "register",
                user=user,
                details={"username": user.username},
                ip=_get_client_ip(request),
            )

            return Response(
                {"message": "User registered successfully.", "token": token.key},
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
            return Response(
                {"error": "login and password are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user = authenticate(request, username=login, password=password)

        if user is None:
            try:
                matched = User.objects.get(email=login)
                user = authenticate(request, username=matched.username, password=password)
            except User.DoesNotExist:
                pass

        if user is None:
            _write_audit(
                "login_failed",
                details={"attempted_login": login},
                ip=ip,
            )
            return Response(
                {"error": "Invalid credentials."},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        # Rotate token on every login — fresh 24h window
        Token.objects.filter(user=user).delete()
        token = Token.objects.create(user=user)

        _write_audit(
            "login",
            user=user,
            details={"username": user.username},
            ip=ip,
        )

        return Response(
            {"message": "Login successful.", "token": token.key, "username": user.username},
            status=status.HTTP_200_OK,
        )


class LogoutView(APIView):
    authentication_classes = [TokenAuthentication]
    permission_classes = [IsAuthenticated]

    def post(self, request):
        _write_audit(
            "logout",
            user=request.user,
            ip=_get_client_ip(request),
        )
        Token.objects.filter(user=request.user).delete()
        return Response({"message": "Logged out successfully."}, status=status.HTTP_200_OK)


class ProfileView(APIView):
    authentication_classes = [TokenAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        profile_image_url = None

        if user.profile_image:
            profile_image_url = request.build_absolute_uri(user.profile_image.url)

        wallet_status = "not_created"
        if hasattr(user, "wallet"):
            wallet_status = user.wallet.wallet_status

        return Response(
            {
                "id":            user.id,
                "username":      user.username,
                "email":         user.email,
                "phone":         user.phone,
                "profile_image": profile_image_url,
                "wallet_status": wallet_status,
            },
            status=status.HTTP_200_OK,
        )


# ── Template views ────────────────────────────────────────────────────────────

def register_page(request):
    return render(request, "accounts/register.html")


def login_page(request):
    return render(request, "accounts/login.html")