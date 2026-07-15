from django.urls import path

from .views import dashboard_view, explorer_view

app_name = "dashboard"

urlpatterns = [
    path("", dashboard_view, name="dashboard"),
    path("explorer/", explorer_view, name="explorer"),
]

