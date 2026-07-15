from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework.authentication import TokenAuthentication
from rest_framework.permissions import IsAuthenticated

from .models import Block
from .services import validate_chain
from transactions.models import Transaction


def _paginate(queryset, request, default_page_size=20):
    """
    Simple page-based pagination helper.

    Query params:
        ?page=1          (1-indexed, default 1)
        ?page_size=20    (default 20, max 100)

    Returns:
        (page_items, meta_dict)
    """
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
        "page":       page,
        "page_size":  page_size,
        "total":      total,
        "total_pages": max(1, (total + page_size - 1) // page_size),
        "has_next":   end < total,
        "has_prev":   page > 1,
    }


class BlockListView(APIView):
    authentication_classes = [TokenAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request):
        qs = Block.objects.order_by("-block_index")
        blocks, meta = _paginate(qs, request, default_page_size=20)

        data = [
            {
                "block_index":   b.block_index,
                "hash":          b.hash,
                "previous_hash": b.previous_hash,
                "merkle_root":   b.merkle_root,
                "nonce":         b.nonce,
                "difficulty":    b.difficulty,
                "miner_address": b.miner_address,
                "reward":        str(b.reward),
                "tx_count":      b.tx_count,
                "timestamp":     b.timestamp.isoformat(),
            }
            for b in blocks
        ]
        return Response({"blocks": data, **meta})


class BlockDetailView(APIView):
    authentication_classes = [TokenAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request, block_index):
        try:
            b = Block.objects.get(block_index=block_index)
        except Block.DoesNotExist:
            return Response({"error": f"Block #{block_index} not found."}, status=404)

        return Response({
            "block_index":   b.block_index,
            "hash":          b.hash,
            "previous_hash": b.previous_hash,
            "merkle_root":   b.merkle_root,
            "nonce":         b.nonce,
            "difficulty":    b.difficulty,
            "miner_address": b.miner_address,
            "reward":        str(b.reward),
            "tx_count":      b.tx_count,
            "timestamp":     b.timestamp.isoformat(),
            "created_at":    b.created_at.isoformat(),
        })


class ChainValidateView(APIView):
    authentication_classes = [TokenAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request):
        is_valid, message = validate_chain()
        total = Block.objects.count()
        return Response(
            {"valid": is_valid, "message": message, "total_blocks": total},
            status=status.HTTP_200_OK if is_valid else status.HTTP_409_CONFLICT,
        )


class ChainStatsView(APIView):
    authentication_classes = [TokenAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request):
        total_blocks = Block.objects.count()
        latest       = Block.objects.order_by("-block_index").first()

        total_tx     = Transaction.objects.count()
        pending_tx   = Transaction.objects.filter(status=Transaction.Status.PENDING).count()
        confirmed_tx = Transaction.objects.filter(status=Transaction.Status.CONFIRMED).count()

        difficulty   = latest.difficulty  if latest else 2
        latest_hash  = latest.hash        if latest else None
        chain_height = latest.block_index if latest else 0

        is_valid, _ = validate_chain()

        return Response({
            "chain_height":  chain_height,
            "total_blocks":  total_blocks,
            "total_tx":      total_tx,
            "pending_tx":    pending_tx,
            "confirmed_tx":  confirmed_tx,
            "difficulty":    difficulty,
            "latest_hash":   latest_hash,
            "chain_valid":   is_valid,
        })