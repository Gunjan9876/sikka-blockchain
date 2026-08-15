from decimal import Decimal
from django.test import TestCase
from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APIClient
from rest_framework import status
from django.test.utils import override_settings
from unittest.mock import patch

from mining.models import MiningRig, MiningSession, MiningPool, PoolMembership, HARDWARE_TIERS
from mining.services import (
    get_or_create_rig, upgrade_rig, get_rig_info,
    start_mining, get_status, join_pool, leave_pool,
    _run_pow_race,
)
from blockchain.services import create_genesis_block

User = get_user_model()

NO_THROTTLE = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework_simplejwt.authentication.JWTAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_THROTTLE_CLASSES": [],
    "DEFAULT_THROTTLE_RATES": {
        "mining": "10000/min",  # dummy high rate — scope must exist even when throttling is off
    },
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
}


def make_user(username="miner1", password="StrongPass123!"):
    user = User.objects.create_user(
        username=username, password=password,
        email=f"{username}@example.com"
    )
    # Auto-create wallet if signal doesn't fire in test
    try:
        from wallet.models import Wallet
        wallet, _ = Wallet.objects.get_or_create(
            owner=user,
            defaults={"balance": Decimal("500.00"), "wallet_address": f"SKA_{username}"}
        )
        # Force balance to 500 — a post_save signal may have already created
        # the wallet with balance=0 before get_or_create ran, so defaults
        # would be ignored and the test wallet would be broke.
        wallet.balance = Decimal("500.00")
        wallet.save(update_fields=["balance"])
    except Exception:
        pass
    return user


# ── Rig Tests ─────────────────────────────────────────────────────────────────

class MiningRigTests(TestCase):

    def setUp(self):
        self.user = make_user()

    def test_get_or_create_rig_creates_basic(self):
        rig = get_or_create_rig(self.user)
        self.assertEqual(rig.tier, MiningRig.Tier.BASIC)
        self.assertEqual(rig.hash_rate, 10)

    def test_get_or_create_rig_idempotent(self):
        rig1 = get_or_create_rig(self.user)
        rig2 = get_or_create_rig(self.user)
        self.assertEqual(rig1.pk, rig2.pk)

    def test_rig_multiplier_basic(self):
        rig = get_or_create_rig(self.user)
        self.assertEqual(rig.multiplier, Decimal("1.0"))

    def test_rig_next_tier_basic(self):
        rig = get_or_create_rig(self.user)
        self.assertEqual(rig.next_tier, "GPU")

    def test_rig_next_tier_cost(self):
        rig = get_or_create_rig(self.user)
        self.assertEqual(rig.next_tier_cost, Decimal("50.00"))

    def test_rig_max_tier_no_next(self):
        rig = get_or_create_rig(self.user)
        rig.tier = MiningRig.Tier.QUANTUM
        rig.save()
        self.assertIsNone(rig.next_tier)
        self.assertEqual(rig.next_tier_cost, Decimal("0"))

    def test_upgrade_rig_deducts_wallet(self):
        from wallet.models import Wallet
        get_or_create_rig(self.user)
        wallet = Wallet.objects.get(owner=self.user)
        balance_before = wallet.balance

        upgraded = upgrade_rig(self.user)

        wallet.refresh_from_db()
        self.assertEqual(upgraded.tier, "GPU")
        self.assertEqual(wallet.balance, balance_before - Decimal("50.00"))

    def test_upgrade_rig_insufficient_funds(self):
        from wallet.models import Wallet
        get_or_create_rig(self.user)
        wallet = Wallet.objects.get(owner=self.user)
        wallet.balance = Decimal("0")
        wallet.save()

        with self.assertRaises(ValueError, msg="Insufficient funds"):
            upgrade_rig(self.user)

    def test_upgrade_rig_at_max_raises(self):
        rig = get_or_create_rig(self.user)
        rig.tier = MiningRig.Tier.QUANTUM
        rig.hash_rate = 5000
        rig.save()

        with self.assertRaises(ValueError, msg="maximum tier"):
            upgrade_rig(self.user)

    def test_get_rig_info_returns_dict(self):
        info = get_rig_info(self.user)
        self.assertIn("tier", info)
        self.assertIn("hash_rate", info)
        self.assertIn("multiplier", info)
        self.assertIn("next_tier", info)
        self.assertIn("is_max_tier", info)

    def test_get_rig_info_basic_not_max(self):
        info = get_rig_info(self.user)
        self.assertFalse(info["is_max_tier"])

    def test_get_rig_info_quantum_is_max(self):
        rig = get_or_create_rig(self.user)
        rig.tier = MiningRig.Tier.QUANTUM
        rig.save()
        info = get_rig_info(self.user)
        self.assertTrue(info["is_max_tier"])


