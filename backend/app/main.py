import logging

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from pathlib import Path

from fastapi.staticfiles import StaticFiles

from app.api import academic, auth, classes, imports, operations, professor, reports, sprint, teaching_plans, users, verification
from app.core.config import get_settings
from app.core.errors import register_error_handlers
from app.db.session import engine

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
settings = get_settings()

app = FastAPI(
    title=settings.app_name,
    version="1.0.0",
    docs_url=None if settings.is_production else "/api/docs",
    openapi_url=None if settings.is_production else "/api/openapi.json",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)
register_error_handlers(app)

api = APIRouter(prefix="/api")
for module in (auth, users, academic, teaching_plans, imports, sprint, professor, classes, verification, operations, reports):
    api.include_router(module.router)


@api.get("/health", tags=["system"])
def health():
    with engine.connect() as conn:
        conn.execute(text("SELECT 1"))
    return {"status": "ok"}


app.include_router(api)

# Locally stored class photos (used only when no S3 bucket is configured). Keys are random, never user-supplied names.
if not settings.storage_bucket:
    Path(settings.local_upload_dir).mkdir(parents=True, exist_ok=True)
    app.mount("/api/uploads", StaticFiles(directory=settings.local_upload_dir), name="uploads")
