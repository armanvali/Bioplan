"""Revenue & paywall workspace (section 15.5): plans and prices, the feature-gate matrix
(with a locked safety row), paywall placements, promos, experiments and dashboards."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from stacksense.core.errors import Conflict, DomainError, NotFound
from stacksense.db import utcnow
from stacksense.modules.admin.audit import audit
from stacksense.modules.admin.models import AdminUser
from stacksense.modules.billing.entitlements import ALWAYS_FREE, FEATURE_KEYS, plan_defs
from stacksense.modules.billing.models import (
    BillingPlan,
    Experiment,
    ExperimentAssignment,
    FunnelEvent,
    PaywallConfig,
    Price,
    PromoCode,
    Purchase,
    Subscription,
)
from stacksense.modules.billing.service import BillingService
from stacksense.modules.catalog.models import Conversion
from stacksense.modules.profile.models import IntakeSession, Plan


class RevenueAdmin:
    def __init__(self, db: Session, actor: AdminUser) -> None:
        self.db = db
        self.actor = actor

    def _audit(self, action: str, target_type: str, target: str | None, before: Any = None, after: Any = None, reason: str | None = None) -> None:
        audit(self.db, self.actor.id, self.actor.role, action, target_type, target, before, after, reason)

    def plans(self) -> dict[str, Any]:
        plans = plan_defs(self.db)
        matrix = {f: {k: (f in p["features"]) for k, p in plans.items()} for f in FEATURE_KEYS}
        return {"plans": list(plans.values()), "feature_matrix": matrix, "locked_free_row": list(ALWAYS_FREE), "feature_keys": list(FEATURE_KEYS)}

    def update_plan(self, key: str, changes: dict[str, Any], reason: str | None = None) -> dict[str, Any]:
        row = self.db.get(BillingPlan, key)
        if row is None:
            raise NotFound("unknown_plan", "Plan not found")
        before = {"name": row.name, "features": row.features, "limits": row.limits, "trial_days": row.trial_days, "active": row.active}
        if "features" in changes:
            bad = [f for f in changes["features"] if f not in FEATURE_KEYS]
            if bad:
                raise DomainError("bad_feature", f"Unknown or ungateable features: {bad}. Safety information can't be gated.")
            row.features = list(changes["features"])
        for f in ("name", "limits", "trial_days", "active"):
            if f in changes:
                setattr(row, f, changes[f])
        self._audit("revenue.plan", "plan", key, before, changes, reason)
        return plan_defs(self.db)[key]

    def upsert_price(self, data: dict[str, Any], reason: str | None = None) -> dict[str, Any]:
        for f in ("id", "plan_key", "currency", "region", "amount"):
            if f not in data:
                raise DomainError("missing_fields", f"Missing {f}")
        if self.db.get(BillingPlan, data["plan_key"]) is None:
            raise NotFound("unknown_plan", "Plan not found")
        row = self.db.get(Price, data["id"])
        before = None
        if row is None:
            row = Price(id=data["id"], plan_key=data["plan_key"], currency=data["currency"], region=data["region"], amount=int(data["amount"]), interval=data.get("interval"), stripe_price_id=data.get("stripe_price_id"))
            self.db.add(row)
        else:
            before = {"amount": row.amount, "active": row.active, "stripe_price_id": row.stripe_price_id}
            row.amount, row.interval = int(data["amount"]), data.get("interval", row.interval)
            row.stripe_price_id = data.get("stripe_price_id", row.stripe_price_id)
            row.active = data.get("active", row.active)
        self.db.flush()
        self._audit("revenue.price", "price", data["id"], before, data, reason)
        return data

    # ------------------------------------------------------------------ paywall
    def paywall(self) -> dict[str, Any]:
        rows = self.db.scalars(select(PaywallConfig).order_by(PaywallConfig.version.desc())).all()
        return {"live": BillingService(self.db).paywall(), "versions": [{"id": r.id, "version": r.version, "status": r.status, "gates": r.gates, "triggers": r.triggers, "copy": r.copy_, "created_by": r.created_by, "published_at": r.published_at.isoformat() if r.published_at else None} for r in rows]}

    def draft_paywall(self, gates: dict[str, Any], triggers: list[dict[str, Any]], copy: dict[str, Any]) -> dict[str, Any]:
        for g in gates:
            if g not in FEATURE_KEYS:
                raise DomainError("bad_gate", f"{g} isn't a gateable feature; safety information is always free")
        latest = self.db.scalar(select(func.max(PaywallConfig.version))) or 1
        row = PaywallConfig(version=latest + 1, status="draft", gates=gates, triggers=triggers, copy_=copy, created_by=self.actor.id)
        self.db.add(row)
        self.db.flush()
        self._audit("revenue.paywall_draft", "paywall", str(row.version), None, {"version": row.version})
        return {"id": row.id, "version": row.version}

    def publish_paywall(self, paywall_id: int) -> dict[str, Any]:
        row = self.db.get(PaywallConfig, paywall_id)
        if row is None:
            raise NotFound("unknown_paywall", "Paywall config not found")
        for r in self.db.scalars(select(PaywallConfig).where(PaywallConfig.status == "published")).all():
            r.status = "archived"
        row.status, row.published_at = "published", utcnow()
        self._audit("revenue.paywall_publish", "paywall", str(row.version), None, {"version": row.version})
        return {"version": row.version, "status": row.status}

    # ------------------------------------------------------------------ promos
    def promos(self) -> list[dict[str, Any]]:
        return [{"code": p.code, "kind": p.kind, "percent_off": p.percent_off, "plan_keys": p.plan_keys, "trial_days": p.trial_days, "partner": p.partner,
                 "max_uses": p.max_uses, "uses": p.uses, "active": p.active, "expires_at": p.expires_at.isoformat() if p.expires_at else None} for p in self.db.scalars(select(PromoCode)).all()]

    def upsert_promo(self, data: dict[str, Any]) -> dict[str, Any]:
        code = str(data.get("code", "")).upper().strip()
        if not code or data.get("kind") not in ("coupon", "partner"):
            raise DomainError("bad_promo", "Promo needs a code and kind coupon|partner")
        row = self.db.get(PromoCode, code)
        if row is None:
            row = PromoCode(code=code, kind=data["kind"])
            self.db.add(row)
        for f in ("percent_off", "plan_keys", "trial_days", "partner", "max_uses", "active"):
            if f in data:
                setattr(row, f, data[f])
        self.db.flush()
        self._audit("revenue.promo", "promo", code, None, data)
        return {"code": code}

    # ------------------------------------------------------------------ experiments
    def experiments(self) -> list[dict[str, Any]]:
        out = []
        for e in self.db.scalars(select(Experiment).order_by(Experiment.created_at.desc())).all():
            counts = dict(self.db.execute(select(ExperimentAssignment.variant, func.count()).where(ExperimentAssignment.experiment_key == e.key).group_by(ExperimentAssignment.variant)).all())
            out.append({"key": e.key, "name": e.name, "surface": e.surface, "region": e.region, "variants": e.variants, "metrics": e.metrics,
                        "guardrails": e.guardrails, "status": e.status, "stop_reason": e.stop_reason, "assignments": counts})
        return out

    def upsert_experiment(self, data: dict[str, Any]) -> dict[str, Any]:
        if data.get("surface") not in ("price", "gates", "copy", "timing"):
            raise DomainError("bad_surface", "surface must be price, gates, copy or timing")
        variants = data.get("variants") or []
        if len(variants) < 2 or len({v["key"] for v in variants}) != len(variants):
            raise DomainError("bad_variants", "At least two uniquely keyed variants")
        if data["surface"] == "gates":
            for v in variants:
                for g in v.get("config", {}).get("gates", {}):
                    if g not in FEATURE_KEYS:
                        raise DomainError("bad_gate", "Experiments can't gate safety information")
        row = self.db.get(Experiment, data["key"])
        if row is not None and row.status == "running":
            raise Conflict("running", "Stop the experiment before editing it")
        if row is None:
            row = Experiment(key=data["key"], name=data.get("name", data["key"]), surface=data["surface"])
            self.db.add(row)
        row.region, row.variants = data.get("region"), variants
        row.metrics = data.get("metrics", ["conversion"])
        row.guardrails = data.get("guardrails", {"refund_rate": 0.08})
        self.db.flush()
        self._audit("revenue.experiment", "experiment", row.key, None, data)
        return {"key": row.key}

    def set_experiment_status(self, key: str, status: str, reason: str | None = None) -> dict[str, Any]:
        row = self.db.get(Experiment, key)
        if row is None:
            raise NotFound("unknown_experiment", "Experiment not found")
        if status not in ("running", "stopped"):
            raise DomainError("bad_status", "status must be running or stopped")
        before = row.status
        row.status, row.stop_reason = status, reason if status == "stopped" else None
        self._audit("revenue.experiment_status", "experiment", key, {"status": before}, {"status": status}, reason)
        return {"key": key, "status": status}

    # ------------------------------------------------------------------ dashboards
    def dashboards(self, days: int = 30) -> dict[str, Any]:
        return revenue_dashboard(self.db, days)


def revenue_dashboard(db: Session, days: int = 30) -> dict[str, Any]:
    since = utcnow() - timedelta(days=days)
    started = db.scalar(select(func.count()).select_from(IntakeSession).where(IntakeSession.created_at >= since)) or 0
    completed = db.scalar(select(func.count()).select_from(Plan).where(Plan.created_at >= since, Plan.reason == "intake")) or 0
    paywall_views = db.scalar(select(func.count()).select_from(FunnelEvent).where(FunnelEvent.event == "paywall_viewed", FunnelEvent.ts >= since)) or 0
    purchases = db.scalars(select(Purchase).where(Purchase.created_at >= since)).all()
    paid = [p for p in purchases if p.status == "paid"]
    refunded = [p for p in purchases if p.status == "refunded"]
    subs = db.scalars(select(Subscription)).all()
    active_subs = [s for s in subs if s.status in ("active", "trialing", "past_due") and not (s.cancel_at and s.cancel_at < utcnow())]
    prices = {p.id: p for p in db.scalars(select(Price)).all()}

    def monthly(s: Subscription) -> float:
        pr = prices.get(s.price_id or "")
        if not pr:
            return 0.0
        return pr.amount / 100 / (12 if pr.interval == "year" else 1)

    mrr = round(sum(monthly(s) for s in active_subs if s.status != "trialing"), 2)
    trials = [s for s in subs if s.trial_end and s.trial_end >= since]
    converted = [s for s in trials if s.status == "active"]
    churned = [s for s in subs if s.status == "canceled" and s.updated_at >= since]
    affiliate = db.scalar(select(func.coalesce(func.sum(Conversion.commission), 0.0)).where(Conversion.ts >= since)) or 0.0
    one_time = sum(p.amount for p in paid) / 100
    revenue = one_time + mrr + float(affiliate)
    payers = {p.user_id for p in paid} | {s.user_id for s in active_subs}
    return {
        "days": days,
        "funnel": {"intake_started": started, "intake_completed": completed, "paywall_viewed": paywall_views, "purchased": len(paid) + len([s for s in subs if s.created_at >= since])},
        "mrr": mrr, "arpu": round(revenue / len(payers), 2) if payers else 0.0,
        "churn_rate": round(len(churned) / len(subs), 4) if subs else 0.0,
        "trial_conversion": round(len(converted) / len(trials), 4) if trials else None,
        "refund_rate": round(len(refunded) / len(purchases), 4) if purchases else 0.0,
        "one_time_revenue": round(one_time, 2), "affiliate_revenue": round(float(affiliate), 2),
        "revenue_per_completed_intake": round(revenue / completed, 2) if completed else None,
        "active_subscriptions": len(active_subs),
    }


def enforce_experiment_guardrails(db: Session) -> list[str]:
    """Automatic stop on harm: refund rate per variant above the guardrail stops the test."""
    stopped = []
    for e in db.scalars(select(Experiment).where(Experiment.status == "running")).all():
        limit = float((e.guardrails or {}).get("refund_rate", 1.0))
        for v in e.variants:
            users = [a.subject_key for a in db.scalars(select(ExperimentAssignment).where(ExperimentAssignment.experiment_key == e.key, ExperimentAssignment.variant == v["key"])).all()]
            if not users:
                continue
            ps = db.scalars(select(Purchase).where(Purchase.user_id.in_(users))).all()
            if len(ps) >= 20 and sum(1 for p in ps if p.status == "refunded") / len(ps) > limit:
                e.status, e.stop_reason = "stopped", f"Guardrail: refund rate above {limit:.0%} in variant {v['key']}"
                audit(db, "system", "system", "revenue.experiment_autostop", "experiment", e.key, None, {"variant": v["key"]}, e.stop_reason)
                stopped.append(e.key)
                break
    return stopped
