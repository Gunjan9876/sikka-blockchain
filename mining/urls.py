from django.urls import path

from .views import StartMiningView, ClaimMiningView, MiningStatusView

app_name = "mining"

urlpatterns = [
    path("start/",  StartMiningView.as_view(), name="start"),
    path("claim/",  ClaimMiningView.as_view(), name="claim"),
    path("status/", MiningStatusView.as_view(), name="status"),
]