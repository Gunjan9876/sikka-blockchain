from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('transactions', '0002_remove_transaction_block_id_transaction_block_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='transaction',
            name='signature',
            field=models.TextField(blank=True, default='',
                                   help_text='Hex-encoded DER ECDSA signature. Empty for COINBASE transactions.'),
        ),
    ]