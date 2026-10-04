"""/v1/plans: build plans, then serve the stack, impact map, products, calendar, .ics,
doctor note and adherence, with gated fields redacted server-side."""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field

from stacksense import registry
from stacksense.config import get_settings
from stacksense.core.errors import DomainError, PaymentRequired
from stacksense.db import utcnow
from stacksense.deps import DB, OptionalUser, PlanToken, SessionToken, features_of, rate_limit
from stacksense.modules.billing.models import FunnelEvent
from stacksense.modules.intake.service import IntakeService
from stacksense.modules.llm.service import gateway_for
from stacksense.modules.plans.service import PlanService
from stacksense.modules.profile.keys import user_hash

router = APIRouter(prefix="/plans", tags=["plans"])


class BuildPlan(BaseModel):
    session_id: str
    start_date: date | None = None


class LabIn(BaseModel):
    analyte: str
    value: float
    unit: str | None = None
    drawn_at: str | None = None


class LabsIn(BaseModel):
    labs: list[LabIn]


class DoseLogIn(BaseModel):
    date: date
    slot: str
    status: str = "taken"


class SideEffect(BaseModel):
    ingredient_id: str
    form: str | None = None
    symptom: str | None = None


class CheckinIn(BaseModel):
    week: int = Field(..., ge=0, le=104)
    area_scores: dict[str, float]
    side_effects: list[SideEffect] = []


def _today(user_tz: str | None = None) -> date:
    return utcnow().date()


@router.post("", summary="Build a plan from a session; returns stack, exclusions and locks")
def build(body: BuildPlan, db: DB, user: OptionalUser, token: SessionToken) -> dict[str, Any]:
    intake = IntakeService(db)
    row = intake.authorize(body.session_id, token, user)
    ps = PlanService(db, intake.keys)
    plan = ps.build_from_session(row, user, body.start_date)
    db.add(FunnelEvent(actor_hash=user_hash(plan.subject_id), event="intake_completed", props={"cards": row.cards_answered, "branches": row.branch_events}))
    out = ps.payload(plan, features_of(db, user))
    return {**out, "plan_token": ps.plan_token(plan)}


@router.get("/{plan_id}", summary="Plan with gated fields redacted per the caller's entitlements")
def get_plan(plan_id: str, db: DB, user: OptionalUser, token: PlanToken) -> dict[str, Any]:
    ps = PlanService(db)
    plan = ps.authorize(plan_id, token, user)
    feats = features_of(db, user)
    out = ps.payload(plan, feats)
    out["entitlements"] = sorted(feats)
    return out


@router.get("/{plan_id}/impact", summary="Health Impact Map payload (redacted for free users)")
def impact(plan_id: str, db: DB, user: OptionalUser, token: PlanToken) -> dict[str, Any]:
    ps = PlanService(db)
    return ps.impact(ps.authorize(plan_id, token, user), features_of(db, user))


@router.get("/{plan_id}/products", summary="Ranked products per item for the user's storefront")
def products(plan_id: str, db: DB, user: OptionalUser, token: PlanToken) -> dict[str, Any]:
    ps = PlanService(db)
    return ps.products(ps.authorize(plan_id, token, user), features_of(db, user))


@router.get("/{plan_id}/schedule", summary="Dose events for a date range (7 days on Free)")
def schedule(plan_id: str, db: DB, user: OptionalUser, token: PlanToken, start: date | None = Query(None, alias="from"), end: date | None = Query(None, alias="to"), today: date | None = None) -> dict[str, Any]:
    ps = PlanService(db)
    plan = ps.authorize(plan_id, token, user)
    t = today or _today()
    start = start or max(t, plan.start_date)
    end = end or start + timedelta(days=6)
    return ps.schedule_range(plan, start, end, features_of(db, user), t)


@router.get("/{plan_id}/today", summary="Today view: slots, items, cues, tasks and progress")
def today_view(plan_id: str, db: DB, user: OptionalUser, token: PlanToken, today: date | None = None) -> dict[str, Any]:
    ps = PlanService(db)
    plan = ps.authorize(plan_id, token, user)
    t = today or _today()
    d = max(t, plan.start_date) if t < plan.start_date else t
    out = ps.schedule_range(plan, d, d, features_of(db, user), t)
    out["day"] = out["days"][0] if out["days"] else None
    return out


@router.post("/{plan_id}/calendar-token", summary="Subscribable .ics feed URL (Full Report or Plus)")
def calendar_token(plan_id: str, db: DB, user: OptionalUser, token: PlanToken) -> dict[str, Any]:
    ps = PlanService(db)
    plan = ps.authorize(plan_id, token, user)
    feats = features_of(db, user)
    if not ({"calendar_90d", "calendar_ongoing"} & feats):
        raise PaymentRequired("calendar_locked", "Calendar subscriptions come with the Full Report or Plus")
    tok = ps.calendar_token(plan, user.id if user else None)
    url = f"{get_settings().public_api_url}/v1/calendar/{tok}.ics"
    return {"url": url, "webcal": url.replace("https://", "webcal://").replace("http://", "webcal://")}


@router.get("/{plan_id}/calendar.ics", summary="One-off .ics download")
def calendar_download(plan_id: str, db: DB, user: OptionalUser, token: PlanToken) -> Response:
    ps = PlanService(db)
    plan = ps.authorize(plan_id, token, user)
    text = ps.ics_download(plan, features_of(db, user))
    return Response(text, media_type="text/calendar; charset=utf-8", headers={"Content-Disposition": 'attachment; filename="stacksense-plan.ics"'})


