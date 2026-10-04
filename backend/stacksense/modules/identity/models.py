from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from stacksense.db import Base, JsonType, UTCDateTime, utcnow


class User(Base):
    """Identity only. Health data lives under ``subject_id`` in the health schema."""

    __tablename__ = "users"
    __table_args__ = {"schema": "identity"}

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    email_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    email_enc: Mapped[str] = mapped_column(Text)
    locale: Mapped[str] = mapped_column(String(10), default="en")
    tz: Mapped[str] = mapped_column(String(64), default="America/Toronto")
    country: Mapped[str | None] = mapped_column(String(2))
    region: Mapped[str | None] = mapped_column(String(8))
    stripe_customer_id: Mapped[str | None] = mapped_column(String(64), index=True)
    subject_id: Mapped[str | None] = mapped_column(String(40), index=True)
    status: Mapped[str] = mapped_column(String(16), default="active")
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    last_active_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    deleted_at: Mapped[datetime | None] = mapped_column(UTCDateTime())


class MagicLink(Base):
    """Single-use magic-link login tokens (the token itself is signed; this row makes it single-use)."""

    __tablename__ = "magic_links"
    __table_args__ = {"schema": "identity"}

    jti: Mapped[str] = mapped_column(String(40), primary_key=True)
    email_hash: Mapped[str] = mapped_column(String(64), index=True)
    purpose: Mapped[str] = mapped_column(String(16), default="login")
    payload: Mapped[dict] = mapped_column(JsonType, default=dict)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime())
    used_at: Mapped[datetime | None] = mapped_column(UTCDateTime())


class PushSubscription(Base):
    __tablename__ = "push_subscriptions"
    __table_args__ = {"schema": "identity"}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("identity.users.id", ondelete="CASCADE"), index=True)
    endpoint: Mapped[str] = mapped_column(Text)
    keys: Mapped[dict] = mapped_column(JsonType, default=dict)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
