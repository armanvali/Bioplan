"""/v1/auth and /v1/me: magic-link sign-in, account, consents, health profile, privacy rights."""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import select

from stacksense.config import get_settings
from stacksense.core.errors import DomainError, NotFound
from stacksense.core.pdf import PdfDoc
from stacksense.deps import DB, CurrentUser, PlanToken, SessionToken, rate_limit
from stacksense.modules.admin.users_admin import create_privacy_request, fulfil_privacy_request
from stacksense.modules.billing.entitlements import Entitlements
from stacksense.modules.identity.models import PushSubscription
from stacksense.modules.identity.service import IdentityService
from stacksense.modules.notify.service import NotifyService
from stacksense.modules.profile.consent import PURPOSES, ConsentService
from stacksense.modules.profile.models import IntakeSession, Plan
from stacksense.modules.profile.service import ProfileService

auth_router = APIRouter(prefix="/auth", tags=["auth"], dependencies=[Depends(rate_limit("auth", 20))])
me_router = APIRouter(prefix="/me", tags=["me"])


class MagicLinkIn(BaseModel):
    email: str = Field(..., max_length=254)
    next: str | None = None


class VerifyIn(BaseModel):
    token: str


class ConsentIn(BaseModel):
    granted: bool
    method: Literal["checkbox", "settings"] = "settings"
    policy_version: str | None = None


class SaveIn(BaseModel):
    """Save results to the account: consents are explicit, separate boxes (section 14.1)."""

    session_id: str | None = None
    plan_id: str | None = None
    profile_storage: bool
    personalisation: bool = False


class PushIn(BaseModel):
    endpoint: str
    keys: dict[str, str]


class PrivacyIn(BaseModel):
    confirm: bool = False


@auth_router.post("/magic-link", summary="Email a sign-in link")
def magic_link(body: MagicLinkIn, db: DB) -> dict[str, Any]:
    token = IdentityService(db).request_magic_link(body.email, payload={"next": body.next})
    out: dict[str, Any] = {"sent": True}
    if get_settings().env in ("dev", "test"):
        out["dev_token"] = token  # no email provider in dev: the link is also logged by the notify worker
    return out


@auth_router.post("/verify", summary="Exchange a magic-link token for an access token")
def verify(body: VerifyIn, db: DB) -> dict[str, Any]:
    ids = IdentityService(db)
    user, link, created = ids.verify_magic_link(body.token)
    return {"access_token": ids.access_token(user), "user": ids.public(user), "created": created, "next": link.payload.get("next")}


@me_router.get("", summary="Current account")
def me(user: CurrentUser, db: DB) -> dict[str, Any]:
    ent = Entitlements(db)
    feats = ent.features(user.id)
    return {**IdentityService(db).public(user), "tier": ent.tier(feats), "entitlements": sorted(feats), "limits": ent.limits(feats)}


@me_router.patch("", summary="Update locale, time zone or country")
def update_me(body: dict[str, Any], user: CurrentUser, db: DB) -> dict[str, Any]:
    for f in ("locale", "tz", "country", "region"):
        if f in body:
            setattr(user, f, body[f])
    return IdentityService(db).public(user)


@me_router.get("/entitlements", summary="Feature keys for the current user")
def entitlements(user: CurrentUser, db: DB) -> dict[str, Any]:
    ent = Entitlements(db)
    feats = ent.features(user.id)
    return {"features": sorted(feats), "tier": ent.tier(feats), "limits": ent.limits(feats)}


@me_router.get("/consents", summary="Consent per purpose")
def consents(user: CurrentUser, db: DB) -> dict[str, Any]:
    return {"purposes": ConsentService(db).summary(user.id)}


@me_router.put("/consents/{purpose}", summary="Grant or withdraw one purpose")
def set_consent(purpose: str, body: ConsentIn, user: CurrentUser, db: DB) -> dict[str, Any]:
    if purpose not in PURPOSES:
        raise NotFound("unknown_purpose", "Unknown consent purpose")
    ConsentService(db).record(user.id, purpose, body.granted, body.method, policy_version=body.policy_version)
    # Withdrawals take effect now; the nightly job is a 24-hour safety net (section 14.1).
    if not body.granted:
        if purpose == "profile_storage" and user.subject_id:
            ProfileService(db).erase_health(user.subject_id)
            user.subject_id = None
        if purpose == "reminders":
            NotifyService(db).cancel_reminders(user.id)
    return {"purposes": ConsentService(db).summary(user.id)}


@me_router.post("/save", summary="Save an anonymous session/plan to the account (needs profile_storage)")
def save(body: SaveIn, user: CurrentUser, db: DB, session_token: SessionToken, plan_token: PlanToken) -> dict[str, Any]:
    from stacksense.modules.intake.service import IntakeService
    from stacksense.modules.plans.service import PlanService

    consent = ConsentService(db)
    consent.record(user.id, "profile_storage", body.profile_storage, "checkbox")
    if not body.profile_storage:
        return {"saved": False, "note": "Nothing was stored. Your plan stays available on this device for 30 days."}
    if body.personalisation:
        consent.record(user.id, "personalisation", True, "checkbox")
    subject_id = None
    if body.session_id:
        subject_id = IntakeService(db).authorize(body.session_id, session_token, user).subject_id
    elif body.plan_id:
        subject_id = PlanService(db).authorize(body.plan_id, plan_token, user).subject_id
    if subject_id is None:
        raise DomainError("nothing_to_save", "Give a session_id or plan_id")
    target = ProfileService(db).link(user, subject_id)
    return {"saved": True, "subject_linked": target == user.subject_id}


