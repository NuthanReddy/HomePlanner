"""Preserve full authored Design snapshots independently from Site history."""
from alembic import op
import sqlalchemy as sa

revision = "0003_design_snapshots"
down_revision = "0002_native_workspace"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("design_snapshots",
        sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id"), primary_key=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("document", sa.JSON(), nullable=False))
    op.create_table("design_revisions",
        sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id"), primary_key=True),
        sa.Column("version", sa.Integer(), primary_key=True),
        sa.Column("document", sa.JSON(), nullable=False))


def downgrade():
    op.drop_table("design_revisions")
    op.drop_table("design_snapshots")
