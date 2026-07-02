"""
Wallet service layer.

All balance mutations go through these two functions.
They are the ONLY place that modify wallet balances,
ensuring no business logic leaks into views or serializers.

Usage:
    from wallet.services import deposit, withdraw
"""

from decimal import Decimal, InvalidOperation

from django.db import transaction

from .models import Wallet


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


@transaction.atomic
def deposit(wallet: Wallet, amount, credit_mining: bool = False) -> Wallet:
    """
    Add `amount` to a wallet's balance.

    Args:
        wallet:        The Wallet instance to credit.
        amount:        Numeric amount to deposit (int, float, str, or Decimal).
        credit_mining: If True, also increments `total_mined`.
                       Pass this from the Mining module when issuing rewards.

    Returns:
        The refreshed Wallet instance (already saved).

    Raises:
        ValueError: If `amount` is not a valid positive number.
    """
    value = _parse_amount(amount)

    # Lock the wallet row for the duration of this transaction
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

    # Lock the wallet row for the duration of this transaction
    wallet = Wallet.objects.select_for_update().get(pk=wallet.pk)

    if wallet.balance < value:
        raise ValueError(
            f"Insufficient funds. Available: {wallet.balance}, requested: {value}."
        )

    wallet.balance -= value
    wallet.total_sent += value

    wallet.save(update_fields=["balance", "total_sent", "updated_at"])
    return wallet
