"""
Blockchain service layer — production-grade implementation.

Features
--------
- SHA-256 hash generation with deterministic payload encoding
- Per-block validation (hash integrity + PoW prefix)
- Previous-hash chain linking verification
- Full chain validation with detailed error reporting
- Atomic block creation with pre-flight chain integrity check
- Merkle root computation for transaction fingerprinting
- Proof-of-Work mining with configurable difficulty
- Structured logging throughout
- validate_chain() called automatically via post_save signal
  (blockchain/signals.py) — DB-level tampering is detected on next write
"""

import hashlib
import logging
import time
from decimal import Decimal
from typing import Optional

from django.db import transaction

from .models import Block

logger = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────

DIFFICULTY = 2          # number of leading zeros required in a valid block hash
GENESIS_TIMESTAMP = "2024-01-01 00:00:00"
GENESIS_PREVIOUS_HASH = "0" * 64


# ── Hash generation ───────────────────────────────────────────────────────────

def generate_hash(index: int, timestamp: str, merkle_root: str,
                  previous_hash: str, nonce: int) -> str:
    """
    Compute the hash for a block given its header fields.

    Delegates to Block.compute_hash() so that mining, validation, and
    the model all use the exact same algorithm (JSON-encoded double-SHA256).
    This ensures hashes produced during mining always match those checked
    during chain validation.

    Args:
        index:         Block height (0-based).
        timestamp:     ISO-format or Unix-epoch string used when the block
                       was mined.
        merkle_root:   64-hex Merkle root of this block's transactions.
        previous_hash: 64-hex hash of the immediately preceding block.
        nonce:         Proof-of-Work counter.

    Returns:
        64-character lowercase hex double-SHA-256 digest.
    """
    return Block.compute_hash(index, timestamp, merkle_root, previous_hash, nonce)


# ── Merkle tree ───────────────────────────────────────────────────────────────

def build_merkle_root(tx_hashes: list) -> str:
    """
    Compute the Merkle root of a list of transaction hashes.

    Gives each block a single cryptographic fingerprint of all its
    transactions.  An empty block gets a well-known sentinel digest
    rather than an empty string so the hash payload is never trivial.

    Args:
        tx_hashes: List of 64-hex transaction hash strings.

    Returns:
        64-character hex Merkle root.
    """
    if not tx_hashes:
        return hashlib.sha256(b"empty_block").hexdigest()

    layer = list(tx_hashes)
    while len(layer) > 1:
        if len(layer) % 2:
            layer.append(layer[-1])   # duplicate last leaf if the count is odd
        layer = [
            hashlib.sha256((layer[i] + layer[i + 1]).encode("utf-8")).hexdigest()
            for i in range(0, len(layer), 2)
        ]
    return layer[0]


# ── Proof of Work ─────────────────────────────────────────────────────────────

def mine_block_hash(index: int, timestamp: str, merkle_root: str,
                    previous_hash: str, difficulty: int) -> tuple[int, str]:
    """
    Iterate nonces until the block hash satisfies the difficulty target.

    The target is a hash whose hex representation starts with
    ``difficulty`` zero characters.

    Args:
        index:         Block height.
        timestamp:     Mining timestamp string.
        merkle_root:   64-hex Merkle root.
        previous_hash: 64-hex hash of the previous block.
        difficulty:    Number of leading zeros required.

    Returns:
        ``(nonce, block_hash)`` — the winning nonce and the hash it produced.
    """
    target = "0" * difficulty
    nonce = 0
    while True:
        candidate = generate_hash(index, timestamp, merkle_root,
                                  previous_hash, nonce)
        if candidate.startswith(target):
            logger.debug(
                "PoW solved for block #%d: nonce=%d hash=%s...",
                index, nonce, candidate[:16],
            )
            return nonce, candidate
        nonce += 1


# ── Per-block validation ──────────────────────────────────────────────────────

def validate_block_hash(block: Block) -> tuple[bool, str]:
    """
    Recompute the block's hash and confirm it matches the stored value.

    This catches any direct mutation of a block's header fields in the
    database regardless of how many blocks come after it.

    Args:
        block: A ``Block`` model instance.

    Returns:
        ``(True,  "Block hash is valid.")``       — hash is intact.
        ``(False, "<error description>")``         — tampering detected.
    """
    # Genesis block was mined with GENESIS_TIMESTAMP string ("2024-01-01 00:00:00").
    # All other blocks store a Unix float timestamp string from time.time().
    # We must use the same string here that was used during mining.
    if block.block_index == 0:
        ts = GENESIS_TIMESTAMP
    elif block.timestamp_raw:
        # Use the exact string that was used during mining (stored at block creation)
        ts = block.timestamp_raw
    else:
        # Fallback for blocks created before timestamp_raw was added
        ts = str(block.timestamp.timestamp())

    expected = generate_hash(
        block.block_index,
        ts,
        block.merkle_root,
        block.previous_hash,
        block.nonce,
    )
    if expected != block.hash:
        return False, (
            f"Block #{block.block_index} hash mismatch: "
            f"stored={block.hash[:16]}... computed={expected[:16]}..."
        )
    return True, "Block hash is valid."


