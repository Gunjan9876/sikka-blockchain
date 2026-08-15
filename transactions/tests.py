from decimal import Decimal
from django.test import TestCase
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework import status
from django.test.utils import override_settings

from wallet.models import Wallet
from transactions.models import Transaction
from transactions.services import (
    create_transaction,
    verify_transaction_signature,
    calculate_fee,
    get_pending_transactions,
    get_user_transactions,
)
from wallet.services import deposit

User = get_user_model()

NO_THROTTLE = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework_simplejwt.authentication.JWTAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_THROTTLE_CLASSES": [],
    "DEFAULT_THROTTLE_RATES": {},
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
}


def make_user(username, email):
    return User.objects.create_user(
        username=username, password="StrongPass123!", email=email
    )


# ── Fee calculation ───────────────────────────────────────────────────────────

class FeeCalculationTests(TestCase):
    def test_fee_is_flat_minimum(self):
        self.assertEqual(calculate_fee(Decimal("10.00")), Decimal("0.00100000"))

    def test_fee_same_for_large_amount(self):
        self.assertEqual(calculate_fee(Decimal("99999.00")), Decimal("0.00100000"))


# ── Transaction creation ──────────────────────────────────────────────────────

class TransactionCreationTests(TestCase):
    def setUp(self):
        self.sender = make_user("sender", "sender@example.com")
        self.receiver = make_user("receiver", "receiver@example.com")
        self.sender_wallet = Wallet.objects.get(owner=self.sender)
        self.receiver_wallet = Wallet.objects.get(owner=self.receiver)
        deposit(self.sender_wallet, Decimal("100.00000000"))
        self.sender_wallet.refresh_from_db()

    def test_transaction_created_successfully(self):
        tx = create_transaction(self.sender, self.receiver_wallet.wallet_address, Decimal("10.00000000"))
        self.assertIsNotNone(tx)
        self.assertEqual(tx.status, Transaction.Status.PENDING)

    def test_sender_balance_debited(self):
        create_transaction(self.sender, self.receiver_wallet.wallet_address, Decimal("10.00000000"))
        self.sender_wallet.refresh_from_db()
        # balance = 100 - 10 (amount) - 0.001 (fee)
        self.assertEqual(self.sender_wallet.balance, Decimal("89.99900000"))

    def test_transaction_has_signature(self):
        tx = create_transaction(self.sender, self.receiver_wallet.wallet_address, Decimal("10.00000000"))
        self.assertTrue(len(tx.signature) > 0)

    def test_transaction_type_is_transfer(self):
        tx = create_transaction(self.sender, self.receiver_wallet.wallet_address, Decimal("10.00000000"))
        self.assertEqual(tx.tx_type, Transaction.TxType.TRANSFER)

    def test_zero_amount_raises(self):
        with self.assertRaises(ValueError):
            create_transaction(self.sender, self.receiver_wallet.wallet_address, Decimal("0"))

    def test_negative_amount_raises(self):
        with self.assertRaises(ValueError):
            create_transaction(self.sender, self.receiver_wallet.wallet_address, Decimal("-5"))

    def test_insufficient_funds_raises(self):
        with self.assertRaises(ValueError):
            create_transaction(self.sender, self.receiver_wallet.wallet_address, Decimal("999.00000000"))

    def test_send_to_own_wallet_raises(self):
        with self.assertRaises(ValueError):
            create_transaction(self.sender, self.sender_wallet.wallet_address, Decimal("10.00000000"))

    def test_invalid_receiver_raises(self):
        with self.assertRaises(Exception):
            create_transaction(self.sender, "SKA_FAKE_ADDRESS_000", Decimal("10.00000000"))

    def test_nonce_increments(self):
        create_transaction(self.sender, self.receiver_wallet.wallet_address, Decimal("5.00000000"))
        self.sender_wallet.refresh_from_db()
        self.assertEqual(self.sender_wallet.nonce, 1)

        create_transaction(self.sender, self.receiver_wallet.wallet_address, Decimal("5.00000000"))
        self.sender_wallet.refresh_from_db()
        self.assertEqual(self.sender_wallet.nonce, 2)


# ── Signature verification ────────────────────────────────────────────────────

