"""
Signals for the wallet app.

`create_user_wallet` fires after a new User is saved for the first time.
It delegates all wallet creation logic to the service layer — no business
logic lives here.
"""

import logging
import threading

from django.conf import settings
from django.db.models.signals import post_save
from django.dispatch import receiver

from .services import create_wallet
from .models import Wallet
from django.db.models.signals import post_save
from django.dispatch import receiver

logger = logging.getLogger(__name__)


def _create_wallet_async(instance):
    """Run wallet creation in a background thread to avoid blocking the request."""
    try:
        create_wallet(owner=instance)
    except Exception as exc:
        logger.error(
            "Failed to create wallet for user '%s': %s",
            instance.username,
            exc,
        )


@receiver(post_save, sender=settings.AUTH_USER_MODEL)
def create_user_wallet(sender, instance, created, **kwargs):
    """
    Automatically create a blockchain wallet when a new user account is created.

    `created` is True only on INSERT, so updates to existing users are ignored.
    The hasattr guard prevents duplicate wallets (e.g. from fixtures or admin).
    All generation logic (address, key pair, status) lives in create_wallet().
    """
    if created and not Wallet.objects.filter(owner=instance).exists():
        t = threading.Thread(target=_create_wallet_async, args=(instance,), daemon=True)
        t.start()


@receiver(post_save, sender='wallet.Organisation')
def notify_verification_status_change(sender, instance, created, **kwargs):
    if created:
        return
    if instance.verification_status == instance._original_verification_status:
        return

    from dashboard.models import Notification
    status_map = {
        instance.VerificationStatus.VERIFIED: "Verified",
        instance.VerificationStatus.REJECTED: "Rejected",
        instance.VerificationStatus.PENDING:  "Pending",
    }
    status_text = status_map.get(instance.verification_status, instance.verification_status)
    Notification.objects.create(
        recipient=instance.wallet.owner,
        title="Verification Status Updated",
        message=f"Your university verification status is now {status_text}.",
        notification_type=Notification.NotificationType.ORG_VERIFICATION,
    )
    instance._original_verification_status = instance.verification_status