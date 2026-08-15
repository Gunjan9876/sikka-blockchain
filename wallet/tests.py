from decimal import Decimal
from django.test import TestCase
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework import status
from django.test.utils import override_settings

from wallet.models import Wallet
from wallet.services import deposit, withdraw, create_wallet

User = get_user_model()

NO_THROTTLE = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework_simplejwt.authentication.JWTAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_THROTTLE_CLASSES": [],
    "DEFAULT_THROTTLE_RATES": {},
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
}


def make_user(username="walletuser", password="StrongPass123!", email="wallet@example.com"):
    # Signal automatically creates wallet on user creation
    return User.objects.create_user(username=username, password=password, email=email)


# ── Wallet creation ───────────────────────────────────────────────────────────

class WalletCreationTests(TestCase):
    def setUp(self):
        self.user = make_user()
        # Signal already created the wallet — just fetch it
        self.wallet = Wallet.objects.get(owner=self.user)

    def test_create_wallet_generates_address(self):
        self.assertTrue(self.wallet.wallet_address.startswith("SKA"))
        self.assertEqual(len(self.wallet.wallet_address), 67)

    def test_create_wallet_initial_balance_zero(self):
        self.assertEqual(self.wallet.balance, Decimal("0.00000000"))

    def test_create_wallet_private_key_encrypted(self):
        # Fernet tokens start with gAAA
        self.assertTrue(self.wallet.private_key.startswith("gAAA"))

    def test_decrypt_private_key_works(self):
        from wallet.services import decrypt_private_key
        pem = decrypt_private_key(self.wallet.private_key)
        self.assertIn("PRIVATE KEY", pem)

    def test_one_wallet_per_user(self):
        # Signal already made one — trying to make another must fail
        with self.assertRaises(Exception):
            create_wallet(self.user)


# ── Deposit / Withdraw ────────────────────────────────────────────────────────

class WalletBalanceTests(TestCase):
    def setUp(self):
        self.user = make_user()
        # Signal already created the wallet — just fetch it
        self.wallet = Wallet.objects.get(owner=self.user)

    def test_deposit_increases_balance(self):
        deposit(self.wallet, Decimal("10.00000000"))
        self.wallet.refresh_from_db()
        self.assertEqual(self.wallet.balance, Decimal("10.00000000"))

    def test_withdraw_decreases_balance(self):
        deposit(self.wallet, Decimal("10.00000000"))
        self.wallet.refresh_from_db()
        withdraw(self.wallet, Decimal("4.00000000"))
        self.wallet.refresh_from_db()
        self.assertEqual(self.wallet.balance, Decimal("6.00000000"))

    def test_withdraw_insufficient_funds_raises(self):
        with self.assertRaises(ValueError):
            withdraw(self.wallet, Decimal("100.00000000"))

    def test_deposit_invalid_amount_raises(self):
        with self.assertRaises(ValueError):
            deposit(self.wallet, Decimal("-1"))

    def test_deposit_credits_mining(self):
        deposit(self.wallet, Decimal("5.00000000"), credit_mining=True)
        self.wallet.refresh_from_db()
        self.assertEqual(self.wallet.total_mined, Decimal("5.00000000"))


# ── Wallet API ────────────────────────────────────────────────────────────────

@override_settings(REST_FRAMEWORK=NO_THROTTLE)
class WalletAPITests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = make_user()
        # Signal already created the wallet
        self.wallet = Wallet.objects.get(owner=self.user)
        self.client.force_authenticate(user=self.user)

    def test_wallet_endpoint_returns_balance(self):
        res = self.client.get("/api/v1/wallet/")
        self.assertEqual(res.status_code, status.HTTP_200_OK)

    def test_wallet_requires_auth(self):
        client = APIClient()
        res = client.get("/api/v1/wallet/")
        self.assertEqual(res.status_code, status.HTTP_401_UNAUTHORIZED)