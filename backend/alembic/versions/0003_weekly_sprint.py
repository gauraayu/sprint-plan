"""weekly sprint revisions, carry-forward, professor start/end class, class evidence

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-03 10:00:00
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = '0003'
down_revision: str | None = '0002'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

EXEC_OLD = "'SCHEDULED', 'IN_PROGRESS', 'PARTIALLY_COMPLETED', 'COMPLETED', 'RESCHEDULED'"
EXEC_NEW = EXEC_OLD + ", 'NOT_CONDUCTED'"
MAT_OLD = "'LECTURE_NOTES', 'ATTACHMENT'"
MAT_NEW = MAT_OLD + ", 'CLASS_EVIDENCE', 'CHECKIN_IMAGE'"
REASONS = ("'SPRINT_MEETING_DECISION', 'FACULTY_AVAILABILITY', 'PREVIOUS_TOPIC_INCOMPLETE', 'HOLIDAY_ADJUSTMENT', "
           "'ROOM_CHANGE', 'LAB_AVAILABILITY', 'ACADEMIC_REQUIREMENT', 'OTHER'")


def _swap(table: str, name: str, expression: str) -> None:
    op.drop_constraint(op.f(name), table, type_="check")
    op.create_check_constraint(op.f(name), table, expression)


def _stamps() -> list:
    return [
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    ]


def upgrade() -> None:
    # --- lectures: substitute professor, cancellation, origin, master snapshot
    op.add_column("lectures", sa.Column("professor_id", sa.Uuid(), nullable=True))
    op.add_column("lectures", sa.Column("is_cancelled", sa.Boolean(), server_default="false", nullable=False))
    op.add_column("lectures", sa.Column("cancel_reason", sa.Text(), nullable=True))
    op.add_column("lectures", sa.Column("origin", sa.String(length=16), server_default="MASTER", nullable=False))
    op.add_column("lectures", sa.Column("carried_from_lecture_id", sa.Uuid(), nullable=True))
    op.add_column("lectures", sa.Column("master_snapshot", postgresql.JSONB(), nullable=True))
    op.create_foreign_key(op.f("fk_lectures_professor_id_users"), "lectures", "users", ["professor_id"], ["id"], ondelete="RESTRICT")
    op.create_foreign_key(op.f("fk_lectures_carried_from_lecture_id_lectures"), "lectures", "lectures", ["carried_from_lecture_id"], ["id"], ondelete="SET NULL")
    op.create_index(op.f("ix_lectures_professor_id"), "lectures", ["professor_id"])

    # --- professor's own start / end, separate from the OM's entry / exit
    op.add_column("lecture_progress", sa.Column("professor_started_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("lecture_progress", sa.Column("professor_ended_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("lecture_progress", sa.Column("checkin_mode", sa.String(length=16), nullable=True))
    _swap("lecture_progress", "ck_lecture_progress_execution_status_valid", f"execution_status IN ({EXEC_NEW})")

    op.add_column("lecture_materials", sa.Column("caption", sa.String(length=300), nullable=True))
    _swap("lecture_materials", "ck_lecture_materials_material_type_valid", f"material_type IN ({MAT_NEW})")

    op.add_column("class_sessions", sa.Column("early_exit_minutes", sa.Integer(), server_default="0", nullable=False))
    op.add_column("class_sessions", sa.Column("early_exit_reason", sa.Text(), nullable=True))

    # --- sprint revisions
    op.create_table(
        "sprint_revisions",
        sa.Column("week_start", sa.Date(), nullable=False),
        sa.Column("week_end", sa.Date(), nullable=False),
        sa.Column("revision_number", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("meeting_date", sa.Date(), nullable=True),
        sa.Column("meeting_notes", sa.Text(), nullable=True),
        sa.Column("created_by_id", sa.Uuid(), nullable=False),
        sa.Column("published_by_id", sa.Uuid(), nullable=True),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        *_stamps(),
        sa.CheckConstraint("status IN ('DRAFT', 'PUBLISHED', 'DISCARDED')", name=op.f("ck_sprint_revisions_status_valid")),
        sa.CheckConstraint("week_end > week_start", name=op.f("ck_sprint_revisions_week_ordered")),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], name=op.f("fk_sprint_revisions_created_by_id_users"), ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["published_by_id"], ["users.id"], name=op.f("fk_sprint_revisions_published_by_id_users"), ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_sprint_revisions")),
    )
    op.create_index("uq_sprint_revisions_one_draft", "sprint_revisions", ["week_start"], unique=True, postgresql_where=sa.text("status = 'DRAFT'"))
    op.create_index("ix_sprint_revisions_week_status", "sprint_revisions", ["week_start", "status"])

    op.create_table(
        "sprint_revision_items",
        sa.Column("revision_id", sa.Uuid(), nullable=False),
        sa.Column("lecture_id", sa.Uuid(), nullable=True),
        sa.Column("teaching_plan_id", sa.Uuid(), nullable=False),
        sa.Column("change_type", sa.String(length=8), nullable=False),
        sa.Column("old_values", postgresql.JSONB(), nullable=True),
        sa.Column("new_values", postgresql.JSONB(), nullable=True),
        sa.Column("reason", sa.String(length=32), nullable=False),
        sa.Column("remarks", sa.Text(), nullable=True),
        sa.Column("carry_forward_lecture_id", sa.Uuid(), nullable=True),
        *_stamps(),
        sa.CheckConstraint("change_type IN ('UPDATE', 'CANCEL', 'ADD')", name=op.f("ck_sprint_revision_items_change_type_valid")),
        sa.CheckConstraint(f"reason IN ({REASONS})", name=op.f("ck_sprint_revision_items_reason_valid")),
        sa.CheckConstraint("reason <> 'OTHER' OR length(trim(coalesce(remarks, ''))) > 0", name=op.f("ck_sprint_revision_items_other_needs_remarks")),
        sa.CheckConstraint("change_type = 'ADD' OR lecture_id IS NOT NULL", name=op.f("ck_sprint_revision_items_change_needs_lecture")),
        sa.ForeignKeyConstraint(["revision_id"], ["sprint_revisions.id"], name=op.f("fk_sprint_revision_items_revision_id_sprint_revisions"), ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["lecture_id"], ["lectures.id"], name=op.f("fk_sprint_revision_items_lecture_id_lectures"), ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["teaching_plan_id"], ["teaching_plans.id"], name=op.f("fk_sprint_revision_items_teaching_plan_id_teaching_plans"), ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["carry_forward_lecture_id"], ["lectures.id"], name=op.f("fk_sprint_revision_items_carry_forward_lecture_id_lectures"), ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_sprint_revision_items")),
        sa.UniqueConstraint("revision_id", "lecture_id", name=op.f("uq_sprint_revision_items_revision_id_lecture_id")),
    )
    op.create_index(op.f("ix_sprint_revision_items_revision_id"), "sprint_revision_items", ["revision_id"])
    op.create_index(op.f("ix_sprint_revision_items_lecture_id"), "sprint_revision_items", ["lecture_id"])

    op.create_table(
        "carry_forward_items",
        sa.Column("source_lecture_id", sa.Uuid(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("target_lecture_id", sa.Uuid(), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("decided_by_id", sa.Uuid(), nullable=False),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=False),
        *_stamps(),
        sa.CheckConstraint("status IN ('OPEN', 'DEFERRED', 'SCHEDULED', 'RESOLVED')", name=op.f("ck_carry_forward_items_status_valid")),
        sa.ForeignKeyConstraint(["source_lecture_id"], ["lectures.id"], name=op.f("fk_carry_forward_items_source_lecture_id_lectures"), ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["target_lecture_id"], ["lectures.id"], name=op.f("fk_carry_forward_items_target_lecture_id_lectures"), ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["decided_by_id"], ["users.id"], name=op.f("fk_carry_forward_items_decided_by_id_users"), ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_carry_forward_items")),
        sa.UniqueConstraint("source_lecture_id", name=op.f("uq_carry_forward_items_source_lecture_id")),
    )


def downgrade() -> None:
    op.drop_table("carry_forward_items")
    op.drop_table("sprint_revision_items")
    op.drop_index("ix_sprint_revisions_week_status", table_name="sprint_revisions")
    op.drop_index("uq_sprint_revisions_one_draft", table_name="sprint_revisions")
    op.drop_table("sprint_revisions")
    op.drop_column("class_sessions", "early_exit_reason")
    op.drop_column("class_sessions", "early_exit_minutes")
    op.execute("DELETE FROM lecture_materials WHERE material_type IN ('CLASS_EVIDENCE', 'CHECKIN_IMAGE')")
    _swap("lecture_materials", "ck_lecture_materials_material_type_valid", f"material_type IN ({MAT_OLD})")
    op.drop_column("lecture_materials", "caption")
    op.execute("UPDATE lecture_progress SET execution_status = 'SCHEDULED' WHERE execution_status = 'NOT_CONDUCTED'")
    _swap("lecture_progress", "ck_lecture_progress_execution_status_valid", f"execution_status IN ({EXEC_OLD})")
    op.drop_column("lecture_progress", "checkin_mode")
    op.drop_column("lecture_progress", "professor_ended_at")
    op.drop_column("lecture_progress", "professor_started_at")
    op.drop_index(op.f("ix_lectures_professor_id"), table_name="lectures")
    op.drop_constraint(op.f("fk_lectures_carried_from_lecture_id_lectures"), "lectures", type_="foreignkey")
    op.drop_constraint(op.f("fk_lectures_professor_id_users"), "lectures", type_="foreignkey")
    for col in ("master_snapshot", "carried_from_lecture_id", "origin", "cancel_reason", "is_cancelled", "professor_id"):
        op.drop_column("lectures", col)
