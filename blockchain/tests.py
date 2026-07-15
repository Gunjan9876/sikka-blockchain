from django.test import TestCase
from django.urls import reverse

class BlockchainSmokeTests(TestCase):
    def test_block_list_requires_auth(self):
        response = self.client.get(reverse("block-list"))
        self.assertIn(response.status_code, (401, 403))

    def test_chain_stats_requires_auth(self):
        response = self.client.get(reverse("chain-stats"))
        self.assertIn(response.status_code, (401, 403))