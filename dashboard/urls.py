from django.urls import path

from .views import (
    dashboard_view, explorer_view, mining_view, wallet_view, 
    profile_view, org_rewards_view, settings_view, login_activity_view, 
    student_rewards_view, org_dashboard_view,
    org_wallet_view, org_explorer_view, org_settings_view, org_activity_view, org_notifications_view,
    org_students_view, org_analytics_view
)

app_name = "dashboard"

urlpatterns = [
    # Student / Shared Routes
    path("",          dashboard_view, name="dashboard"),
    path("explorer/", explorer_view,  name="explorer"),
    path("mining/",   mining_view,    name="mining"),
    path("wallet/",   wallet_view,    name="wallet"),
    path("profile/",  profile_view,   name="profile"),
    path("student/rewards/", student_rewards_view, name="student_rewards"),
    path("settings/", settings_view,  name="settings"),
    path("activity/", login_activity_view, name="login_activity"),

    # University Routes
    path("org/",      org_dashboard_view, name="org_dashboard"),
    path("org/rewards/", org_rewards_view, name="org_rewards"),
    path("org/wallet/", org_wallet_view, name="org_wallet"),
    path("org/explorer/", org_explorer_view, name="org_explorer"),
    path("org/settings/", org_settings_view, name="org_settings"),
    path("org/activity/", org_activity_view, name="org_activity"),
    path("org/notifications/", org_notifications_view, name="org_notifications"),
    path("org/students/", org_students_view, name="org_students"),
    path("org/analytics/", org_analytics_view, name="org_analytics"),
]