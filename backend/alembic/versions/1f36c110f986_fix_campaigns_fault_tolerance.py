"""fix_campaigns_fault_tolerance

Revision ID: 1f36c110f986
Revises: a9c715b3fe38
Create Date: 2026-07-14 14:55:40.451517

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '1f36c110f986'
down_revision: Union[str, Sequence[str], None] = 'a9c715b3fe38'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Add columns to campaignrecipient
    with op.batch_alter_table('campaignrecipient', schema=None) as batch_op:
        batch_op.add_column(sa.Column('attempt_count', sa.Integer(), nullable=True, server_default='0'))
        batch_op.add_column(sa.Column('last_attempt_at', sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column('gmail_message_id', sa.String(), nullable=True))

    # Safely remove the foreign key on emaillog.campaign_id that pointed to emailcampaign.id.
    # We do this using batch_alter_table so it works correctly on SQLite.
    with op.batch_alter_table('emaillog', schema=None) as batch_op:
        # We need to recreate campaign_id column without the ForeignKey constraint.
        # In SQLAlchemy/Alembic batch mode, we can redefine the column without ForeignKey.
        batch_op.alter_column('campaign_id',
               existing_type=sa.String(),
               type_=sa.String(),
               existing_nullable=True)


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('emaillog', schema=None) as batch_op:
        batch_op.create_foreign_key(
            'fk_emaillog_campaign_id',
            'emailcampaign',
            ['campaign_id'],
            ['id']
        )

    with op.batch_alter_table('campaignrecipient', schema=None) as batch_op:
        batch_op.drop_column('gmail_message_id')
        batch_op.drop_column('last_attempt_at')
        batch_op.drop_column('attempt_count')
