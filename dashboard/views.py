from django.shortcuts import render
import json
from accounts.models import User
from wallet.models import Organisation


# ---------------------------------------------------------------------------
# Student Dashboard – /dashboard/
# ---------------------------------------------------------------------------
def dashboard_view(request):
    return render(request, "dashboard/dashboard.html")


# ---------------------------------------------------------------------------
# University Dashboard – /dashboard/org/
# ---------------------------------------------------------------------------
def org_dashboard_view(request):
    return render(request, "dashboard/org_dashboard.html", {"is_university": True})


def explorer_view(request):
    return render(request, "blockchain/explorer.html")


def mining_view(request):
    return render(request, "dashboard/mining.html")


def wallet_view(request):
    return render(request, "dashboard/wallet.html")


def profile_view(request):
    return render(request, "dashboard/profile.html")


def org_rewards_view(request):
    org_user_ids = Organisation.objects.filter(
        wallet__isnull=False
    ).values_list("wallet__owner_id", flat=True)

    students = User.objects.filter(
        is_active=True,
        wallet__isnull=False
    ).exclude(id__in=list(org_user_ids)).select_related("wallet")

    student_data = []
    for student in students:
        student_data.append({
            "id": student.id,
            "username": student.username,
            "email": student.email,
            "name": f"{student.first_name} {student.last_name}".strip() or student.username,
            "wallet_address": student.wallet.wallet_address,
        })

    return render(request, "dashboard/org_rewards.html", {"students_json": student_data})


def student_rewards_view(request):
    return render(request, "dashboard/student_rewards.html")


def settings_view(request):
    return render(request, "dashboard/settings.html")


def login_activity_view(request):
    return render(request, 'dashboard/login_activity.html')


def org_wallet_view(request):
    return render(request, 'dashboard/org_wallet.html')


def org_explorer_view(request):
    return render(request, 'dashboard/org_explorer.html')


def org_settings_view(request):
    return render(request, 'dashboard/org_settings.html')


def org_activity_view(request):
    return render(request, 'dashboard/org_login_activity.html')


def org_notifications_view(request):
    return render(request, 'dashboard/org_notifications.html')


def org_students_view(request):
    return render(request, 'dashboard/org_students.html')


def org_analytics_view(request):
    return render(request, 'dashboard/org_analytics.html')