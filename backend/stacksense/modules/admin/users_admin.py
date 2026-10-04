"""Users & data workspace (section 15.2). Health data is masked by default; revealing it
needs a reason, is logged, and shows up in the user's own privacy history."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from stacksense import registry
from stacksense.core.errors import DomainError, NotFound
from stacksense.core.ids import new_id
from stacksense.db import utcnow
from stacksense.modules.admin.audit import audit
from stacksense.modules.admin.models import AdminUser
from stacksense.modules.billing.entitlements import Entitlements
from stacksense.modules.billing.models import CheckoutSession, Entitlement, Purchase, Subscription
from stacksense.modules.catalog.models import Click
from stacksense.modules.identity.models import User
from stacksense.modules.identity.service import IdentityService
from stacksense.modules.profile.consent import ConsentService
from stacksense.modules.profile.keys import email_hash
from stacksense.modules.profile.models import IntakeSession, Plan, PrivacyRequest, StaffAccess
from stacksense.modules.profile.service import ProfileService

PRIVACY_DUE_DAYS = {"CA": 30, "QC": 30, "US": 45}
SUPPRESS_BELOW = 5


def _mask(v: Any) -> Any:
    if isinstance(v, dict):
        return {k: _mask(x) for k, x in v.items()}
    if isinstance(v, list):
        return ["•••"] * len(v)
    return "•••" if v not in (None, "") else v


class UsersAdmin:
    def __init__(self, db: Session, actor: AdminUser) -> None:
        self.db = db
        self.actor = actor
        self.identity = IdentityService(db)

    def _audit(self, action: str, user_id: str | None, before: Any = None, after: Any = None, reason: str | None = None) -> None:
        audit(self.db, self.actor.id, self.actor.role, action, "user", user_id, before, after, reason)

    def search(self, q: str) -> list[dict[str, Any]]:
        q = q.strip()
        users: list[User] = []
        if "@" in q:
            u = self.db.scalar(select(User).where(User.email_hash == email_hash(q)))
            users = [u] if u else []
        elif q.startswith("usr_"):
            u = self.db.get(User, q)
            users = [u] if u else []
        elif q.startswith(("pur_", "cs_", "pi_", "sub_", "evt_")):
            uid = self.db.scalar(select(Purchase.user_id).where(or_(Purchase.id == q, Purchase.stripe_checkout_id == q, Purchase.stripe_payment_intent == q)))
            uid = uid or self.db.scalar(select(CheckoutSession.user_id).where(CheckoutSession.id == q))
            uid = uid or self.db.scalar(select(Subscription.user_id).where(Subscription.stripe_subscription_id == q))
            users = [u for u in [self.db.get(User, uid)] if u] if uid else []
        elif q.startswith("clk_"):
            click = self.db.get(Click, q)
            if click:
                for u in self.db.scalars(select(User).where(User.subject_id.is_not(None))).all():
                    from stacksense.modules.profile.keys import user_hash

                    if user_hash(u.id) == click.user_hash or user_hash(u.subject_id or "") == click.user_hash:
                        users = [u]
                        break
        self._audit("users.search", None, None, {"query_kind": q[:4]})
        return [self.card(u) for u in users]

    def card(self, u: User) -> dict[str, Any]:
        ent = Entitlements(self.db)
        feats = ent.features(u.id)
        plan = self.db.scalar(select(Plan).where(Plan.subject_id == u.subject_id, Plan.status == "active")) if u.subject_id else None
        sub = self.db.scalar(select(Subscription).where(Subscription.user_id == u.id).order_by(Subscription.created_at.desc()))
        return {
            "id": u.id, "email_masked": self.identity.public(u)["email_masked"] if u.status != "deleted" else "(deleted)", "status": u.status,
            "tier": ent.tier(feats), "plan_status": plan.status if plan else None, "subscription": sub.status if sub else None,
            "consents": {c["purpose"]: c["granted"] for c in ConsentService(self.db).summary(u.id)},
            "last_active_at": u.last_active_at.isoformat() if u.last_active_at else None, "created_at": u.created_at.isoformat(),
        }

    def _user(self, user_id: str) -> User:
        u = self.db.get(User, user_id)
        if u is None:
            raise NotFound("unknown_user", "User not found")
        return u

    def record(self, user_id: str) -> dict[str, Any]:
        u = self._user(user_id)
        out = self.card(u)
        if u.subject_id:
            try:
                prof = ProfileService(self.db).profile(u.subject_id)
                out["health_profile"] = {"masked": True, "stable_facts": _mask(prof["stable_facts"]), "labs": _mask(prof["labs"]),
                                         "plans": prof["plans"], "sessions": prof["sessions"]}
            except NotFound:
                out["health_profile"] = None
        self._audit("users.view", u.id)
        return out

    def reveal(self, user_id: str, reason: str) -> dict[str, Any]:
        if not reason or len(reason.strip()) < 6:
            raise DomainError("reason_required", "Give a reason, such as a support ticket number")
        u = self._user(user_id)
        if not u.subject_id:
            raise NotFound("no_profile", "No health profile on this account")
        self.db.add(StaffAccess(admin_id=self.actor.id, admin_role=self.actor.role, user_id=u.id, reason=reason.strip(), scope="health_profile"))
        self._audit("users.reveal", u.id, None, {"scope": "health_profile"}, reason)
        return {"user_id": u.id, "health_profile": ProfileService(self.db).profile(u.subject_id), "logged": True}

    def consents(self, user_id: str) -> list[dict[str, Any]]:
        return ConsentService(self.db).history(self._user(user_id).id)

    def record_consent(self, user_id: str, purpose: str, granted: bool, reason: str) -> dict[str, Any]:
        """Support records a change the user requested by email; it never grants silently."""
        if not reason:
            raise DomainError("reason_required", "Quote the user's request")
        u = self._user(user_id)
        ConsentService(self.db).record(u.id, purpose, granted, method="support", actor=f"support:{self.actor.id}")
        self._audit("users.consent", u.id, None, {"purpose": purpose, "granted": granted}, reason)
        if purpose == "profile_storage" and not granted and u.subject_id:
            ProfileService(self.db).erase_health(u.subject_id)
            u.subject_id = None
        return {"ok": True}

    def plans(self, user_id: str) -> list[dict[str, Any]]:
        u = self._user(user_id)
        if not u.subject_id:
            return []
        rows = self.db.scalars(select(Plan).where(Plan.subject_id == u.subject_id).order_by(Plan.created_at.desc())).all()
        return [{"id": p.id, "status": p.status, "rules_version": p.rules_version, "graph_version": p.graph_version, "impact_version": p.impact_version,
                 "catalog_snapshot_id": p.catalog_snapshot_id, "created_at": p.created_at.isoformat(), "items": p.summary.get("active", []), "reason": p.reason} for p in rows]

    def rerun_preview(self, plan_id: str) -> dict[str, Any]:
        from stacksense.modules.plans.service import PlanService

        plan = self.db.get(Plan, plan_id)
        if plan is None:
            raise NotFound("unknown_plan", "Plan not found")
        diff = PlanService(self.db).rebuild_preview(plan, registry.live_kb(self.db, plan.subject_id))
        self._audit("plans.rerun_preview", None, None, {"plan_id": plan_id, "changed": diff["changed"]})
        return diff

    # ------------------------------------------------------------------ account actions
    def grant(self, user_id: str, plan_key: str | None, feature: str | None, days: int | None, reason: str) -> dict[str, Any]:
        u = self._user(user_id)
        ent = Entitlements(self.db)
        expires = utcnow() + timedelta(days=days) if days else None
        src = new_id("grant")
        if plan_key:
            ent.grant_plan(u.id, plan_key, "grant", src, expires, reason)
        elif feature:
            ent.grant(u.id, feature, "grant", src, expires, reason)
        else:
            raise DomainError("nothing_to_grant", "Give a plan_key or a feature")
        self._audit("users.grant", u.id, None, {"plan_key": plan_key, "feature": feature, "days": days, "source": src}, reason)
        return {"source_id": src, "features": sorted(ent.features(u.id))}

    def revoke(self, user_id: str, entitlement_id: int, reason: str) -> dict[str, Any]:
        e = self.db.get(Entitlement, entitlement_id)
        if e is None or e.user_id != user_id:
            raise NotFound("unknown_entitlement", "Entitlement not found")
        e.revoked_at = utcnow()
        self._audit("users.revoke", user_id, {"feature": e.feature_key}, None, reason)
        return {"ok": True}

    def entitlements(self, user_id: str) -> list[dict[str, Any]]:
        rows = self.db.scalars(select(Entitlement).where(Entitlement.user_id == user_id).order_by(Entitlement.granted_at.desc())).all()
        return [{"id": e.id, "feature": e.feature_key, "source": e.source, "source_id": e.source_id, "granted_at": e.granted_at.isoformat(),
                 "expires_at": e.expires_at.isoformat() if e.expires_at else None, "revoked_at": e.revoked_at.isoformat() if e.revoked_at else None} for e in rows]

    def purchases(self, user_id: str) -> list[dict[str, Any]]:
        rows = self.db.scalars(select(Purchase).where(Purchase.user_id == user_id).order_by(Purchase.created_at.desc())).all()
        return [{"id": p.id, "plan_key": p.plan_key, "amount": p.amount, "currency": p.currency, "status": p.status,
                 "created_at": p.created_at.isoformat(), "refunded_at": p.refunded_at.isoformat() if p.refunded_at else None} for p in rows]

    def refund(self, purchase_id: str, reason: str) -> dict[str, Any]:
        import json

        from stacksense.modules.billing.service import BillingService

        p = self.db.get(Purchase, purchase_id)
        if p is None:
            raise NotFound("unknown_purchase", "Purchase not found")
        svc = BillingService(self.db)
        if svc.gw.fake or not p.stripe_payment_intent or p.stripe_payment_intent.startswith("pi_fake"):
            ev = {"id": f"evt_refund_{p.id}_{int(utcnow().timestamp())}", "type": "charge.refunded", "created": int(utcnow().timestamp()), "data": {"object": {"payment_intent": p.stripe_payment_intent or f"pi_none_{p.id}"}}}
            if not p.stripe_payment_intent:
                p.stripe_payment_intent = ev["data"]["object"]["payment_intent"]
            payload = json.dumps(ev).encode()
            out = svc.handle_webhook(payload, svc.gw.sign(payload))
        else:
            svc.gw.refund(p.stripe_payment_intent)
            out = {"requested": True}  # entitlements are revoked when Stripe sends charge.refunded
        self._audit("users.refund", p.user_id, {"purchase": p.id}, out, reason)
        return out

    def suspend(self, user_id: str, suspend: bool, reason: str) -> dict[str, Any]:
        u = self._user(user_id)
        before = u.status
        u.status = "suspended" if suspend else "active"
        self._audit("users.suspend" if suspend else "users.unsuspend", u.id, {"status": before}, {"status": u.status}, reason)
        return {"status": u.status}

    def resend_magic_link(self, user_id: str) -> dict[str, Any]:
        u = self._user(user_id)
        self.identity.request_magic_link(self.identity.email_of(u))
        self._audit("users.magic_link", u.id)
        return {"sent": True}

    # ------------------------------------------------------------------ privacy queue
    def privacy_queue(self, status: str | None = None) -> list[dict[str, Any]]:
        stmt = select(PrivacyRequest).order_by(PrivacyRequest.due_at)
        if status:
            stmt = stmt.where(PrivacyRequest.status == status)
        return [{"id": r.id, "user_id": r.user_id, "type": r.type, "status": r.status, "due_at": r.due_at.isoformat(), "created_at": r.created_at.isoformat(),
                 "jurisdiction": r.jurisdiction, "notes": r.notes, "overdue": r.status != "completed" and r.due_at < utcnow()} for r in self.db.scalars(stmt).all()]

    def fulfil(self, request_id: str) -> dict[str, Any]:
        r = self.db.get(PrivacyRequest, request_id)
        if r is None:
            raise NotFound("unknown_request", "Privacy request not found")
        result = fulfil_privacy_request(self.db, r)
        self._audit("privacy.fulfil", r.user_id, None, {"request": r.id, "type": r.type})
        return result

    # ------------------------------------------------------------------ cohorts (de-identified)
    def cohorts(self) -> dict[str, Any]:
        plans = self.db.scalars(select(Plan).where(Plan.status == "active")).all()
        items: dict[str, int] = {}
        goals: dict[str, int] = {}
        excluded: dict[str, int] = {}
        for p in plans:
            for i in p.summary.get("active", []):
                items[i] = items.get(i, 0) + 1
            for g in p.summary.get("goals", []):
                goals[g] = goals.get(g, 0) + 1
            for e in p.summary.get("excluded", []):
                excluded[e] = excluded.get(e, 0) + 1

        def sup(d: dict[str, int]) -> dict[str, Any]:
            return {k: (v if v >= SUPPRESS_BELOW else f"<{SUPPRESS_BELOW}") for k, v in sorted(d.items(), key=lambda kv: -kv[1])}

        sessions = self.db.scalar(select(func.count()).select_from(IntakeSession)) or 0
        return {"active_plans": len(plans), "intake_sessions": sessions, "by_stack_item": sup(items), "by_goal": sup(goals), "by_exclusion": sup(excluded),
                "note": f"Counts under {SUPPRESS_BELOW} are suppressed; no individual rows can be exported."}


def create_privacy_request(db: Session, user: User, type_: str) -> PrivacyRequest:
    if type_ not in ("export", "delete", "correct"):
        raise DomainError("bad_type", "type must be export, delete or correct")
    jur = "QC" if user.region == "QC" else (user.country or "CA")
    r = PrivacyRequest(id=new_id("prv"), user_id=user.id, type=type_, jurisdiction=jur, due_at=utcnow() + timedelta(days=PRIVACY_DUE_DAYS.get(jur, 30)))
    db.add(r)
    db.flush()
    return r


def fulfil_privacy_request(db: Session, r: PrivacyRequest) -> dict[str, Any]:
    user = db.get(User, r.user_id)
    if user is None:
        r.status, r.completed_at = "completed", utcnow()
        return {"status": "completed", "note": "account already gone"}
    prof = ProfileService(db)
    if r.type == "export":
        data = prof.export(user)
        r.result = {"keys": sorted(data), "size": len(str(data))}
        out: dict[str, Any] = {"export": data}
    elif r.type == "delete":
        out = prof.delete_account(user)
        r.result = out
    else:
        r.status = "in_progress"
        r.notes = (r.notes or "") + " Correction requests are handled by support."
        return {"status": "in_progress"}
    r.status, r.completed_at = "completed", utcnow()
    return out
