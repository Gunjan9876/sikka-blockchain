from rest_framework import serializers

from .models import MiningSession


class MiningSessionSerializer(serializers.ModelSerializer):
    """
    Exposes only public mining session fields.
    User FK, internal ID, and raw timestamps are intentionally excluded.
    """

    class Meta:
        model = MiningSession
        fields = [
            "status",
            "reward_rate",
            "reward",
            "started_at",
            "ends_at",
            "claimed_at",
        ]
        read_only_fields = fields