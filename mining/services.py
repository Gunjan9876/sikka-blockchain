"""
Mining service layer.

All mining business logic lives here.
Views only call these functions — no logic in views or serializers.

Reward calculation is always server-side and deterministic.
"""

from decimal import Decimal
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from .models import MiningSession


# ─── Configuration ────────────────────────────────────────────────────────────

# Maximum mining duration: rewards are capped at 24 hours
MAX_DURATION = timedelta(hours=24)

# Reward per hour in SIKKA tokens (Decimal for precision)
REWARD_RATE = Decimal("10.00000000")


# ─── Helper ───────────────────────────────────────────────────────────────────

def calculate_reward(started_at, claim_time=None) -> Decimal:
    """
    Compute the SIKKA reward for a mining session.

    Args:
        started_at: The session's start datetime (timezone-aware).
        claim_time: The moment of claim (defaults to now). Always server-side.

    Returns:
        Decimal reward, capped at MAX_DURATION * REWARD_RATE.
        Minimum is 0 (handles clock skew / instant claims gracefully).
    """
    if claim_time is None:
        claim_time = timezone.now()

    elapsed = claim_time - started_at

    # Cap at maximum mining duration
    effective_duration = min(elapsed, MAX_DURATION)

    # Guard against negative elapsed (clock skew)
    if effective_duration.total_seconds() <= 0:
        return Decimal("0.00000000")

    hours_mined = Decimal(str(effective_duration.total_seconds())) / Decimal("3600")
    reward = (hours_mined * REWARD_RATE).quantize(Decimal("0.00000000"))

    return reward


# ─── Service Functions ─────────────────────────────────────────────────────────

def start_mining(user) -> MiningSession:
    """
    Start a new mining session for `user`.

    Raises:
        ValueError: If the user already has a RUNNING session.
    """
    # Block duplicate sessions (check RUNNING only; READY is a finished state)
    active = MiningSession.objects.filter(
        user=user,
        status=MiningSession.Status.RUNNING,
    ).first()

    if active:
        raise ValueError("A mining session is already running.")

    now = timezone.now()

    session = MiningSession.objects.create(
        user=user,
        ends_at=now + MAX_DURATION,
        reward_rate=REWARD_RATE,
        reward=Decimal("0.00000000"),
        status=MiningSession.Status.RUNNING,
    )

    return session


@transaction.atomic
def claim_mining(user) -> MiningSession:
    """
    Claim the reward for the user's active mining session.

    Calculates reward server-side, credits the user's wallet via
    wallet.services.deposit(credit_mining=True), marks session CLAIMED.

    Raises:
        ValueError: If there is no claimable session, or it was already claimed.
    """
    # Import here to avoid circular import (wallet → mining → wallet)
    from wallet.services import deposit as wallet_deposit

    # Find the active session — lock the row immediately
    session = (
        MiningSession.objects
        .select_for_update()
        .filter(user=user, status=MiningSession.Status.RUNNING)
        .first()
    )

    if session is None:
        raise ValueError("No active mining session found.")

    # Calculate reward on the server; never trust client timestamps
    claim_time = timezone.now()
    reward = calculate_reward(session.started_at, claim_time)

    if reward <= 0:
        raise ValueError("Reward is zero — please wait before claiming.")

    # Retrieve the user's wallet (created automatically on registration)
    try:
        wallet = user.wallet
    except Exception:
        raise ValueError("Wallet not found. Please contact support.")

    # Credit reward into wallet — atomic, updates balance + total_mined
    wallet_deposit(wallet, reward, credit_mining=True)

    # Finalise the session
    session.reward = reward
    session.status = MiningSession.Status.CLAIMED
    session.claimed_at = claim_time
    session.save(update_fields=["reward", "status", "claimed_at"])

    return session


def get_status(user) -> dict:
    """
    Return the current mining status for `user`.

    Returns a plain dict — the view serialises this into the HTTP response.
    """
    session = MiningSession.objects.filter(
        user=user,
        status=MiningSession.Status.RUNNING,
    ).first()

    if session is None:
        return {
            "is_mining": False,
            "started_at": None,
            "elapsed_seconds": 0,
            "estimated_reward": "0.00000000",
        }

    now = timezone.now()
    elapsed = now - session.started_at
    estimated = calculate_reward(session.started_at, now)

    return {
        "is_mining": True,
        "started_at": session.started_at.isoformat(),
        "elapsed_seconds": int(elapsed.total_seconds()),
        "estimated_reward": str(estimated),
    }