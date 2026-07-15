from django.test import TestCase
from django.urls import reverse

class WalletSmokeTests(TestCase):
    def test_wallet_endpoint_requires_auth(self):
        response = self.client.get(reverse("wallet:wallet"))
        self.assertIn(response.status_code, (401, 403))