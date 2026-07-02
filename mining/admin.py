from django.contrib import admin
from .models import MiningSession


@admin.register(MiningSession)
class MiningSessionAdmin(admin.ModelAdmin):

    list_display = (
        "id",
        "user",
        "status",
        "reward_rate",
        "reward",
        "started_at",
        "ends_at",
        "claimed_at",
    )

    list_filter = (
        "status",
    )

    search_fields = (
        "user__username",
        "user__email",
    )