from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models


class Wallet(models.Model):
    """
    One wallet per user, created automatically on registration via signal.
    All monetary values are stored as Decimal with 8 decimal places.
    """

    owner = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="wallet",
    )

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
