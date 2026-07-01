from django.urls import path
from .views import StartMiningView

urlpatterns = [
    path("start/", StartMiningView.as_view(), name="start-mining"),
]