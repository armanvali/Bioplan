"""Billing: offers, paywall config, experiments, checkout and the webhook -> entitlements pipeline.

Payment status never reaches the rules engine. It only decides which fields the API
redacts on the way out.
"""

from __future__ import annotations

import hashlib
import json
import time
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from stacksense.config import DATA_DIR, get_settings
from stacksense.core.errors import Conflict, DomainError, NotFound
from stacksense.core.ids import new_id
from stacksense.db import utcnow
from stacksense.modules.billing.entitlements import Entitlements, plan_defs
from stacksense.modules.billing.models import (
    CheckoutSession,
    Experiment,
    ExperimentAssignment,
    PaywallConfig,
    PromoCode,
    Purchase,
    StripeEvent,
    Subscription,
)
from stacksense.modules.billing.stripe_gateway import StripeGateway
from stacksense.modules.identity.models import User

SUB_GRACE = timedelta(days=3)


def seed_paywall() -> dict[str, Any]:
    return json.loads((DATA_DIR / "billing" / "paywall.json").read_text())


def gateway() -> StripeGateway:
    s = get_settings()
    return StripeGateway(s.stripe_secret_key, s.stripe_webhook_secret)


def region_for(country: str | None) -> tuple[str, str]:
    return ("CA", "CAD") if country == "CA" else ("US", "USD")


def _ts(x: int | None) -> datetime | None:
    return datetime.fromtimestamp(x, tz=UTC) if x else None


