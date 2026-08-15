"""
Transaction model for the SIKKA blockchain platform.
"""

import hashlib
import time

from django.db import models


class Transaction(models.Model):

    class Status(models.TextChoices):
        PENDING   = "PENDING",   "Pending"
        CONFIRMED = "CONFIRMED", "Confirmed"
        FAILED    = "FAILED",    "Failed"

    class TxType(models.TextChoices):
        COINBASE = "COINBASE", "Mining Reward"
        TRANSFER = "TRANSFER", "Transfer"
        REWARD   = "REWARD",   "University Reward"

    tx_hash          = models.CharField(max_length=64, unique=True, db_index=True)
    tx_type          = models.CharField(max_length=16, choices=TxType.choices, default=TxType.TRANSFER)
    sender_address   = models.CharField(max_length=67, blank=True, default="", db_index=True)
    receiver_address = models.CharField(max_length=67, db_index=True)
    amount           = models.DecimalField(max_digits=20, decimal_places=8)
    fee              = models.DecimalField(max_digits=20, decimal_places=8, default="0.00000000")
    nonce            = models.PositiveIntegerField(default=0)

    # ── ECDSA signature ───────────────────────────────────────────────────────
    # Hex-encoded DER signature of the canonical tx message.
    # Empty string for COINBASE transactions (protocol-generated, no signer).
    signature        = models.TextField(blank=True, default="")

    status           = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING, db_index=True)

    block            = models.ForeignKey(
        "blockchain.Block",
        null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name="transactions",
    )

    created_at       = models.DateTimeField(auto_now_add=True)
    confirmed_at     = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.tx_type} {self.tx_hash[:16]}... ({self.status})"

    @staticmethod
    def compute_hash(sender, receiver, amount, nonce, timestamp):
        payload = f"{sender}{receiver}{amount}{nonce}{timestamp}"
        return hashlib.sha256(payload.encode()).hexdigest()

class Reward(models.Model):

    class AchievementType(models.TextChoices):
        ATTENDANCE = "ATTENDANCE", "Attendance"
        HACKATHON = "HACKATHON", "Hackathon"
        CERTIFICATION = "CERTIFICATION", "Certification"
        PLACEMENT = "PLACEMENT", "Placement"
        EVENT = "EVENT", "Event"
        OTHER = "OTHER", "Other"

    class Status(models.TextChoices):
        PENDING = "PENDING", "Pending"
        APPROVED = "APPROVED", "Approved"
        REJECTED = "REJECTED", "Rejected"

    organisation = models.ForeignKey(
        "wallet.Organisation",
        on_delete=models.CASCADE,
        related_name="rewards_issued"
    )
    student_wallet = models.ForeignKey(
        "wallet.Wallet",
        on_delete=models.CASCADE,
        related_name="rewards_received"
    )
    transaction = models.OneToOneField(
        "Transaction",
        null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name="reward_detail"
    )

    achievement_type = models.CharField(max_length=20, choices=AchievementType.choices, default=AchievementType.OTHER)
    description = models.TextField(blank=True)
    amount = models.DecimalField(max_digits=20, decimal_places=8)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)

    issued_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-issued_at"]

    def __str__(self):
        return f"{self.achievement_type} - {self.amount} SKA ({self.status})"