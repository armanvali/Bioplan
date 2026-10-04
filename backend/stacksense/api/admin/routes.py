"""/admin/v1: the admin panel API (section 15). Every endpoint is role-scoped and every
write is audited. Admin writes go through the same domain services as the app, never
direct database edits."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from stacksense.config import get_settings
from stacksense.deps import DB, CurrentAdmin, require
from stacksense.modules.admin import audit as audit_log
from stacksense.modules.admin.auth import AdminAuth
from stacksense.modules.admin.catalog_admin import CatalogAdmin
from stacksense.modules.admin.engine_admin import EngineAdmin
from stacksense.modules.admin.models import AdminUser, LLMCallLog, Outbox
from stacksense.modules.admin.revenue_admin import RevenueAdmin
from stacksense.modules.admin.roles import ROLES, SCOPES
from stacksense.modules.admin.users_admin import UsersAdmin
from stacksense.personas import load_personas

router = APIRouter(prefix="/admin/v1")


def Scoped(scope: str) -> Any:  # noqa: N802 - reads like a type in signatures
    return Annotated[AdminUser, Depends(require(scope))]


# ---------------------------------------------------------------- auth & staff
class LoginIn(BaseModel):
    email: str
    code: str | None = None


class StaffIn(BaseModel):
    email: str
    name: str
    role: str


class RoleIn(BaseModel):
    role: str


@router.post("/auth/login", tags=["admin:auth"])
def login(body: LoginIn, db: DB) -> dict[str, Any]:
    return AdminAuth(db).login(body.email, body.code)


@router.get("/auth/me", tags=["admin:auth"])
def me(admin: CurrentAdmin, db: DB) -> dict[str, Any]:
    return AdminAuth(db).public(admin)


@router.get("/staff", tags=["admin:staff"])
def staff(admin: Scoped("staff.manage"), db: DB) -> dict[str, Any]:
    rows = db.scalars(select(AdminUser).order_by(AdminUser.created_at)).all()
    return {"staff": [AdminAuth(db).public(a) | {"active": a.active, "last_login_at": a.last_login_at.isoformat() if a.last_login_at else None} for a in rows],
            "roles": {k: {"label": v["label"], "scopes": sorted(v["scopes"]), "cannot": v["cannot"]} for k, v in ROLES.items()}, "scopes": SCOPES}


@router.post("/staff", tags=["admin:staff"])
def add_staff(body: StaffIn, admin: Scoped("staff.manage"), db: DB) -> dict[str, Any]:
    new, secret = AdminAuth(db).create_admin(body.email, body.name, body.role, actor=admin.id)
    return {"admin": AdminAuth(db).public(new), "totp_uri": AdminAuth(db).provisioning(new)}


@router.put("/staff/{admin_id}/role", tags=["admin:staff"])
def set_role(admin_id: str, body: RoleIn, admin: Scoped("staff.manage"), db: DB) -> dict[str, Any]:
    return AdminAuth(db).public(AdminAuth(db).set_role(admin, admin_id, body.role))


# ---------------------------------------------------------------- users & data
class ReasonIn(BaseModel):
    reason: str = Field(..., min_length=3)


class ConsentChangeIn(BaseModel):
    purpose: str
    granted: bool
    reason: str


class GrantIn(BaseModel):
    plan_key: str | None = None
    feature: str | None = None
    days: int | None = None
    reason: str


class SuspendIn(BaseModel):
    suspend: bool
    reason: str


@router.get("/users", tags=["admin:users"])
def search_users(q: str, admin: Scoped("users.read"), db: DB) -> dict[str, Any]:
    return {"results": UsersAdmin(db, admin).search(q)}


@router.get("/users/{user_id}", tags=["admin:users"])
def user_record(user_id: str, admin: Scoped("users.read"), db: DB) -> dict[str, Any]:
    ua = UsersAdmin(db, admin)
    return {**ua.record(user_id), "entitlements": ua.entitlements(user_id), "plans": ua.plans(user_id)}


@router.post("/users/{user_id}/reveal", tags=["admin:users"])
def reveal(user_id: str, body: ReasonIn, admin: Scoped("users.reveal"), db: DB) -> dict[str, Any]:
    return UsersAdmin(db, admin).reveal(user_id, body.reason)


@router.get("/users/{user_id}/consents", tags=["admin:users"])
def user_consents(user_id: str, admin: Scoped("users.read"), db: DB) -> dict[str, Any]:
    return {"history": UsersAdmin(db, admin).consents(user_id)}


@router.post("/users/{user_id}/consents", tags=["admin:users"])
def record_consent(user_id: str, body: ConsentChangeIn, admin: Scoped("users.consent_record"), db: DB) -> dict[str, Any]:
    return UsersAdmin(db, admin).record_consent(user_id, body.purpose, body.granted, body.reason)


@router.post("/users/{user_id}/entitlements", tags=["admin:users"])
def grant(user_id: str, body: GrantIn, admin: Scoped("users.entitlements"), db: DB) -> dict[str, Any]:
    return UsersAdmin(db, admin).grant(user_id, body.plan_key, body.feature, body.days, body.reason)


@router.delete("/users/{user_id}/entitlements/{entitlement_id}", tags=["admin:users"])
def revoke(user_id: str, entitlement_id: int, body: ReasonIn, admin: Scoped("users.entitlements"), db: DB) -> dict[str, Any]:
    return UsersAdmin(db, admin).revoke(user_id, entitlement_id, body.reason)


@router.post("/purchases/{purchase_id}/refund", tags=["admin:users"])
def refund(purchase_id: str, body: ReasonIn, admin: Scoped("users.refund"), db: DB) -> dict[str, Any]:
    return UsersAdmin(db, admin).refund(purchase_id, body.reason)


@router.post("/users/{user_id}/suspend", tags=["admin:users"])
def suspend(user_id: str, body: SuspendIn, admin: Scoped("users.suspend"), db: DB) -> dict[str, Any]:
    return UsersAdmin(db, admin).suspend(user_id, body.suspend, body.reason)


@router.post("/users/{user_id}/magic-link", tags=["admin:users"])
def resend_link(user_id: str, admin: Scoped("users.magic_link"), db: DB) -> dict[str, Any]:
    return UsersAdmin(db, admin).resend_magic_link(user_id)


@router.get("/plans/{plan_id}/rerun-preview", tags=["admin:users"])
def rerun_preview(plan_id: str, admin: Scoped("users.read"), db: DB) -> dict[str, Any]:
    return UsersAdmin(db, admin).rerun_preview(plan_id)


@router.get("/privacy-requests", tags=["admin:privacy"])
def privacy_requests(admin: Scoped("privacy.queue"), db: DB, status: str | None = None) -> dict[str, Any]:
    return {"requests": UsersAdmin(db, admin).privacy_queue(status)}


@router.post("/privacy-requests/{request_id}/fulfil", tags=["admin:privacy"])
def fulfil(request_id: str, admin: Scoped("privacy.queue"), db: DB) -> dict[str, Any]:
    out = UsersAdmin(db, admin).fulfil(request_id)
    return {"status": "completed", "keys": sorted(out.get("export", out))}


@router.get("/cohorts", tags=["admin:analytics"])
def cohorts(admin: Scoped("cohorts.read"), db: DB) -> dict[str, Any]:
    return UsersAdmin(db, admin).cohorts()


# ---------------------------------------------------------------- recommendation engine
class DraftIn(BaseModel):
    kind: str
    notes: str | None = None


class EditIn(BaseModel):
    ops: list[dict[str, Any]]
    reason: str | None = None


class ReviewIn(BaseModel):
    approve: bool
    notes: str | None = None


class PublishIn(BaseModel):
    rollout_pct: int = Field(100, ge=1, le=100)


class SimulateIn(BaseModel):
    release_id: str
    persona_id: str | None = None
    answers: dict[str, Any] | None = None
    labs: list[dict[str, Any]] | None = None


@router.get("/engine/graph", tags=["admin:engine"])
def graph(admin: Scoped("engine.read"), db: DB) -> dict[str, Any]:
    return EngineAdmin(db, admin).live("graph")


@router.get("/engine/knowledge", tags=["admin:engine"])
def knowledge(admin: Scoped("engine.read"), db: DB) -> dict[str, Any]:
    from stacksense import registry

    live = EngineAdmin(db, admin).live("rules")
    live["problems"] = registry.live_kb(db).validate()
    return live


@router.get("/engine/releases", tags=["admin:engine"])
def releases(admin: Scoped("engine.read"), db: DB, kind: str | None = None) -> dict[str, Any]:
    return {"releases": EngineAdmin(db, admin).list(kind)}


@router.get("/engine/releases/{release_id}", tags=["admin:engine"])
def release(release_id: str, admin: Scoped("engine.read"), db: DB) -> dict[str, Any]:
    ea = EngineAdmin(db, admin)
    r = ea.get(release_id)
    return {**ea.summary(r), "data": r.data}


@router.post("/engine/releases", tags=["admin:engine"])
def create_release(body: DraftIn, admin: Scoped("engine.draft"), db: DB) -> dict[str, Any]:
    ea = EngineAdmin(db, admin)
    return ea.summary(ea.create_draft(body.kind, body.notes))


@router.patch("/engine/releases/{release_id}", tags=["admin:engine"])
def edit_release(release_id: str, body: EditIn, admin: Scoped("engine.draft"), db: DB) -> dict[str, Any]:
    ea = EngineAdmin(db, admin)
    return ea.summary(ea.edit(release_id, body.ops, body.reason))


@router.post("/engine/releases/{release_id}/check", tags=["admin:engine"])
def check_release(release_id: str, admin: Scoped("engine.simulate"), db: DB) -> dict[str, Any]:
    ea = EngineAdmin(db, admin)
    return ea.summary(ea.check(release_id))


@router.post("/engine/releases/{release_id}/submit", tags=["admin:engine"])
def submit_release(release_id: str, admin: Scoped("engine.draft"), db: DB) -> dict[str, Any]:
    ea = EngineAdmin(db, admin)
    return ea.summary(ea.submit(release_id))


@router.post("/engine/releases/{release_id}/review", tags=["admin:engine"])
def review_release(release_id: str, body: ReviewIn, admin: Scoped("engine.approve"), db: DB) -> dict[str, Any]:
    ea = EngineAdmin(db, admin)
    return ea.summary(ea.review(release_id, body.approve, body.notes))


@router.post("/engine/releases/{release_id}/publish", tags=["admin:engine"])
def publish_release(release_id: str, body: PublishIn, admin: Scoped("engine.publish"), db: DB) -> dict[str, Any]:
    ea = EngineAdmin(db, admin)
    return ea.summary(ea.publish(release_id, body.rollout_pct))


@router.post("/engine/releases/{release_id}/rollback", tags=["admin:engine"])
def rollback_release(release_id: str, body: ReasonIn, admin: Scoped("engine.publish"), db: DB) -> dict[str, Any]:
    ea = EngineAdmin(db, admin)
    return ea.summary(ea.rollback(release_id, body.reason))


@router.get("/engine/releases/{release_id}/impact", tags=["admin:engine"])
def release_impact(release_id: str, admin: Scoped("engine.simulate"), db: DB) -> dict[str, Any]:
    return EngineAdmin(db, admin).impact_report(release_id)


@router.get("/engine/personas", tags=["admin:engine"])
def personas(admin: Scoped("engine.simulate")) -> dict[str, Any]:
    return {"personas": [{"id": p["id"], "name": p["name"], "description": p.get("description", ""), "expect": p.get("expect", {})} for p in load_personas()]}


@router.post("/engine/simulator", tags=["admin:engine"])
def simulate(body: SimulateIn, admin: Scoped("engine.simulate"), db: DB) -> dict[str, Any]:
    return EngineAdmin(db, admin).simulate(body.release_id, body.persona_id, body.answers, body.labs)


@router.get("/engine/llm", tags=["admin:engine"])
def llm_calls(admin: Scoped("engine.read"), db: DB) -> dict[str, Any]:
    rows = db.scalars(select(LLMCallLog).order_by(LLMCallLog.ts.desc()).limit(200)).all()
    total = len(rows) or 1
    fallbacks = sum(1 for r in rows if r.outcome.startswith("fallback"))
    return {"fallback_rate": round(fallbacks / total, 3), "calls": [{"job": r.job, "model": r.model, "outcome": r.outcome, "latency_ms": r.latency_ms, "cost_usd": r.cost_usd, "ts": r.ts.isoformat()} for r in rows]}


# ---------------------------------------------------------------- catalog
class OverrideIn(BaseModel):
    product_id: str
    action: str
    reason: str
    expires_days: int | None = None


class ActiveIn(BaseModel):
    active: bool
    reason: str


@router.get("/catalog/products", tags=["admin:catalog"])
def products(admin: Scoped("catalog.read"), db: DB, ingredient: str | None = None) -> dict[str, Any]:
    return {"products": CatalogAdmin(db, admin).products(ingredient)}


@router.put("/catalog/products/{product_id}", tags=["admin:catalog"])
def put_product(product_id: str, body: dict[str, Any], admin: Scoped("catalog.write"), db: DB) -> dict[str, Any]:
    reason = body.pop("_reason", None)
    return CatalogAdmin(db, admin).upsert_product({**body, "id": product_id}, reason)


@router.post("/catalog/products/{product_id}/active", tags=["admin:catalog"])
def product_active(product_id: str, body: ActiveIn, admin: Scoped("catalog.write"), db: DB) -> dict[str, Any]:
    return CatalogAdmin(db, admin).set_active(product_id, body.active, body.reason)


@router.get("/catalog/retailers", tags=["admin:catalog"])
def retailers(admin: Scoped("catalog.read"), db: DB) -> dict[str, Any]:
    return {"retailers": CatalogAdmin(db, admin).retailers()}


@router.put("/catalog/retailers/{retailer_id}", tags=["admin:catalog"])
def put_retailer(retailer_id: str, body: dict[str, Any], admin: Scoped("catalog.write"), db: DB) -> dict[str, Any]:
    reason = body.pop("_reason", None)
    return CatalogAdmin(db, admin).upsert_retailer({**body, "id": retailer_id}, reason)


@router.get("/catalog/overrides", tags=["admin:catalog"])
def overrides(admin: Scoped("catalog.read"), db: DB) -> dict[str, Any]:
    return {"overrides": CatalogAdmin(db, admin).overrides()}


@router.post("/catalog/overrides", tags=["admin:catalog"])
def add_override(body: OverrideIn, admin: Scoped("catalog.overrides"), db: DB) -> dict[str, Any]:
    return CatalogAdmin(db, admin).add_override(body.product_id, body.action, body.reason, body.expires_days)


@router.delete("/catalog/overrides/{override_id}", tags=["admin:catalog"])
def remove_override(override_id: int, body: ReasonIn, admin: Scoped("catalog.overrides"), db: DB) -> dict[str, Any]:
    return CatalogAdmin(db, admin).remove_override(override_id, body.reason)


@router.get("/catalog/link-health", tags=["admin:catalog"])
def link_health(admin: Scoped("catalog.read"), db: DB) -> dict[str, Any]:
    return {"checks": CatalogAdmin(db, admin).link_health()}


@router.post("/catalog/link-health/run", tags=["admin:catalog"])
def run_link_health(admin: Scoped("catalog.write"), db: DB) -> dict[str, Any]:
    from stacksense.modules.plans.service import affiliate_tags

    return CatalogAdmin(db, admin).run_link_health(affiliate_tags())


@router.get("/catalog/performance", tags=["admin:catalog"])
def performance(admin: Scoped("catalog.read"), db: DB, days: int = 30) -> dict[str, Any]:
    return CatalogAdmin(db, admin).performance(days)


# ---------------------------------------------------------------- revenue
class PaywallIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    gates: dict[str, Any]
    triggers: list[dict[str, Any]]
    copy_text: dict[str, Any] = Field(alias="copy")


class ExpStatusIn(BaseModel):
    status: str
    reason: str | None = None


@router.get("/revenue/plans", tags=["admin:revenue"])
def rev_plans(admin: Scoped("revenue.read"), db: DB) -> dict[str, Any]:
    return RevenueAdmin(db, admin).plans()


@router.put("/revenue/plans/{key}", tags=["admin:revenue"])
def rev_update_plan(key: str, body: dict[str, Any], admin: Scoped("revenue.write"), db: DB) -> dict[str, Any]:
    reason = body.pop("_reason", None)
    return RevenueAdmin(db, admin).update_plan(key, body, reason)


@router.put("/revenue/prices/{price_id}", tags=["admin:revenue"])
def rev_price(price_id: str, body: dict[str, Any], admin: Scoped("revenue.write"), db: DB) -> dict[str, Any]:
    reason = body.pop("_reason", None)
    return RevenueAdmin(db, admin).upsert_price({**body, "id": price_id}, reason)


@router.get("/revenue/paywall", tags=["admin:revenue"])
def rev_paywall(admin: Scoped("revenue.read"), db: DB) -> dict[str, Any]:
    return RevenueAdmin(db, admin).paywall()


@router.post("/revenue/paywall", tags=["admin:revenue"])
def rev_paywall_draft(body: PaywallIn, admin: Scoped("revenue.write"), db: DB) -> dict[str, Any]:
    return RevenueAdmin(db, admin).draft_paywall(body.gates, body.triggers, body.copy_text)


@router.post("/revenue/paywall/{paywall_id}/publish", tags=["admin:revenue"])
def rev_paywall_publish(paywall_id: int, admin: Scoped("revenue.write"), db: DB) -> dict[str, Any]:
    return RevenueAdmin(db, admin).publish_paywall(paywall_id)


@router.get("/revenue/promos", tags=["admin:revenue"])
def rev_promos(admin: Scoped("revenue.read"), db: DB) -> dict[str, Any]:
    return {"promos": RevenueAdmin(db, admin).promos()}


@router.post("/revenue/promos", tags=["admin:revenue"])
def rev_promo(body: dict[str, Any], admin: Scoped("revenue.write"), db: DB) -> dict[str, Any]:
    return RevenueAdmin(db, admin).upsert_promo(body)


@router.get("/revenue/experiments", tags=["admin:revenue"])
def rev_experiments(admin: Scoped("revenue.read"), db: DB) -> dict[str, Any]:
    return {"experiments": RevenueAdmin(db, admin).experiments()}


@router.post("/revenue/experiments", tags=["admin:revenue"])
def rev_experiment(body: dict[str, Any], admin: Scoped("revenue.write"), db: DB) -> dict[str, Any]:
    return RevenueAdmin(db, admin).upsert_experiment(body)


@router.post("/revenue/experiments/{key}/status", tags=["admin:revenue"])
def rev_experiment_status(key: str, body: ExpStatusIn, admin: Scoped("revenue.write"), db: DB) -> dict[str, Any]:
    return RevenueAdmin(db, admin).set_experiment_status(key, body.status, body.reason)


@router.get("/revenue/dashboards", tags=["admin:revenue"])
def rev_dashboards(admin: Scoped("dashboards.read"), db: DB, days: int = 30) -> dict[str, Any]:
    return RevenueAdmin(db, admin).dashboards(days)


# ---------------------------------------------------------------- audit + ops
@router.get("/audit", tags=["admin:audit"])
def audit_list(admin: Scoped("audit.read"), db: DB, actor: str | None = None, action: str | None = None, target_id: str | None = None, limit: int = 200) -> dict[str, Any]:
    return {"records": audit_log.query(db, actor=actor, action=action, target_id=target_id, limit=limit)}


@router.get("/audit/export", tags=["admin:audit"], response_class=PlainTextResponse)
def audit_export(admin: Scoped("audit.export"), db: DB) -> PlainTextResponse:
    audit_log.audit(db, admin.id, admin.role, "audit.export", "audit_log", None)
    return PlainTextResponse(audit_log.export_csv(db), media_type="text/csv", headers={"Content-Disposition": 'attachment; filename="audit.csv"'})


@router.get("/ops/outbox", tags=["admin:ops"])
def outbox(admin: Scoped("settings.manage"), db: DB) -> dict[str, Any]:
    rows = db.scalars(select(Outbox).order_by(Outbox.id.desc()).limit(100)).all()
    return {"env": get_settings().env, "outbox": [{"id": r.id, "channel": r.channel, "template": r.template, "status": r.status, "scheduled_for": r.scheduled_for.isoformat(), "error": r.error} for r in rows]}
