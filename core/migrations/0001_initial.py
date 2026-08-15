from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="AuditLog",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("action",      models.CharField(choices=[
                    ("login",         "Login"),
                    ("login_failed",  "Login Failed"),
                    ("logout",        "Logout"),
                    ("register",      "Register"),
                    ("mining_start",  "Mining Start"),
                    ("mining_claim",  "Mining Claim"),
                    ("tx_created",    "Transaction Created"),
                    ("tx_confirmed",  "Transaction Confirmed"),
                    ("tx_failed",     "Transaction Failed"),
                    ("token_expired", "Token Expired"),
                ], db_index=True, max_length=50)),
                ("entity_type", models.CharField(blank=True, default="", max_length=50)),
                ("entity_id",   models.CharField(blank=True, default="", max_length=100)),
                ("details",     models.JSONField(blank=True, default=dict)),
                ("ip_address",  models.GenericIPAddressField(blank=True, null=True)),
                ("created_at",  models.DateTimeField(auto_now_add=True, db_index=True)),
                ("user", models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name="audit_logs",
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={"ordering": ["-created_at"], "verbose_name": "Audit Log", "verbose_name_plural": "Audit Logs"},
        ),
    ]