class BillingService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.ent = Entitlements(db)
        self.gw = gateway()
        self.settings = get_settings()

    # ------------------------------------------------------------------ paywall + experiments
    def paywall(self) -> dict[str, Any]:
        row = self.db.scalar(select(PaywallConfig).where(PaywallConfig.status == "published").order_by(PaywallConfig.version.desc()))
        if row is None:
            seed = seed_paywall()
            return {"version": seed["version"], "gates": seed["gates"], "triggers": seed["triggers"], "copy": seed["copy"]}
        return {"version": row.version, "gates": row.gates, "triggers": row.triggers, "copy": row.copy_}

    def assign(self, experiment: Experiment, subject_key: str) -> str:
        """Sticky, weighted assignment per user (or anonymous id)."""
        row = self.db.scalar(select(ExperimentAssignment).where(ExperimentAssignment.experiment_key == experiment.key, ExperimentAssignment.subject_key == subject_key))
        if row:
            return row.variant
        total = sum(float(v.get("weight", 1)) for v in experiment.variants) or 1.0
        h = int(hashlib.sha256(f"{experiment.key}|{subject_key}".encode()).hexdigest()[:8], 16) / 0xFFFFFFFF * total
        acc, chosen = 0.0, experiment.variants[-1]["key"]
        for v in experiment.variants:
            acc += float(v.get("weight", 1))
            if h <= acc:
                chosen = v["key"]
                break
        self.db.add(ExperimentAssignment(experiment_key=experiment.key, subject_key=subject_key, variant=chosen))
        self.db.flush()
        return chosen

    def offers(self, country: str | None, subject_key: str | None) -> dict[str, Any]:
        region, currency = region_for(country)
        plans = plan_defs(self.db)
        paywall = self.paywall()
        applied: list[dict[str, Any]] = []
        price_overrides: dict[str, int] = {}
        if subject_key:
            exps = self.db.scalars(select(Experiment).where(Experiment.status == "running")).all()
            for exp in exps:
                if exp.region and exp.region != region:
                    continue
                variant = self.assign(exp, subject_key)
                cfg = next((v.get("config", {}) for v in exp.variants if v["key"] == variant), {})
                applied.append({"experiment": exp.key, "variant": variant})
                if exp.surface == "copy":
                    paywall["copy"] = {**paywall["copy"], **cfg.get("copy", {})}
                elif exp.surface == "timing":
                    paywall["triggers"] = [{**t, **cfg.get("triggers", {}).get(t["id"], {})} for t in paywall["triggers"]]
                elif exp.surface == "price":
                    price_overrides.update(cfg.get("amounts", {}))
                elif exp.surface == "gates":
                    paywall["gates"] = {**paywall["gates"], **cfg.get("gates", {})}
        out_plans = []
        for key in ["free", *paywall["copy"].get("offer_order", ["full_report", "plus"])]:
            p = plans.get(key)
            if not p or not p.get("active", True):
                continue
            prices = [
                {**pr, "amount": price_overrides.get(pr["id"], pr["amount"])}
                for pr in p.get("prices", []) if pr["currency"] == currency
            ]
            out_plans.append({"key": p["key"], "name": p["name"], "kind": p["kind"], "features": p["features"], "limits": p["limits"], "trial_days": p.get("trial_days", 0), "prices": prices})
        return {"region": region, "currency": currency, "plans": out_plans, "paywall": paywall, "experiments": applied}

    # ------------------------------------------------------------------ checkout
    def start_checkout(self, *, plan_key: str, price_id: str, user: User | None, email: str | None, plan_id: str | None, session_id: str | None, promo: str | None) -> dict[str, Any]:
        plans = plan_defs(self.db)
        plan = plans.get(plan_key)
        if not plan or plan["kind"] == "free":
            raise NotFound("unknown_plan", "Unknown plan")
        price = next((p for p in plan["prices"] if p["id"] == price_id), None)
        if price is None:
            raise NotFound("unknown_price", "Unknown price for this plan")
        if user is None and not email:
            raise DomainError("email_required", "We need an email so your purchase is never lost")
        trial_days = plan.get("trial_days") or None
        if promo:
            code = self.db.get(PromoCode, promo.upper())
            if not code or not code.active or (code.plan_keys and plan_key not in code.plan_keys) or (code.max_uses and code.uses >= code.max_uses):
                raise DomainError("bad_promo", "That code isn't valid for this plan")
            if code.trial_days:
                trial_days = code.trial_days
        from stacksense.modules.profile.keys import email_hash

        cs_id = new_id("cs")
        metadata = {"plan_key": plan_key, "price_id": price_id, "checkout_id": cs_id, "plan_id": plan_id or "", "session_id": session_id or "", "user_id": user.id if user else "", "promo": promo or ""}
        success = f"{self.settings.public_web_url}/checkout/success?cs={cs_id}"
        cancel = f"{self.settings.public_web_url}/pricing" + (f"?plan={plan_id}" if plan_id else "")
        if self.gw.fake:
            url = f"{self.settings.public_web_url}/checkout/fake?cs={cs_id}"
            mode = "fake"
        else:
            if not price.get("stripe_price_id"):
                raise DomainError("price_not_synced", "This price isn't synced to Stripe yet")
            session = self.gw.create_checkout(
                mode="subscription" if plan["kind"] == "subscription" else "payment", stripe_price_id=price["stripe_price_id"],
                success_url=success, cancel_url=cancel, client_reference_id=cs_id, metadata=metadata,
                customer=user.stripe_customer_id if user else None, customer_email=email if not (user and user.stripe_customer_id) else None,
                trial_days=trial_days if plan["kind"] == "subscription" else None, idempotency_key=cs_id,
            )
            url, mode = session["url"], "stripe"
        row = CheckoutSession(
            id=cs_id, user_id=user.id if user else None, email_hash=email_hash(email) if email else None, plan_key=plan_key, price_id=price_id,
            plan_id=plan_id, session_id=session_id, promo_code=promo, mode=mode, url=url,
        )
        self.db.add(row)
        self.db.flush()
        return {"checkout_id": cs_id, "url": url, "mode": mode, "price": price, "plan": {"key": plan_key, "name": plan["name"], "kind": plan["kind"], "trial_days": trial_days or 0}}

    def complete_fake(self, checkout_id: str, email: str | None) -> dict[str, Any]:
        """Dev-only: emulate Stripe completing a checkout by replaying a signed event."""
        if not self.gw.fake:
            raise Conflict("not_fake", "Fake checkout is disabled when Stripe is configured")
        cs = self.db.get(CheckoutSession, checkout_id)
        if cs is None:
            raise NotFound("unknown_checkout", "Unknown checkout")
        plan = plan_defs(self.db)[cs.plan_key]
        price = next(p for p in plan["prices"] if p["id"] == cs.price_id)
        now = int(time.time())
        user = self.db.get(User, cs.user_id) if cs.user_id else None
        if user is None and not email:
            raise DomainError("email_required", "Email needed to complete the fake checkout")
        obj: dict[str, Any] = {
            "id": f"cs_fake_{checkout_id}", "object": "checkout.session", "client_reference_id": checkout_id,
            "customer": f"cus_fake_{(cs.user_id or checkout_id)[-12:]}", "customer_details": {"email": email},
            "amount_total": price["amount"], "currency": price["currency"].lower(), "payment_status": "paid",
            "mode": "subscription" if plan["kind"] == "subscription" else "payment",
            "payment_intent": None if plan["kind"] == "subscription" else f"pi_fake_{checkout_id}",
            "subscription": f"sub_fake_{checkout_id}" if plan["kind"] == "subscription" else None,
            "metadata": {"plan_key": cs.plan_key, "price_id": cs.price_id, "checkout_id": checkout_id, "plan_id": cs.plan_id or "", "session_id": cs.session_id or "", "user_id": cs.user_id or "", "promo": cs.promo_code or ""},
        }
        events = [{"id": f"evt_fake_{checkout_id}_1", "type": "checkout.session.completed", "created": now, "data": {"object": obj}}]
        if plan["kind"] == "subscription":
            trial = plan.get("trial_days") or 0
            events.append({"id": f"evt_fake_{checkout_id}_2", "type": "customer.subscription.updated", "created": now + 1, "data": {"object": {
                "id": obj["subscription"], "object": "subscription", "customer": obj["customer"], "status": "trialing" if trial else "active",
                "current_period_end": now + (trial or 30) * 86400, "trial_end": now + trial * 86400 if trial else None, "cancel_at": None,
                "metadata": obj["metadata"], "items": {"data": [{"price": {"id": cs.price_id}}]},
            }}})
        results = []
        for ev in events:
            payload = json.dumps(ev).encode()
            results.append(self.handle_webhook(payload, self.gw.sign(payload)))
        return {"checkout_id": checkout_id, "results": results}

    def portal(self, user: User) -> str:
        if self.gw.fake or not user.stripe_customer_id or user.stripe_customer_id.startswith("cus_fake"):
            return f"{self.settings.public_web_url}/account/billing?portal=fake"
        return self.gw.create_portal(user.stripe_customer_id, f"{self.settings.public_web_url}/account/billing")

    def cancel_subscription(self, user: User) -> dict[str, Any]:
        """One-click cancel, effective at period end (fake mode; real mode uses the portal)."""
        sub = self.db.scalar(select(Subscription).where(Subscription.user_id == user.id, Subscription.status.in_(["active", "trialing"])))
        if not sub:
            raise NotFound("no_subscription", "No active subscription")
        sub.cancel_at = sub.current_period_end or utcnow()
        self.ent.set_expiry(sub.stripe_subscription_id, sub.cancel_at)
        return {"subscription": sub.stripe_subscription_id, "cancel_at": sub.cancel_at.isoformat() if sub.cancel_at else None}

    # ------------------------------------------------------------------ webhooks
    def handle_webhook(self, payload: bytes, signature: str | None) -> dict[str, Any]:
        event = self.gw.verify(payload, signature)
        existing = self.db.get(StripeEvent, event["id"])
        if existing and existing.status == "processed":
            return {"event": event["id"], "status": "duplicate"}
        row = existing or StripeEvent(id=event["id"], type=event["type"], created=int(event.get("created", 0)), payload=event)
        if not existing:
            self.db.add(row)
        try:
            outcome = self._dispatch(event)
            row.status, row.error = "processed", None
        except Exception as e:
            row.status, row.error = "failed", str(e)[:500]
            self.db.flush()
            raise
        self.db.flush()
        return {"event": event["id"], "status": "processed", **outcome}

    def replay(self, event_id: str) -> dict[str, Any]:
        row = self.db.get(StripeEvent, event_id)
        if row is None:
            raise NotFound("unknown_event", "Unknown event")
        row.status = "replaying"
        outcome = self._dispatch(row.payload)
        row.status = "processed"
        return {"event": event_id, "status": "replayed", **outcome}

    def _dispatch(self, event: dict[str, Any]) -> dict[str, Any]:
        t, obj = event["type"], event["data"]["object"]
        if t == "checkout.session.completed":
            return self._checkout_completed(obj)
        if t == "invoice.paid":
            return self._invoice_paid(obj, int(event.get("created", 0)))
        if t in ("customer.subscription.updated", "customer.subscription.created", "customer.subscription.deleted"):
            return self._subscription_changed(obj, int(event.get("created", 0)), deleted=t.endswith("deleted"))
        if t == "charge.refunded":
            return self._refunded(obj)
        return {"ignored": t}

    def _user_for(self, obj: dict[str, Any]) -> tuple[User, bool]:
        from stacksense.modules.identity.service import IdentityService

        meta = obj.get("metadata") or {}
        user = self.db.get(User, meta["user_id"]) if meta.get("user_id") else None
        created = False
        if user is None:
            email = (obj.get("customer_details") or {}).get("email") or obj.get("customer_email")
            if not email:
                raise DomainError("no_email", "Checkout without an email")
            user, created = IdentityService(self.db).get_or_create_user(email)
            if created:
                # Anonymous purchase: create the account and send a magic link so it isn't lost.
                IdentityService(self.db).request_magic_link(email, "login", {"after_purchase": True, "plan_id": meta.get("plan_id")})
        if obj.get("customer") and not user.stripe_customer_id:
            user.stripe_customer_id = obj["customer"]
        return user, created

    def _checkout_completed(self, obj: dict[str, Any]) -> dict[str, Any]:
        meta = obj.get("metadata") or {}
        user, created = self._user_for(obj)
        cs = self.db.get(CheckoutSession, meta.get("checkout_id") or obj.get("client_reference_id") or "")
        if cs:
            cs.status, cs.completed_at, cs.user_id = "complete", utcnow(), user.id
        plan_key = meta["plan_key"]
        if meta.get("promo"):
            code = self.db.get(PromoCode, meta["promo"].upper())
            if code:
                code.uses += 1
        if obj.get("mode") == "subscription":
            sub_id = obj["subscription"]
            sub = self.db.scalar(select(Subscription).where(Subscription.stripe_subscription_id == sub_id))
            if sub is None:
                sub = Subscription(id=new_id("subs"), user_id=user.id, plan_key=plan_key, price_id=meta.get("price_id"), stripe_subscription_id=sub_id, status="incomplete")
                self.db.add(sub)
            self.db.flush()
            # Provisional access until the subscription event lands with the period end.
            self.ent.grant_plan(user.id, plan_key, "subscription", sub_id, sub.current_period_end and sub.current_period_end + SUB_GRACE or utcnow() + timedelta(days=2))
            return {"user_id": user.id, "user_created": created, "subscription": sub_id}
        purchase = self.db.scalar(select(Purchase).where(Purchase.stripe_checkout_id == obj["id"]))
        if purchase is None:
            purchase = Purchase(
                id=new_id("pur"), user_id=user.id, plan_key=plan_key, price_id=meta.get("price_id"), stripe_checkout_id=obj["id"],
                stripe_payment_intent=obj.get("payment_intent"), amount=int(obj.get("amount_total") or 0), currency=(obj.get("currency") or "cad").upper(),
                plan_id=meta.get("plan_id") or None, promo_code=meta.get("promo") or None,
            )
            self.db.add(purchase)
            self.db.flush()
        # Access to a purchased Full Report never expires.
        self.ent.grant_plan(user.id, plan_key, "purchase", purchase.id, None)
        return {"user_id": user.id, "user_created": created, "purchase": purchase.id}

    def _invoice_paid(self, obj: dict[str, Any], created: int) -> dict[str, Any]:
        sub = self.db.scalar(select(Subscription).where(Subscription.stripe_subscription_id == obj.get("subscription")))
        if not sub:
            return {"ignored": "unknown_subscription"}
        period_end = None
        for line in (obj.get("lines") or {}).get("data", []):
            period_end = max(period_end or 0, int((line.get("period") or {}).get("end") or 0))
        if period_end:
            sub.current_period_end = _ts(period_end)
            if sub.status in ("past_due", "unpaid", "incomplete"):
                sub.status = "active"
            self.ent.grant_plan(sub.user_id, sub.plan_key, "subscription", sub.stripe_subscription_id, sub.current_period_end + SUB_GRACE)  # type: ignore[operator]
        return {"subscription": sub.stripe_subscription_id, "period_end": period_end}

    def _subscription_changed(self, obj: dict[str, Any], created: int, deleted: bool) -> dict[str, Any]:
        sub = self.db.scalar(select(Subscription).where(Subscription.stripe_subscription_id == obj["id"]))
        if sub is None:
            meta = obj.get("metadata") or {}
            user = self.db.get(User, meta["user_id"]) if meta.get("user_id") else self.db.scalar(select(User).where(User.stripe_customer_id == obj.get("customer")))
            if user is None:
                raise DomainError("unknown_customer", "Subscription for an unknown customer")
            sub = Subscription(id=new_id("subs"), user_id=user.id, plan_key=meta.get("plan_key", "plus"), stripe_subscription_id=obj["id"], status="incomplete")
            self.db.add(sub)
            self.db.flush()
        if created and created < sub.last_event_created:
            return {"ignored": "out_of_order", "subscription": sub.stripe_subscription_id}
        sub.last_event_created = created
        sub.status = "canceled" if deleted else obj.get("status", sub.status)
        sub.current_period_end = _ts(obj.get("current_period_end")) or sub.current_period_end
        sub.trial_end = _ts(obj.get("trial_end"))
        sub.cancel_at = _ts(obj.get("cancel_at")) or (_ts(obj.get("ended_at")) if deleted else sub.cancel_at)
        if sub.status in ("active", "trialing", "past_due"):
            end = sub.cancel_at or sub.current_period_end
            self.ent.grant_plan(sub.user_id, sub.plan_key, "subscription", sub.stripe_subscription_id, end + SUB_GRACE if end else None)
            if sub.status == "trialing" and sub.trial_end:
                from stacksense.modules.notify.service import NotifyService

                NotifyService(self.db).enqueue(sub.user_id, "email", "trial_ending", {"date": sub.trial_end.date().isoformat()}, scheduled_for=sub.trial_end - timedelta(days=2), dedupe_key=f"trial:{sub.stripe_subscription_id}:{sub.trial_end.date()}")
        else:
            self.ent.set_expiry(sub.stripe_subscription_id, sub.current_period_end if deleted and sub.current_period_end and sub.current_period_end > utcnow() else utcnow())
        return {"subscription": sub.stripe_subscription_id, "subscription_status": sub.status}

    def _refunded(self, obj: dict[str, Any]) -> dict[str, Any]:
        purchase = self.db.scalar(select(Purchase).where(Purchase.stripe_payment_intent == obj.get("payment_intent")))
        if not purchase:
            return {"ignored": "unknown_purchase"}
        if purchase.status != "refunded":
            purchase.status, purchase.refunded_at = "refunded", utcnow()
            self.ent.revoke_source(purchase.id)
        refunds = self.db.scalar(select(func.count()).select_from(Purchase).where(Purchase.user_id == purchase.user_id, Purchase.status == "refunded")) or 0
        flagged = refunds >= 2
        if flagged:
            from stacksense.modules.admin.audit import audit

            audit(self.db, "system", "system", "billing.refund_flag", "user", purchase.user_id, None, {"refunds": refunds}, "Repeated refunds flag the account for review")
        return {"purchase": purchase.id, "refunded": True, "flagged": flagged}

    def billing_summary(self, user: User) -> dict[str, Any]:
        purchases = self.db.scalars(select(Purchase).where(Purchase.user_id == user.id).order_by(Purchase.created_at.desc())).all()
        subs = self.db.scalars(select(Subscription).where(Subscription.user_id == user.id).order_by(Subscription.created_at.desc())).all()
        feats = self.ent.features(user.id)
        return {
            "tier": self.ent.tier(feats), "features": sorted(feats), "limits": self.ent.limits(feats),
            "purchases": [{"id": p.id, "plan_key": p.plan_key, "amount": p.amount, "currency": p.currency, "status": p.status, "created_at": p.created_at.isoformat()} for p in purchases],
            "subscriptions": [{"id": s.stripe_subscription_id, "plan_key": s.plan_key, "status": s.status, "current_period_end": s.current_period_end.isoformat() if s.current_period_end else None, "trial_end": s.trial_end.isoformat() if s.trial_end else None, "cancel_at": s.cancel_at.isoformat() if s.cancel_at else None} for s in subs],
        }