def validate_block_proof_of_work(block: Block) -> tuple[bool, str]:
    """
    Verify that the stored hash satisfies the recorded difficulty target.

    Args:
        block: A ``Block`` model instance.

    Returns:
        ``(True,  "PoW is valid.")``          — hash meets difficulty.
        ``(False, "<error description>")``     — PoW requirement not met.
    """
    target = "0" * block.difficulty
    if not block.hash.startswith(target):
        return False, (
            f"Block #{block.block_index} does not meet difficulty={block.difficulty}: "
            f"hash={block.hash[:16]}..."
        )
    return True, "PoW is valid."


def validate_block(block: Block) -> tuple[bool, str]:
    """
    Full single-block validation: hash integrity + Proof-of-Work.

    Args:
        block: A ``Block`` model instance.

    Returns:
        ``(True,  "Block is valid.")``        — all checks passed.
        ``(False, "<error description>")``     — at least one check failed.
    """
    ok, msg = validate_block_hash(block)
    if not ok:
        return False, msg

    ok, msg = validate_block_proof_of_work(block)
    if not ok:
        return False, msg

    return True, "Block is valid."


# ── Previous-hash linking verification ───────────────────────────────────────

def verify_previous_hash_link(block: Block, expected_previous_hash: str) -> tuple[bool, str]:
    """
    Confirm that ``block.previous_hash`` equals the hash of the preceding block.

    This is the cryptographic glue that makes the chain tamper-evident:
    altering any block's content would require re-mining all subsequent
    blocks.

    Args:
        block:                  The block whose link is being checked.
        expected_previous_hash: The ``hash`` field of the block at index
                                ``block.block_index - 1``.

    Returns:
        ``(True,  "Previous hash link is valid.")`` — link is intact.
        ``(False, "<error description>")``           — link is broken.
    """
    if block.previous_hash != expected_previous_hash:
        return False, (
            f"Block #{block.block_index} has a broken chain link: "
            f"expected previous_hash={expected_previous_hash[:16]}... "
            f"but stored {block.previous_hash[:16]}..."
        )
    return True, "Previous hash link is valid."


# ── Full chain validation ─────────────────────────────────────────────────────

def validate_chain() -> tuple[bool, str]:
    """
    Walk every block in index order and verify the full chain.

    For each block the following checks are performed:
    1. The stored hash matches the recomputed hash (tamper detection).
    2. The stored hash meets the difficulty target (PoW integrity).
    3. ``previous_hash`` equals the ``hash`` of the preceding block
       (chain-linking integrity).

    The genesis block (index 0) is anchored to the sentinel
    ``GENESIS_PREVIOUS_HASH`` (64 zero characters).

    This function is called automatically after every ``Block.save()``
    via the post_save signal in ``blockchain/signals.py``, so any
    direct DB-level tampering is detected on the next write.

    Returns:
        ``(True,  "Chain is valid.")``        — all blocks are consistent.
        ``(False, "<error description>")``     — tamper or inconsistency found.
    """
    blocks = list(Block.objects.order_by("block_index"))

    if not blocks:
        return True, "Chain is valid."

    # Genesis block anchor
    if blocks[0].block_index != 0:
        return False, "Genesis block (index 0) is missing."

    prev_hash = GENESIS_PREVIOUS_HASH

    for block in blocks:
        # 1. Hash integrity (recompute and compare)
        ok, msg = validate_block_hash(block)
        if not ok:
            logger.warning("Chain validation failed at block #%d: %s",
                           block.block_index, msg)
            return False, msg

        # 2. Proof-of-Work integrity
        ok, msg = validate_block_proof_of_work(block)
        if not ok:
            logger.warning("Chain validation failed at block #%d: %s",
                           block.block_index, msg)
            return False, msg

        # 3. Chain-linking integrity (skip for genesis — it has no parent)
        if block.block_index > 0:
            ok, msg = verify_previous_hash_link(block, prev_hash)
            if not ok:
                logger.warning("Chain validation failed at block #%d: %s",
                               block.block_index, msg)
                return False, msg

        prev_hash = block.hash

    logger.debug("Chain validation passed (%d blocks).", len(blocks))
    return True, "Chain is valid."


# ── Chain access helpers ──────────────────────────────────────────────────────

def get_latest_block() -> Optional[Block]:
    """Return the block with the highest index, or None if the chain is empty."""
    return Block.objects.order_by("-block_index").first()


