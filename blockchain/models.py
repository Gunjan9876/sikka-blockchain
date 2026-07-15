"""
Block model for the SIKKA blockchain.

Each block contains a cryptographic hash of the previous block,
creating a tamper-evident chain. Changing any historical record
would invalidate every subsequent block's hash.

Hash algorithm: SHA-256(SHA-256(payload)) — identical to Bitcoin's
double-SHA256, producing a 64-character lowercase hex digest.

Field naming follows Bitcoin terminology where possible:
  block_number  → alias for block_index  (Bitcoin: block height)
  current_hash  → alias for hash         (Bitcoin: block hash)
  mined_by      → alias for miner_address
"""

import hashlib
import json

from django.db import models
from django.utils import timezone


class Block(models.Model):

    # ── Core chain fields ─────────────────────────────────────────────────────

    block_index   = models.PositiveIntegerField(
        unique=True,
        db_index=True,
        help_text="Block height in the chain. Genesis block is 0.",
    )
    timestamp = models.DateTimeField(
        default=timezone.now,
        help_text="UTC timestamp when this block was accepted into the chain.",
    )
    timestamp_raw = models.CharField(
        max_length=32,
        blank=True,
        default="",
        help_text="Original timestamp string used during mining (str(time.time()) for non-genesis blocks). "
                  "Preserved to allow exact hash recomputation during chain validation.",
    )
    

    # ── Hash chain ────────────────────────────────────────────────────────────

    previous_hash = models.CharField(
        max_length=64,
        help_text="Double-SHA256 hash of the previous block header. "
                  "All zeros for the genesis block.",
    )
    hash          = models.CharField(
        max_length=64,
        unique=True,
        db_index=True,
        help_text="Double-SHA256 hash of this block's header fields "
                  "(index + timestamp + merkle_root + previous_hash + nonce).",
    )

    # ── Proof of Work ─────────────────────────────────────────────────────────

    nonce         = models.BigIntegerField(
        default=0,
        help_text="The value iterated during mining until the hash "
                  "satisfies the difficulty target.",
    )
    difficulty    = models.PositiveIntegerField(
        default=2,
        help_text="Number of leading zero hex chars required in a valid hash. "
                  "Bitcoin adjusts this every 2,016 blocks.",
    )

    # ── Transactions ──────────────────────────────────────────────────────────

    merkle_root   = models.CharField(
        max_length=64,
        help_text="Root of the Merkle tree built from all transaction hashes "
                  "in this block. Allows efficient tx membership proofs.",
    )
    tx_count      = models.PositiveIntegerField(
        default=0,
        help_text="Number of transactions included in this block.",
    )

    # ── Miner / Reward ────────────────────────────────────────────────────────

    miner_address = models.CharField(
        max_length=67,
        blank=True,
        default="",
        help_text="SIKKA wallet address of the miner who solved the PoW puzzle.",
    )
    reward        = models.DecimalField(
        max_digits=20,
        decimal_places=8,
        default="0.00000000",
        help_text="SKA tokens awarded to the miner via the coinbase transaction.",
    )

    # ── Metadata ──────────────────────────────────────────────────────────────

    created_at    = models.DateTimeField(
        auto_now_add=True,
        help_text="Database insertion timestamp (differs from block timestamp "
                  "only if the block was imported rather than mined locally).",
    )

    class Meta:
        ordering = ["-block_index"]

    def __str__(self):
        return f"Block #{self.block_index} ({self.hash[:16]}…)"

    # ── Bitcoin-style property aliases ────────────────────────────────────────
    # These let you use Bitcoin terminology in code (block.block_number,
    # block.current_hash, block.mined_by) without adding any DB columns
    # or requiring a migration.

    @property
    def block_number(self) -> int:
        """
        Bitcoin terminology for block height.
        Alias for block_index. Genesis block = 0.
        """
        return self.block_index

    @property
    def current_hash(self) -> str:
        """
        The hash of this block's header.
        Alias for `hash` — 'current_hash' matches Bitcoin documentation
        terminology more closely.
        """
        return self.hash

    @property
    def mined_by(self) -> str:
        """
        Address of the miner who solved the PoW puzzle.
        Alias for miner_address.
        """
        return self.miner_address

    @property
    def is_genesis(self) -> bool:
        """True if this is the genesis block (block_index == 0)."""
        return self.block_index == 0

    @property
    def target(self) -> str:
        """
        The difficulty target string — a hash must start with this many zeros.
        Example: difficulty=2 → target='00'.
        Mirrors Bitcoin's compact target representation conceptually.
        """
        return "0" * self.difficulty

    # ── Hash computation ──────────────────────────────────────────────────────

    @staticmethod
    def compute_hash(index, timestamp, merkle_root, previous_hash, nonce) -> str:
        """
        Compute the double-SHA256 block hash — identical to Bitcoin's algorithm.

        Bitcoin's block hash is:
            SHA256(SHA256(block_header_bytes))

        Here we serialise the header fields to a canonical JSON string
        (sorted keys, no whitespace) before hashing, which gives a
        deterministic result regardless of Python version or platform.

        Args:
            index:         Block height (int).
            timestamp:     String representation of the block timestamp.
            merkle_root:   64-char hex Merkle root of included transactions.
            previous_hash: 64-char hex hash of the preceding block.
            nonce:         Integer nonce found during PoW mining.

        Returns:
            64-character lowercase hex digest (double-SHA256).
        """
        header = json.dumps(
            {
                "index":         index,
                "timestamp":     str(timestamp),
                "merkle_root":   merkle_root,
                "previous_hash": previous_hash,
                "nonce":         nonce,
            },
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")

        first_pass  = hashlib.sha256(header).digest()          # raw bytes
        second_pass = hashlib.sha256(first_pass).hexdigest()   # hex string
        return second_pass

    @staticmethod
    def verify_hash(block) -> bool:
        """
        Recompute the block's hash and confirm it matches what is stored.

        Used by validate_chain() to detect any tampering with stored records.

        Args:
            block: A Block instance.

        Returns:
            True if the stored hash matches the recomputed hash AND
            the hash satisfies the difficulty target.
        """
        recomputed = Block.compute_hash(
            block.block_index,
            block.timestamp,
            block.merkle_root,
            block.previous_hash,
            block.nonce,
        )
        target = "0" * block.difficulty
        return recomputed == block.hash and block.hash.startswith(target)