from decimal import Decimal, InvalidOperation

from rest_framework import status
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from django.db.models import Q
from wallet.models import Wallet

from .services import create_transaction, get_transaction, get_user_transactions, MIN_FEE


def _get_client_ip(request):
    x_forwarded = request.META.get("HTTP_X_FORWARDED_FOR")
    if x_forwarded:
        return x_forwarded.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR")


def _paginate(queryset, request, default_page_size=20):
    try:
        page = max(1, int(request.query_params.get("page", 1)))
    except (ValueError, TypeError):
        page = 1

    try:
        page_size = min(100, max(1, int(request.query_params.get("page_size", default_page_size))))
    except (ValueError, TypeError):
        page_size = default_page_size

    total = queryset.count()
    start = (page - 1) * page_size
    end   = start + page_size
    items = list(queryset[start:end])

    return items, {
        "page":        page,
        "page_size":   page_size,
        "total":       total,
        "total_pages": max(1, (total + page_size - 1) // page_size),
        "has_next":    end < total,
        "has_prev":    page > 1,
    }


class SendTransactionView(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes     = [IsAuthenticated]

    def post(self, request):
        receiver_address = request.data.get("receiver_address", "").strip()
        amount_raw       = request.data.get("amount")

        # ── Input validation ──────────────────────────────────────────────────
        if not receiver_address:
            return Response({"error": "receiver_address is required."}, status=400)

        if len(receiver_address) > 128:
            return Response({"error": "Invalid receiver address."}, status=400)

        if amount_raw is None:
            return Response({"error": "amount is required."}, status=400)

        try:
            amount = Decimal(str(amount_raw))
        except (InvalidOperation, ValueError):
            return Response({"error": "Invalid amount format."}, status=400)

        if amount <= 0:
            return Response({"error": "Amount must be greater than zero."}, status=400)

        if amount > Decimal("1000000"):
            return Response({"error": "Amount exceeds maximum transfer limit (1,000,000 SKA)."}, status=400)

        if amount != round(amount, 8):
            return Response({"error": "Amount cannot have more than 8 decimal places."}, status=400)

        try:
            tx = create_transaction(
                request.user,
                receiver_address,
                amount,
                ip_address=_get_client_ip(request),
            )
        except ValueError as e:
            return Response({"error": str(e)}, status=400)

        return Response({
            "message":        "Transaction submitted.",
            "tx_hash":        tx.tx_hash,
            "amount":         str(tx.amount),
            "fee":            str(tx.fee),
            "total_deducted": str(tx.amount + tx.fee),
            "status":         tx.status,
        }, status=201)


class FeeEstimateView(APIView):
    """
    GET /api/v1/transactions/fee-estimate/?amount=10
    Returns the fee that will be charged for a given transfer amount.
    Frontend can show this to the user before they confirm.
    """
    authentication_classes = [JWTAuthentication]
    permission_classes     = [IsAuthenticated]

    def get(self, request):
        from .services import calculate_fee
        amount_str = request.query_params.get("amount", "0")
        try:
            amount = Decimal(str(amount_str))
            fee    = calculate_fee(amount)
        except Exception:
            fee = MIN_FEE

        return Response({
            "fee":     str(fee),
            "min_fee": str(MIN_FEE),
            "note":    "Fee is deducted from sender in addition to the transfer amount.",
        })


class TransactionDetailView(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes     = [IsAuthenticated]

    def get(self, request, tx_hash):
        try:
            tx = get_transaction(tx_hash)
        except ValueError as e:
            return Response({"error": str(e)}, status=404)

        return Response({
            "tx_hash":          tx.tx_hash,
            "sender_address":   tx.sender_address,
            "receiver_address": tx.receiver_address,
            "amount":           str(tx.amount),
            "fee":              str(tx.fee),
            "status":           tx.status,
            "created_at":       tx.created_at,
            "confirmed_at":     tx.confirmed_at,
        })


class TransactionListView(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes     = [IsAuthenticated]

    def get(self, request):
        from transactions.models import Transaction
        try:
            user_wallet = Wallet.objects.get(owner=request.user)
            user_address = user_wallet.wallet_address
        except Wallet.DoesNotExist:
            return Response({"error": "User does not have a wallet."}, status=404)
        qs = Transaction.objects.select_related("block").filter(
        Q(sender_address=user_address) | Q(receiver_address=user_address)
        ).order_by("-created_at")
        # Optional extra filter: ?wallet=<address> (only if it matches the user's own wallet)
        wallet_addr = request.query_params.get("wallet", "").strip()
        if wallet_addr and wallet_addr != user_address:
            return Response({"error": "You can only view your own transactions."}, status=403)
        txs, meta = _paginate(qs, request, default_page_size=20)

        data = [{
            "tx_hash":          tx.tx_hash,
            "tx_type":          tx.tx_type,
            "sender_address":   tx.sender_address,
            "receiver_address": tx.receiver_address,
            "amount":           str(tx.amount),
            "fee":              str(tx.fee),
            "status":           tx.status,
            "block_index":      tx.block.block_index if tx.block else None,
            "created_at":       tx.created_at.isoformat(),
            "confirmed_at":     tx.confirmed_at.isoformat() if tx.confirmed_at else None,
        } for tx in txs]

        return Response({"transactions": data, **meta})