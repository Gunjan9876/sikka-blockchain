from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models


class Wallet(models.Model):

    class WalletStatus(models.TextChoices):
        ACTIVE = "active", "Active"
        SUSPENDED = "suspended", "Suspended"
        CLOSED = "closed", "Closed"

    owner = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="wallet",
    )

    # ── Cryptographic identity ──────────────────────────────────────────────
    wallet_address = models.CharField(
        max_length=67,
        unique=True,
        blank=True,
        default="",
        help_text=(
            "Unique blockchain wallet address. "
            "Generated automatically by the wallet service during wallet creation."
        ),
    )
    public_key = models.TextField(
        blank=True,
        default="",
        help_text="PEM-encoded public key for this wallet.",
    )
    private_key = models.TextField(
        blank=True,
        default="",
        help_text=(
            "FOR EDUCATIONAL PURPOSES ONLY. "
            "In production, private keys are never stored server-side."
        ),
    )

    # ── Status ──────────────────────────────────────────────────────────────
    wallet_status = models.CharField(
        max_length=16,
        choices=WalletStatus.choices,
        default=WalletStatus.ACTIVE,
    )

    # ── Balances ─────────────────────────────────────────────────────────────
    balance = models.DecimalField(
        max_digits=20,
        decimal_places=8,
        default="0.00000000",
    )
    total_mined = models.DecimalField(
        max_digits=20,
        decimal_places=8,
        default="0.00000000",
    )
    total_sent = models.DecimalField(
        max_digits=20,
        decimal_places=8,
        default="0.00000000",
    )
    total_received = models.DecimalField(
        max_digits=20,
        decimal_places=8,
        default="0.00000000",
    )

    # ── Transaction nonce ────────────────────────────────────────────────────
    nonce = models.PositiveIntegerField(
        default=0,
        help_text="Strictly incrementing counter — prevents transaction replay attacks.",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Wallet"
        verbose_name_plural = "Wallets"

    def __str__(self):
        return f"Wallet({self.owner.username})"

    def clean(self):
        if self.balance < 0:
            raise ValidationError("Wallet balance cannot be negative.")

class Organisation(models.Model):
    class VerificationStatus(models.TextChoices):
        PENDING = "pending", "Pending"
        VERIFIED = "verified", "Verified"
        REJECTED = "rejected", "Rejected"

    name         = models.CharField(max_length=128)
    wallet       = models.OneToOneField('Wallet', on_delete=models.CASCADE, related_name='org')
    slug         = models.SlugField(unique=True)
    reward_quota = models.DecimalField(max_digits=20, decimal_places=8, default='10000.00000000')
    quota_used   = models.DecimalField(max_digits=20, decimal_places=8, default='0.00000000')
    
    # Verification & Profile Details
    verification_status = models.CharField(max_length=20, choices=VerificationStatus.choices, default=VerificationStatus.PENDING)
    contact_person = models.CharField(max_length=128, blank=True)
    contact_number = models.CharField(max_length=20, blank=True)
    website = models.URLField(blank=True)
    address = models.TextField(blank=True)
    logo = models.ImageField(upload_to="org_logos/", blank=True, null=True)
    
    is_active    = models.BooleanField(default=True)
    created_at   = models.DateTimeField(auto_now_add=True)

    def quota_remaining(self):
        return self.reward_quota - self.quota_used

    # AFTER
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._original_verification_status = self.verification_status

    def __str__(self):
        return self.name