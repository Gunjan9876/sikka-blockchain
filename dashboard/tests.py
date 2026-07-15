from django.test import TestCase
from django.urls import reverse

class DashboardSmokeTests(TestCase):
    def test_dashboard_shell_loads(self):
        response = self.client.get(reverse("dashboard:dashboard"))
        self.assertEqual(response.status_code, 200)

    def test_explorer_shell_loads(self):
        response = self.client.get(reverse("dashboard:explorer"))
        self.assertEqual(response.status_code, 200)