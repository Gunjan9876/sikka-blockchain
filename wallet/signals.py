"""
Signals for the wallet app.

`create_user_wallet` fires after a new User is saved for the first time.
It delegates all wallet creation logic to the service layer — no business
logic lives here.
"""

import logging

from django.conf import settings
from django.db.models.signals import post_save
from django.dispatch import receiver

from .services import create_wallet

logger = logging.getLogger(__name__)


@receiver(post_save, sender=settings.AUTH_USER_MODEL)
def create_user_wallet(sender, instance, created, **kwargs):
    """
    Automatically create a blockchain wallet when a new user account is created.

    `created` is True only on INSERT, so updates to existing users are ignored.
    The hasattr guard prevents duplicate wallets (e.g. from fixtures or admin).
    All generation logic (address, key pair, status) lives in create_wallet().
    """
    if created and not hasattr(instance, "wallet"):
        try:
            create_wallet(owner=instance)
        except Exception as exc:
            logger.error(
                "Failed to create wallet for user '%s': %s",
                instance.username,
                exc,
            )