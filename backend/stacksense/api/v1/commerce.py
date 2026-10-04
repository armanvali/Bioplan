"""/v1/billing, /v1/webhooks/stripe, /v1/clicks, /v1/go: monetisation endpoints.

Affiliate links are attached after the stack is decided; clicks log a hashed user id only.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Header, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field

from stacksense.core.errors import DomainError, NotFound
from stacksense.core.ids import new_id
from stacksense.deps import DB, CurrentUser, OptionalUser, PlanToken, rate_limit
from stacksense.modules.billing.models import FunnelEvent
from stacksense.modules.billing.service import BillingService
from stacksense.modules.catalog.models import Click
from stacksense.modules.plans.service import PlanService
from stacksense.modules.profile.keys import user_hash

billing_router = APIRouter(prefix="/billing", tags=["billing"])
webhook_router = APIRouter(prefix="/webhooks", tags=["webhooks"])
click_router = APIRouter(tags=["affiliate"], dependencies=[Depends(rate_limit("clicks", 60))])

ALLOWED_EVENTS = {"paywall_viewed", "paywall_dismissed", "paywall_offer_tapped", "results_viewed", "calendar_opened", "product_sheet_opened"}


class CheckoutIn(BaseModel):
    plan_key: str
    price_id: str
    plan_id: str | None = None
    session_id: str | None = None
    email: str | None = Field(None, max_length=254)
    promo: str | None = None


class FakeCompleteIn(BaseModel):
    email: str | None = None


class ClickIn(BaseModel):
    plan_id: str
    product_id: str
    ingredient_id: str | None = None


class EventIn(BaseModel):
    event: str
    anon_id: str = Field(..., max_length=64)
    props: dict[str, str | int | float | bool] = {}


@billing_router.get("/offers", summary="Plans, prices and paywall config for the user's region and experiment variant")
def offers(db: DB, user: OptionalUser, country: str | None = None, anon_id: str | None = None) -> dict[str, Any]:
    subject_key = user.id if user else anon_id
    return BillingService(db).offers(country or (user.country if user else None), subject_key)


@billing_router.post("/checkout", summary="Create a checkout session for a plan key")
def checkout(body: CheckoutIn, db: DB, user: OptionalUser) -> dict[str, Any]:
    return BillingService(db).start_checkout(plan_key=body.plan_key, price_id=body.price_id, user=user, email=body.email, plan_id=body.plan_id, session_id=body.session_id, promo=body.promo)


@billing_router.post("/fake-checkout/{checkout_id}/complete", summary="Dev only: complete a fake checkout (emits signed webhook events)")
def fake_complete(checkout_id: str, body: FakeCompleteIn, db: DB) -> dict[str, Any]:
    return BillingService(db).complete_fake(checkout_id, body.email)


@billing_router.post("/portal", summary="Customer Portal link")
def portal(user: CurrentUser, db: DB) -> dict[str, Any]:
    return {"url": BillingService(db).portal(user)}


@billing_router.post("/cancel", summary="Cancel Plus at period end (one click)")
def cancel(user: CurrentUser, db: DB) -> dict[str, Any]:
    return BillingService(db).cancel_subscription(user)


@billing_router.get("/summary", summary="Subscription, receipts and limits")
def summary(user: CurrentUser, db: DB) -> dict[str, Any]:
    return BillingService(db).billing_summary(user)


@webhook_router.post("/stripe", summary="Verified, idempotent Stripe webhook -> entitlements")
async def stripe_webhook(request: Request, db: DB, stripe_signature: str | None = Header(None)) -> dict[str, Any]:
    payload = await request.body()
    return BillingService(db).handle_webhook(payload, stripe_signature)


@click_router.post("/clicks", summary="Log an affiliate click; returns the destination URL")
def click(body: ClickIn, db: DB, user: OptionalUser, token: PlanToken) -> dict[str, Any]:
    ps = PlanService(db)
    plan = ps.authorize(body.plan_id, token, user)
    products = ps.products(plan, {"product_alternatives"})  # routing is the same for every tier
    offer = None
    for it in products["items"]:
        for p in [it.get("best"), *it.get("alternatives", [])]:
            if p and p["product_id"] == body.product_id:
                offer = p.get("offer")
    if not offer or not offer.get("url"):
        raise NotFound("unknown_product", "That product isn't part of this plan")
    click_id = new_id("clk")
    db.add(Click(id=click_id, user_hash=user_hash(user.id if user else plan.subject_id), plan_id=plan.id, product_id=body.product_id, retailer=offer["retailer"], url=offer["url"]))
    return {"click_id": click_id, "url": offer["url"], "retailer": offer["retailer"], "go": f"/v1/go/{click_id}"}


@click_router.get("/go/{click_id}", summary="Redirect a logged click to the retailer")
def go(click_id: str, db: DB) -> RedirectResponse:
    row = db.get(Click, click_id)
    if row is None:
        raise NotFound("unknown_click", "Unknown link")
    return RedirectResponse(row.url, status_code=302)


@click_router.post("/events", summary="Consent-gated product analytics (no health content)")
def event(body: EventIn, db: DB, user: OptionalUser) -> dict[str, Any]:
    if body.event not in ALLOWED_EVENTS:
        raise DomainError("unknown_event", "Unknown analytics event")
    db.add(FunnelEvent(actor_hash=user_hash(user.id if user else body.anon_id), event=body.event, props={k: v for k, v in body.props.items() if k in ("trigger", "variant", "plan_key", "surface")}))
    return {"ok": True}
