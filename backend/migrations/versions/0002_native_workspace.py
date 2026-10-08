"""Add native Site/Costs documents without modifying legacy or metadata records."""
from alembic import op
import sqlalchemy as sa

revision = "0002_native_workspace"
down_revision = "0001_platform"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("workspaces",
        sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id"), primary_key=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("cursor", sa.Integer(), nullable=False),
        sa.Column("head", sa.Integer(), nullable=False),
        sa.Column("document", sa.JSON(), nullable=False))
    op.create_table("workspace_revisions",
        sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id"), primary_key=True),
        sa.Column("sequence", sa.Integer(), primary_key=True),
        sa.Column("document", sa.JSON(), nullable=False))


def downgrade():
    op.drop_table("workspace_revisions")
    op.drop_table("workspaces")
