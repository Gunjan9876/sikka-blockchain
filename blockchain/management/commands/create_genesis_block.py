"""
Management command: create_genesis_block

Usage:
    python manage.py create_genesis_block

Creates the genesis block (block #0) if it does not already exist.
Idempotent — safe to run multiple times.
"""

from django.core.management.base import BaseCommand

from blockchain.services import create_genesis_block
from blockchain.models import Block


class Command(BaseCommand):
    help = "Create the SIKKA genesis block (block #0) if it does not exist."

    def handle(self, *args, **options):
        if Block.objects.filter(block_index=0).exists():
            self.stdout.write(self.style.WARNING(
                "Genesis block already exists — nothing to do."
            ))
            return

        self.stdout.write("Creating genesis block…")
        genesis = create_genesis_block()
        self.stdout.write(self.style.SUCCESS(
            f"Genesis block created: #{genesis.block_index}  hash={genesis.hash}"
        ))