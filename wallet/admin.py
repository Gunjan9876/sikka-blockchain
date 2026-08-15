from django.contrib import admin

from .models import Wallet, Organisation


@admin.register(Wallet)
class WalletAdmin(admin.ModelAdmin):
    list_display = ("owner", "balance", "total_mined", "total_sent", "total_received", "created_at")
    readonly_fields = ("owner", "balance", "total_mined", "total_sent", "total_received", "created_at", "updated_at")
    search_fields = ("owner__username", "owner__email")

@admin.register(Organisation)
class OrganisationAdmin(admin.ModelAdmin):
    list_display = ("name", "verification_status", "contact_person", "is_active", "created_at")
    list_filter = ("verification_status", "is_active")
    search_fields = ("name", "slug", "contact_person", "contact_number", "email")
    prepopulated_fields = {"slug": ("name",)}
