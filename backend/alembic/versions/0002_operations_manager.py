"""operations manager: OM role, class_sessions, OM verification level, plan room

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-02 10:00:00
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0002'
down_revision: str | None = '0001'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

OLD_ROLES = "'ADMIN', 'PROFESSOR', 'CL', 'CH'"
NEW_ROLES = "'ADMIN', 'PROFESSOR', 'CL', 'CH', 'OM'"

# (table, constraint, expression template)
ROLE_CHECKS = (
    ("roles", "ck_roles_code_valid", "code IN ({roles})"),
    ("audit_logs", "ck_audit_logs_actor_role_valid", "actor_role IS NULL OR actor_role IN ({roles})"),
    ("verifications", "ck_verifications_verifier_role_valid", "verifier_role IS NULL OR verifier_role IN ({roles})"),
)


def _swap(table: str, name: str, expression: str) -> None:
    # op.f(): the name is already final, so the naming convention must not prefix it again.
    op.drop_constraint(op.f(name), table, type_="check")
    op.create_check_constraint(op.f(name), table, expression)


def upgrade() -> None:
    for table, name, template in ROLE_CHECKS:
        _swap(table, name, template.format(roles=NEW_ROLES))
    _swap("verifications", "ck_verifications_level_valid", "verification_level IN ('CL', 'CH', 'OM')")

    op.add_column("teaching_plans", sa.Column("room", sa.String(length=40), nullable=True))

    op.create_table(
        "class_sessions",
        sa.Column("lecture_id", sa.Uuid(), nullable=False),
        sa.Column("professor_id", sa.Uuid(), nullable=False),
        sa.Column("session_date", sa.Date(), nullable=False),
        sa.Column("scheduled_start", sa.Time(), nullable=False),
        sa.Column("scheduled_end", sa.Time(), nullable=True),
        sa.Column("room", sa.String(length=40), nullable=True),
        sa.Column("entry_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("exit_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("entry_delay_minutes", sa.Integer(), server_default="0", nullable=False),
        sa.Column("timing_status", sa.String(length=16), nullable=False),
        sa.Column("delay_reason", sa.String(length=32), nullable=True),
        sa.Column("delay_remarks", sa.Text(), nullable=True),
        sa.Column("entry_recorded_by_id", sa.Uuid(), nullable=False),
        sa.Column("exit_recorded_by_id", sa.Uuid(), nullable=True),
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("timing_status IN ('ON_TIME', 'DELAYED')", name=op.f("ck_class_sessions_timing_status_valid")),
        sa.CheckConstraint(
            "delay_reason IS NULL OR delay_reason IN ('PREVIOUS_CLASS_OVERRUN', 'DEPARTMENTAL_MEETING', 'ADMINISTRATIVE_WORK', "
            "'TECHNICAL_ISSUE', 'ROOM_ISSUE', 'EMERGENCY', 'OTHER')", name=op.f("ck_class_sessions_delay_reason_valid")),
        sa.CheckConstraint("exit_at IS NULL OR exit_at > entry_at", name=op.f("ck_class_sessions_exit_after_entry")),
        sa.CheckConstraint("entry_delay_minutes >= 0", name=op.f("ck_class_sessions_delay_not_negative")),
        sa.CheckConstraint("timing_status <> 'DELAYED' OR delay_reason IS NOT NULL", name=op.f("ck_class_sessions_delayed_needs_reason")),
        sa.CheckConstraint("delay_reason IS DISTINCT FROM 'OTHER' OR length(trim(coalesce(delay_remarks, ''))) > 0",
                           name=op.f("ck_class_sessions_other_reason_needs_remarks")),
        sa.ForeignKeyConstraint(["lecture_id"], ["lectures.id"], name=op.f("fk_class_sessions_lecture_id_lectures"), ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["professor_id"], ["users.id"], name=op.f("fk_class_sessions_professor_id_users"), ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["entry_recorded_by_id"], ["users.id"], name=op.f("fk_class_sessions_entry_recorded_by_id_users"), ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["exit_recorded_by_id"], ["users.id"], name=op.f("fk_class_sessions_exit_recorded_by_id_users"), ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_class_sessions")),
        sa.UniqueConstraint("lecture_id", name=op.f("uq_class_sessions_lecture_id")),
    )
    op.create_index(op.f("ix_class_sessions_professor_id"), "class_sessions", ["professor_id"])
    op.create_index(op.f("ix_class_sessions_session_date"), "class_sessions", ["session_date"])
    op.create_index("ix_class_sessions_date_status", "class_sessions", ["session_date", "timing_status"])

    # Reference data: the role row itself. Demo users are created by scripts/seed.py.
    op.execute("INSERT INTO roles (code, name, description) VALUES "
               "('OM', 'Operations Manager', 'Records class entry/exit timings and gives final verification') "
               "ON CONFLICT (code) DO NOTHING")


def downgrade() -> None:
    op.execute("DELETE FROM verifications WHERE verification_level = 'OM'")
    op.execute("DELETE FROM notifications WHERE user_id IN (SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE r.code = 'OM')")
    op.execute("DELETE FROM audit_logs WHERE actor_role = 'OM'")
    op.drop_table("class_sessions")
    op.execute("DELETE FROM users WHERE role_id IN (SELECT id FROM roles WHERE code = 'OM')")
    op.execute("DELETE FROM roles WHERE code = 'OM'")
    op.drop_column("teaching_plans", "room")
    _swap("verifications", "ck_verifications_level_valid", "verification_level IN ('CL', 'CH')")
    for table, name, template in ROLE_CHECKS:
        _swap(table, name, template.format(roles=OLD_ROLES))
