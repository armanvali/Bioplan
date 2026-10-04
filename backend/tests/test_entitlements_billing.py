"""Entitlement tests (section 12.1): every gated endpoint redacts without the feature key;
safety fields are present for every tier; Stripe webhook replays and out-of-order events
leave entitlements correct."""

import json
import time

import pytest
from sqlalchemy import select

from stacksense.db import session_scope
from stacksense.modules.admin.models import AuditLog
from stacksense.modules.billing.models import Purchase
from tests.conftest import build_plan_api, buy, login, run_intake_api

SAFETY_KEYS = ("excluded", "locked", "warnings", "banners", "spacing", "drug_spacing")


@pytest.fixture
def maya_plan(client, maya):
    run = run_intake_api(client, maya)
    plan = build_plan_api(client, run)
    return plan, {"X-Plan-Token": plan["plan_token"]}


def test_free_tier_is_redacted_server_side(client, maya_plan):
    plan, h = maya_plan
    pid = plan["plan_id"]
    for it in plan["items"]:
        assert it["dose"]["locked"] is True and "range" in it["dose"]
        assert it["dose_label"] is None and it["amount_text"] is None
    for k in SAFETY_KEYS:
        assert k in plan
    assert plan["excluded"] and plan["locked"]
    im = client.get(f"/v1/plans/{pid}/impact", headers=h).json()
    visible = [a for a in im["areas"] if not a.get("locked")]
    assert len(visible) == 3 and all("projected" not in a for a in im["areas"] if a.get("locked"))
    pr = client.get(f"/v1/plans/{pid}/products", headers=h).json()
    assert all(i["alternatives"] == [] for i in pr["items"]) and pr["gated"] == ["product_alternatives"]
    assert all(i["best"] for i in pr["items"])  # best match + affiliate link on every tier
    sched = client.get(f"/v1/plans/{pid}/schedule?from=2026-10-05&to=2026-11-30&today=2026-10-05", headers=h).json()
    assert len(sched["days"]) == 7 and sched["locked_after"]
    for path in ("calendar.ics", "doctor-note.pdf"):
        assert client.get(f"/v1/plans/{pid}/{path}", headers=h).status_code == 402
    assert client.post(f"/v1/plans/{pid}/calendar-token", headers=h).status_code == 402
    audit = client.get(f"/v1/plans/{pid}/audit", headers=h).json()["records"]
    assert all("amount" not in r for r in audit)


def test_full_report_unlocks_and_never_expires(client, maya_plan):
    plan, h = maya_plan
    pid = plan["plan_id"]
    out = buy(client, "full_report", "price_full_report_cad", "maya@example.com", pid)
    assert out["results"][0]["user_created"] is True  # anonymous purchase creates the account
    auth = {**login(client, "maya@example.com"), **h}
    full = client.get(f"/v1/plans/{pid}", headers=auth).json()
    assert all(isinstance(it["dose"], (int, float)) for it in full["items"])
    assert full["gated"] == []
    assert client.get(f"/v1/plans/{pid}/impact", headers=auth).json().get("locked") is not True
    assert client.get(f"/v1/plans/{pid}/calendar.ics", headers=auth).status_code == 200
    pdf = client.get(f"/v1/plans/{pid}/doctor-note.pdf", headers=auth)
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")
    sched = client.get(f"/v1/plans/{pid}/schedule?from=2026-10-05&to=2026-12-31&today=2026-10-05", headers=auth).json()
    assert len(sched["days"]) == 88 and sched["locked_after"] is None
    # Plus-only features stay locked.
    assert client.post(f"/v1/plans/{pid}/checkins", json={"week": 2, "area_scores": {"sleep": 6}}, headers=auth).status_code == 402
    ents = client.get("/v1/me/entitlements", headers=auth).json()
    assert ents["tier"] == "full_report" and "calendar_ongoing" not in ents["features"]


def test_plus_subscription_trial_and_cancel(client, maya_plan):
    plan, h = maya_plan
    pid = plan["plan_id"]
    buy(client, "plus", "price_plus_month_cad", "plus@example.com", pid)
    auth = {**login(client, "plus@example.com"), **h}
    me = client.get("/v1/me", headers=auth).json()
    assert me["tier"] == "plus" and "reminders" in me["entitlements"]
    summary = client.get("/v1/billing/summary", headers=auth).json()
    assert summary["subscriptions"][0]["status"] == "trialing" and summary["subscriptions"][0]["trial_end"]
    r = client.post(f"/v1/plans/{pid}/checkins", json={"week": 2, "area_scores": {"sleep": 6, "energy": 5}, "side_effects": []}, headers=auth)
    assert r.status_code == 200 and r.json()["reported"][0]["area_scores"]["sleep"] == 6
    cancel = client.post("/v1/billing/cancel", headers=auth).json()
    assert cancel["cancel_at"]
    # Cancellation is effective at period end: access continues until then.
    assert "calendar_ongoing" in client.get("/v1/me/entitlements", headers=auth).json()["features"]