# ── PoW Race Tests ────────────────────────────────────────────────────────────

class PoWRaceTests(TestCase):

    def setUp(self):
        self.user = make_user()
        self.rig = get_or_create_rig(self.user)

    def test_pow_returns_valid_hash(self):
        result = _run_pow_race("test_seed", self.rig, difficulty=2)
        self.assertIn("nonce", result)
        self.assertIn("hash", result)
        self.assertIn("attempts", result)
        self.assertTrue(result["hash"].startswith("00"))

    def test_pow_attempts_positive(self):
        result = _run_pow_race("test_seed", self.rig, difficulty=1)
        self.assertGreater(result["attempts"], 0)

    def test_pow_higher_tier_same_result_difficulty(self):
        """Both rigs must produce a hash meeting difficulty — tier just affects speed."""
        gpu_rig = get_or_create_rig(self.user)
        gpu_rig.tier = MiningRig.Tier.GPU
        gpu_rig.hash_rate = 100
        gpu_rig.save()

        result = _run_pow_race("same_seed", gpu_rig, difficulty=1)
        self.assertTrue(result["hash"].startswith("0"))

    def test_pow_different_seeds_different_nonces(self):
        result1 = _run_pow_race("seed_aaa", self.rig, difficulty=1)
        result2 = _run_pow_race("seed_bbb", self.rig, difficulty=1)
        # Different seeds → very likely different nonces/hashes
        self.assertNotEqual(result1["hash"], result2["hash"])


# ── Mining Session Tests ──────────────────────────────────────────────────────

class MiningSessionTests(TestCase):

    def setUp(self):
        self.user = make_user()
        create_genesis_block()

    def test_start_mining_creates_session(self):
        session = start_mining(self.user)
        self.assertEqual(session.status, MiningSession.Status.RUNNING)
        self.assertEqual(session.user, self.user)

    def test_start_mining_twice_raises(self):
        start_mining(self.user)
        with self.assertRaises(ValueError, msg="already running"):
            start_mining(self.user)

    def test_session_has_rig_snapshot(self):
        session = start_mining(self.user)
        self.assertEqual(session.hash_rate_snapshot, 10)  # BASIC rig

    def test_get_status_not_mining(self):
        status_data = get_status(self.user)
        self.assertFalse(status_data["is_mining"])
        self.assertEqual(status_data["elapsed_seconds"], 0)

    def test_get_status_while_mining(self):
        start_mining(self.user)
        status_data = get_status(self.user)
        self.assertTrue(status_data["is_mining"])
        self.assertIn("hash_rate", status_data)
        self.assertIn("estimated_reward", status_data)

    def test_claim_mining_creates_block(self):
        from blockchain.models import Block
        start_mining(self.user)
        blocks_before = Block.objects.count()

        from mining.services import claim_mining
        session = claim_mining(self.user)

        self.assertEqual(session.status, MiningSession.Status.CLAIMED)
        self.assertIsNotNone(session.claimed_at)
        self.assertGreater(Block.objects.count(), blocks_before)

    def test_claim_mining_sets_pow_fields(self):
        start_mining(self.user)
        from mining.services import claim_mining
        session = claim_mining(self.user)

        self.assertGreater(session.pow_nonce, 0)
        self.assertNotEqual(session.pow_hash, "")
        self.assertGreater(session.pow_attempts, 0)

    def test_claim_without_session_raises(self):
        from mining.services import claim_mining
        with self.assertRaises(ValueError, msg="No active mining session"):
            claim_mining(self.user)

    def test_claim_credits_wallet(self):
        from wallet.models import Wallet
        wallet = Wallet.objects.get(owner=self.user)
        balance_before = wallet.balance

        start_mining(self.user)
        from mining.services import claim_mining
        claim_mining(self.user)

        wallet.refresh_from_db()
        self.assertGreaterEqual(wallet.balance, balance_before)


