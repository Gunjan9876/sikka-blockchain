from django.contrib.auth import authenticate
from rest_framework import status
from rest_framework.authentication import TokenAuthentication
from rest_framework.authtoken.models import Token
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import User
from .serializers import RegisterSerializer


class RegisterView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = RegisterSerializer(data=request.data)

        if serializer.is_valid():
            user = serializer.save()
            token, _ = Token.objects.get_or_create(user=user)

            return Response(
                {
                    "message": "User registered successfully.",
                    "token": token.key,
                },
                status=status.HTTP_201_CREATED,
            )

        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class LoginView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        login = request.data.get("login", "").strip()
        password = request.data.get("password", "").strip()

        if not login or not password:
            return Response(
                {"error": "login and password are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Try authenticating with username directly
        user = authenticate(request, username=login, password=password)

        # If that fails, look up by email and retry
        if user is None:
            try:
                matched = User.objects.get(email=login)
                user = authenticate(request, username=matched.username, password=password)
            except User.DoesNotExist:
                pass

        if user is None:
            return Response(
                {"error": "Invalid credentials."},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        token, _ = Token.objects.get_or_create(user=user)

        return Response(
            {
                "message": "Login successful.",
                "token": token.key,
                "username": user.username,
            },
            status=status.HTTP_200_OK,
        )


class LogoutView(APIView):
    authentication_classes = [TokenAuthentication]
    permission_classes = [IsAuthenticated]

    def post(self, request):
        # Delete via queryset — safe even if no token exists
        Token.objects.filter(user=request.user).delete()

        return Response(
            {"message": "Logged out successfully."},
            status=status.HTTP_200_OK,
        )


class ProfileView(APIView):
    authentication_classes = [TokenAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        profile_image_url = None

        if user.profile_image:
            profile_image_url = request.build_absolute_uri(user.profile_image.url)

        return Response(
            {
                "id": user.id,
                "username": user.username,
                "email": user.email,
                "phone": user.phone,
                "profile_image": profile_image_url,
                "wallet_status": "not_created",  # placeholder — wallet app not built yet
            },
            status=status.HTTP_200_OK,
        )


from django.shortcuts import render

def register_page(request):
    return render(request, "accounts/register.html")

def login_page(request):
    return render(request, "accounts/login.html")
