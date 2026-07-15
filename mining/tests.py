from django.test import TestCase
from django.urls import reverse

class MiningSmokeTests(TestCase):
    def test_mining_status_requires_auth(self):
        response = self.client.get(reverse("mining:status"))
        self.assertIn(response.status_code, (401, 403))

    def test_mining_start_requires_auth(self):
        response = self.client.post(reverse("mining:start"), data={})
        self.assertIn(response.status_code, (401, 403))