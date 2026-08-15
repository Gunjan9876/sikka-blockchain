from django.urls import path
from .views import SendTransactionView, TransactionDetailView, TransactionListView, FeeEstimateView

urlpatterns = [
    path("send/",        SendTransactionView.as_view(),              name="tx-send"),
    path("",             TransactionListView.as_view(),              name="tx-list"),
    path("<str:tx_hash>/", TransactionDetailView.as_view(),          name="tx-detail"),
    path("fee-estimate/", FeeEstimateView.as_view(), name="fee-estimate"),
]