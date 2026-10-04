"""Entitlements service (section 13.3). The API checks ``has_feature(user, key)`` on every
gated read. Plans map to feature sets in data (admin-editable), so a new bundle needs no code."""

from __future__ import annotations

import json
from datetime import datetime
from functools import lru_cache
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from stacksense.config import DATA_DIR
from stacksense.db import utcnow
from stacksense.modules.billing.models import BillingPlan, Entitlement, Price

FEATURE_KEYS = (
    "impact_full", "impact_history", "exact_doses", "product_alternatives", "price_alerts", "calendar_90d",
    "calendar_ongoing", "reminders", "doctor_note", "checkins", "lab_replan", "rerun_intake",
)
# Safety information can never be gated (section 13.4); the admin feature matrix shows this row locked.
ALWAYS_FREE = ("intake", "review", "stack_names", "why_you_short", "exclusions", "interactions", "locked_items", "stop_cards", "safety_banners", "best_match_product")


@lru_cache
def seed_plans() -> dict[str, Any]:
    return json.loads((DATA_DIR / "billing" / "plans.json").read_text())


def plan_defs(db: Session) -> dict[str, dict[str, Any]]:
    rows = db.scalars(select(BillingPlan)).all()
    if not rows:
        return {p["key"]: p for p in seed_plans()["plans"]}
    prices = db.scalars(select(Price).where(Price.active.is_(True))).all()
    out = {}
    for r in rows:
        out[r.key] = {
            "key": r.key, "name": r.name, "kind": r.kind, "features": list(r.features), "limits": dict(r.limits), "trial_days": r.trial_days,
            "active": r.active,
            "prices": [{"id": p.id, "currency": p.currency, "region": p.region, "amount": p.amount, "interval": p.interval, "stripe_price_id": p.stripe_price_id} for p in prices if p.plan_key == r.key],
        }
    return out


def seed_billing(db: Session) -> None:
    if db.scalar(select(BillingPlan).limit(1)):
        return
    for p in seed_plans()["plans"]:
        db.add(BillingPlan(key=p["key"], name=p["name"], kind=p["kind"], features=p["features"], limits=p["limits"], trial_days=p.get("trial_days", 0)))
        db.flush()
        for pr in p["prices"]:
            db.add(Price(id=pr["id"], plan_key=p["key"], currency=pr["currency"], region=pr["region"], amount=pr["amount"], interval=pr["interval"], stripe_price_id=pr.get("stripe_price_id")))
    db.flush()


class Entitlements:
    def __init__(self, db: Session) -> None:
        self.db = db

    def active(self, user_id: str | None, at: datetime | None = None) -> list[Entitlement]:
        if not user_id:
            return []
        at = at or utcnow()
        rows = self.db.scalars(select(Entitlement).where(Entitlement.user_id == user_id, Entitlement.revoked_at.is_(None))).all()
        return [r for r in rows if r.expires_at is None or r.expires_at > at]

    def features(self, user_id: str | None) -> set[str]:
        return {e.feature_key for e in self.active(user_id)}

    def has_feature(self, user_id: str | None, key: str) -> bool:
        return key in self.features(user_id)

    def limits(self, features: set[str]) -> dict[str, Any]:
        return {
            "calendar_days": 3650 if "calendar_ongoing" in features else 90 if "calendar_90d" in features else 7,
            "impact_areas": 8 if "impact_full" in features else 3,
            "rerun_intake": -1 if "calendar_ongoing" in features and "rerun_intake" in features else (1 if "rerun_intake" in features else 0),
        }

    def tier(self, features: set[str]) -> str:
        if "calendar_ongoing" in features:
            return "plus"
        if "exact_doses" in features:
            return "full_report"
        return "free"

    def grant_plan(self, user_id: str, plan_key: str, source: str, source_id: str | None, expires_at: datetime | None = None, note: str | None = None) -> list[Entitlement]:
        plan = plan_defs(self.db).get(plan_key)
        if plan is None:
            raise KeyError(plan_key)
        return [self.grant(user_id, f, source, source_id, expires_at, note) for f in plan["features"]]

    def grant(self, user_id: str, feature: str, source: str, source_id: str | None, expires_at: datetime | None = None, note: str | None = None) -> Entitlement:
        if feature not in FEATURE_KEYS:
            raise KeyError(feature)
        existing = self.db.scalar(select(Entitlement).where(
            Entitlement.user_id == user_id, Entitlement.feature_key == feature, Entitlement.source == source,
            Entitlement.source_id == source_id, Entitlement.revoked_at.is_(None),
        ))
        if existing:
            existing.expires_at = expires_at
            return existing
        e = Entitlement(user_id=user_id, feature_key=feature, source=source, source_id=source_id, expires_at=expires_at, note=note)
        self.db.add(e)
        self.db.flush()
        return e

    def set_expiry(self, source_id: str, expires_at: datetime | None) -> int:
        rows = self.db.scalars(select(Entitlement).where(Entitlement.source_id == source_id, Entitlement.revoked_at.is_(None))).all()
        for r in rows:
            r.expires_at = expires_at
        return len(rows)

    def revoke_source(self, source_id: str) -> int:
        rows = self.db.scalars(select(Entitlement).where(Entitlement.source_id == source_id, Entitlement.revoked_at.is_(None))).all()
        for r in rows:
            r.revoked_at = utcnow()
        return len(rows)
