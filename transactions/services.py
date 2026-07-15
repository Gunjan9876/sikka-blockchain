"""
Transaction service layer.

Key improvements over the previous version:
  - Every TRANSFER transaction is signed with the sender's ECDSA private key.
  - Signature is verified before the transaction is accepted.
  - Audit log entries are written for every create / confirm event.
  - Transaction fees: sender pays MIN_FEE per transfer. Fee deducted from
    sender balance along with amount. Miner collects all fees when block is mined.
"""

import time
from decimal import Decimal

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.exceptions import InvalidSignature

from django.db import transaction
from django.utils import timezone

from wallet.models import Wallet
from .models import Transaction


# ── Fee configuration ─────────────────────────────────────────────────────────

# Minimum transaction fee in SKA (paid to the miner who mines the block)
MIN_FEE = Decimal("0.00100000")   # 0.001 SKA — matches SIKKA report spec


# ── ECDSA helpers ─────────────────────────────────────────────────────────────

def _sign_transaction(private_key_pem: str, message: str) -> str:
    private_key = serialization.load_pem_private_key(
        private_key_pem.encode(), password=None
    )
    signature_bytes = private_key.sign(message.encode(), ec.ECDSA(hashes.SHA256()))
    return signature_bytes.hex()


def verify_transaction_signature(tx: Transaction) -> bool:
    if tx.tx_type == Transaction.TxType.COINBASE:
        return True

    if not tx.signature:
        return False

    try:
        wallet = Wallet.objects.get(wallet_address=tx.sender_address)
    except Wallet.DoesNotExist:
        return False

    if not wallet.public_key:
        return False

    try:
        public_key = serialization.load_pem_public_key(wallet.public_key.encode())
        message = _canonical_tx_message(
            tx.sender_address, tx.receiver_address, tx.amount, tx.nonce
        )
        public_key.verify(
            bytes.fromhex(tx.signature),
            message.encode(),
            ec.ECDSA(hashes.SHA256()),
        )
        return True
    except (InvalidSignature, ValueError, Exception):
        return False


def _canonical_tx_message(sender: str, receiver: str, amount, nonce: int) -> str:
    return f"{sender}:{receiver}:{amount}:{nonce}"


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_wallet_by_address(address: str) -> Wallet:
    try:
        return Wallet.objects.get(wallet_address=address)
    except Wallet.DoesNotExist:
        raise ValueError(f"No wallet found with address {address}.")


def _write_audit(action: str, user=None, entity_type: str = "", entity_id: str = "",
                 details: dict = None, ip: str = None):
    try:
        from core.models import AuditLog
        AuditLog.objects.create(
            user=user,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            details=details or {},
            ip_address=ip,
        )
    except Exception:
        pass


# ── Fee helpers ───────────────────────────────────────────────────────────────

def calculate_fee(amount: Decimal) -> Decimal:
    """
    Calculate the transaction fee for a given amount.
    Currently a flat minimum fee (0.001 SKA), matching the SIKKA whitepaper spec.
    Can be made dynamic in future (e.g. % of amount with a floor).
    """
    return MIN_FEE


def collect_fees_for_block(transactions) -> Decimal:
    """
    Sum up all TRANSFER fees from a list of pending transactions.
    Called by mining/services.py to add fees to the miner's coinbase reward.
    """
    total = Decimal("0.00000000")
    for tx in transactions:
        if tx.tx_type == Transaction.TxType.TRANSFER:
            total += tx.fee
    return total


# ── User-to-user transfer ─────────────────────────────────────────────────────

