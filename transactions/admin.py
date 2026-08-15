from django.contrib import admin
from .models import Transaction, Reward

@admin.register(Transaction)
class TransactionAdmin(admin.ModelAdmin):
    list_display = ("tx_hash", "tx_type", "amount", "status", "created_at")
    list_filter = ("tx_type", "status")

@admin.register(Reward)
class RewardAdmin(admin.ModelAdmin):
    list_display = ("organisation", "student_wallet", "achievement_type", "amount", "status", "issued_at")
    list_filter = ("status", "achievement_type")
