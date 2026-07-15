from decimal import Decimal
from django.db import models
from django.conf import settings


# ── Hardware Tiers ─────────────────────────────────────────────────────────────
# Each tier has a name, hash rate (MH/s), cost in SKA, and reward multiplier.
# User starts with BASIC for free. Upgrades cost SKA from their wallet.

HARDWARE_TIERS = {
    "BASIC":      {"label": "Basic CPU",       "hash_rate": 10,    "cost": Decimal("0"),          "multiplier": Decimal("1.0")},
    "GPU":        {"label": "GPU Rig",          "hash_rate": 100,   "cost": Decimal("50.00"),      "multiplier": Decimal("2.5")},
    "ASIC":       {"label": "ASIC Miner",       "hash_rate": 1000,  "cost": Decimal("200.00"),     "multiplier": Decimal("8.0")},
    "QUANTUM":    {"label": "Quantum Rig",      "hash_rate": 5000,  "cost": Decimal("1000.00"),    "multiplier": Decimal("25.0")},
}

TIER_ORDER = ["BASIC", "GPU", "ASIC", "QUANTUM"]


class MiningRig(models.Model):
    """
    Represents a user's mining hardware.
    One rig per user — upgrades replace the current tier.
    Hash rate determines reward multiplier on top of base time reward.
    """

    class Tier(models.TextChoices):
        BASIC   = "BASIC",   "Basic CPU"
        GPU     = "GPU",     "GPU Rig"
        ASIC    = "ASIC",    "ASIC Miner"
        QUANTUM = "QUANTUM", "Quantum Rig"

    owner = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="mining_rig",
    )

    tier = models.CharField(
        max_length=16,
        choices=Tier.choices,
        default=Tier.BASIC,
        help_text="Current hardware tier. Higher tier = more hash rate = more reward.",
    )

    # Denormalised for quick access — kept in sync with tier on upgrade
    hash_rate = models.PositiveIntegerField(
        default=10,
        help_text="Hash rate in MH/s.",
    )

    total_upgrades = models.PositiveIntegerField(
        default=0,
        help_text="Number of times this rig has been upgraded.",
    )

    purchased_at = models.DateTimeField(auto_now_add=True)
    upgraded_at  = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Mining Rig"

    def __str__(self):
        return f"{self.owner.username} — {self.get_tier_display()} ({self.hash_rate} MH/s)"

    @property
    def multiplier(self) -> Decimal:
        return HARDWARE_TIERS[self.tier]["multiplier"]

    @property
    def next_tier(self):
        """Returns the next tier key, or None if already at max."""
        idx = TIER_ORDER.index(self.tier)
        if idx + 1 < len(TIER_ORDER):
            return TIER_ORDER[idx + 1]
        return None

    @property
    def next_tier_cost(self) -> Decimal:
        """Cost in SKA to upgrade to the next tier."""
        nt = self.next_tier
        if nt:
            return HARDWARE_TIERS[nt]["cost"]
        return Decimal("0")


# ── Mining Pool ────────────────────────────────────────────────────────────────

class MiningPool(models.Model):
    """
    A mining pool that users can join.
    When a pool member claims a block, the reward is split proportionally
    among all active pool members based on their hash rates.
    """

    name        = models.CharField(max_length=64, unique=True)
    description = models.TextField(blank=True, default="")

    # Pool fee percentage taken before splitting reward to members (0–10%)
    pool_fee_pct = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        default="1.00",
        help_text="Pool operator fee percentage (e.g. 1.00 = 1%).",
    )

    is_active   = models.BooleanField(default=True)
    created_at  = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Mining Pool"

    def __str__(self):
        return f"Pool: {self.name} ({self.member_count} members)"

    @property
    def member_count(self):
        return self.memberships.filter(is_active=True).count()

    @property
    def total_hash_rate(self):
        """Sum of hash rates of all active members."""
        result = self.memberships.filter(is_active=True).aggregate(
            total=models.Sum("rig_hash_rate_snapshot")
        )
        return result["total"] or 0


class PoolMembership(models.Model):
    """
    Tracks which pool a user belongs to.
    A user can only be in one pool at a time.
    """

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="pool_membership",
    )

    pool = models.ForeignKey(
        MiningPool,
        on_delete=models.CASCADE,
        related_name="memberships",
    )

    # Snapshot of hash rate at join time — updated on rig upgrade
    rig_hash_rate_snapshot = models.PositiveIntegerField(default=10)

    is_active  = models.BooleanField(default=True)
    joined_at  = models.DateTimeField(auto_now_add=True)
    left_at    = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = "Pool Membership"

    def __str__(self):
        status = "active" if self.is_active else "left"
        return f"{self.user.username} → {self.pool.name} ({status})"


# ── Mining Session (updated) ───────────────────────────────────────────────────

class MiningSession(models.Model):

    class Status(models.TextChoices):
        RUNNING = "RUNNING", "Running"
        READY   = "READY",   "Ready to Claim"
        CLAIMED = "CLAIMED", "Claimed"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="mining_sessions",
    )

    # Rig and pool snapshots at session start
    rig = models.ForeignKey(
        MiningRig,
        null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name="sessions",
        help_text="Rig used for this session.",
    )
    pool = models.ForeignKey(
        MiningPool,
        null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name="sessions",
        help_text="Pool this session contributed to (if any).",
    )

    # Snapshot of hash rate at session start (rig may be upgraded later)
    hash_rate_snapshot = models.PositiveIntegerField(
        default=10,
        help_text="MH/s at the time this session started.",
    )

    started_at = models.DateTimeField(auto_now_add=True)
    ends_at    = models.DateTimeField()

    reward_rate = models.DecimalField(
        max_digits=20,
        decimal_places=8,
        default="10.00000000",
    )

    reward = models.DecimalField(
        max_digits=20,
        decimal_places=8,
        default="0.00000000",
    )

    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.RUNNING,
    )

    claimed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.user.username} — {self.status} ({self.hash_rate_snapshot} MH/s)"