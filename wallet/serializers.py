from rest_framework import serializers

from .models import Wallet


class WalletSerializer(serializers.ModelSerializer):
    """
    Exposes only the fields a user should see about their own wallet.
    Wallet ID and owner FK are intentionally excluded.
    private_key is never exposed through the API.
    """

    username = serializers.CharField(source="owner.username", read_only=True)

    class Meta:
        model = Wallet
        fields = [
            "username",
            "wallet_address",
            "public_key",
            "wallet_status",
            "balance",
            "total_mined",
            "total_sent",
            "total_received",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields
