from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, Float, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from stacksense.db import Base, JsonType, UTCDateTime, utcnow


class AdminUser(Base):
    __tablename__ = "admin_users"
    __table_args__ = {"schema": "admin"}

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True)
    name: Mapped[str] = mapped_column(String(128))
    role: Mapped[str] = mapped_column(String(32))
    sso_subject: Mapped[str | None] = mapped_column(String(128), unique=True)
    totp_secret_enc: Mapped[str | None] = mapped_column(Text)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    last_login_at: Mapped[datetime | None] = mapped_column(UTCDateTime())


class AuditLog(Base):
    """Append-only (a Postgres trigger in the migration rejects UPDATE/DELETE)."""

    __tablename__ = "audit_log"
    __table_args__ = {"schema": "admin"}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    actor: Mapped[str] = mapped_column(String(64), index=True)
    role: Mapped[str] = mapped_column(String(32))
    action: Mapped[str] = mapped_column(String(64), index=True)
    target_type: Mapped[str] = mapped_column(String(32))
    target_id: Mapped[str | None] = mapped_column(String(80), index=True)
    before: Mapped[dict | None] = mapped_column(JsonType)
    after: Mapped[dict | None] = mapped_column(JsonType)
    reason: Mapped[str | None] = mapped_column(Text)
    ts: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow, index=True)


class Release(Base):
    """Versioned rules or graph content moving through Draft -> Checks -> Review -> Approved -> Published."""

    __tablename__ = "releases"
    __table_args__ = {"schema": "admin"}

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    kind: Mapped[str] = mapped_column(String(8))  # rules | graph
    version: Mapped[str] = mapped_column(String(40), index=True)
    base_version: Mapped[str | None] = mapped_column(String(40))
    status: Mapped[str] = mapped_column(String(16), default="draft")
    data: Mapped[dict] = mapped_column(JsonType)
    author: Mapped[str] = mapped_column(String(64))
    reviewer: Mapped[str | None] = mapped_column(String(64))
    rollout_pct: Mapped[int] = mapped_column(Integer, default=0)
    check_report: Mapped[dict] = mapped_column(JsonType, default=dict)
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    submitted_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    reviewed_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    published_at: Mapped[datetime | None] = mapped_column(UTCDateTime())


class Outbox(Base):
    """Notification outbox (push, email). The worker delivers and marks rows sent."""

    __tablename__ = "outbox"
    __table_args__ = {"schema": "admin"}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str | None] = mapped_column(String(40), index=True)
    channel: Mapped[str] = mapped_column(String(8))  # push | email
    template: Mapped[str] = mapped_column(String(48))
    payload: Mapped[dict] = mapped_column(JsonType, default=dict)
    dedupe_key: Mapped[str | None] = mapped_column(String(128), unique=True)
    status: Mapped[str] = mapped_column(String(16), default="pending")
    scheduled_for: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow, index=True)
    sent_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    error: Mapped[str | None] = mapped_column(Text)


class LLMCallLog(Base):
    __tablename__ = "llm_calls"
    __table_args__ = {"schema": "admin"}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    job: Mapped[str] = mapped_column(String(16), index=True)
    model: Mapped[str] = mapped_column(String(48))
    outcome: Mapped[str] = mapped_column(String(48))
    prompt_hash: Mapped[str] = mapped_column(String(16))
    response_hash: Mapped[str | None] = mapped_column(String(16))
    latency_ms: Mapped[int] = mapped_column(Integer, default=0)
    cost_usd: Mapped[float] = mapped_column(Float, default=0)
    ts: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow, index=True)


class JobRun(Base):
    __tablename__ = "job_runs"
    __table_args__ = {"schema": "admin"}

    name: Mapped[str] = mapped_column(String(48), primary_key=True)
    last_run_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    status: Mapped[str] = mapped_column(String(16), default="never")
    detail: Mapped[dict] = mapped_column(JsonType, default=dict)
