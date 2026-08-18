import uuid
from django.contrib.auth.models import AbstractUser
from django.db import models
from django.utils import timezone
from datetime import timedelta


def _token_expiry():
    return timezone.now() + timedelta(hours=24)

def _reset_expiry():
    return timezone.now() + timedelta(hours=1)


# AFTER
class User(AbstractUser):

    email = models.EmailField(unique=True)
    phone = models.CharField(max_length=15, blank=True)

    profile_image = models.ImageField(
        upload_to="profiles/",
        blank=True,
        null=True
    )

    # ── Email Verification ────────────────────────────────────────────────────
    email_verified       = models.BooleanField(default=True)
    email_verify_token   = models.UUIDField(default=uuid.uuid4, editable=False)
    email_token_expiry   = models.DateTimeField(default=_token_expiry)

    # ── Password Reset ────────────────────────────────────────────────────────
    password_reset_token  = models.UUIDField(null=True, blank=True)
    password_reset_expiry = models.DateTimeField(null=True, blank=True)

    # ── 2FA fields ────────────────────────────────────────────────────────────
    totp_secret  = models.CharField(max_length=64, blank=True, default="")
    totp_enabled = models.BooleanField(default=False)

    def __str__(self):
        return self.username

    def is_email_token_valid(self):
        return timezone.now() < self.email_token_expiry

    def is_reset_token_valid(self):
        if not self.password_reset_token or not self.password_reset_expiry:
            return False
        return timezone.now() < self.password_reset_expiry

    def generate_reset_token(self):
        self.password_reset_token = uuid.uuid4()
        self.password_reset_expiry = _reset_expiry()
        self.save(update_fields=["password_reset_token", "password_reset_expiry"])
        return self.password_reset_token
