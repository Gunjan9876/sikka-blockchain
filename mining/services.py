"""
Mining service layer — v2 with hash rate, hardware upgrades, and mining pools.

Reward formula:
    base_reward     = time_elapsed_hours × REWARD_RATE
    hardware_reward = base_reward × rig.multiplier
    fees_earned     = sum of TRANSFER fees in pending txns
    total_reward    = hardware_reward + fees_earned

Pool reward split (when miner is in a pool):
    pool_cut        = total_reward × pool_fee_pct
    distributable   = total_reward - pool_cut
    each_member     = distributable × (member_hash_rate / total_pool_hash_rate)
"""

import hashlib
import logging
import time
from decimal import Decimal
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from .models import MiningSession, MiningRig, MiningPool, PoolMembership, HARDWARE_TIERS, TIER_ORDER


logger = logging.getLogger(__name__)

MAX_DURATION   = timedelta(hours=24)
REWARD_RATE    = Decimal("10.00000000")   # base SKA per hour (Basic CPU)
POW_DIFFICULTY = 4


# ─── PoW Helpers ──────────────────────────────────────────────────────────────

def calculate_hash(previous_hash, timestamp, merkle_root, nonce):
    payload = f"{previous_hash}{timestamp}{merkle_root}{nonce}".encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def validate_pow(block_hash, difficulty=POW_DIFFICULTY):
    return block_hash.startswith("0" * difficulty)


def mine_block(previous_hash, merkle_root, difficulty=POW_DIFFICULTY):
    target    = "0" * difficulty
    timestamp = str(time.time())
    start_time = time.time()
    nonce = 0
    prefix = f"{previous_hash}{timestamp}{merkle_root}".encode("utf-8")

    while True:
        payload    = prefix + str(nonce).encode("utf-8")
        block_hash = hashlib.sha256(payload).hexdigest()
        if block_hash.startswith(target):
            break
        nonce += 1

    return {
        "nonce": nonce, "block_hash": block_hash,
        "difficulty": difficulty, "mining_time": time.time() - start_time,
        "timestamp": timestamp,
    }


# ─── Reward Calculation ────────────────────────────────────────────────────────

def calculate_reward(started_at, claim_time=None, multiplier=Decimal("1.0")) -> Decimal:
    """
    Time-based reward scaled by hardware multiplier.
    base = hours_mined × REWARD_RATE
    final = base × multiplier
    """
    if claim_time is None:
        claim_time = timezone.now()

    elapsed            = claim_time - started_at
    effective_duration = min(elapsed, MAX_DURATION)

    if effective_duration.total_seconds() <= 0:
        return Decimal("0.00000000")

    hours_mined = Decimal(str(effective_duration.total_seconds())) / Decimal("3600")
    reward      = (hours_mined * REWARD_RATE * multiplier).quantize(Decimal("0.00000000"))
    return reward


# ─── Rig helpers ──────────────────────────────────────────────────────────────

def get_or_create_rig(user) -> MiningRig:
    """Get user's rig or create a free BASIC one."""
    rig, _ = MiningRig.objects.get_or_create(
        owner=user,
        defaults={"tier": MiningRig.Tier.BASIC, "hash_rate": 10},
    )
    return rig


def upgrade_rig(user) -> MiningRig:
    """
    Upgrade user's rig to the next tier.
    Deducts the upgrade cost from their wallet.
    Raises ValueError if already at max tier or insufficient funds.
    """
    from wallet.models import Wallet

    rig = get_or_create_rig(user)

    if rig.next_tier is None:
        raise ValueError("Your rig is already at the maximum tier (Quantum Rig).")

    next_tier_key  = rig.next_tier
    next_tier_info = HARDWARE_TIERS[next_tier_key]
    cost           = next_tier_info["cost"]

    wallet = Wallet.objects.select_for_update().get(owner=user)

    if wallet.balance < cost:
        raise ValueError(
            f"Insufficient funds. Upgrade to {next_tier_info['label']} costs "
            f"{cost} SKA. Available: {wallet.balance} SKA."
        )

    # Deduct cost
    wallet.balance -= cost
    wallet.save(update_fields=["balance", "updated_at"])

    # Upgrade rig
    rig.tier           = next_tier_key
    rig.hash_rate      = next_tier_info["hash_rate"]
    rig.total_upgrades += 1
    rig.save(update_fields=["tier", "hash_rate", "total_upgrades", "upgraded_at"])

    # Update pool membership snapshot if in a pool
    try:
        membership = user.pool_membership
        if membership.is_active:
            membership.rig_hash_rate_snapshot = rig.hash_rate
            membership.save(update_fields=["rig_hash_rate_snapshot"])
    except PoolMembership.DoesNotExist:
        pass

    logger.info(
        "[Rig] Upgraded — user=%s tier=%s hash_rate=%s MH/s cost=%s SKA",
        user.username, next_tier_key, rig.hash_rate, cost,
    )

    return rig


