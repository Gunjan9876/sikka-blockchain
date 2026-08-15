from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated

class IssueRewardView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        from wallet.models import Organisation
        from transactions.services import request_reward

        try:
            org = Organisation.objects.get(wallet__owner=request.user, is_active=True)
            if org.verification_status != Organisation.VerificationStatus.VERIFIED:
                return Response({"error": "Your university account is pending verification."}, status=403)
        except Organisation.DoesNotExist:
            return Response({"error": "Not an authorised organisation."}, status=403)

        recipient = request.data.get("recipient_address")
        amount    = request.data.get("amount")
        achievement_type = request.data.get("achievement_type", "OTHER")
        description = request.data.get("description", "")

        if not recipient or not amount:
            return Response({"error": "recipient_address and amount are required."}, status=400)

        try:
            reward = request_reward(org, recipient, amount, achievement_type, description)
            return Response({
                "reward_id": reward.id,
                "amount": str(reward.amount),
                "recipient": reward.student_wallet.wallet_address,
                "status": reward.status,
                "achievement_type": reward.achievement_type,
            }, status=201)
        except ValueError as e:
            return Response({"error": str(e)}, status=400)


class ReviewRewardView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        from wallet.models import Organisation
        from transactions.models import Reward
        from transactions.services import approve_reward, reject_reward

        try:
            org = Organisation.objects.get(wallet__owner=request.user, is_active=True)
            if org.verification_status != Organisation.VerificationStatus.VERIFIED:
                return Response({"error": "Your university account is pending verification."}, status=403)
        except Organisation.DoesNotExist:
            return Response({"error": "Not an authorised organisation."}, status=403)

        reward_id = request.data.get("reward_id")
        action = request.data.get("action")

        if not reward_id or action not in ["approve", "reject"]:
            return Response({"error": "Invalid reward_id or action."}, status=400)

        try:
            reward = Reward.objects.get(id=reward_id, organisation=org)
        except Reward.DoesNotExist:
            return Response({"error": "Reward not found."}, status=404)

        try:
            if action == "approve":
                approve_reward(reward)
            else:
                reject_reward(reward)
            return Response({"status": reward.status}, status=200)
        except ValueError as e:
            return Response({"error": str(e)}, status=400)


class OrgInfoView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        from wallet.models import Organisation
        from transactions.models import Reward

        try:
            org = Organisation.objects.get(wallet__owner=request.user, is_active=True)
        except Organisation.DoesNotExist:
            return Response({"has_org": False})

        rewards = Reward.objects.filter(
            organisation=org
        ).select_related("student_wallet", "transaction").order_by("-issued_at")[:20]

        reward_list = []
        for r in rewards:
            reward_list.append({
                "id": r.id,
                "receiver_address": r.student_wallet.wallet_address,
                "amount": str(r.amount),
                "status": r.status,
                "achievement_type": r.achievement_type,
                "description": r.description,
                "tx_hash": r.transaction.tx_hash if r.transaction else None,
                "issued_at": r.issued_at.isoformat() if r.issued_at else None,
            })
        from accounts.models import User
        from django.db.models import Sum
        from transactions.models import Reward

        total_students = User.objects.filter(is_active=True, wallet__isnull=False).exclude(id=request.user.id).count()
        rewards_issued = Reward.objects.filter(organisation=org, status=Reward.Status.APPROVED).count()
        pending_requests = Reward.objects.filter(organisation=org, status=Reward.Status.PENDING).count()
        total_ska_distributed = Reward.objects.filter(organisation=org, status=Reward.Status.APPROVED).aggregate(Sum('amount'))['amount__sum'] or 0

        return Response({
            "has_org": True,
            "name": org.name,
            "logo_url": org.logo.url if org.logo else None,
            "verification_status": org.verification_status,
            "address": org.address,
            "website": org.website,
            "quota_remaining": str(org.quota_remaining()),
            "quota_used": str(org.quota_used),
            "reward_quota": str(org.reward_quota),
            "total_students": total_students,
            "rewards_issued": rewards_issued,
            "pending_requests": pending_requests,
            "total_ska_distributed": total_ska_distributed,
            "rewards": reward_list
        })