@me_router.get("/plans", summary="Saved plans")
def my_plans(user: CurrentUser, db: DB) -> dict[str, Any]:
    if not user.subject_id:
        return {"plans": []}
    rows = db.scalars(select(Plan).where(Plan.subject_id == user.subject_id).order_by(Plan.created_at.desc())).all()
    return {"plans": [{"id": p.id, "status": p.status, "created_at": p.created_at.isoformat(), "items": p.summary.get("active", []), "locked": p.summary.get("locked", []),
                       "monthly_cost": p.summary.get("monthly_cost"), "reason": p.reason, "rules_version": p.rules_version} for p in rows]}


@me_router.get("/sessions", summary="Intake sessions on this account")
def my_sessions(user: CurrentUser, db: DB) -> dict[str, Any]:
    if not user.subject_id:
        return {"sessions": []}
    rows = db.scalars(select(IntakeSession).where(IntakeSession.subject_id == user.subject_id).order_by(IntakeSession.created_at.desc())).all()
    return {"sessions": [{"id": s.id, "status": s.status, "created_at": s.created_at.isoformat(), "cards": s.cards_answered} for s in rows]}


@me_router.get("/profile", summary="Health profile view")
def profile(user: CurrentUser, db: DB) -> dict[str, Any]:
    if not user.subject_id:
        return {"profile": None}
    return {"profile": ProfileService(db).profile(user.subject_id)}


@me_router.post("/preferences", summary="Product memory: rate a product, flag hard-to-swallow, like a brand")
def preferences(body: dict[str, Any], user: CurrentUser, db: DB) -> dict[str, Any]:
    if not user.subject_id or not ConsentService(db).allows(user.id, "profile_storage"):
        raise DomainError("needs_profile_storage", "Saving preferences needs profile storage")
    allowed = {k: body[k] for k in ("product_id", "rating", "hard_to_swallow", "brand", "liked_brand") if k in body}
    ProfileService(db).record(user.subject_id, "preference", allowed)
    return {"ok": True}


@me_router.get("/privacy/history", summary="Consent changes and staff access to your data")
def privacy_history(user: CurrentUser, db: DB) -> dict[str, Any]:
    return {"consents": ConsentService(db).history(user.id), "staff_access": ProfileService(db).staff_access(user.id)}


@me_router.post("/privacy/export", summary="Export everything (JSON; add ?format=pdf for a PDF)")
def privacy_export(user: CurrentUser, db: DB, format: str = "json") -> Any:
    req = create_privacy_request(db, user, "export")
    data = fulfil_privacy_request(db, req)["export"]
    if format == "pdf":
        doc = PdfDoc("StackSense data export")
        doc.heading("Your StackSense data", 16)
        doc.paragraph(f"Exported {data['exported_at']}")
        for section in ("account", "consents", "billing", "staff_access", "health_profile"):
            if section in data:
                doc.heading(section.replace("_", " ").title(), 12)
                _pdf_dump(doc, data[section])
        return Response(doc.render(), media_type="application/pdf", headers={"Content-Disposition": 'attachment; filename="stacksense-export.pdf"'})
    return {"request_id": req.id, "data": data}


def _pdf_dump(doc: PdfDoc, obj: Any, depth: int = 0) -> None:
    if isinstance(obj, dict):
        for k, v in obj.items():
            if isinstance(v, (dict, list)):
                doc.paragraph(f"{'  ' * depth}{k}:", bold=True)
                _pdf_dump(doc, v, depth + 1)
            else:
                doc.paragraph(f"{'  ' * depth}{k}: {v}")
    elif isinstance(obj, list):
        for v in obj[:200]:
            _pdf_dump(doc, v, depth + 1) if isinstance(v, (dict, list)) else doc.bullets([str(v)])
    else:
        doc.paragraph(str(obj))


@me_router.post("/privacy/delete", summary="Delete everything (two clicks: confirm=true)")
def privacy_delete(body: PrivacyIn, user: CurrentUser, db: DB) -> dict[str, Any]:
    if not body.confirm:
        raise DomainError("confirm_required", "Send confirm=true to delete your account and health data")
    req = create_privacy_request(db, user, "delete")
    return {"request_id": req.id, **fulfil_privacy_request(db, req)}


@me_router.post("/push-subscriptions", summary="Register a Web Push subscription (needs reminders consent)")
def push_subscribe(body: PushIn, user: CurrentUser, db: DB) -> dict[str, Any]:
    if not ConsentService(db).allows(user.id, "reminders"):
        raise DomainError("needs_reminders_consent", "Turn on reminders first")
    db.add(PushSubscription(user_id=user.id, endpoint=body.endpoint, keys=body.keys))
    return {"ok": True, "vapid_public_key": get_settings().vapid_public_key}
