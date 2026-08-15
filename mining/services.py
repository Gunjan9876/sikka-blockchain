"""
Mining service layer — Phase 2: Real Proof-of-Work Race.

Mining model (Phase 2):
    - User starts a session (start_mining)
    - On claim, a PoW puzzle is solved using the miner's session data as seed
    - Higher-tier rigs solve faster (larger nonce skip = simulates parallel hashing)
    - Block reward = halving schedule (50 → 25 → 12.5 SKA ...) + tx fees
    - Supply cap enforced: total minted SKA never exceeds 100M
    - Pool members split reward proportionally by hash rate

Rig skip factors (simulated parallelism):
    BASIC   → skip 1   (slowest)
    GPU     → skip 10
    ASIC    → skip 100
    QUANTUM → skip 500 (fastest)
"""

import hashlib
import logging
from decimal import Decimal
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from .models import MiningSession, MiningRig, MiningPool, PoolMembership, HARDWARE_TIERS, TIER_ORDER


logger = logging.getLogger(__name__)

MAX_DURATION = timedelta(hours=24)
REWARD_RATE  = Decimal("10.00000000")   # kept for legacy get_status estimated display


# ─── PoW Race ─────────────────────────────────────────────────────────────────

def _run_pow_race(seed: str, rig: MiningRig, difficulty: int) -> dict:
    """
    Simulate a PoW race where higher-tier rigs solve the puzzle faster.

    Each rig tier gets a nonce skip factor — on every iteration, the miner
    advances by skip steps instead of 1, simulating parallel hashing cores.

        BASIC   skip=1   → checks every nonce
        GPU     skip=10  → jumps 10 at a time
        ASIC    skip=100 → jumps 100 at a time
        QUANTUM skip=500 → jumps 500 at a time

    The seed is unique per miner+session so two miners never compete on
    the exact same puzzle (prevents one miner always winning first).

    Args:
        seed:       Unique string derived from miner address + session data.
        rig:        The miner's MiningRig instance (determines skip factor).
        difficulty: Number of leading zeros required in the winning hash.

    Returns:
        dict with keys: nonce (int), hash (str), attempts (int).
    """
    target     = "0" * difficulty
    tier_skip  = max(1, rig.hash_rate // 10)   # BASIC=1, GPU=10, ASIC=100, QUANTUM=500

    # Unique start offset per miner — prevents all BASIC rigs checking nonce 0 first
    start_nonce = abs(hash(seed)) % 100_000
    nonce       = 0
    attempts    = 0

    while True:
        candidate = hashlib.sha256(
            f"{seed}:{start_nonce + nonce}".encode("utf-8")
        ).hexdigest()
        attempts += 1

        if candidate.startswith(target):
            return {
                "nonce":    start_nonce + nonce,
                "hash":     candidate,
                "attempts": attempts,
            }

        nonce += tier_skip


# ─── Rig helpers ──────────────────────────────────────────────────────────────

def get_or_create_rig(user) -> MiningRig:
    """Get user's rig or create a free BASIC one."""
    rig, _ = MiningRig.objects.get_or_create(
        owner=user,
        defaults={"tier": MiningRig.Tier.BASIC, "hash_rate": 10},
    )
    return rig


@transaction.atomic
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
    rig.tier            = next_tier_key
    rig.hash_rate       = next_tier_info["hash_rate"]
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
    rig            = get_or_create_rig(user)
    next_tier      = rig.next_tier
    next_tier_info = HARDWARE_TIERS.get(next_tier, {}) if next_tier else {}

    return {
        "tier":            rig.tier,
        "tier_label":      rig.get_tier_display(),
        "hash_rate":       rig.hash_rate,
        "multiplier":      str(rig.multiplier),
        "total_upgrades":  rig.total_upgrades,
        "next_tier":       next_tier,
        "next_tier_label": next_tier_info.get("label"),
        "next_tier_cost":  str(rig.next_tier_cost),
        "is_max_tier":     next_tier is None,
    }


# ─── Pool helpers ─────────────────────────────────────────────────────────────

def join_pool(user, pool_id: int) -> PoolMembership:
    """
    Join a mining pool. Auto-switches if already in another pool.

    The DB has a unique constraint on user_id (one row per user ever),
    so we NEVER insert a second row — we always reuse/update the existing one.
    """
    rig  = get_or_create_rig(user)
    pool = MiningPool.objects.get(pk=pool_id, is_active=True)

    try:
        membership = user.pool_membership
        if membership.pool_id == pool_id and membership.is_active:
            raise ValueError("You are already a member of this pool.")
        # Reuse the existing row — just point it at the new pool
        membership.pool                    = pool
        membership.rig_hash_rate_snapshot  = rig.hash_rate
        membership.is_active               = True
        membership.left_at                 = None
        membership.joined_at               = timezone.now()
        membership.save(update_fields=[
            "pool", "rig_hash_rate_snapshot", "is_active", "left_at", "joined_at"
        ])
    except PoolMembership.DoesNotExist:
        # First time joining any pool — safe to create
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

    pool_fee      = (total_reward * pool.pool_fee_pct / Decimal("100")).quantize(Decimal("0.00000000"))
    distributable = total_reward - pool_fee

    memberships = list(pool.memberships.filter(is_active=True).select_related("user"))
    total_hash  = sum(m.rig_hash_rate_snapshot for m in memberships) or 1

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
    """
    Start a new mining session. Creates BASIC rig if user has none.
    Only one active session allowed per user.
    """
    active = MiningSession.objects.filter(
        user=user, status=MiningSession.Status.RUNNING
    ).first()

    if active:
        raise ValueError("A mining session is already running.")

    rig = get_or_create_rig(user)
    now = timezone.now()

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


def claim_mining(user) -> MiningSession:
    """
    Claim block reward via real PoW race.

    Flow:
    1. Load active session (no lock yet)
    2. Solve PoW puzzle OUTSIDE atomic block — CPU-heavy, must not hold DB lock
    3. Re-acquire session with select_for_update inside atomic block
    4. Compute block reward from halving schedule + tx fees
    5. Enforce 100M supply cap — clamp reward if near cap
    6. Mine block on-chain (add_block)
    7. Confirm all pending txns (TRANSFER + COINBASE + REWARD)
    8. Credit wallet (solo) or split proportionally (pool)
    9. Finalise session with PoW stats (nonce, hash, attempts)

    O9 fix: PoW solving runs before the atomic block so no DB connection
    is held during potentially long CPU-intensive hashing. This prevents
    connection pool exhaustion under concurrent miners.
    """
    from wallet.services import deposit as wallet_deposit
    from blockchain.services import (
        add_block,
        get_block_reward,
        get_total_mined,
        get_current_difficulty,
        get_latest_block,
        MAX_SUPPLY,
    )
    from transactions.services import (
        create_coinbase_transaction,
        confirm_transactions,
        get_pending_transactions,
        get_all_pending_transactions,
        collect_fees_for_block,
    )

    # ── Pre-flight: load session + rig (no DB lock held yet) ─────────────────
    session = MiningSession.objects.filter(
        user=user, status=MiningSession.Status.RUNNING
    ).first()

    if session is None:
        raise ValueError("No active mining session found.")

    rig = get_or_create_rig(user)

    try:
        wallet = user.wallet
    except Exception:
        raise ValueError("Wallet not found.")

    miner_address = wallet.wallet_address or f"USER_{user.pk}"

    # ── 1. Solve PoW OUTSIDE atomic block (no DB lock held during hashing) ───
    difficulty  = get_current_difficulty()
    puzzle_seed = f"{miner_address}:{session.pk}:{session.started_at.timestamp()}"
    pow_result  = _run_pow_race(puzzle_seed, rig, difficulty)

    logger.info(
        "[Mining] PoW solved — miner=%s nonce=%d attempts=%d hash=%s... difficulty=%d tier=%s",
        miner_address, pow_result["nonce"], pow_result["attempts"],
        pow_result["hash"][:16], difficulty, rig.tier,
    )

    # ── 2. All DB writes inside atomic block ──────────────────────────────────
    with transaction.atomic():
        # Re-fetch session with lock — prevents double-claim race condition
        session = (
            MiningSession.objects
            .select_for_update()
            .filter(user=user, status=MiningSession.Status.RUNNING)
            .first()
        )
        if session is None:
            raise ValueError("Mining session was already claimed.")

        claim_time = timezone.now()

        # ── 3. Collect tx fees ────────────────────────────────────────────────
        pending_txs = get_pending_transactions()
        fees_earned = collect_fees_for_block(pending_txs)

        # ── 4. Block reward — halving schedule + supply cap ───────────────────
        latest_block  = get_latest_block()
        next_index    = (latest_block.block_index + 1) if latest_block else 1
        base_reward   = get_block_reward(next_index)

        total_mined   = get_total_mined()
        remaining_cap = MAX_SUPPLY - total_mined

        # Clamp to remaining supply (enforces hard cap)
        block_reward  = min(base_reward, max(remaining_cap, Decimal("0")))
        total_reward  = (block_reward + fees_earned).quantize(Decimal("0.00000000"))

        logger.info(
            "[Mining] Reward calc — base=%s fees=%s total=%s remaining_cap=%s next_block=#%d",
            base_reward, fees_earned, total_reward, remaining_cap, next_index,
        )

        # ── 5. Coinbase tx (only if reward > 0) ──────────────────────────────
        if total_reward > 0:
            create_coinbase_transaction(miner_address, total_reward)

        tx_hashes = [tx.tx_hash for tx in get_all_pending_transactions()]

        # ── 6. Mine block on-chain ────────────────────────────────────────────
        try:
            block = add_block(
                tx_hashes=tx_hashes,
                miner_address=miner_address,
                reward=total_reward,
            )
        except (ValueError, RuntimeError) as exc:
            raise ValueError(f"Block creation failed: {exc}") from exc

        # ── 7. Confirm ALL pending txns (TRANSFER + COINBASE + REWARD) ────────
        all_pending = get_all_pending_transactions()
        confirm_transactions(all_pending, block)

        # ── 8. Credit wallet(s) ───────────────────────────────────────────────
        pool = session.pool
        if pool and pool.is_active:
            _distribute_pool_reward(user, pool, total_reward)
            logger.info(
                "[Mining] Pool reward distributed — pool=%s total=%s SKA",
                pool.name, total_reward,
            )
        else:
            wallet_deposit(wallet, total_reward, credit_mining=True)
            logger.info(
                "[Mining] Solo reward — miner=%s total=%s SKA block=#%d",
                miner_address, total_reward, block.block_index,
            )

        # ── 9. Finalise session with PoW stats ────────────────────────────────
        session.reward       = total_reward
        session.status       = MiningSession.Status.CLAIMED
        session.claimed_at   = claim_time
        session.pow_nonce    = pow_result["nonce"]
        session.pow_hash     = pow_result["hash"]
        session.pow_attempts = pow_result["attempts"]
        session.save(update_fields=[
            "reward", "status", "claimed_at",
            "pow_nonce", "pow_hash", "pow_attempts",
        ])

    return session


def get_status(user) -> dict:
    """
    Return current mining status for the dashboard.
    estimated_reward shows the current block reward from halving schedule.
    """
    session  = MiningSession.objects.filter(
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

    # Show current block reward (halving schedule) as estimated reward
    from blockchain.services import get_block_reward, get_latest_block
    _latest     = get_latest_block()
    _next_index = (_latest.block_index + 1) if _latest else 1
    estimated   = get_block_reward(_next_index)

    now     = timezone.now()
    elapsed = now - session.started_at

    return {
        "is_mining":        True,
        "started_at":       session.started_at.isoformat(),
        "elapsed_seconds":  int(elapsed.total_seconds()),
        "estimated_reward": str(estimated),
        "hash_rate":        session.hash_rate_snapshot,
        "rig":              rig_info,
        "pool":             pool_info,
    }