@router.get("/{plan_id}/doctor-note.pdf", summary="Doctor note PDF (Full Report or Plus)")
def doctor_note(plan_id: str, db: DB, user: OptionalUser, token: PlanToken) -> Response:
    ps = PlanService(db)
    pdf = ps.doctor_note(ps.authorize(plan_id, token, user), features_of(db, user))
    return Response(pdf, media_type="application/pdf", headers={"Content-Disposition": 'attachment; filename="stacksense-doctor-note.pdf"'})


@router.get("/{plan_id}/explanations", summary="'Why you' explanations (LLM with guardrails, template fallback)")
def explanations(plan_id: str, db: DB, user: OptionalUser, token: PlanToken) -> dict[str, Any]:
    ps = PlanService(db)
    plan = ps.authorize(plan_id, token, user)
    result = ps.result(plan)
    inp = ps.inputs(plan)
    kb = registry.kb_for_version(db, plan.rules_version)
    answers = {kb.signals[s].label: "; ".join(src["text"] for src in inp.signal_sources.get(s, [])[:3]) for s, p in inp.signals.items() if p >= 0.6 and s in kb.signals}
    return gateway_for(db, kb).explain_plan(result, answers)


@router.get("/{plan_id}/audit", summary="Stage-by-stage decisions behind this plan (always free)")
def audit_trail(plan_id: str, db: DB, user: OptionalUser, token: PlanToken) -> dict[str, Any]:
    ps = PlanService(db)
    plan = ps.authorize(plan_id, token, user)
    result = ps.result(plan)
    feats = features_of(db, user)
    records = result.get("audit", [])
    if "exact_doses" not in feats:
        records = [{k: v for k, v in r.items() if k != "amount"} for r in records]
    return {"plan_id": plan.id, "rules_version": plan.rules_version, "graph_version": plan.graph_version, "records": records}


@router.get("/{plan_id}/diff/{other_id}", summary="What changed between two of your plans")
def diff(plan_id: str, other_id: str, db: DB, user: OptionalUser, token: PlanToken) -> dict[str, Any]:
    from stacksense.modules.plans.service import diff_results

    ps = PlanService(db)
    a = ps.authorize(plan_id, token, user)
    b = ps.authorize(other_id, token, user)
    return diff_results(ps.result(a), ps.result(b))


@router.post("/{plan_id}/labs", summary="Add lab values; re-plans and unlocks (Plus: lab_replan)")
def labs(plan_id: str, body: LabsIn, db: DB, user: OptionalUser, token: PlanToken) -> dict[str, Any]:
    ps = PlanService(db)
    plan = ps.authorize(plan_id, token, user)
    feats = features_of(db, user)
    if "lab_replan" not in feats:
        raise PaymentRequired("lab_replan_locked", "Lab upload and automatic re-plan come with Plus")
    new = ps.add_labs_and_replan(plan, [lab.model_dump() for lab in body.labs], user)
    from stacksense.modules.plans.service import diff_results

    return {"plan": ps.payload(new, feats), "plan_token": ps.plan_token(new), "diff": diff_results(ps.result(plan), ps.result(new))}


@router.post("/{plan_id}/dose-logs", summary="Log a dose moment as taken / skipped / late")
def dose_log(plan_id: str, body: DoseLogIn, db: DB, user: OptionalUser, token: PlanToken) -> dict[str, Any]:
    ps = PlanService(db)
    plan = ps.authorize(plan_id, token, user)
    if body.date > _today() + timedelta(days=1):
        raise DomainError("future_log", "You can't log doses in the future")
    row = ps.log_dose(plan, body.date, body.slot, body.status)
    return {"date": row.occurred_on.isoformat(), "slot": row.slot, "status": row.status}


@router.post("/{plan_id}/checkins", summary="Check-in: 0-10 per area plus side effects (Plus)")
def checkin(plan_id: str, body: CheckinIn, db: DB, user: OptionalUser, token: PlanToken) -> dict[str, Any]:
    ps = PlanService(db)
    plan = ps.authorize(plan_id, token, user)
    if "checkins" not in features_of(db, user):
        raise PaymentRequired("checkins_locked", "Check-ins come with Plus")
    ps.checkin(plan, body.week, body.area_scores, [s.model_dump() for s in body.side_effects])
    return ps.reported_vs_projected(plan)


@router.get("/{plan_id}/progress", summary="Reported vs projected over time (Plus: impact_history)")
def progress(plan_id: str, db: DB, user: OptionalUser, token: PlanToken) -> dict[str, Any]:
    ps = PlanService(db)
    plan = ps.authorize(plan_id, token, user)
    if "impact_history" not in features_of(db, user):
        raise PaymentRequired("history_locked", "Reported vs projected comes with Plus")
    return ps.reported_vs_projected(plan)


calendar_router = APIRouter(prefix="/calendar", tags=["calendar"], dependencies=[Depends(rate_limit("calendar", 60))])


@calendar_router.get("/{token}.ics", summary="Subscribable calendar feed (signed token)")
def calendar_feed(token: str, db: DB) -> Response:
    text = PlanService(db).ics_for_token(token)
    return Response(text, media_type="text/calendar; charset=utf-8")
