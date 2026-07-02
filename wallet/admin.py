from django.contrib import admin

from .models import Wallet


@admin.register(Wallet)
class WalletAdmin(admin.ModelAdmin):
    list_display = ("owner", "balance", "total_mined", "total_sent", "total_received", "created_at")
    readonly_fields = ("owner", "balance", "total_mined", "total_sent", "total_received", "created_at", "updated_at")
    search_fields = ("owner__username", "owner__email")
