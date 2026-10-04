from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from stacksense.db import Base, JsonType, UTCDateTime, utcnow


class BillingPlan(Base):
    __tablename__ = "billing_plans"
    __table_args__ = {"schema": "billing"}

    key: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str] = mapped_column(String(64))
    kind: Mapped[str] = mapped_column(String(16))  # free | one_time | subscription
    features: Mapped[list] = mapped_column(JsonType, default=list)
    limits: Mapped[dict] = mapped_column(JsonType, default=dict)
    trial_days: Mapped[int] = mapped_column(Integer, default=0)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow, onupdate=utcnow)


class Price(Base):
    __tablename__ = "prices"
    __table_args__ = {"schema": "billing"}

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    plan_key: Mapped[str] = mapped_column(ForeignKey("billing.billing_plans.key"), index=True)
    currency: Mapped[str] = mapped_column(String(3))
    region: Mapped[str] = mapped_column(String(8))
    amount: Mapped[int] = mapped_column(Integer)  # minor units
    interval: Mapped[str | None] = mapped_column(String(8))
    stripe_price_id: Mapped[str | None] = mapped_column(String(64))
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class CheckoutSession(Base):
    __tablename__ = "checkout_sessions"
    __table_args__ = {"schema": "billing"}

    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    user_id: Mapped[str | None] = mapped_column(String(40), index=True)
    email_hash: Mapped[str | None] = mapped_column(String(64))
    plan_key: Mapped[str] = mapped_column(String(32))
    price_id: Mapped[str] = mapped_column(String(64))
    plan_id: Mapped[str | None] = mapped_column(String(40))  # the StackSense plan being unlocked
    session_id: Mapped[str | None] = mapped_column(String(40))  # anonymous intake to attach
    promo_code: Mapped[str | None] = mapped_column(String(32))
    mode: Mapped[str] = mapped_column(String(8), default="fake")  # fake | stripe
    status: Mapped[str] = mapped_column(String(16), default="open")
    url: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    completed_at: Mapped[datetime | None] = mapped_column(UTCDateTime())


class Purchase(Base):
    __tablename__ = "purchases"
    __table_args__ = {"schema": "billing"}

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(40), index=True)
    plan_key: Mapped[str] = mapped_column(String(32))
    price_id: Mapped[str | None] = mapped_column(String(64))
    stripe_checkout_id: Mapped[str | None] = mapped_column(String(80), unique=True)
    stripe_payment_intent: Mapped[str | None] = mapped_column(String(80), index=True)
    amount: Mapped[int] = mapped_column(Integer, default=0)
    currency: Mapped[str] = mapped_column(String(3), default="CAD")
    status: Mapped[str] = mapped_column(String(16), default="paid")  # paid | refunded
    plan_id: Mapped[str | None] = mapped_column(String(40))
    promo_code: Mapped[str | None] = mapped_column(String(32))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    refunded_at: Mapped[datetime | None] = mapped_column(UTCDateTime())


class Subscription(Base):
    __tablename__ = "subscriptions"
    __table_args__ = {"schema": "billing"}

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(40), index=True)
    plan_key: Mapped[str] = mapped_column(String(32))
    price_id: Mapped[str | None] = mapped_column(String(64))
    stripe_subscription_id: Mapped[str] = mapped_column(String(80), unique=True)
    status: Mapped[str] = mapped_column(String(24))  # trialing | active | past_due | canceled | unpaid
    current_period_end: Mapped[datetime | None] = mapped_column(UTCDateTime())
    trial_end: Mapped[datetime | None] = mapped_column(UTCDateTime())
    cancel_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    last_event_created: Mapped[int] = mapped_column(Integer, default=0)  # ignore out-of-order webhooks
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow, onupdate=utcnow)


class Entitlement(Base):
    __tablename__ = "entitlements"
    __table_args__ = {"schema": "billing"}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(String(40), index=True)
    feature_key: Mapped[str] = mapped_column(String(32))
    source: Mapped[str] = mapped_column(String(16))  # purchase | subscription | grant | trial
    source_id: Mapped[str | None] = mapped_column(String(80))
    granted_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    expires_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    revoked_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    note: Mapped[str | None] = mapped_column(Text)


class StripeEvent(Base):
    """Idempotency + replay store for webhooks."""

    __tablename__ = "stripe_events"
    __table_args__ = {"schema": "billing"}

    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    type: Mapped[str] = mapped_column(String(64))
    created: Mapped[int] = mapped_column(Integer)
    payload: Mapped[dict] = mapped_column(JsonType)
    status: Mapped[str] = mapped_column(String(16), default="processed")
    error: Mapped[str | None] = mapped_column(Text)
    received_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)


class PaywallConfig(Base):
    __tablename__ = "paywall_configs"
    __table_args__ = {"schema": "billing"}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    version: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(16), default="draft")  # draft | published | archived
    gates: Mapped[dict] = mapped_column(JsonType, default=dict)
    triggers: Mapped[list] = mapped_column(JsonType, default=list)
    copy_: Mapped[dict] = mapped_column("copy", JsonType, default=dict)
    created_by: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    published_at: Mapped[datetime | None] = mapped_column(UTCDateTime())


class Experiment(Base):
    __tablename__ = "experiments"
    __table_args__ = {"schema": "billing"}

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(128))
    surface: Mapped[str] = mapped_column(String(16))  # price | gates | copy | timing
    region: Mapped[str | None] = mapped_column(String(8))
    variants: Mapped[list] = mapped_column(JsonType, default=list)  # [{key, weight, config}]
    metrics: Mapped[list] = mapped_column(JsonType, default=list)
    guardrails: Mapped[dict] = mapped_column(JsonType, default=dict)  # {refund_rate: 0.05, complaint_rate: 0.01}
    status: Mapped[str] = mapped_column(String(16), default="draft")  # draft | running | stopped
    stop_reason: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)


class ExperimentAssignment(Base):
    __tablename__ = "experiment_assignments"
    __table_args__ = (UniqueConstraint("experiment_key", "subject_key"), {"schema": "billing"})

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    experiment_key: Mapped[str] = mapped_column(String(64), index=True)
    subject_key: Mapped[str] = mapped_column(String(64))
    variant: Mapped[str] = mapped_column(String(32))
    assigned_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)


class PromoCode(Base):
    __tablename__ = "promo_codes"
    __table_args__ = {"schema": "billing"}

    code: Mapped[str] = mapped_column(String(32), primary_key=True)
    kind: Mapped[str] = mapped_column(String(16))  # coupon | partner
    percent_off: Mapped[float] = mapped_column(Float, default=0)
    plan_keys: Mapped[list] = mapped_column(JsonType, default=list)
    trial_days: Mapped[int | None] = mapped_column(Integer)
    partner: Mapped[str | None] = mapped_column(String(64))
    max_uses: Mapped[int | None] = mapped_column(Integer)
    uses: Mapped[int] = mapped_column(Integer, default=0)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    expires_at: Mapped[datetime | None] = mapped_column(UTCDateTime())


class FunnelEvent(Base):
    """Product analytics with no health content (consent-gated upstream)."""

    __tablename__ = "funnel_events"
    __table_args__ = {"schema": "billing"}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    actor_hash: Mapped[str] = mapped_column(String(64), index=True)
    event: Mapped[str] = mapped_column(String(48), index=True)
    props: Mapped[dict] = mapped_column(JsonType, default=dict)
    ts: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow, index=True)
    note: Mapped[str | None] = mapped_column(Text)
