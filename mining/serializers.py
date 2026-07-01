from rest_framework import serializers
from .models import MiningSession


class MiningSessionSerializer(serializers.ModelSerializer):
    class Meta:
        model = MiningSession
        fields = "__all__"
        read_only_fields = (
            "id",
            "started_at",
            "created_at",
            "claimed_at",
        )