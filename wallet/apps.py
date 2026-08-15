from django.apps import AppConfig


class WalletConfig(AppConfig):
    name = 'wallet'

    def ready(self):
        import wallet.signals  # noqa: F401 — registers post_save receiver
