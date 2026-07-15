"""
Blockchain integrity signals.

Automatically validates the hash chain after every Block save.
Any direct database tampering (editing a block's hash, previous_hash,
or merkle_root in the DB) will be detected on the next block write
and logged as a critical error.

This is what makes the chain tamper-EVIDENT — not tamper-proof
(a single-server simulation can't prevent DB admin access), but any
tampering is immediately surfaced rather than silently corrupting the chain.
"""

import logging

from django.db.models.signals import post_save
from django.dispatch import receiver

from .models import Block

logger = logging.getLogger(__name__)


@receiver(post_save, sender=Block)
def check_chain_integrity(sender, instance, created, **kwargs):
    """
    After any Block is saved, validate the entire chain.

    - On a new block: confirms the new block was appended correctly.
    - On an update: detects if an existing block was tampered with.

    Logs a CRITICAL alert if the chain is broken — in production this
    would also trigger a PagerDuty / Slack alert.
    """
    from .services import validate_chain
    is_valid, message = validate_chain()

    if is_valid:
        logger.info(
            "Chain integrity OK after Block #%d save.", instance.block_index
        )
    else:
        logger.critical(
            "CHAIN INTEGRITY FAILURE after Block #%d save: %s",
            instance.block_index,
            message,
        )