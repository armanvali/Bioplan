"""/v1/intake: adaptive intake sessions (section 9.2)."""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from stacksense import registry
from stacksense.deps import DB, OptionalUser, SessionToken, rate_limit
from stacksense.modules.billing.models import FunnelEvent
from stacksense.modules.intake.service import IntakeService
from stacksense.modules.llm.service import gateway_for
from stacksense.modules.profile.keys import user_hash

router = APIRouter(prefix="/intake", tags=["intake"], dependencies=[Depends(rate_limit("intake", 240))])


class CreateSession(BaseModel):
    locale: str = Field("en", pattern=r"^(en|fr-CA)$")
    context_date: str | None = Field(None, description="Override 'today' (testing, demos)")


class AnswerIn(BaseModel):
    node_id: str
    value: dict[str, Any]


class SignalPatch(BaseModel):
    signal_id: str
    action: Literal["remove", "restore", "confirm"]


class LabIn(BaseModel):
    analyte: str
    value: float
    unit: str | None = None
    drawn_at: str | None = None


class LabsIn(BaseModel):
    labs: list[LabIn]


class FreeTextIn(BaseModel):
    text: str = Field(..., max_length=500)


class RephraseIn(BaseModel):
    node_id: str
    reading_level: str = "grade 6"


@router.post("/sessions", summary="Start an intake; returns the first card")
def create_session(body: CreateSession, db: DB, user: OptionalUser) -> dict[str, Any]:
    svc = IntakeService(db)
    row, token, step, state = svc.create(body.locale, user, context_date=body.context_date)
    db.add(FunnelEvent(actor_hash=user_hash(row.subject_id), event="intake_started", props={"returning": row.returning_user, "locale": body.locale}))
    engine = svc.engine_for(row)
    return {
        "session_id": row.id, "session_token": token, "graph_version": row.graph_version, "rules_version": row.rules_version,
        "returning": row.returning_user, "next": step.to_dict(), "confidence": engine.confidence(state),
    }


@router.get("/sessions/{session_id}", summary="Current step (resume after refresh or offline)")
def get_session(session_id: str, db: DB, user: OptionalUser, token: SessionToken) -> dict[str, Any]:
    svc = IntakeService(db)
    row = svc.authorize(session_id, token, user)
    return {"session_id": row.id, "status": row.status, **svc.step(row)}


@router.post("/sessions/{session_id}/answers", summary="Submit an answer; returns the next card, toast, signal deltas and confidence")
def answer(session_id: str, body: AnswerIn, db: DB, user: OptionalUser, token: SessionToken) -> dict[str, Any]:
    svc = IntakeService(db)
    row = svc.authorize(session_id, token, user)
    return svc.answer(row, body.node_id, body.value)


@router.post("/sessions/{session_id}/back", summary="Undo the last answer")
def back(session_id: str, db: DB, user: OptionalUser, token: SessionToken) -> dict[str, Any]:
    svc = IntakeService(db)
    row = svc.authorize(session_id, token, user)
    state, step = svc.mutate(row, lambda eng, st: eng.back(st))
    return {"next": step.to_dict()}


@router.post("/sessions/{session_id}/stops/{card_id}/acknowledge", summary="Continue past a restricting stop card")
def acknowledge(session_id: str, card_id: str, db: DB, user: OptionalUser, token: SessionToken) -> dict[str, Any]:
    svc = IntakeService(db)
    row = svc.authorize(session_id, token, user)
    _, step = svc.mutate(row, lambda eng, st: eng.acknowledge_stop(st, card_id))
    return {"next": step.to_dict()}


@router.post("/sessions/{session_id}/finish", summary="'Show my results' (allowed after the safety block)")
def finish(session_id: str, db: DB, user: OptionalUser, token: SessionToken) -> dict[str, Any]:
    svc = IntakeService(db)
    row = svc.authorize(session_id, token, user)
    _, step = svc.mutate(row, lambda eng, st: eng.request_finish(st))
    return {"next": step.to_dict()}


