from django.test import TestCase
from django.test.utils import override_settings
from django.urls import reverse
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework import status

User = get_user_model()

NO_THROTTLE = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework_simplejwt.authentication.JWTAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_THROTTLE_CLASSES": [],
    "DEFAULT_THROTTLE_RATES": {},
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
}


def make_user(username="testuser", password="StrongPass123!", email="test@example.com"):
    return User.objects.create_user(username=username, password=password, email=email)


# ── Page loads ────────────────────────────────────────────────────────────────

class AccountsPageTests(TestCase):
    def test_register_page_loads(self):
        self.assertEqual(self.client.get(reverse("register_page")).status_code, 200)

    def test_login_page_loads(self):
        self.assertEqual(self.client.get(reverse("login_page")).status_code, 200)


# ── Register ──────────────────────────────────────────────────────────────────

@override_settings(REST_FRAMEWORK=NO_THROTTLE)
class RegisterTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_register_success(self):
        res = self.client.post("/api/v1/accounts/register/", {
            "username": "newuser",
            "email": "new@example.com",
            "password": "StrongPass123!",
            "confirm_password": "StrongPass123!",
        }, format="json")
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertIn("access", res.data)

    def test_register_duplicate_username(self):
        make_user()
        res = self.client.post("/api/v1/accounts/register/", {
            "username": "testuser",
            "email": "other@example.com",
            "password": "StrongPass123!",
            "confirm_password": "StrongPass123!",
        }, format="json")
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

    def test_register_missing_fields(self):
        res = self.client.post("/api/v1/accounts/register/", {}, format="json")
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)


# ── Login ─────────────────────────────────────────────────────────────────────

@override_settings(REST_FRAMEWORK=NO_THROTTLE)
class LoginTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = make_user()

    def test_login_success(self):
        res = self.client.post("/api/v1/accounts/login/", {
            "login": "testuser", "password": "StrongPass123!"
        }, format="json")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertIn("access", res.data)
        self.assertIn("refresh", res.data)

    def test_login_wrong_password(self):
        res = self.client.post("/api/v1/accounts/login/", {
            "login": "testuser", "password": "WrongPass!"
        }, format="json")
        self.assertEqual(res.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_login_by_email(self):
        res = self.client.post("/api/v1/accounts/login/", {
            "login": "test@example.com", "password": "StrongPass123!"
        }, format="json")
        self.assertEqual(res.status_code, status.HTTP_200_OK)

    def test_login_missing_fields(self):
        res = self.client.post("/api/v1/accounts/login/", {}, format="json")
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)


# ── Profile ───────────────────────────────────────────────────────────────────

@override_settings(REST_FRAMEWORK=NO_THROTTLE)
class ProfileTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = make_user()
        self.client.force_authenticate(user=self.user)

    def test_profile_authenticated(self):
        res = self.client.get("/api/v1/accounts/profile/")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data["username"], "testuser")

    def test_profile_unauthenticated(self):
        client = APIClient()
        res = client.get("/api/v1/accounts/profile/")
        self.assertEqual(res.status_code, status.HTTP_401_UNAUTHORIZED)


# ── 2FA ───────────────────────────────────────────────────────────────────────

@override_settings(REST_FRAMEWORK=NO_THROTTLE)
class TwoFATests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = make_user()
        self.client.force_authenticate(user=self.user)
        self.client.get("/api/v1/accounts/2fa/setup/")

    def test_2fa_setup_returns_qr(self):
        res = self.client.get("/api/v1/accounts/2fa/setup/")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertIn("qr_code", res.data)
        self.assertIn("secret", res.data)

    def test_2fa_verify_invalid_otp(self):
        res = self.client.post("/api/v1/accounts/2fa/verify/", {
            "otp": "000000"
        }, format="json")
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)