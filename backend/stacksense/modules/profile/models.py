"""Health schema (pseudonymous, encrypted payloads) and the consent ledger."""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import Boolean, Date, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from stacksense.db import Base, JsonType, UTCDateTime, utcnow


class Subject(Base):
    """A pseudonymous health identity with its own wrapped data key (crypto-shredding)."""

    __tablename__ = "subjects"
    __table_args__ = {"schema": "health"}

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    wrapped_dek: Mapped[str | None] = mapped_column(Text)
    anonymous: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    linked_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    deleted_at: Mapped[datetime | None] = mapped_column(UTCDateTime())


class IntakeSession(Base):
    __tablename__ = "intake_sessions"
    __table_args__ = {"schema": "health"}

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    subject_id: Mapped[str] = mapped_column(ForeignKey("health.subjects.id", ondelete="CASCADE"), index=True)
    graph_version: Mapped[str] = mapped_column(String(40))
    rules_version: Mapped[str | None] = mapped_column(String(40))
    status: Mapped[str] = mapped_column(String(16), default="active")  # active | review | completed | stopped | abandoned
    phase: Mapped[str | None] = mapped_column(String(32))
    state_enc: Mapped[str] = mapped_column(Text)
    flags: Mapped[list] = mapped_column(JsonType, default=list)
    locale: Mapped[str] = mapped_column(String(10), default="en")
    cards_answered: Mapped[int] = mapped_column(Integer, default=0)
    branch_events: Mapped[int] = mapped_column(Integer, default=0)
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    secret_hash: Mapped[str] = mapped_column(String(64))
    returning_user: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow, onupdate=utcnow)
    completed_at: Mapped[datetime | None] = mapped_column(UTCDateTime())


class Answer(Base):
    """Append-only answer history (the session state holds the current answers)."""

    __tablename__ = "answers"
    __table_args__ = {"schema": "health"}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("health.intake_sessions.id", ondelete="CASCADE"), index=True)
    node_id: Mapped[str] = mapped_column(String(64))
    node_version: Mapped[int] = mapped_column(Integer)
    value_enc: Mapped[str] = mapped_column(Text)
    source: Mapped[str] = mapped_column(String(16), default="user")
    answered_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)


class Lab(Base):
    __tablename__ = "labs"
    __table_args__ = {"schema": "health"}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    subject_id: Mapped[str] = mapped_column(ForeignKey("health.subjects.id", ondelete="CASCADE"), index=True)
    analyte: Mapped[str] = mapped_column(String(32))
    value_enc: Mapped[str] = mapped_column(Text)
    unit: Mapped[str | None] = mapped_column(String(16))
    drawn_at: Mapped[date | None] = mapped_column(Date)
    source: Mapped[str] = mapped_column(String(32), default="self_reported")
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)


class Plan(Base):
    __tablename__ = "plans"
    __table_args__ = {"schema": "health"}

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    subject_id: Mapped[str] = mapped_column(ForeignKey("health.subjects.id", ondelete="CASCADE"), index=True)
    session_id: Mapped[str | None] = mapped_column(String(40), index=True)
    parent_plan_id: Mapped[str | None] = mapped_column(String(40))
    rules_version: Mapped[str] = mapped_column(String(40))
    graph_version: Mapped[str] = mapped_column(String(40))
    impact_version: Mapped[str] = mapped_column(String(40))
    catalog_snapshot_id: Mapped[str | None] = mapped_column(String(40))
    status: Mapped[str] = mapped_column(String(16), default="active")  # active | superseded
    reason: Mapped[str] = mapped_column(String(32), default="intake")  # intake | labs | rerun | checkin
    result_enc: Mapped[str] = mapped_column(Text)
    inputs_enc: Mapped[str | None] = mapped_column(Text)  # PlanInput for reproducibility
    summary: Mapped[dict] = mapped_column(JsonType, default=dict)  # non-identifying (item ids, counts)
    start_date: Mapped[date] = mapped_column(Date)
    calendar_key: Mapped[str] = mapped_column(String(40), index=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    superseded_at: Mapped[datetime | None] = mapped_column(UTCDateTime())


class PlanItem(Base):
    __tablename__ = "plan_items"
    __table_args__ = {"schema": "health"}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    plan_id: Mapped[str] = mapped_column(ForeignKey("health.plans.id", ondelete="CASCADE"), index=True)
    ingredient_id: Mapped[str] = mapped_column(String(64))
    form: Mapped[str | None] = mapped_column(String(32))
    dose: Mapped[float | None] = mapped_column(Float)
    unit: Mapped[str | None] = mapped_column(String(16))
    state: Mapped[str] = mapped_column(String(16))  # active | locked | excluded | dropped
    reason_codes: Mapped[list] = mapped_column(JsonType, default=list)


class PlanItemProduct(Base):
    __tablename__ = "plan_item_products"
    __table_args__ = {"schema": "health"}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    plan_item_id: Mapped[int] = mapped_column(ForeignKey("health.plan_items.id", ondelete="CASCADE"), index=True)
    product_id: Mapped[str] = mapped_column(String(64))
    rank: Mapped[int] = mapped_column(Integer)
    retailer: Mapped[str | None] = mapped_column(String(32))
    affiliate_url: Mapped[str | None] = mapped_column(Text)


class DoseEvent(Base):
    __tablename__ = "dose_events"
    __table_args__ = {"schema": "health"}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    plan_id: Mapped[str] = mapped_column(ForeignKey("health.plans.id", ondelete="CASCADE"), index=True)
    ingredient_id: Mapped[str] = mapped_column(String(64))
    slot: Mapped[str] = mapped_column(String(16))
    rrule: Mapped[str] = mapped_column(String(255))
    local_time: Mapped[str] = mapped_column(String(5))
    tz: Mapped[str] = mapped_column(String(64))
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)
    uid: Mapped[str] = mapped_column(String(80), index=True)
    sequence: Mapped[int] = mapped_column(Integer, default=0)