class SignatureVerificationTests(TestCase):
    def setUp(self):
        self.sender = make_user("siguser", "sig@example.com")
        self.receiver = make_user("sigreceiver", "sigr@example.com")
        self.sender_wallet = Wallet.objects.get(owner=self.sender)
        self.receiver_wallet = Wallet.objects.get(owner=self.receiver)
        deposit(self.sender_wallet, Decimal("50.00000000"))
        self.sender_wallet.refresh_from_db()

    def test_valid_signature_verifies(self):
        tx = create_transaction(self.sender, self.receiver_wallet.wallet_address, Decimal("5.00000000"))
        self.assertTrue(verify_transaction_signature(tx))

    def test_tampered_signature_fails(self):
        tx = create_transaction(self.sender, self.receiver_wallet.wallet_address, Decimal("5.00000000"))
        tx.signature = "deadbeef" * 8
        tx.save()
        self.assertFalse(verify_transaction_signature(tx))

    def test_coinbase_tx_always_valid(self):
        tx = Transaction.objects.create(
            tx_hash="coinbase_test_hash",
            tx_type=Transaction.TxType.COINBASE,
            sender_address="",
            receiver_address=self.receiver_wallet.wallet_address,
            amount=Decimal("50.00000000"),
            fee=Decimal("0.00000000"),
            nonce=0,
            signature="",
            status=Transaction.Status.PENDING,
        )
        self.assertTrue(verify_transaction_signature(tx))

    def test_replay_attack_prevented(self):
        # Create and confirm first tx
        tx1 = create_transaction(self.sender, self.receiver_wallet.wallet_address, Decimal("5.00000000"))
        tx1.status = Transaction.Status.CONFIRMED
        tx1.save()

        # Same nonce tx should fail signature verification
        tx2 = Transaction(
            tx_hash="replay_hash",
            tx_type=Transaction.TxType.TRANSFER,
            sender_address=tx1.sender_address,
            receiver_address=tx1.receiver_address,
            amount=tx1.amount,
            fee=tx1.fee,
            nonce=tx1.nonce,   # same nonce = replay
            signature=tx1.signature,
            status=Transaction.Status.PENDING,
        )
        self.assertFalse(verify_transaction_signature(tx2))


# ── Mempool fee ordering ──────────────────────────────────────────────────────

class MempoolOrderingTests(TestCase):
    def setUp(self):
        self.sender = make_user("mempooluser", "mempool@example.com")
        self.receiver = make_user("mempoolreceiver", "mempoolr@example.com")
        self.sender_wallet = Wallet.objects.get(owner=self.sender)
        self.receiver_wallet = Wallet.objects.get(owner=self.receiver)
        deposit(self.sender_wallet, Decimal("200.00000000"))
        self.sender_wallet.refresh_from_db()

    def test_pending_transactions_ordered_by_fee_desc(self):
        tx1 = create_transaction(self.sender, self.receiver_wallet.wallet_address, Decimal("10.00000000"))
        tx2 = create_transaction(self.sender, self.receiver_wallet.wallet_address, Decimal("20.00000000"))
        pending = get_pending_transactions()
        # Both have same flat fee — FIFO for ties (tx1 first)
        self.assertGreaterEqual(len(pending), 2)
        fees = [tx.fee for tx in pending]
        self.assertEqual(fees, sorted(fees, reverse=True))


# ── Transaction API ───────────────────────────────────────────────────────────

@override_settings(REST_FRAMEWORK=NO_THROTTLE)
class TransactionAPITests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = make_user("apiuser", "api@example.com")
        self.other = make_user("apiother", "apiother@example.com")
        self.wallet = Wallet.objects.get(owner=self.user)
        self.other_wallet = Wallet.objects.get(owner=self.other)
        deposit(self.wallet, Decimal("100.00000000"))
        self.wallet.refresh_from_db()
        self.client.force_authenticate(user=self.user)

    def test_transaction_list_returns_200(self):
        res = self.client.get("/api/v1/transactions/")
        self.assertEqual(res.status_code, status.HTTP_200_OK)

    def test_transaction_list_requires_auth(self):
        res = APIClient().get("/api/v1/transactions/")
        self.assertEqual(res.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_send_transaction_success(self):
        res = self.client.post("/api/v1/transactions/send/", {
            "receiver_address": self.other_wallet.wallet_address,
            "amount": "10.00000000"
        }, format="json")
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)

    def test_send_requires_auth(self):
        res = APIClient().post("/api/v1/transactions/send/", {
            "receiver_address": self.other_wallet.wallet_address,
            "amount": "10.00000000"
        }, format="json")
        self.assertEqual(res.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_send_insufficient_funds_returns_400(self):
        res = self.client.post("/api/v1/transactions/send/", {
            "receiver_address": self.other_wallet.wallet_address,
            "amount": "99999.00000000"
        }, format="json")
        self.assertIn(res.status_code, (status.HTTP_400_BAD_REQUEST, status.HTTP_402_PAYMENT_REQUIRED))