@router.get("/sessions/{session_id}/review", summary="'Here's what we heard': signals with their source answers")
def review(session_id: str, db: DB, user: OptionalUser, token: SessionToken) -> dict[str, Any]:
    svc = IntakeService(db)
    row = svc.authorize(session_id, token, user)
    engine = svc.engine_for(row)
    state = svc.load_state(row)
    out = engine.review(state)
    out["preview"] = _preview(svc, engine, state)
    return out


def _preview(svc: IntakeService, engine: Any, state: Any) -> dict[str, Any]:
    """Live stack preview for the review screen: removing a chip updates this immediately."""
    from stacksense.modules.rules.engine import RulesEngine
    from stacksense.modules.rules.inputs import plan_input_from_state

    st = type(state).from_dict(state.to_dict())
    engine.apply_defaults(st)
    res = RulesEngine(engine.kb).build(plan_input_from_state(engine, st))
    return {
        "stack": [{"ingredient_id": it["ingredient_id"], "name": it["name"], "short": it["short"]} for it in res["items"]],
        "locked": [x["ingredient_id"] for x in res["locked"]],
        "need": res["need"], "monthly_cost": res["totals"]["monthly_cost"], "currency": res["totals"]["currency"],
    }


@router.patch("/sessions/{session_id}/signals", summary="User removes, restores or confirms a signal")
def patch_signals(session_id: str, body: SignalPatch, db: DB, user: OptionalUser, token: SessionToken) -> dict[str, Any]:
    svc = IntakeService(db)
    row = svc.authorize(session_id, token, user)
    svc.mutate(row, lambda eng, st: eng.patch_signal(st, body.signal_id, body.action))
    return review(session_id, db, user, token)


@router.post("/sessions/{session_id}/labs", summary="Add lab values to the intake (unlocks or removes items)")
def add_labs(session_id: str, body: LabsIn, db: DB, user: OptionalUser, token: SessionToken) -> dict[str, Any]:
    svc = IntakeService(db)
    row = svc.authorize(session_id, token, user)
    svc.mutate(row, lambda eng, st: eng.add_labs(st, [lab.model_dump() for lab in body.labs]))
    return svc.step(row)


@router.post("/sessions/{session_id}/free-text", summary="Map free text to signals (LLM, bounded); low confidence comes back as confirm chips")
def free_text(session_id: str, body: FreeTextIn, db: DB, user: OptionalUser, token: SessionToken) -> dict[str, Any]:

    svc = IntakeService(db)
    row = svc.authorize(session_id, token, user)
    engine = svc.engine_for(row)
    node = engine.graph.nodes.get("D0_anything_else")
    allowed = node.free_text_signals if node else []
    return gateway_for(db, engine.kb).map_free_text(body.text, allowed)


@router.post("/sessions/{session_id}/rephrase", summary="Reading-level / language rephrasing of a card (falls back to approved text)")
def rephrase(session_id: str, body: RephraseIn, db: DB, user: OptionalUser, token: SessionToken) -> dict[str, Any]:

    svc = IntakeService(db)
    row = svc.authorize(session_id, token, user)
    engine = svc.engine_for(row)
    state = svc.load_state(row)
    payload = engine.node_payload(body.node_id, state)
    return gateway_for(db, engine.kb).rephrase(payload, body.reading_level, row.locale)


@router.get("/drugs", summary="Medicine search-as-you-type (3+ letters)")
def drugs(q: str, db: DB) -> dict[str, Any]:
    kb = registry.live_kb(db)
    if len(q.strip()) < 3:
        return {"results": []}
    out = []
    for d in kb.search_drugs(q):
        # The live interaction check shown under the field ("We will never suggest St John's wort ...").
        blocks = [
            {"ingredient_id": c.ingredient_id, "name": kb.ingredients[c.ingredient_id].name, "text": c.rule_text}
            for c in kb.data.contraindications if c.kind == "drug_class" and c.code in d.classes and c.severity == "exclude"
        ]
        out.append({"id": d.id, "name": d.name, "aliases": d.aliases[:3], "classes": d.classes, "blocks": blocks})
    return {"results": out}
