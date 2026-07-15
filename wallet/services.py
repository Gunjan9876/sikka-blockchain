# """
# Wallet service layer.

# All balance mutations go through these two functions.
# They are the ONLY place that modify wallet balances,
# ensuring no business logic leaks into views or serializers.

# Usage:
#     from wallet.services import deposit, withdraw
# """

# from decimal import Decimal, InvalidOperation

# from django.db import transaction

# from .models import Wallet


# def _parse_amount(amount):
#     """
#     Convert `amount` to a Decimal and validate it is a finite positive number.
#     Raises ValueError with a human-readable message on any failure.
#     """
#     try:
#         value = Decimal(str(amount))
#     except (InvalidOperation, TypeError, ValueError):
#         raise ValueError(f"Invalid amount: '{amount}' is not a valid number.")

#     if value <= 0:
#         raise ValueError("Amount must be greater than zero.")

#     return value


# @transaction.atomic
# def deposit(wallet: Wallet, amount, credit_mining: bool = False) -> Wallet:
#     """
#     Add `amount` to a wallet's balance.

#     Args:
#         wallet:        The Wallet instance to credit.
#         amount:        Numeric amount to deposit (int, float, str, or Decimal).
#         credit_mining: If True, also increments `total_mined`.
#                        Pass this from the Mining module when issuing rewards.

#     Returns:
#         The refreshed Wallet instance (already saved).

#     Raises:
#         ValueError: If `amount` is not a valid positive number.
#     """
#     value = _parse_amount(amount)

#     # Lock the wallet row for the duration of this transaction
#     wallet = Wallet.objects.select_for_update().get(pk=wallet.pk)

#     wallet.balance += value
#     wallet.total_received += value

#     if credit_mining:
#         wallet.total_mined += value

#     wallet.save(update_fields=["balance", "total_mined", "total_received", "updated_at"])
#     return wallet


# @transaction.atomic
# def withdraw(wallet: Wallet, amount) -> Wallet:
#     """
#     Deduct `amount` from a wallet's balance.

#     Args:
#         wallet:  The Wallet instance to debit.
#         amount:  Numeric amount to withdraw (int, float, str, or Decimal).

#     Returns:
#         The refreshed Wallet instance (already saved).

#     Raises:
#         ValueError: If `amount` is not valid, or if it would cause a negative balance.
#     """
#     value = _parse_amount(amount)

#     # Lock the wallet row for the duration of this transaction
#     wallet = Wallet.objects.select_for_update().get(pk=wallet.pk)

#     if wallet.balance < value:
#         raise ValueError(
#             f"Insufficient funds. Available: {wallet.balance}, requested: {value}."
#         )

#     wallet.balance -= value
#     wallet.total_sent += value

#     wallet.save(update_fields=["balance", "total_sent", "updated_at"])
#     return wallet

"""
Wallet service layer.

All balance mutations go through these two functions.
They are the ONLY place that modify wallet balances,
ensuring no business logic leaks into views or serializers.

Usage:
    from wallet.services import deposit, withdraw, create_wallet
"""

import hashlib
import uuid
from decimal import Decimal, InvalidOperation
from typing import Tuple

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from django.db import transaction

from .models import Wallet


# ── Helpers ──────────────────────────────────────────────────────────────────

"""
Wallet service layer.

All balance mutations go through these two functions.
They are the ONLY place that modify wallet balances,
ensuring no business logic leaks into views or serializers.

Usage:
    from wallet.services import deposit, withdraw, create_wallet
"""

import hashlib
import uuid
from decimal import Decimal, InvalidOperation
from typing import Tuple

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from django.db import transaction

from .models import Wallet


# ── Helpers ──────────────────────────────────────────────────────────────────


def _parse_amount(amount):
    """
    Convert `amount` to a Decimal and validate it is a finite positive number.
    Raises ValueError with a human-readable message on any failure.
    """
    try:
        value = Decimal(str(amount))
    except (InvalidOperation, TypeError, ValueError):
        raise ValueError(f"Invalid amount: '{amount}' is not a valid number.")

    if value <= 0:
        raise ValueError("Amount must be greater than zero.")

    return value


