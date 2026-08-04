"""add lead ai tables

Revision ID: c7b89d02e4f1
Revises: 1f36c110f986
Create Date: 2026-08-04 09:15:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c7b89d02e4f1'
down_revision: Union[str, Sequence[str], None] = '1f36c110f986'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'lead_ai_threads',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('organization_id', sa.String(), nullable=False),
        sa.Column('lead_id', sa.String(), nullable=False),
        sa.Column('user_id', sa.String(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['lead_id'], ['lead.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('lead_id', 'organization_id', name='uq_lead_ai_thread_per_lead')
    )
    op.create_index(op.f('ix_lead_ai_threads_id'), 'lead_ai_threads', ['id'], unique=False)
    op.create_index(op.f('ix_lead_ai_threads_lead_id'), 'lead_ai_threads', ['lead_id'], unique=False)
    op.create_index(op.f('ix_lead_ai_threads_organization_id'), 'lead_ai_threads', ['organization_id'], unique=False)
    op.create_index(op.f('ix_lead_ai_threads_user_id'), 'lead_ai_threads', ['user_id'], unique=False)

    op.create_table(
        'lead_ai_messages',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('thread_id', sa.String(), nullable=False),
        sa.Column('role', sa.String(), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['thread_id'], ['lead_ai_threads.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_lead_ai_messages_id'), 'lead_ai_messages', ['id'], unique=False)
    op.create_index(op.f('ix_lead_ai_messages_thread_id'), 'lead_ai_messages', ['thread_id'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_lead_ai_messages_thread_id'), table_name='lead_ai_messages')
    op.drop_index(op.f('ix_lead_ai_messages_id'), table_name='lead_ai_messages')
    op.drop_table('lead_ai_messages')

    op.drop_index(op.f('ix_lead_ai_threads_user_id'), table_name='lead_ai_threads')
    op.drop_index(op.f('ix_lead_ai_threads_organization_id'), table_name='lead_ai_threads')
    op.drop_index(op.f('ix_lead_ai_threads_lead_id'), table_name='lead_ai_threads')
    op.drop_index(op.f('ix_lead_ai_threads_id'), table_name='lead_ai_threads')
    op.drop_table('lead_ai_threads')
