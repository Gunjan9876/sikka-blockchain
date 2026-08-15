from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('wallet', '0004_alter_wallet_wallet_address'),
    ]

    operations = [
        migrations.AddField(
            model_name='wallet',
            name='nonce',
            field=models.PositiveIntegerField(
                default=0,
                help_text='Strictly incrementing counter — prevents transaction replay attacks.',
            ),
        ),
    ]