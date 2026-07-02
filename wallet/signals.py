"""
Signals for the wallet app.

`create_user_wallet` fires after a new User is saved for the first time.
It creates exactly one Wallet per user and is idempotent — if the wallet
already exists (e.g. due to admin or fixture), it is silently ignored.
"""

from django.conf import settings
from django.db.models.signals import post_save
from django.dispatch import receiver

from .models import Wallet


@receiver(post_save, sender=settings.AUTH_USER_MODEL)
def create_user_wallet(sender, instance, created, **kwargs):
    """
    Automatically create a wallet when a new user account is created.
    `created` is True only on INSERT, so updates to existing users are ignored.
    `get_or_create` adds a second layer of safety against duplicate wallets.
    """
    if created:
        Wallet.objects.get_or_create(owner=instance)
