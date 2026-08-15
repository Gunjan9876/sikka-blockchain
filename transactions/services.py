"""
Transaction service layer.

Key improvements over the previous version:
  - Every TRANSFER transaction is signed with the sender's ECDSA private key.
  - Signature is verified before the transaction is accepted.
  - Audit log entries are written for every create / confirm event.
  - Transaction fees: sender pays MIN_FEE per transfer. Fee deducted from
    sender balance along with amount. Miner collects all fees when block is mined.
  - Replay attack prevention via nonce check on signature verification.
  - Amount normalized to 8 decimal places in canonical message.
"""

import time
from decimal import Decimal

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.exceptions import InvalidSignature

from django.db import transaction
from django.db.models import Max
from django.utils import timezone

from wallet.models import Wallet
from .models import Transaction


# ── Fee configuration ─────────────────────────────────────────────────────────

MIN_FEE = Decimal("0.00100000")   # 0.001 SKA


# ── ECDSA helpers ─────────────────────────────────────────────────────────────

def _sign_transaction(private_key_encrypted: str, message: str) -> str:
    from wallet.services import decrypt_private_key
    private_key_pem = decrypt_private_key(private_key_encrypted)
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

        # Replay attack check — nonce must be > last confirmed nonce for sender
        confirmed_max_nonce = Transaction.objects.filter(
            sender_address=tx.sender_address,
            status=Transaction.Status.CONFIRMED,
        ).aggregate(max_nonce=Max('nonce'))['max_nonce'] or 0

        if tx.nonce <= confirmed_max_nonce:
            return False

        return True

    except ValueError:
        # Malformed hex signature
        return False
    except InvalidSignature:
        return False
    except Exception:
        return False


def _canonical_tx_message(sender: str, receiver: str, amount, nonce: int) -> str:
    # Normalize to 8 decimal places — prevents float string mismatch
    return f"{sender}:{receiver}:{Decimal(str(amount)):.8f}:{nonce}"


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
    return MIN_FEE


def collect_fees_for_block(transactions) -> Decimal:
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
      5. Sign the canonical tx message with sender's private key (encrypted in DB).
      6. Create a PENDING transaction with fee stored on the record.
      7. Write audit log.

    Raises:
        ValueError: on any validation failure.
    """
    amount = Decimal(str(amount))

    if amount <= 0:
        raise ValueError("Amount must be greater than zero.")

    # AFTER
    sender_wallet = (
        Wallet.objects
        .select_for_update()
        .get(owner=sender_user)
    )

    if sender_wallet.wallet_status != Wallet.WalletStatus.ACTIVE:
        raise ValueError("Your wallet is suspended or closed and cannot send transactions.")

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

    sender_wallet.balance    -= total_debit
    sender_wallet.total_sent += amount
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



@transaction.atomic
def confirm_transactions(transactions, block) -> None:
    """
    Mark transactions CONFIRMED and link them to the mined block.
    - TRANSFER: verify ECDSA signature, then credit receiver.
    - COINBASE: no signature check needed; miner wallet already credited
                via wallet_deposit in claim_mining — just confirm + link.
    - REWARD: no signature check; student wallet already credited via
              deposit() in approve_reward — just confirm + link.
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

        # COINBASE and REWARD: balances already credited before this call.
        # Just confirm and link to block.
        tx.status       = Transaction.Status.CONFIRMED
        tx.block        = block
        tx.confirmed_at = now
        tx.save(update_fields=["status", "block", "confirmed_at"])

def get_all_pending_transactions():
    """
    Return ALL pending transactions (TRANSFER + COINBASE + REWARD)
    to be confirmed after a block is mined.
    """
    return list(
        Transaction.objects.filter(
            status=Transaction.Status.PENDING,
        ).order_by("-fee", "created_at")
    )


def get_pending_transactions():
    """
    Return pending transactions ordered by fee descending (highest fee first).
    Miners naturally prioritize high-fee transactions — matches whitepaper claim.
    COINBASE transactions are excluded here; they are created separately.
    """
    return list(
        Transaction.objects.filter(
            status=Transaction.Status.PENDING,
            tx_type=Transaction.TxType.TRANSFER,   # exclude coinbase from mempool
        ).order_by("-fee", "created_at")           # fee DESC, then FIFO for ties
    )

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


