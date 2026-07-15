from django.test import TestCase
from django.urls import reverse

class AccountsSmokeTests(TestCase):
    def test_register_page_loads(self):
        response = self.client.get(reverse("register_page"))
        self.assertEqual(response.status_code, 200)

    def test_login_page_loads(self):
        response = self.client.get(reverse("login_page"))
        self.assertEqual(response.status_code, 200)

class AccountsApiSmokeTests(TestCase):
    def test_register_endpoint_reachable(self):
        response = self.client.post("/api/v1/accounts/register/", data={})
        self.assertNotEqual(response.status_code, 404)
        self.assertLess(response.status_code, 500)

    def test_login_endpoint_reachable(self):
        response = self.client.post("/api/v1/accounts/login/", data={})
        self.assertNotEqual(response.status_code, 404)
        self.assertLess(response.status_code, 500)