# ── Blockchain identity helpers ───────────────────────────────────────────────


def generate_wallet_address() -> str:
    """
    Generate a unique blockchain-style wallet address for SIKKA.

    Algorithm:
        1. Generate a random UUID4.
        2. SHA-256 hash its bytes.
        3. Take the full hex digest (64 characters).
        4. Prepend the "SKA" platform prefix.

    Returns:
        str: A 67-character address in the form ``SKA<64-hex-chars>``.
             Example: ``SKA91a7b84c4e2f...``
    """
    raw = uuid.uuid4().bytes
    digest = hashlib.sha256(raw).hexdigest().upper()
    return f"SKA{digest}"


def generate_key_pair() -> Tuple[str, str]:
    """
    Generate an EC (secp256k1) key pair for a SIKKA wallet identity.

    ⚠️  EDUCATIONAL / DEMO USE ONLY:
        Production blockchain systems NEVER store the private key on the server.

    Returns:
        Tuple[str, str]: ``(public_key_pem, private_key_pem)`` — both as UTF-8 PEM strings.
    """
    private_key_obj = ec.generate_private_key(ec.SECP256K1())

    private_key_pem: str = private_key_obj.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode("utf-8")

    public_key_pem: str = private_key_obj.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode("utf-8")

    return public_key_pem, private_key_pem


# ── Wallet factory ────────────────────────────────────────────────────────────


@transaction.atomic
def create_wallet(owner) -> Wallet:
    """
    Create and persist a fully initialised Wallet for the given user.

    Generates a unique wallet address and an EC key pair, then stores them
    on the new Wallet record. All balance accumulators start at zero and
    the wallet is set to ACTIVE status.

    Args:
        owner: A Django user instance (``AUTH_USER_MODEL``).

    Returns:
        Wallet: The newly created and saved Wallet instance.
    """
    public_key_pem, private_key_pem = generate_key_pair()

    wallet = Wallet.objects.create(
        owner=owner,
        wallet_address=generate_wallet_address(),
        public_key=public_key_pem,
        private_key=private_key_pem,   # ⚠️  Demo only
        wallet_status=Wallet.WalletStatus.ACTIVE,
        balance=Decimal("0.00000000"),
        total_mined=Decimal("0.00000000"),
        total_sent=Decimal("0.00000000"),
        total_received=Decimal("0.00000000"),
    )
    return wallet


# ── Balance mutations ─────────────────────────────────────────────────────────


@transaction.atomic
def deposit(wallet: Wallet, amount, credit_mining: bool = False) -> Wallet:
    """
    Add `amount` to a wallet's balance.

    Args:
        wallet:        The Wallet instance to credit.
        amount:        Numeric amount to deposit (int, float, str, or Decimal).
        credit_mining: If True, also increments `total_mined`.

    Returns:
        The refreshed Wallet instance (already saved).

    Raises:
        ValueError: If `amount` is not a valid positive number.
    """
    value = _parse_amount(amount)

    wallet = Wallet.objects.select_for_update().get(pk=wallet.pk)

    wallet.balance += value
    wallet.total_received += value

    if credit_mining:
        wallet.total_mined += value

    wallet.save(update_fields=["balance", "total_mined", "total_received", "updated_at"])
    return wallet


@transaction.atomic
def withdraw(wallet: Wallet, amount) -> Wallet:
    """
    Deduct `amount` from a wallet's balance.

    Args:
        wallet:  The Wallet instance to debit.
        amount:  Numeric amount to withdraw (int, float, str, or Decimal).

    Returns:
        The refreshed Wallet instance (already saved).

    Raises:
        ValueError: If `amount` is not valid, or if it would cause a negative balance.
    """
    value = _parse_amount(amount)

    wallet = Wallet.objects.select_for_update().get(pk=wallet.pk)

    if wallet.balance < value:
        raise ValueError(
            f"Insufficient funds. Available: {wallet.balance}, requested: {value}."
        )

    wallet.balance -= value
    wallet.total_sent += value

    wallet.save(update_fields=["balance", "total_sent", "updated_at"])
    return wallet