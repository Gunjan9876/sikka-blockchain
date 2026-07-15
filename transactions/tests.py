from django.test import TestCase
from django.urls import reverse

class TransactionsSmokeTests(TestCase):
    def test_transaction_list_requires_auth(self):
        response = self.client.get(reverse("tx-list"))
        self.assertIn(response.status_code, (401, 403))

    def test_send_transaction_requires_auth(self):
        response = self.client.post(reverse("tx-send"), data={})
        self.assertIn(response.status_code, (401, 403))