# ── Pool Tests ────────────────────────────────────────────────────────────────

class MiningPoolTests(TestCase):

    def setUp(self):
        self.user = make_user()
        self.pool = MiningPool.objects.create(
            name="TestPool", pool_fee_pct=Decimal("1.00"), is_active=True
        )

    def test_join_pool(self):
        membership = join_pool(self.user, self.pool.pk)
        self.assertTrue(membership.is_active)
        self.assertEqual(membership.pool, self.pool)

    def test_join_same_pool_twice_raises(self):
        join_pool(self.user, self.pool.pk)
        with self.assertRaises(ValueError, msg="already a member"):
            join_pool(self.user, self.pool.pk)

    def test_leave_pool(self):
        join_pool(self.user, self.pool.pk)
        leave_pool(self.user)
        membership = PoolMembership.objects.get(user=self.user)
        self.assertFalse(membership.is_active)
        self.assertIsNotNone(membership.left_at)

    def test_leave_pool_not_in_pool_raises(self):
        with self.assertRaises(ValueError, msg="not currently in any pool"):
            leave_pool(self.user)

    def test_pool_member_count(self):
        user2 = make_user("miner2")
        join_pool(self.user, self.pool.pk)
        join_pool(user2, self.pool.pk)
        self.assertEqual(self.pool.member_count, 2)

    def test_pool_total_hash_rate(self):
        get_or_create_rig(self.user)
        join_pool(self.user, self.pool.pk)
        self.assertGreater(self.pool.total_hash_rate, 0)

    def test_switch_pool(self):
        pool2 = MiningPool.objects.create(
            name="Pool2", pool_fee_pct=Decimal("2.00"), is_active=True
        )
        join_pool(self.user, self.pool.pk)
        join_pool(self.user, pool2.pk)  # Should auto-switch to pool2

        # Only one membership row ever exists per user (unique constraint on user_id).
        # Switching reuses that row — the pool FK is updated to pool2.
        self.assertEqual(PoolMembership.objects.filter(user=self.user).count(), 1)

        membership = PoolMembership.objects.get(user=self.user)
        self.assertTrue(membership.is_active)
        self.assertEqual(membership.pool, pool2)   # now points at pool2
        self.assertIsNone(membership.left_at)       # active, so not left


# ── API Smoke Tests ───────────────────────────────────────────────────────────

@override_settings(REST_FRAMEWORK=NO_THROTTLE)
class MiningAPITests(TestCase):

    def setUp(self):
        self.client = APIClient()
        self.user = make_user()
        self.client.force_authenticate(user=self.user)
        create_genesis_block()

    def test_status_endpoint_authenticated(self):
        res = self.client.get(reverse("mining:status"))
        self.assertEqual(res.status_code, status.HTTP_200_OK)

    def test_status_requires_auth(self):
        res = APIClient().get(reverse("mining:status"))
        self.assertIn(res.status_code, (401, 403))

    def test_start_mining_endpoint(self):
        res = self.client.post(reverse("mining:start"), data={})
        self.assertIn(res.status_code, (200, 201))

    def test_start_mining_requires_auth(self):
        res = APIClient().post(reverse("mining:start"), data={})
        self.assertIn(res.status_code, (401, 403))

    def test_start_twice_returns_error(self):
        self.client.post(reverse("mining:start"), data={})
        res = self.client.post(reverse("mining:start"), data={})
        self.assertIn(res.status_code, (400, 409))