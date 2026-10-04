"""StackSense API: one FastAPI app in front of the modular monolith.

    /v1/*        public API (intake, plans, billing, account, affiliate)
    /admin/v1/*  admin panel API (role-scoped, audited)
    /healthz     liveness;  /readyz  readiness (DB reachable)
"""

from __future__ import annotations

import logging
import time
import uuid
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from stacksense import __version__
from stacksense.config import get_settings
from stacksense.core.errors import DomainError
from stacksense.db import create_all, get_engine, session_scope

log = logging.getLogger("stacksense.api")


def bootstrap() -> None:
    """Dev/test: create tables and seed reference data. Production runs Alembic + `stacksense-seed`."""
    from stacksense.seed import seed_reference

    create_all(get_engine())
    with session_scope() as db:
        seed_reference(db)


@asynccontextmanager
async def lifespan(app: FastAPI):  # type: ignore[no-untyped-def]
    settings = get_settings()
    if settings.env in ("dev", "test"):
        bootstrap()
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    app = FastAPI(
        title="StackSense API",
        version=__version__,
        description="Adaptive intake, deterministic rules-and-evidence engine, Health Impact Map, dosage calendar, catalog and billing. "
        "The rules engine is the only source of doses, exclusions and interactions; the LLM only words.",
        lifespan=lifespan,
        docs_url="/docs",
        openapi_url="/openapi.json",
    )
    app.add_middleware(
        CORSMiddleware, allow_origins=settings.cors_origins, allow_credentials=True,
        allow_methods=["*"], allow_headers=["*"], expose_headers=["X-Request-ID"],
    )

    @app.middleware("http")
    async def request_context(request: Request, call_next: Any) -> Any:
        rid = request.headers.get("x-request-id") or uuid.uuid4().hex[:16]
        start = time.perf_counter()
        response = await call_next(request)
        ms = (time.perf_counter() - start) * 1000
        response.headers["X-Request-ID"] = rid
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Cache-Control"] = response.headers.get("Cache-Control", "no-store")
        # Paths only: no query strings (tokens) and never bodies (health data) in logs.
        log.info("rid=%s %s %s %s %.1fms", rid, request.method, request.url.path, response.status_code, ms)
        return response

    @app.exception_handler(DomainError)
    async def domain_error(request: Request, exc: DomainError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content={"error": {"code": exc.code, "message": exc.message, "details": exc.details}})

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(status_code=422, content={"error": {"code": "validation_error", "message": "Invalid request", "details": {"errors": exc.errors()[:10]}}})

    from stacksense.api.admin.routes import router as admin_router
    from stacksense.api.v1.account import auth_router, me_router
    from stacksense.api.v1.commerce import billing_router, click_router, webhook_router
    from stacksense.api.v1.intake import router as intake_router
    from stacksense.api.v1.meta import router as meta_router
    from stacksense.api.v1.plans import calendar_router
    from stacksense.api.v1.plans import router as plans_router

    for r in (meta_router, intake_router, plans_router, calendar_router, billing_router, webhook_router, click_router, auth_router, me_router):
        app.include_router(r, prefix="/v1")
    app.include_router(admin_router)

    @app.get("/healthz", tags=["ops"])
    def healthz() -> dict[str, str]:
        return {"status": "ok", "version": __version__}

    @app.get("/readyz", tags=["ops"])
    def readyz() -> dict[str, Any]:
        with get_engine().connect() as conn:
            conn.execute(text("SELECT 1"))
        from stacksense.knowledge.base import default_kb
        from stacksense.modules.intake.graph import default_graph

        return {"status": "ready", "rules_version": default_kb().version, "graph_version": default_graph().version}

    return app


app = create_app()
