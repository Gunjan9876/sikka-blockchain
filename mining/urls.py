from django.urls import path
from .views import (
    StartMiningView, ClaimMiningView, MiningStatusView, MiningHistoryView,
    RigInfoView, RigUpgradeView,
    PoolListView, PoolJoinView, PoolLeaveView,
)

app_name = "mining"

urlpatterns = [
    # Core mining
    path("start/",   StartMiningView.as_view(),  name="start"),
    path("claim/",   ClaimMiningView.as_view(),  name="claim"),
    path("status/",  MiningStatusView.as_view(), name="status"),
    path("history/", MiningHistoryView.as_view(), name="history"),

    # Hardware
    path("rig/",         RigInfoView.as_view(),    name="rig-info"),
    path("rig/upgrade/", RigUpgradeView.as_view(), name="rig-upgrade"),

    # Pool
    path("pools/",       PoolListView.as_view(),  name="pool-list"),
    path("pools/join/",  PoolJoinView.as_view(),  name="pool-join"),
    path("pools/leave/", PoolLeaveView.as_view(), name="pool-leave"),
]