def _signed(client, event):
    from stacksense.modules.billing.service import gateway

    payload = json.dumps(event).encode()
    return client.post("/v1/webhooks/stripe", content=payload, headers={"Stripe-Signature": gateway().sign(payload), "Content-Type": "application/json"})


def test_webhooks_are_verified_idempotent_and_order_safe(client, maya_plan):
    plan, _ = maya_plan
    buy(client, "plus", "price_plus_month_cad", "order@example.com", plan["plan_id"])
    auth = login(client, "order@example.com")
    sub_id = client.get("/v1/billing/summary", headers=auth).json()["subscriptions"][0]["id"]
    now = int(time.time())
    newer = {"id": "evt_new", "type": "customer.subscription.updated", "created": now + 100, "data": {"object": {"id": sub_id, "status": "active", "current_period_end": now + 30 * 86400, "cancel_at": None}}}
    older = {"id": "evt_old", "type": "customer.subscription.updated", "created": now + 50, "data": {"object": {"id": sub_id, "status": "canceled", "current_period_end": now - 10}}}
    assert _signed(client, newer).json()["status"] == "processed"
    assert _signed(client, newer).json()["status"] == "duplicate"  # replay is a no-op
    assert _signed(client, older).json()["ignored"] == "out_of_order"  # stale event can't revoke access
    assert "calendar_ongoing" in client.get("/v1/me/entitlements", headers=auth).json()["features"]
    deleted = {"id": "evt_del", "type": "customer.subscription.deleted", "created": now + 200, "data": {"object": {"id": sub_id, "status": "canceled", "current_period_end": now - 5, "ended_at": now - 5}}}
    _signed(client, deleted)
    assert "calendar_ongoing" not in client.get("/v1/me/entitlements", headers=auth).json()["features"]
    bad = client.post("/v1/webhooks/stripe", content=b"{}", headers={"Stripe-Signature": "t=1,v1=bad"})
    assert bad.status_code == 401


def test_refund_revokes_and_repeated_refunds_flag(client, maya_plan):
    plan, _ = maya_plan
    for _ in range(2):
        out = buy(client, "full_report", "price_full_report_cad", "refund@example.com", plan["plan_id"])
        pur = out["results"][0]["purchase"]
        with session_scope() as db:
            db.get(Purchase, pur).stripe_payment_intent = f"pi_test_{pur}"
        ev = {"id": f"evt_ref_{pur}", "type": "charge.refunded", "created": int(time.time()), "data": {"object": {"payment_intent": f"pi_test_{pur}"}}}
        assert _signed(client, ev).json()["refunded"] is True
    auth = login(client, "refund@example.com")
    assert client.get("/v1/me/entitlements", headers=auth).json()["tier"] == "free"
    with session_scope() as db:
        flag = db.scalar(select(AuditLog).where(AuditLog.action == "billing.refund_flag"))
        assert flag and flag.after["refunds"] == 2  # repeated refunds flag the account for review


def test_offers_are_regional_and_experiments_sticky(client, session):
    ca = client.get("/v1/billing/offers?country=CA&anon_id=a1").json()
    us = client.get("/v1/billing/offers?country=US&anon_id=a1").json()
    assert ca["currency"] == "CAD" and us["currency"] == "USD"
    fr = next(p for p in ca["plans"] if p["key"] == "full_report")
    assert fr["prices"][0]["amount"] == 999
    assert ca["paywall"]["copy"]["trust_line"] == "Safety information is always free."
    from stacksense.modules.billing.models import Experiment

    session.add(Experiment(key="price_test", name="Price test", surface="price", region="CA", status="running",
                           variants=[{"key": "control", "weight": 1, "config": {}}, {"key": "low", "weight": 1, "config": {"amounts": {"price_full_report_cad": 799}}}]))
    session.commit()
    seen = {client.get(f"/v1/billing/offers?country=CA&anon_id=u{i}").json()["experiments"][0]["variant"] for i in range(30)}
    assert seen == {"control", "low"}
    first = client.get("/v1/billing/offers?country=CA&anon_id=sticky").json()
    for _ in range(5):
        assert client.get("/v1/billing/offers?country=CA&anon_id=sticky").json()["experiments"] == first["experiments"]


def test_affiliate_click_logs_hash_and_redirects(client, maya_plan, session):
    plan, h = maya_plan
    r = client.post("/v1/clicks", json={"plan_id": plan["plan_id"], "product_id": "th-mg"}, headers=h).json()
    assert r["retailer"] == "amazon_ca"
    go = client.get(r["go"], follow_redirects=False)
    assert go.status_code == 302 and "amazon.ca" in go.headers["location"]
    from stacksense.modules.catalog.models import Click

    row = session.get(Click, r["click_id"])
    assert len(row.user_hash) == 32 and "@" not in row.user_hash
    assert client.post("/v1/clicks", json={"plan_id": plan["plan_id"], "product_id": "not-in-plan"}, headers=h).status_code == 404