@transaction.atomic
def create_transaction(sender_user, receiver_address: str, amount,
                       ip_address: str = None) -> Transaction:
    """
    Transfer SKA tokens from sender to receiver with ECDSA signature.

    Flow:
      1. Validate amount and addresses.
      2. Calculate fee (flat MIN_FEE = 0.001 SKA).
      3. Check sender has enough balance for amount + fee.
      4. Debit sender immediately (amount + fee together).
      5. Sign the canonical tx message with sender's private key.
      6. Create a PENDING transaction with fee stored on the record.
      7. Write audit log.

    The receiver is credited (amount only) when a miner mines the block.
    The fee goes to the miner at that point via collect_fees_for_block().

    Raises:
        ValueError: on any validation failure.
    """
    amount = Decimal(str(amount))

    if amount <= 0:
        raise ValueError("Amount must be greater than zero.")

    sender_wallet = (
        Wallet.objects
        .select_for_update()
        .get(owner=sender_user)
    )

    if sender_wallet.wallet_address == receiver_address:
        raise ValueError("Cannot send SKA to your own wallet.")

    _get_wallet_by_address(receiver_address)  # validate receiver exists

    fee = calculate_fee(amount)
    total_debit = amount + fee

    if sender_wallet.balance < total_debit:
        raise ValueError(
            f"Insufficient funds. Available: {sender_wallet.balance} SKA, "
            f"required: {total_debit} SKA (amount {amount} + fee {fee})."
        )

    nonce = sender_wallet.nonce + 1
    timestamp = str(time.time())

    tx_hash = Transaction.compute_hash(
        sender_wallet.wallet_address,
        receiver_address,
        amount,
        nonce,
        timestamp,
    )

    canonical = _canonical_tx_message(
        sender_wallet.wallet_address, receiver_address, amount, nonce
    )
    signature = _sign_transaction(sender_wallet.private_key, canonical)

    # Debit sender: amount + fee together
    sender_wallet.balance    -= total_debit
    sender_wallet.total_sent += amount      # total_sent tracks transfer amount only
    sender_wallet.nonce       = nonce
    sender_wallet.save(update_fields=["balance", "total_sent", "nonce", "updated_at"])

    tx = Transaction.objects.create(
        tx_hash=tx_hash,
        tx_type=Transaction.TxType.TRANSFER,
        sender_address=sender_wallet.wallet_address,
        receiver_address=receiver_address,
        amount=amount,
        fee=fee,
        nonce=nonce,
        signature=signature,
        status=Transaction.Status.PENDING,
    )

    _write_audit(
        action="tx_created",
        user=sender_user,
        entity_type="Transaction",
        entity_id=tx.tx_hash,
        details={"amount": str(amount), "fee": str(fee), "receiver": receiver_address},
        ip=ip_address,
    )

    return tx


# ── Coinbase + block confirmation ─────────────────────────────────────────────

def create_coinbase_transaction(miner_address: str, reward) -> Transaction:
    """
    Create a coinbase (mining reward) transaction.
    reward already includes collected tx fees (added in claim_mining).
    """
    nonce = Transaction.objects.filter(
        receiver_address=miner_address,
        tx_type=Transaction.TxType.COINBASE,
    ).count()

    tx_hash = Transaction.compute_hash(
        sender="COINBASE",
        receiver=miner_address,
        amount=str(reward),
        nonce=nonce,
        timestamp=str(time.time()),
    )

    return Transaction.objects.create(
        tx_hash=tx_hash,
        tx_type=Transaction.TxType.COINBASE,
        sender_address="",
        receiver_address=miner_address,
        amount=reward,
        fee=Decimal("0.00000000"),
        nonce=nonce,
        signature="",
        status=Transaction.Status.PENDING,
    )


def confirm_transactions(transactions, block) -> None:
    """
    Mark transactions CONFIRMED and link them to the mined block.
    For TRANSFER: verify ECDSA signature, then credit receiver (amount only).
    Fees are already collected by the miner via coinbase — not re-credited here.
    """
    now = timezone.now()
    for tx in transactions:
        if tx.tx_type == Transaction.TxType.TRANSFER:
            if not verify_transaction_signature(tx):
                tx.status = Transaction.Status.FAILED
                tx.block = block
                tx.confirmed_at = now
                tx.save(update_fields=["status", "block", "confirmed_at"])
                continue

            try:
                receiver_wallet = Wallet.objects.select_for_update().get(
                    wallet_address=tx.receiver_address
                )
                receiver_wallet.balance        += tx.amount
                receiver_wallet.total_received += tx.amount
                receiver_wallet.save(update_fields=["balance", "total_received", "updated_at"])
            except Wallet.DoesNotExist:
                pass

        tx.status       = Transaction.Status.CONFIRMED
        tx.block        = block
        tx.confirmed_at = now
        tx.save(update_fields=["status", "block", "confirmed_at"])


def get_pending_tx_hashes() -> list:
    return list(
        Transaction.objects.filter(
            status=Transaction.Status.PENDING
        ).values_list("tx_hash", flat=True)
    )


def get_pending_transactions():
    return list(Transaction.objects.filter(status=Transaction.Status.PENDING))


# ── Queries ───────────────────────────────────────────────────────────────────

def get_transaction(tx_hash: str) -> Transaction:
    try:
        return Transaction.objects.get(tx_hash=tx_hash)
    except Transaction.DoesNotExist:
        raise ValueError(f"Transaction {tx_hash} not found.")


def get_user_transactions(user) -> list:
    from django.db.models import Q
    wallet = Wallet.objects.get(owner=user)
    address = wallet.wallet_address
    return list(
        Transaction.objects.filter(
            Q(sender_address=address) | Q(receiver_address=address)
        ).order_by("-created_at")
    )