def get_rig_info(user) -> dict:
    """Return rig details for the status/dashboard API."""
    rig = get_or_create_rig(user)
    next_tier     = rig.next_tier
    next_tier_info = HARDWARE_TIERS.get(next_tier, {}) if next_tier else {}

    return {
        "tier":             rig.tier,
        "tier_label":       rig.get_tier_display(),
        "hash_rate":        rig.hash_rate,
        "multiplier":       str(rig.multiplier),
        "total_upgrades":   rig.total_upgrades,
        "next_tier":        next_tier,
        "next_tier_label":  next_tier_info.get("label"),
        "next_tier_cost":   str(rig.next_tier_cost),
        "is_max_tier":      next_tier is None,
    }


# ─── Pool helpers ─────────────────────────────────────────────────────────────

def join_pool(user, pool_id: int) -> PoolMembership:
    """Join a mining pool. Leave current pool first if in one."""
    rig  = get_or_create_rig(user)
    pool = MiningPool.objects.get(pk=pool_id, is_active=True)

    # Leave existing pool
    try:
        existing = user.pool_membership
        if existing.pool_id == pool_id and existing.is_active:
            raise ValueError("You are already a member of this pool.")
        existing.is_active = False
        existing.left_at   = timezone.now()
        existing.save(update_fields=["is_active", "left_at"])
    except PoolMembership.DoesNotExist:
        pass

    membership = PoolMembership.objects.create(
        user=user,
        pool=pool,
        rig_hash_rate_snapshot=rig.hash_rate,
        is_active=True,
    )

    logger.info("[Pool] %s joined pool '%s'", user.username, pool.name)
    return membership


def leave_pool(user) -> None:
    """Leave current pool."""
    try:
        membership = user.pool_membership
        if not membership.is_active:
            raise ValueError("You are not currently in any pool.")
        membership.is_active = False
        membership.left_at   = timezone.now()
        membership.save(update_fields=["is_active", "left_at"])
        logger.info("[Pool] %s left pool '%s'", user.username, membership.pool.name)
    except PoolMembership.DoesNotExist:
        raise ValueError("You are not currently in any pool.")


def _distribute_pool_reward(miner, pool, total_reward) -> dict:
    """
    Split total_reward among all active pool members proportional to hash rate.
    Pool takes its fee cut first.

    Returns: dict of {user → reward_amount}
    """
    from wallet.services import deposit as wallet_deposit
    from wallet.models import Wallet

    pool_fee     = (total_reward * pool.pool_fee_pct / Decimal("100")).quantize(Decimal("0.00000000"))
    distributable = total_reward - pool_fee

    memberships  = list(pool.memberships.filter(is_active=True).select_related("user"))
    total_hash   = sum(m.rig_hash_rate_snapshot for m in memberships) or 1

    distributions = {}
    for m in memberships:
        share  = Decimal(str(m.rig_hash_rate_snapshot)) / Decimal(str(total_hash))
        amount = (distributable * share).quantize(Decimal("0.00000000"))
        distributions[m.user] = amount

        try:
            wallet = Wallet.objects.get(owner=m.user)
            wallet_deposit(wallet, amount, credit_mining=True)
            logger.info(
                "[Pool] Distributed %s SKA to %s (hash_rate=%s/%s)",
                amount, m.user.username, m.rig_hash_rate_snapshot, total_hash,
            )
        except Exception as e:
            logger.error("[Pool] Failed to credit %s: %s", m.user.username, e)

    return distributions


# ─── Core Service Functions ────────────────────────────────────────────────────

def start_mining(user) -> MiningSession:
    """Start a new mining session. Creates BASIC rig if user has none."""
    active = MiningSession.objects.filter(
        user=user, status=MiningSession.Status.RUNNING
    ).first()

    if active:
        raise ValueError("A mining session is already running.")

    rig  = get_or_create_rig(user)
    now  = timezone.now()

    # Get pool if member
    pool = None
    try:
        membership = user.pool_membership
        if membership.is_active:
            pool = membership.pool
    except PoolMembership.DoesNotExist:
        pass

    session = MiningSession.objects.create(
        user=user,
        rig=rig,
        pool=pool,
        hash_rate_snapshot=rig.hash_rate,
        ends_at=now + MAX_DURATION,
        reward_rate=REWARD_RATE,
        reward=Decimal("0.00000000"),
        status=MiningSession.Status.RUNNING,
    )

    return session


