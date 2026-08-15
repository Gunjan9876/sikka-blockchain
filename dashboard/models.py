from django.db import models
from django.contrib.auth import get_user_model

User = get_user_model()

class Notification(models.Model):
    class NotificationType(models.TextChoices):
        REWARD_REQUEST = 'REWARD_REQUEST', 'Reward Requested'
        REWARD_APPROVED = 'REWARD_APPROVED', 'Reward Approved'
        REWARD_REJECTED = 'REWARD_REJECTED', 'Reward Rejected'
        QUOTA_WARNING = 'QUOTA_WARNING', 'Quota Warning'
        ORG_VERIFICATION = 'ORG_VERIFICATION', 'University Verification'
        SYSTEM = 'SYSTEM', 'System Announcement'

    recipient = models.ForeignKey(User, on_delete=models.CASCADE, related_name='notifications')
    title = models.CharField(max_length=255)
    message = models.TextField()
    notification_type = models.CharField(max_length=20, choices=NotificationType.choices, default=NotificationType.SYSTEM)
    is_read = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    
    # Optional relation to a reward. Using string reference to avoid circular imports.
    related_reward = models.ForeignKey(
        'transactions.Reward', 
        on_delete=models.SET_NULL, 
        null=True, blank=True, 
        related_name='notifications'
    )

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.title} for {self.recipient.username}"