@transaction.atomic
def request_reward(org, recipient_address: str, amount, achievement_type: str, description: str = "") -> 'Reward':
    from decimal import Decimal
    from wallet.models import Wallet
    from .models import Reward

    amount = Decimal(str(amount))
    if amount <= 0:
        raise ValueError("Amount must be positive.")
    if org.quota_remaining() < amount:
        raise ValueError(f"Quota exceeded. Remaining: {org.quota_remaining()} SKA")

    try:
        recipient_wallet = Wallet.objects.get(wallet_address=recipient_address)
    except Wallet.DoesNotExist:
        raise ValueError(f"Recipient wallet not found: {recipient_address}")

    reward = Reward.objects.create(
        organisation=org,
        student_wallet=recipient_wallet,
        achievement_type=achievement_type,
        description=description,
        amount=amount,
        status=Reward.Status.PENDING,
    )

    from dashboard.models import Notification
    Notification.objects.create(
        recipient=org.wallet.owner,
        title="Reward Requested",
        message=f"A reward of {amount} SKA has been requested for {recipient_address}.",
        notification_type=Notification.NotificationType.REWARD_REQUEST,
        related_reward=reward
    )

    return reward

@transaction.atomic
def approve_reward(reward) -> 'Transaction':
    import hashlib, time
    from decimal import Decimal
    from wallet.services import deposit
    from .models import Transaction, Reward
    from wallet.models import Organisation

    if reward.status != Reward.Status.PENDING:
        raise ValueError("Reward is not pending.")

    # Lock the org row so concurrent approvals can't both pass the quota check
    org = Organisation.objects.select_for_update().get(pk=reward.organisation_id)
    if org.quota_remaining() < reward.amount:
        raise ValueError(f"Quota exceeded. Remaining: {org.quota_remaining()} SKA")
    # Credit the student (University uses quota, not wallet balance)
    deposit(reward.student_wallet, reward.amount)

    org.quota_used += reward.amount
    org.save(update_fields=["quota_used"])

    ts = str(time.time())
    tx_hash = hashlib.sha256(
        f"{org.wallet.wallet_address}{reward.student_wallet.wallet_address}{reward.amount}{ts}{reward.id}".encode()
    ).hexdigest()

    tx = Transaction.objects.create(
        tx_hash=tx_hash,
        tx_type=Transaction.TxType.REWARD,
        sender_address=org.wallet.wallet_address,
        receiver_address=reward.student_wallet.wallet_address,
        amount=reward.amount,
        fee=Decimal("0.00000000"),
        status=Transaction.Status.PENDING,
    )

    reward.status = Reward.Status.APPROVED
    reward.transaction = tx
    reward.save(update_fields=["status", "transaction", "updated_at"])

    from dashboard.models import Notification
    Notification.objects.create(
        recipient=org.wallet.owner,
        title="Reward Approved",
        message=f"Reward of {reward.amount} SKA for {reward.student_wallet.wallet_address} was approved.",
        notification_type=Notification.NotificationType.REWARD_APPROVED,
        related_reward=reward
    )
    
    # Check quota warning (e.g., if < 20% of 1,000,000 which is 200,000, or just an arbitrary low number like 1000)
    if org.quota_remaining() < Decimal("1000.00000000"):
        Notification.objects.create(
            recipient=org.wallet.owner,
            title="Quota Low Warning",
            message=f"Your remaining quota is low ({org.quota_remaining()} SKA). Please request an increase.",
            notification_type=Notification.NotificationType.QUOTA_WARNING
        )

    return tx

@transaction.atomic
def reject_reward(reward) -> 'Reward':
    from .models import Reward
    if reward.status != Reward.Status.PENDING:
        raise ValueError("Reward is not pending.")
    
    reward.status = Reward.Status.REJECTED
    reward.save(update_fields=["status", "updated_at"])

    from dashboard.models import Notification
    Notification.objects.create(
        recipient=reward.organisation.wallet.owner,
        title="Reward Rejected",
        message=f"Reward of {reward.amount} SKA for {reward.student_wallet.wallet_address} was rejected.",
        notification_type=Notification.NotificationType.REWARD_REJECTED,
        related_reward=reward
    )

    return reward