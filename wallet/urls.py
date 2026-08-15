from django.urls import path

from .views import WalletView

app_name = "wallet"

urlpatterns = [
    path("", WalletView.as_view(), name="wallet"),
]