@transaction.atomic
def claim_mining(user) -> MiningSession:
    """
    Claim reward with hash-rate-based calculation and optional pool split.

    Flow:
    1. Load active session + rig multiplier
    2. Calculate time reward × hardware multiplier
    3. Add pending tx fees
    4. If in pool → split reward among members proportionally
       If solo    → credit miner directly
    5. Mine block on-chain, confirm txns
    6. Finalise session
    """
    from wallet.services import deposit as wallet_deposit
    from blockchain.services import add_block
    from transactions.services import (
        create_coinbase_transaction,
        confirm_transactions,
        get_pending_tx_hashes,
        get_pending_transactions,
        collect_fees_for_block,
    )

    session = (
        MiningSession.objects
        .select_for_update()
        .filter(user=user, status=MiningSession.Status.RUNNING)
        .first()
    )

    if session is None:
        raise ValueError("No active mining session found.")

    claim_time = timezone.now()

    # ── 1. Get rig multiplier ─────────────────────────────────────────────────
    rig        = get_or_create_rig(user)
    multiplier = rig.multiplier

    # ── 2. Time-based reward × hardware multiplier ────────────────────────────
    time_reward  = calculate_reward(session.started_at, claim_time, multiplier)

    if time_reward <= 0:
        raise ValueError("Reward is zero — please wait before claiming.")

    try:
        wallet = user.wallet
    except Exception:
        raise ValueError("Wallet not found.")

    miner_address = wallet.wallet_address or f"USER_{user.pk}"

    # ── 3. Collect tx fees ────────────────────────────────────────────────────
    pending_txs  = get_pending_transactions()
    fees_earned  = collect_fees_for_block(pending_txs)
    total_reward = time_reward + fees_earned

    # ── 4. Coinbase tx ────────────────────────────────────────────────────────
    coinbase_tx = create_coinbase_transaction(miner_address, total_reward)
    tx_hashes   = get_pending_tx_hashes()

    logger.info(
        "[Mining] Block candidate — miner=%s hash_rate=%sMH/s multiplier=%s "
        "time_reward=%s fees=%s total=%s",
        miner_address, rig.hash_rate, multiplier,
        time_reward, fees_earned, total_reward,
    )

    # ── 5. Mine block on-chain ────────────────────────────────────────────────
    try:
        block = add_block(
            tx_hashes=tx_hashes,
            miner_address=miner_address,
            reward=total_reward,
        )
    except (ValueError, RuntimeError) as exc:
        raise ValueError(f"Block creation failed: {exc}") from exc

    # ── 6. Confirm all pending txns ───────────────────────────────────────────
    all_pending = get_pending_transactions()
    confirm_transactions(all_pending, block)

    # ── 7. Credit wallet(s) ───────────────────────────────────────────────────
    pool = session.pool
    if pool and pool.is_active:
        # Pool mode: split reward among all active members
        _distribute_pool_reward(user, pool, total_reward)
        logger.info(
            "[Mining] Pool reward distributed — pool=%s total=%s SKA",
            pool.name, total_reward,
        )
    else:
        # Solo mode: full reward to miner
        wallet_deposit(wallet, total_reward, credit_mining=True)
        logger.info(
            "[Mining] Solo reward — miner=%s total=%s SKA block=#%d",
            miner_address, total_reward, block.block_index,
        )

    # ── 8. Finalise session ───────────────────────────────────────────────────
    session.reward     = total_reward
    session.status     = MiningSession.Status.CLAIMED
    session.claimed_at = claim_time
    session.save(update_fields=["reward", "status", "claimed_at"])

    return session


def get_status(user) -> dict:
    session = MiningSession.objects.filter(
        user=user, status=MiningSession.Status.RUNNING,
    ).first()

    rig_info = get_rig_info(user)

    # Pool info
    pool_info = None
    try:
        membership = user.pool_membership
        if membership.is_active:
            pool_info = {
                "pool_id":         membership.pool_id,
                "pool_name":       membership.pool.name,
                "pool_fee_pct":    str(membership.pool.pool_fee_pct),
                "total_hash_rate": membership.pool.total_hash_rate,
                "member_count":    membership.pool.member_count,
            }
    except PoolMembership.DoesNotExist:
        pass

    if session is None:
        return {
            "is_mining":        False,
            "started_at":       None,
            "elapsed_seconds":  0,
            "estimated_reward": "0.00000000",
            "rig":              rig_info,
            "pool":             pool_info,
        }

    now       = timezone.now()
    elapsed   = now - session.started_at
    multiplier = rig.multiplier if (rig := get_or_create_rig(user)) else Decimal("1.0")
    estimated = calculate_reward(session.started_at, now, multiplier)

    return {
        "is_mining":        True,
        "started_at":       session.started_at.isoformat(),
        "elapsed_seconds":  int(elapsed.total_seconds()),
        "estimated_reward": str(estimated),
        "hash_rate":        session.hash_rate_snapshot,
        "rig":              rig_info,
        "pool":             pool_info,
    }