class DoseLog(Base):
    __tablename__ = "dose_logs"
    __table_args__ = (UniqueConstraint("plan_id", "occurred_on", "slot", "ingredient_id"), {"schema": "health"})

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    subject_id: Mapped[str] = mapped_column(ForeignKey("health.subjects.id", ondelete="CASCADE"), index=True)
    plan_id: Mapped[str] = mapped_column(ForeignKey("health.plans.id", ondelete="CASCADE"), index=True)
    ingredient_id: Mapped[str] = mapped_column(String(64), default="*")  # "*" = whole slot
    slot: Mapped[str] = mapped_column(String(16))
    occurred_on: Mapped[date] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(16))  # taken | skipped | late
    logged_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)


class Checkin(Base):
    __tablename__ = "checkins"
    __table_args__ = {"schema": "health"}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    subject_id: Mapped[str] = mapped_column(ForeignKey("health.subjects.id", ondelete="CASCADE"), index=True)
    plan_id: Mapped[str] = mapped_column(ForeignKey("health.plans.id", ondelete="CASCADE"), index=True)
    week: Mapped[int] = mapped_column(Integer)
    payload_enc: Mapped[str] = mapped_column(Text)  # area scores + side effects
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)


class ProfileEvent(Base):
    """Event-sourced health history (section 14.4). Append-only; the profile is a projection."""

    __tablename__ = "profile_events"
    __table_args__ = {"schema": "health"}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    subject_id: Mapped[str] = mapped_column(ForeignKey("health.subjects.id", ondelete="CASCADE"), index=True)
    type: Mapped[str] = mapped_column(String(32))  # answer | lab | dose | checkin | side_effect | preference | plan
    payload_enc: Mapped[str] = mapped_column(Text)
    ts: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow, index=True)


class UserFeatures(Base):
    __tablename__ = "user_features"
    __table_args__ = {"schema": "health"}

    subject_id: Mapped[str] = mapped_column(ForeignKey("health.subjects.id", ondelete="CASCADE"), primary_key=True)
    features_enc: Mapped[str] = mapped_column(Text)
    computed_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)


class CalendarFeed(Base):
    """SEQUENCE bookkeeping per plan lineage so subscribed calendars update in place."""

    __tablename__ = "calendar_feeds"
    __table_args__ = {"schema": "health"}

    calendar_key: Mapped[str] = mapped_column(String(40), primary_key=True)
    subject_id: Mapped[str] = mapped_column(ForeignKey("health.subjects.id", ondelete="CASCADE"), index=True)
    feed_state: Mapped[dict] = mapped_column(JsonType, default=dict)
    token_version: Mapped[int] = mapped_column(Integer, default=1)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow, onupdate=utcnow)


class Consent(Base):
    """Append-only consent ledger (section 14.1). Never updated or deleted, except when the
    whole account is erased."""

    __tablename__ = "consents"
    __table_args__ = {"schema": "identity"}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("identity.users.id", ondelete="CASCADE"), index=True)
    purpose: Mapped[str] = mapped_column(String(32))
    granted: Mapped[bool] = mapped_column(Boolean)
    policy_version: Mapped[str] = mapped_column(String(32))
    text_hash: Mapped[str] = mapped_column(String(64))
    method: Mapped[str] = mapped_column(String(16))  # checkbox | settings | support
    actor: Mapped[str] = mapped_column(String(64), default="user")
    ts: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow, index=True)
    enforced_at: Mapped[datetime | None] = mapped_column(UTCDateTime())


class PrivacyRequest(Base):
    __tablename__ = "privacy_requests"
    __table_args__ = {"schema": "admin"}

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(40), index=True)
    type: Mapped[str] = mapped_column(String(16))  # export | delete | correct
    status: Mapped[str] = mapped_column(String(16), default="pending")
    jurisdiction: Mapped[str | None] = mapped_column(String(16))
    due_at: Mapped[datetime] = mapped_column(UTCDateTime())
    completed_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    result: Mapped[dict] = mapped_column(JsonType, default=dict)
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)


class StaffAccess(Base):
    """Reason-logged staff access to identifiable health data; shown in the user's privacy history."""

    __tablename__ = "staff_access"
    __table_args__ = {"schema": "admin"}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    admin_id: Mapped[str] = mapped_column(String(40))
    admin_role: Mapped[str] = mapped_column(String(32))
    user_id: Mapped[str] = mapped_column(String(40), index=True)
    reason: Mapped[str] = mapped_column(Text)
    scope: Mapped[str] = mapped_column(String(64), default="health_profile")
    ts: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
