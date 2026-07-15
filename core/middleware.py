"""
TokenExpiryMiddleware

Checks every authenticated API request for token age.
If the token is older than TOKEN_EXPIRY_HOURS, it is deleted and
a 401 is returned so the client redirects to login.

This closes the gap flagged in the security report:
"A leaked DRF token remains valid indefinitely."
"""

import json
from datetime import timedelta

from django.http import JsonResponse
from django.utils import timezone

TOKEN_EXPIRY_HOURS = 24  # token lifetime — change in settings if needed


class TokenExpiryMiddleware:
    """Invalidate DRF tokens older than TOKEN_EXPIRY_HOURS."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        auth_header = request.META.get("HTTP_AUTHORIZATION", "")

        if auth_header.startswith("Token "):
            token_key = auth_header.split(" ", 1)[1].strip()
            self._check_expiry(token_key, request)

        return self.get_response(request)

    def _check_expiry(self, token_key, request):
        try:
            from rest_framework.authtoken.models import Token
            token = Token.objects.select_related("user").get(key=token_key)
        except Exception:
            return  # invalid token — let DRF handle the 401

        expiry_time = token.created + timedelta(hours=TOKEN_EXPIRY_HOURS)

        if timezone.now() > expiry_time:
            # Write audit log entry before deleting
            try:
                from core.models import AuditLog
                AuditLog.objects.create(
                    user=token.user,
                    action=AuditLog.Action.TOKEN_EXPIRED,
                    entity_type="Token",
                    entity_id=token_key[:8] + "…",
                    details={"reason": "Token exceeded 24h lifetime"},
                    ip_address=_get_client_ip(request),
                )
            except Exception:
                pass

            token.delete()


def _get_client_ip(request):
    x_forwarded = request.META.get("HTTP_X_FORWARDED_FOR")
    if x_forwarded:
        return x_forwarded.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR")