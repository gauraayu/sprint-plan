"""Integration-test fixtures: a real PostgreSQL database, migrated with Alembic and seeded.

Set TEST_DATABASE_URL to point at a disposable database. It is wiped on every run.
"""
import os

TEST_URL = os.environ.get("TEST_DATABASE_URL", "postgresql+psycopg://postgres@localhost:5432/teaching_portal_test")
os.environ["DATABASE_URL"] = TEST_URL  # must happen before the app (and its engine) is imported

import pytest  # noqa: E402
from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.core.config import get_settings  # noqa: E402

get_settings.cache_clear()


@pytest.fixture(scope="session")
def db_engine():
    from app.db.session import engine

    with engine.begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE; CREATE SCHEMA public;"))
    cfg = Config(os.path.join(os.path.dirname(__file__), "..", "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(os.path.dirname(__file__), "..", "alembic"))
    command.upgrade(cfg, "head")

    from app.db.session import SessionLocal
    from scripts.seed import seed

    db = SessionLocal()
    seed(db)
    db.close()
    yield engine


@pytest.fixture()
def db(db_engine):
    from app.db.session import SessionLocal

    session = SessionLocal()
    yield session
    session.close()


@pytest.fixture(scope="session")
def client(db_engine):
    from app.main import app

    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture(scope="session")
def tokens(client):
    """Real sign-in for each seeded demo account - there is no role-selection shortcut any more."""
    out = {}
    for role, username in (("ADMIN", "admin.demo"), ("PROFESSOR", "professor.demo"), ("CL_CH", "clch.demo"), ("OM", "om.demo")):
        r = client.post("/api/auth/login", json={"identifier": username, "password": "Demo@1234"})
        assert r.status_code == 200, r.text
        assert r.json()["role"] == role
        out[role] = {"Authorization": f"Bearer {r.json()['access_token']}"}
    return out
