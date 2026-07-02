from rest_framework import serializers

from .models import Wallet


class WalletSerializer(serializers.ModelSerializer):
    """
    Exposes only the fields a user should see about their own wallet.
    Wallet ID and owner FK are intentionally excluded.
    """

    username = serializers.CharField(source="owner.username", read_only=True)

    class Meta:
        model = Wallet
        fields = [
            "username",
            "balance",
            "total_mined",
            "total_sent",
            "total_received",
            "created_at",
        ]
        read_only_fields = fields