def chain_stats() -> dict:
    """
    Return summary statistics for the explorer API.

    Returns:
        Dictionary with chain_height, total_blocks, total_tx,
        pending_tx, and difficulty.
    """
    from transactions.models import Transaction   # local import to avoid circular deps

    total_blocks = Block.objects.count()
    latest = get_latest_block()
    total_tx = Transaction.objects.count()
    pending_tx = Transaction.objects.filter(
        status=Transaction.Status.PENDING
    ).count()

    return {
        "chain_height": latest.block_index if latest else 0,
        "total_blocks": total_blocks,
        "total_tx": total_tx,
        "pending_tx": pending_tx,
        "difficulty": DIFFICULTY,
    }


# ── Block creation ────────────────────────────────────────────────────────────

@transaction.atomic
def create_genesis_block() -> Block:
    """
    Create block #0 — the genesis block.

    Idempotent: if the genesis block already exists it is returned
    unchanged.  Uses a fixed timestamp and a well-known previous hash
    (64 zeros) so the genesis hash is deterministic across environments.

    Returns:
        The genesis ``Block`` instance.
    """
    if Block.objects.filter(block_index=0).exists():
        return Block.objects.get(block_index=0)

    merkle_root = hashlib.sha256(b"SIKKA_GENESIS").hexdigest()

    nonce, block_hash = mine_block_hash(
        index=0,
        timestamp=GENESIS_TIMESTAMP,
        merkle_root=merkle_root,
        previous_hash=GENESIS_PREVIOUS_HASH,
        difficulty=DIFFICULTY,
    )

    # Parse GENESIS_TIMESTAMP into a timezone-aware datetime so the DB
    # stores exactly the same timestamp string that was used during mining.
    # Without this, auto_now_add saves "now" and validation recomputes a
    # different hash — causing a permanent chain integrity failure.
    from datetime import datetime, timezone
    genesis_dt = datetime(2024, 1, 1, 0, 0, 0, tzinfo=timezone.utc)

    genesis = Block.objects.create(
        block_index=0,
        timestamp=genesis_dt,
        previous_hash=GENESIS_PREVIOUS_HASH,
        merkle_root=merkle_root,
        nonce=nonce,
        hash=block_hash,
        difficulty=DIFFICULTY,
        miner_address="SIKKA_GENESIS",
        reward=Decimal("0.00000000"),
        tx_count=0,
    )
    logger.info("Genesis block created: %s", genesis.hash)
    return genesis


@transaction.atomic
def add_block(tx_hashes: list, miner_address: str, reward: Decimal) -> Block:
    """
    Mine and append a new block to the chain.

    Steps
    -----
    1. Validate the existing chain — refuse to extend a broken chain.
    2. Retrieve the latest block to obtain the parent hash.
    3. Build the Merkle root from the supplied transaction hashes.
    4. Run Proof-of-Work to find a valid nonce and hash.
    5. Persist the new block and log the result.

    Args:
        tx_hashes:     List of 64-hex transaction hash strings to include.
        miner_address: Address of the node that mined this block.
        reward:        Block reward credited to the miner.

    Returns:
        The newly created and persisted ``Block`` instance.

    Raises:
        ValueError:  If the genesis block is missing.
        RuntimeError: If the current chain is already invalid (tamper detected).
    """
    # Guard: refuse to extend a broken chain
    is_valid, msg = validate_chain()
    if not is_valid:
        raise RuntimeError(
            f"Chain integrity failure — cannot add block: {msg}"
        )

    latest = get_latest_block()
    if latest is None:
        # Genesis block has not been created yet — create it automatically
        # so that the first claim_mining() call always succeeds without
        # requiring a manual management command.
        logger.info("Genesis block missing — auto-creating before adding block #1.")
        latest = create_genesis_block()

    index = latest.block_index + 1
    previous_hash = latest.hash
    merkle_root = build_merkle_root(tx_hashes)
    timestamp = str(time.time())

    nonce, block_hash = mine_block_hash(
        index=index,
        timestamp=timestamp,
        merkle_root=merkle_root,
        previous_hash=previous_hash,
        difficulty=DIFFICULTY,
    )

    # Convert Unix float string → timezone-aware datetime so the stored
    # timestamp matches exactly what was used during mining.
    from datetime import datetime, timezone as tz
    block_timestamp = datetime.fromtimestamp(float(timestamp), tz=tz.utc)

    block = Block.objects.create(
        block_index=index,
        timestamp=block_timestamp,
        timestamp_raw=timestamp,
        previous_hash=previous_hash,
        merkle_root=merkle_root,
        nonce=nonce,
        hash=block_hash,
        difficulty=DIFFICULTY,
        miner_address=miner_address,
        reward=reward,
        tx_count=len(tx_hashes),
    )

    logger.info(
        "Block #%d mined: %s... (nonce=%d, txns=%d)",
        index, block_hash[:16], nonce, len(tx_hashes),
    )
    return block