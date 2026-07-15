from rest_framework import status
from rest_framework.authentication import TokenAuthentication
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.throttles import MiningRateThrottle
from . import services
from .models import MiningPool
from .serializers import MiningSessionSerializer


def _get_client_ip(request):
    x_forwarded = request.META.get("HTTP_X_FORWARDED_FOR")
    if x_forwarded:
        return x_forwarded.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR")


def _write_audit(action, user=None, details=None, ip=None):
    try:
        from core.models import AuditLog
        AuditLog.objects.create(
            user=user, action=action, entity_type="MiningSession",
            entity_id=str(user.pk) if user else "",
            details=details or {}, ip_address=ip,
        )
    except Exception:
        pass


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
        "page": page, "page_size": page_size, "total": total,
        "total_pages": max(1, (total + page_size - 1) // page_size),
        "has_next": end < total, "has_prev": page > 1,
    }


# ── Mining Core ───────────────────────────────────────────────────────────────

class StartMiningView(APIView):
    authentication_classes = [TokenAuthentication]
    permission_classes     = [IsAuthenticated]
    throttle_classes       = [MiningRateThrottle]

    def post(self, request):
        try:
            session    = services.start_mining(request.user)
            serializer = MiningSessionSerializer(session)
            _write_audit("mining_start", user=request.user,
                         details={"session_id": session.pk, "hash_rate": session.hash_rate_snapshot},
                         ip=_get_client_ip(request))
            return Response(
                {"message": "Mining started.", "data": serializer.data},
                status=status.HTTP_201_CREATED,
            )
        except ValueError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)


class ClaimMiningView(APIView):
    authentication_classes = [TokenAuthentication]
    permission_classes     = [IsAuthenticated]
    throttle_classes       = [MiningRateThrottle]

    def post(self, request):
        try:
            session    = services.claim_mining(request.user)
            serializer = MiningSessionSerializer(session)
            _write_audit("mining_claim", user=request.user,
                         details={"reward": str(session.reward)},
                         ip=_get_client_ip(request))
            return Response(
                {"message": "Mining reward claimed.", "reward": str(session.reward), "data": serializer.data},
                status=status.HTTP_200_OK,
            )
        except ValueError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)


class MiningStatusView(APIView):
    authentication_classes = [TokenAuthentication]
    permission_classes     = [IsAuthenticated]

    def get(self, request):
        return Response(services.get_status(request.user), status=status.HTTP_200_OK)


class MiningHistoryView(APIView):
    authentication_classes = [TokenAuthentication]
    permission_classes     = [IsAuthenticated]

    def get(self, request):
        from .models import MiningSession
        qs = MiningSession.objects.filter(user=request.user).order_by("-started_at")
        sessions, meta = _paginate(qs, request, default_page_size=20)

        data = [{
            "status":           s.status,
            "reward":           str(s.reward),
            "reward_rate":      str(s.reward_rate),
            "hash_rate":        s.hash_rate_snapshot,
            "rig_tier":         s.rig.tier if s.rig else "BASIC",
            "pool":             s.pool.name if s.pool else None,
            "started_at":       s.started_at.isoformat(),
            "claimed_at":       s.claimed_at.isoformat() if s.claimed_at else None,
        } for s in sessions]

        return Response({"sessions": data, **meta})


# ── Hardware Upgrade ──────────────────────────────────────────────────────────

class RigInfoView(APIView):
    """GET — current rig details + upgrade cost"""
    authentication_classes = [TokenAuthentication]
    permission_classes     = [IsAuthenticated]

    def get(self, request):
        return Response(services.get_rig_info(request.user))


class RigUpgradeView(APIView):
    """POST — upgrade rig to next tier (costs SKA)"""
    authentication_classes = [TokenAuthentication]
    permission_classes     = [IsAuthenticated]

    def post(self, request):
        try:
            rig = services.upgrade_rig(request.user)
            _write_audit("rig_upgrade", user=request.user,
                         details={"new_tier": rig.tier, "hash_rate": rig.hash_rate},
                         ip=_get_client_ip(request))
            return Response({
                "message":    f"Rig upgraded to {rig.get_tier_display()}!",
                "tier":       rig.tier,
                "tier_label": rig.get_tier_display(),
                "hash_rate":  rig.hash_rate,
                "multiplier": str(rig.multiplier),
            })
        except ValueError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)


# ── Pool ──────────────────────────────────────────────────────────────────────

class PoolListView(APIView):
    """GET — list all active pools"""
    authentication_classes = [TokenAuthentication]
    permission_classes     = [IsAuthenticated]

    def get(self, request):
        pools = MiningPool.objects.filter(is_active=True)
        data  = [{
            "id":              p.id,
            "name":            p.name,
            "description":     p.description,
            "pool_fee_pct":    str(p.pool_fee_pct),
            "member_count":    p.member_count,
            "total_hash_rate": p.total_hash_rate,
        } for p in pools]
        return Response({"pools": data})


class PoolJoinView(APIView):
    """POST — join a pool {pool_id}"""
    authentication_classes = [TokenAuthentication]
    permission_classes     = [IsAuthenticated]

    def post(self, request):
        pool_id = request.data.get("pool_id")
        if not pool_id:
            return Response({"error": "pool_id is required."}, status=400)
        try:
            membership = services.join_pool(request.user, int(pool_id))
            return Response({
                "message":   f"Joined pool '{membership.pool.name}'.",
                "pool_name": membership.pool.name,
                "pool_fee":  str(membership.pool.pool_fee_pct),
            })
        except (ValueError, MiningPool.DoesNotExist) as exc:
            return Response({"error": str(exc)}, status=400)


class PoolLeaveView(APIView):
    """POST — leave current pool"""
    authentication_classes = [TokenAuthentication]
    permission_classes     = [IsAuthenticated]

    def post(self, request):
        try:
            services.leave_pool(request.user)
            return Response({"message": "Left pool successfully."})
        except ValueError as exc:
            return Response({"error": str(exc)}, status=400)