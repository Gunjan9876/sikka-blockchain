"""
AuditLog — immutable record of every significant action in SIKKA.

Every login, logout, mining claim, transaction send, and failed attempt
is written here. Rows are never updated or deleted — only inserted.
This is what makes SIKKA behave like a financial platform, not just a web app.
"""

from django.conf import settings
from django.db import models


class AuditLog(models.Model):

    class Action(models.TextChoices):
        LOGIN          = "login",          "Login"
        LOGIN_FAILED   = "login_failed",   "Login Failed"
        LOGOUT         = "logout",         "Logout"
        REGISTER       = "register",       "Register"
        MINING_START   = "mining_start",   "Mining Start"
        MINING_CLAIM   = "mining_claim",   "Mining Claim"
        TX_CREATED     = "tx_created",     "Transaction Created"
        TX_CONFIRMED   = "tx_confirmed",   "Transaction Confirmed"
        TX_FAILED      = "tx_failed",      "Transaction Failed"
        TOKEN_EXPIRED  = "token_expired",  "Token Expired"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="audit_logs",
    )
    action      = models.CharField(max_length=50, choices=Action.choices, db_index=True)
    entity_type = models.CharField(max_length=50, blank=True, default="")
    entity_id   = models.CharField(max_length=100, blank=True, default="")
    details     = models.JSONField(default=dict, blank=True)
    ip_address  = models.GenericIPAddressField(null=True, blank=True)
    created_at  = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name      = "Audit Log"
        verbose_name_plural = "Audit Logs"

    def __str__(self):
        user = self.user.username if self.user else "anonymous"
        return f"[{self.created_at:%Y-%m-%d %H:%M}] {self.action} — {user}"