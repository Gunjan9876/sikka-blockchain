from django.db import models
from django.conf import settings


class MiningSession(models.Model):

    class Status(models.TextChoices):
        RUNNING = "RUNNING", "Running"
        READY   = "READY",   "Ready to Claim"
        CLAIMED = "CLAIMED", "Claimed"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="mining_sessions",
    )

    started_at = models.DateTimeField(auto_now_add=True)
    ends_at    = models.DateTimeField()

    # Rate in SIKKA per hour (stored so history is auditable)
    reward_rate = models.DecimalField(
        max_digits=20,
        decimal_places=8,
        default="10.00000000",
    )

    # Final reward credited on claim (0 until claimed)
    reward = models.DecimalField(
        max_digits=20,
        decimal_places=8,
        default="0.00000000",
    )

    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.RUNNING,
    )

    claimed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.user.username} — {self.status}"