class StudentRewardHistoryView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        from wallet.models import Wallet
        from transactions.models import Reward

        try:
            wallet = Wallet.objects.get(owner=request.user)
        except Wallet.DoesNotExist:
            return Response({"error": "Wallet not found."}, status=404)

        rewards = Reward.objects.filter(
            student_wallet=wallet
        ).select_related("organisation", "transaction").order_by("-issued_at")

        reward_list = []
        for r in rewards:
            reward_list.append({
                "id": r.id,
                "organisation_name": r.organisation.name,
                "amount": str(r.amount),
                "status": r.status,
                "achievement_type": r.achievement_type,
                "description": r.description,
                "issued_at": r.issued_at,
                "tx_hash": r.transaction.tx_hash if r.transaction else None,
            })

        return Response({"rewards": reward_list})


class NotificationListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        from dashboard.models import Notification
        notifications = Notification.objects.filter(recipient=request.user)

        unread_count = notifications.filter(is_read=False).count()

        data = []
        for n in notifications:
            data.append({
                "id": n.id,
                "title": n.title,
                "message": n.message,
                "type": n.notification_type,
                "is_read": n.is_read,
                "created_at": n.created_at.isoformat(),
                "related_reward_id": n.related_reward_id
            })

        return Response({"unread_count": unread_count, "notifications": data})


class NotificationReadView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        from dashboard.models import Notification
        notification_id = request.data.get("notification_id")
        if not notification_id:
            return Response({"error": "notification_id is required."}, status=400)

        try:
            notification = Notification.objects.get(id=notification_id, recipient=request.user)
            notification.is_read = True
            notification.save(update_fields=["is_read"])
            return Response({"status": "success"})
        except Notification.DoesNotExist:
            return Response({"error": "Notification not found."}, status=404)


class NotificationReadAllView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        from dashboard.models import Notification
        Notification.objects.filter(recipient=request.user, is_read=False).update(is_read=True)
        return Response({"status": "success"})


class OrgAnalyticsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        from wallet.models import Organisation, Wallet
        from transactions.models import Reward, Transaction
        from accounts.models import User
        from dashboard.models import Notification
        from blockchain.models import Block
        from django.db.models import Sum, Count, Avg, Q
        from django.db.models.functions import TruncDate
        from django.utils import timezone
        import datetime

        try:
            org = Organisation.objects.get(wallet__owner=request.user, is_active=True)
            if org.verification_status != Organisation.VerificationStatus.VERIFIED:
                return Response({"error": "Your university account is pending verification."}, status=403)
        except Organisation.DoesNotExist:
            return Response({"error": "Not an authorised organisation."}, status=403)

        time_filter = request.query_params.get("filter", "all")
        now = timezone.now()
        start_date = None

        if time_filter == "today":
            start_date = now.replace(hour=0, minute=0, second=0, microsecond=0)
        elif time_filter == "7days":
            start_date = now - datetime.timedelta(days=7)
        elif time_filter == "30days":
            start_date = now - datetime.timedelta(days=30)

        reward_time_q = Q()
        if start_date:
            reward_time_q &= Q(issued_at__gte=start_date)

        # 1. Overview
        all_students = User.objects.filter(wallet__isnull=False, is_superuser=False, wallet__org__isnull=True)
        total_students = all_students.count()
        active_students = all_students.filter(is_active=True).count()

        rewards_qs = Reward.objects.filter(organisation=org)
        filtered_rewards_qs = rewards_qs.filter(reward_time_q)

        rewards_issued = filtered_rewards_qs.filter(status='APPROVED').count()
        pending_rewards = filtered_rewards_qs.filter(status='PENDING').count()

        ska_distributed = filtered_rewards_qs.filter(status='APPROVED').aggregate(Sum('amount'))['amount__sum'] or 0
        avg_reward = filtered_rewards_qs.filter(status='APPROVED').aggregate(Avg('amount'))['amount__avg'] or 0
        highest_reward = filtered_rewards_qs.filter(status='APPROVED').order_by('-amount').first()
        highest_reward_amt = highest_reward.amount if highest_reward else 0

        # 2. Charts
        rewards_over_time = list(filtered_rewards_qs.filter(status='APPROVED')
                                 .annotate(day=TruncDate('issued_at'))
                                 .values('day')
                                 .annotate(total=Sum('amount'))
                                 .order_by('day'))

        top_students = list(filtered_rewards_qs.filter(status='APPROVED')
                            .values('student_wallet__owner__first_name', 'student_wallet__owner__username')
                            .annotate(total=Sum('amount'))
                            .order_by('-total')[:10])

        achievements = list(filtered_rewards_qs.filter(status='APPROVED')
                            .values('achievement_type')
                            .annotate(count=Count('id')))

        statuses = list(filtered_rewards_qs.values('status').annotate(count=Count('id')))

        # 3. Student Insights
        most_active_student_query = User.objects.filter(
            wallet__isnull=False, is_superuser=False, wallet__org__isnull=True
        ).annotate(
            reward_count=Count('wallet__rewards_received', filter=Q(
                wallet__rewards_received__organisation=org,
                wallet__rewards_received__status='APPROVED'
            ))
        ).order_by('-reward_count')[:5]

        most_active = []
        for s in most_active_student_query:
            if s.reward_count > 0:
                most_active.append({
                    "name": s.first_name or s.username,
                    "count": s.reward_count
                })

        # 4. Blockchain Insights
        blocks_query = Block.objects.all()
        txs_query = Transaction.objects.all()
        if start_date:
            blocks_query = blocks_query.filter(timestamp__gte=start_date)
            txs_query = txs_query.filter(created_at__gte=start_date)  # C1 fix: was timestamp__gte

        total_txs = txs_query.count()
        successful_txs = txs_query.filter(status='CONFIRMED').count()
        failed_txs = txs_query.filter(status='FAILED').count()
        blocks_mined = blocks_query.count()

        # 5. University Performance
        quota_allocated = org.reward_quota
        quota_used = org.quota_used
        approval_rate = 0
        total_handled = filtered_rewards_qs.exclude(status='PENDING').count()
        if total_handled > 0:
            approval_rate = (filtered_rewards_qs.filter(status='APPROVED').count() / total_handled) * 100

        # 6. Recent Activity
        recent_activity_qs = Notification.objects.filter(recipient=request.user).order_by('-created_at')[:10]
        recent_activity = []
        for a in recent_activity_qs:
            recent_activity.append({
                "type": a.notification_type,
                "message": a.message,
                "date": a.created_at
            })

        return Response({
            "overview": {
                "total_students": total_students,
                "active_students": active_students,
                "rewards_issued": rewards_issued,
                "pending_rewards": pending_rewards,
                "ska_distributed": float(ska_distributed),
                "quota_remaining": float(quota_allocated - quota_used),
                "avg_reward": float(avg_reward),
                "highest_reward": float(highest_reward_amt)
            },
            "charts": {
                "rewards_over_time": [{"date": str(r['day']), "amount": float(r['total'])} for r in rewards_over_time],
                "top_students": [{"name": r['student_wallet__owner__first_name'] or r['student_wallet__owner__username'], "amount": float(r['total'])} for r in top_students],
                "achievement_distribution": {r['achievement_type']: r['count'] for r in achievements},
                "status_distribution": {r['status']: r['count'] for r in statuses}
            },
            "student_insights": {
                "most_active": most_active,
            },
            "blockchain_insights": {
                "total_txs": total_txs,
                "successful_txs": successful_txs,
                "failed_txs": failed_txs,
                "blocks_mined": blocks_mined,
                "chain_height": Block.objects.count() - 1 if Block.objects.exists() else 0
            },
            "university_performance": {
                "quota_allocated": float(quota_allocated),
                "quota_used": float(quota_used),
                "approval_rate": round(approval_rate, 2)
            },
            "recent_activity": recent_activity
        })


class OrgStudentsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        from wallet.models import Organisation
        from accounts.models import User
        from transactions.models import Reward, Transaction
        from django.db.models import Q, Prefetch
        from collections import defaultdict

        try:
            org = Organisation.objects.get(wallet__owner=request.user, is_active=True)
            if org.verification_status != Organisation.VerificationStatus.VERIFIED:
                return Response({"error": "Your university account is pending verification."}, status=403)
        except Organisation.DoesNotExist:
            return Response({"error": "Not an authorised organisation."}, status=403)

        # Prefetch all rewards for this org in a single query
        org_rewards_prefetch = Prefetch(
            'wallet__rewards_received',
            queryset=Reward.objects.filter(organisation=org).order_by('-issued_at'),
            to_attr='org_rewards'
        )

        users = User.objects.filter(
            is_active=True,
            wallet__isnull=False
        ).exclude(id=request.user.id).select_related('wallet').prefetch_related(org_rewards_prefetch)

        user_list = list(users)
        wallet_addresses = [u.wallet.wallet_address for u in user_list]

        # Fetch all relevant transactions in one query
        all_txs = Transaction.objects.filter(
            Q(sender_address__in=wallet_addresses) | Q(receiver_address__in=wallet_addresses)
        ).order_by('-created_at')

        # Group by wallet address (cap at 10 per address)
        tx_by_address = defaultdict(list)
        for tx in all_txs:
            if len(tx_by_address[tx.sender_address]) < 10:
                tx_by_address[tx.sender_address].append(tx)
            if tx.receiver_address != tx.sender_address and len(tx_by_address[tx.receiver_address]) < 10:
                tx_by_address[tx.receiver_address].append(tx)

        students_data = []
        for user in user_list:
            wallet = user.wallet
            org_rewards = wallet.org_rewards  # from prefetch — no extra query

            total_rewards_count = len(org_rewards)
            approved_rewards = [r for r in org_rewards if r.status == Reward.Status.APPROVED]
            total_ska_earned = sum(r.amount for r in approved_rewards) if approved_rewards else 0
            last_reward = org_rewards[0] if org_rewards else None

            recent_txs = tx_by_address.get(wallet.wallet_address, [])[:10]
            tx_data = [{
                "tx_hash": tx.tx_hash,
                "amount": str(tx.amount),
                "type": tx.tx_type,
                "status": tx.status,
                "timestamp": tx.created_at.isoformat() if tx.created_at else None
            } for tx in recent_txs]

            reward_history = [{
                "date": r.issued_at.isoformat() if r.issued_at else None,
                "achievement": r.get_achievement_type_display(),
                "description": r.description,
                "amount": str(r.amount),
                "status": r.status,
                "issued_by": org.name
            } for r in org_rewards]

            students_data.append({
                "id": user.id,
                "name": user.get_full_name() or user.username,
                "username": user.username,
                "email": user.email,
                "wallet_address": wallet.wallet_address,
                "wallet_balance": str(wallet.balance),
                "wallet_total_mined": str(wallet.total_mined),
                "wallet_total_sent": str(wallet.total_sent),
                "wallet_total_received": str(wallet.total_received),
                "account_created": user.date_joined.isoformat() if user.date_joined else None,
                "last_login": user.last_login.isoformat() if user.last_login else None,
                "is_active": user.is_active,

                "org_total_rewards": total_rewards_count,
                "org_total_ska_earned": str(total_ska_earned),
                "org_last_reward_date": last_reward.issued_at.isoformat() if last_reward and last_reward.issued_at else None,

                "reward_history": reward_history,
                "recent_transactions": tx_data
            })

        return Response({"students": students_data})