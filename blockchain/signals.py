import logging

from django.core.cache import cache
from django.db.models.signals import post_save
from django.dispatch import receiver

from .models import Block

logger = logging.getLogger(__name__)

CHAIN_VALID_CACHE_KEY = "blockchain:chain_valid"
CHAIN_VALID_CACHE_TTL = 30  # seconds


@receiver(post_save, sender=Block)
def check_chain_integrity(sender, instance, created, **kwargs):
    from .services import validate_chain
    is_valid, message = validate_chain()

    # Invalidate cache so next stats/validate request gets fresh result
    cache.delete(CHAIN_VALID_CACHE_KEY)

    if is_valid:
        logger.info("Chain integrity OK after Block #%d save.", instance.block_index)
    else:
        logger.critical(
            "CHAIN INTEGRITY FAILURE after Block #%d save: %s",
            instance.block_index,
            message,
        )