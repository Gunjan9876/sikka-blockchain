from django.contrib import admin
from .models import AuditLog


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    list_display  = ("created_at", "action", "user", "entity_type", "entity_id", "ip_address")
    list_filter   = ("action",)
    search_fields = ("user__username", "entity_id", "ip_address")
    readonly_fields = ("user", "action", "entity_type", "entity_id", "details", "ip_address", "created_at")

    # Audit logs must never be edited or deleted via admin
    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False