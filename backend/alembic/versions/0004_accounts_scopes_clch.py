"""real user accounts, verification / operations scopes, CL + CH merged into one CL_CH role

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-03 16:00:00

Data strategy (nothing is deleted):
  * accounts with role CL or CH become CL_CH; the two old role rows are then removed
  * verification steps at level CL become level CL_CH (same step, new name); `verifier_role`
    keeps the role the person held at the time (CL), so the audit trail still reads truthfully
  * a CH step that was still PENDING becomes the OM step - the record was already academically
    verified, and the new chain is Professor -> CL/CH -> OM
  * CH steps that were already decided stay as legacy 'CH' rows for the audit trail
  * audit_logs.actor_role keeps its historical CL / CH values
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = '0004'
down_revision: str | None = '0003'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ACTIVE_ROLES = "'ADMIN', 'PROFESSOR', 'CL_CH', 'OM'"
WITH_LEGACY = ACTIVE_ROLES + ", 'CL', 'CH'"
OLD_ROLES = "'ADMIN', 'PROFESSOR', 'CL', 'CH', 'OM'"


def _swap(table: str, name: str, expression: str | None) -> None:
    op.drop_constraint(op.f(name), table, type_="check")
    if expression:
        op.create_check_constraint(op.f(name), table, expression)


def upgrade() -> None:
    # ---- accounts
    op.add_column("users", sa.Column("username", sa.String(length=60), nullable=True))
    op.add_column("users", sa.Column("phone", sa.String(length=20), nullable=True))
    op.add_column("users", sa.Column("must_change_password", sa.Boolean(), server_default="false", nullable=False))
    op.add_column("users", sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True))
    op.create_unique_constraint(op.f("uq_users_username"), "users", ["username"])

    op.create_table(
        "user_scopes",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("mode", sa.String(length=16), server_default="ALL", nullable=False),
        sa.Column("department_id", sa.Uuid(), nullable=True),
        sa.Column("semester_numbers", postgresql.JSONB(astext_type=sa.Text()), server_default="[]", nullable=False),
        sa.Column("section_names", postgresql.JSONB(astext_type=sa.Text()), server_default="[]", nullable=False),
        sa.Column("subject_ids", postgresql.JSONB(astext_type=sa.Text()), server_default="[]", nullable=False),
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("mode IN ('ALL', 'SELECTED')", name=op.f("ck_user_scopes_mode_valid")),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name=op.f("fk_user_scopes_user_id_users"), ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["department_id"], ["departments.id"], name=op.f("fk_user_scopes_department_id_departments"), ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_user_scopes")),
        sa.UniqueConstraint("user_id", name=op.f("uq_user_scopes_user_id")),
    )

    # ---- CL + CH -> CL_CH
    _swap("roles", "ck_roles_code_valid", None)
    op.execute("INSERT INTO roles (code, name, description) VALUES "
               "('CL_CH', 'CL/CH', 'Academic verifier: reviews professor submissions within the assigned scope') "
               "ON CONFLICT (code) DO NOTHING")
    op.execute("UPDATE users SET role_id = (SELECT id FROM roles WHERE code = 'CL_CH') "
               "WHERE role_id IN (SELECT id FROM roles WHERE code IN ('CL', 'CH'))")
    op.execute("DELETE FROM roles WHERE code IN ('CL', 'CH')")
    op.create_check_constraint(op.f("ck_roles_code_valid"), "roles", f"code IN ({ACTIVE_ROLES})")
    _swap("audit_logs", "ck_audit_logs_actor_role_valid", f"actor_role IS NULL OR actor_role IN ({WITH_LEGACY})")
    _swap("verifications", "ck_verifications_verifier_role_valid", f"verifier_role IS NULL OR verifier_role IN ({WITH_LEGACY})")

    _swap("verifications", "ck_verifications_level_valid", None)
    op.execute("UPDATE verifications SET verification_level = 'CL_CH' WHERE verification_level = 'CL'")
    op.execute("UPDATE verifications SET verification_level = 'OM' WHERE verification_level = 'CH' AND status = 'PENDING'")
    op.create_check_constraint(op.f("ck_verifications_level_valid"), "verifications", "verification_level IN ('CL_CH', 'OM', 'CH')")

    # Notifications already delivered keep their text, but their links must still open something.
    op.execute("UPDATE notifications SET title = replace(title, 'CL-verified', 'CL/CH-verified') WHERE kind = 'verification.pending'")


def downgrade() -> None:
    _swap("verifications", "ck_verifications_level_valid", None)
    op.execute("UPDATE verifications SET verification_level = 'CL' WHERE verification_level = 'CL_CH'")
    op.create_check_constraint(op.f("ck_verifications_level_valid"), "verifications", "verification_level IN ('CL', 'CH', 'OM')")

    _swap("roles", "ck_roles_code_valid", None)
    op.execute("INSERT INTO roles (code, name, description) VALUES ('CL', 'CL', 'First-level verifier'), "
               "('CH', 'CH', 'Second-level verifier') ON CONFLICT (code) DO NOTHING")
    # The merge cannot be undone per person; every CL/CH account returns as CL.
    op.execute("UPDATE users SET role_id = (SELECT id FROM roles WHERE code = 'CL') "
               "WHERE role_id IN (SELECT id FROM roles WHERE code = 'CL_CH')")
    op.execute("DELETE FROM roles WHERE code = 'CL_CH'")
    op.create_check_constraint(op.f("ck_roles_code_valid"), "roles", f"code IN ({OLD_ROLES})")
    op.execute("UPDATE audit_logs SET actor_role = 'CL' WHERE actor_role = 'CL_CH'")
    op.execute("UPDATE verifications SET verifier_role = 'CL' WHERE verifier_role = 'CL_CH'")
    _swap("audit_logs", "ck_audit_logs_actor_role_valid", f"actor_role IS NULL OR actor_role IN ({OLD_ROLES})")
    _swap("verifications", "ck_verifications_verifier_role_valid", f"verifier_role IS NULL OR verifier_role IN ({OLD_ROLES})")

    op.drop_table("user_scopes")
    op.drop_constraint(op.f("uq_users_username"), "users", type_="unique")
    op.drop_column("users", "last_login_at")
    op.drop_column("users", "must_change_password")
    op.drop_column("users", "phone")
    op.drop_column("users", "username")
