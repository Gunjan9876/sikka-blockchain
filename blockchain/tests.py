from decimal import Decimal
from django.test import TestCase
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework import status
from django.test.utils import override_settings

from blockchain.models import Block
from blockchain.services import (
    create_genesis_block, add_block, validate_chain,
    get_latest_block, get_block_reward, get_current_difficulty, MAX_SUPPLY,
)

User = get_user_model()

NO_THROTTLE = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework_simplejwt.authentication.JWTAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_THROTTLE_CLASSES": [],
    "DEFAULT_THROTTLE_RATES": {},
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
}


# ── Genesis block ─────────────────────────────────────────────────────────────

class GenesisBlockTests(TestCase):
    def test_genesis_block_created(self):
        block = create_genesis_block()
        self.assertEqual(block.block_index, 0)
        self.assertTrue(block.is_genesis)

    def test_genesis_previous_hash_zeros(self):
        block = create_genesis_block()
        self.assertEqual(block.previous_hash, "0" * 64)

    def test_genesis_hash_valid(self):
        block = create_genesis_block()
        self.assertTrue(Block.verify_hash(block))

    def test_create_genesis_twice_raises(self):
        create_genesis_block()
        with self.assertRaises(Exception):
            create_genesis_block()


# ── Block addition ────────────────────────────────────────────────────────────

class BlockAdditionTests(TestCase):
    def setUp(self):
        self.genesis = create_genesis_block()

    def test_add_block_increments_index(self):
        block = add_block(
            tx_hashes=[], miner_address="SKA123", reward=Decimal("50")
        )
        self.assertEqual(block.block_index, 1)

    def test_add_block_links_previous_hash(self):
        block = add_block(
            tx_hashes=[], miner_address="SKA123", reward=Decimal("50")
        )
        self.assertEqual(block.previous_hash, self.genesis.hash)

    def test_add_block_hash_satisfies_difficulty(self):
        block = add_block(
            tx_hashes=[], miner_address="SKA123", reward=Decimal("50")
        )
        target = "0" * block.difficulty
        self.assertTrue(block.hash.startswith(target))


# ── Chain validation ──────────────────────────────────────────────────────────

class ChainValidationTests(TestCase):
    def setUp(self):
        self.genesis = create_genesis_block()

    def test_single_block_chain_valid(self):
     is_valid, msg = validate_chain()
     self.assertTrue(is_valid, msg)

def test_two_block_chain_valid(self):
    add_block(tx_hashes=[], miner_address="SKA123", reward=Decimal("50"))
    is_valid, msg = validate_chain()
    self.assertTrue(is_valid, msg)

def test_tampered_chain_invalid(self):
    add_block(tx_hashes=[], miner_address="SKA123", reward=Decimal("50"))
    self.genesis.merkle_root = "a" * 64
    self.genesis.save()
    is_valid, msg = validate_chain()
    self.assertFalse(is_valid, msg) 


# ── Halving schedule ──────────────────────────────────────────────────────────

class HalvingScheduleTests(TestCase):
    def test_initial_reward(self):
        reward = get_block_reward(1)
        self.assertEqual(reward, Decimal("50.00000000"))

    def test_reward_halves(self):
        r1 = get_block_reward(1)
        r2 = get_block_reward(210001)
        self.assertEqual(r2, r1 / 2)

    def test_supply_cap_defined(self):
        self.assertEqual(MAX_SUPPLY, Decimal("100000000"))


# ── Difficulty ────────────────────────────────────────────────────────────────

class DifficultyTests(TestCase):
    def setUp(self):
        create_genesis_block()

    def test_difficulty_is_positive_int(self):
        d = get_current_difficulty()
        self.assertIsInstance(d, int)
        self.assertGreater(d, 0)


# ── Blockchain API ────────────────────────────────────────────────────────────

@override_settings(REST_FRAMEWORK=NO_THROTTLE)
class BlockchainAPITests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            username="chainuser", password="StrongPass123!", email="chain@example.com"
        )
        self.client.force_authenticate(user=self.user)
        create_genesis_block()

    def test_chain_stats_endpoint(self):
        res = self.client.get("/api/v1/blockchain/stats/")
        self.assertEqual(res.status_code, status.HTTP_200_OK)

    def test_validate_endpoint(self):
        res = self.client.get("/api/v1/blockchain/validate/")
        self.assertEqual(res.status_code, status.HTTP_200_OK)

    def test_stats_requires_auth(self):
        client = APIClient()
        res = client.get("/api/v1/blockchain/stats/")
        self.assertEqual(res.status_code, status.HTTP_401_UNAUTHORIZED)