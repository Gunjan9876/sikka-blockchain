from datetime import timedelta
from django.utils import timezone

from .models import MiningSession


class MiningService:

    MINING_DURATION = timedelta(hours=2)
    REWARD = 20

    @staticmethod
    def start_mining(user):
        """
        Start a new mining session for a user.
        """

        # Check if user already has a running session
        existing_session = MiningSession.objects.filter(
            user=user,
            status=MiningSession.Status.RUNNING
        ).first()

        if existing_session:
            raise ValueError("Mining session is already running.")

        start_time = timezone.now()
        end_time = start_time + MiningService.MINING_DURATION

        session = MiningSession.objects.create(
            user=user,
            ends_at=end_time,
            reward=MiningService.REWARD,
            status=MiningSession.Status.RUNNING
        )

        return session