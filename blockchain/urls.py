from django.urls import path
from .views import BlockListView, BlockDetailView, ChainValidateView, ChainStatsView

urlpatterns = [
    path("",                   BlockListView.as_view(),    name="block-list"),
    path("stats/",             ChainStatsView.as_view(),   name="chain-stats"),
    path("validate/",          ChainValidateView.as_view(), name="chain-validate"),
    path("<int:block_index>/", BlockDetailView.as_view(),  name="block-detail"),
]