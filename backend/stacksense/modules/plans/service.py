"""Plans: build from an intake session, persist reproducibly, and serve every view
(stack, impact map, products, calendar, .ics, doctor note) with entitlement redaction.

Reproducibility (section 4.3): a plan stores its PlanInput, rules/graph/impact versions
and catalog snapshot id, so rebuilding it yields identical output.
"""

from __future__ import annotations

import dataclasses
from datetime import date, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from stacksense import registry
from stacksense.config import get_settings
from stacksense.core import tokens
from stacksense.core.errors import Conflict, DomainError, Forbidden, NotFound, PaymentRequired, Unauthorized
from stacksense.core.ids import new_id
from stacksense.core.pdf import PdfDoc
from stacksense.db import utcnow
from stacksense.modules.billing import redaction
from stacksense.modules.catalog.service import (
    CatalogSnapshot,
    load_seed_catalog,
    match_plan,
    prefs_from_facts,
)
from stacksense.modules.identity.models import User
from stacksense.modules.intake.service import IntakeService
from stacksense.modules.profile.keys import KeyRing
from stacksense.modules.profile.models import (
    CalendarFeed,
    Checkin,
    DoseEvent,
    DoseLog,
    IntakeSession,
    Plan,
    PlanItem,
    PlanItemProduct,
)
from stacksense.modules.rules.engine import PlanInput, RulesEngine
from stacksense.modules.rules.inputs import plan_input_from_state
from stacksense.modules.scheduler.calendar import Schedule, ScheduleSettings, build_schedule, stable_uid
from stacksense.modules.scheduler.solver import SLOT_LABELS, Routine

PLAN_TOKEN_TTL = 365 * 24 * 3600
CAL_TOKEN_TTL = 5 * 365 * 24 * 3600


def _inputs_to_json(inp: PlanInput) -> dict[str, Any]:
    d = dataclasses.asdict(inp)
    d["evidenced"] = sorted(inp.evidenced)
    return d


def _inputs_from_json(d: dict[str, Any]) -> PlanInput:
    d = dict(d)
    d["evidenced"] = set(d.get("evidenced", []))
    return PlanInput(**d)


def current_catalog(db: Session) -> CatalogSnapshot:
    from stacksense.modules.catalog.models import Product, ProductOverride, RetailerProgram

    seed = load_seed_catalog()
    prods = db.scalars(select(Product).where(Product.active.is_(True))).all()
    rets = db.scalars(select(RetailerProgram).where(RetailerProgram.active.is_(True))).all()
    now = utcnow()
    overrides = {
        o.product_id: {"action": o.action, "reason": o.reason}
        for o in db.scalars(select(ProductOverride).where(ProductOverride.active.is_(True))).all()
        if o.expires_at is None or o.expires_at > now
    }
    return CatalogSnapshot(
        products=[p.data for p in prods] if prods else seed.products,
        retailers=[r.data for r in rets] if rets else seed.retailers,
        form_variants=seed.form_variants,
        overrides=overrides,
    )


def snapshot_by_id(db: Session, snapshot_id: str | None) -> CatalogSnapshot:
    from stacksense.modules.catalog.models import CatalogSnapshotRow

    if snapshot_id:
        row = db.get(CatalogSnapshotRow, snapshot_id)
        if row:
            return CatalogSnapshot(**row.data)
    return current_catalog(db)


def store_snapshot(db: Session, snap: CatalogSnapshot) -> str:
    from stacksense.modules.catalog.models import CatalogSnapshotRow

    if db.get(CatalogSnapshotRow, snap.version) is None:
        db.add(CatalogSnapshotRow(id=snap.version, data=snap.to_dict()))
        db.flush()
    return snap.version


def affiliate_tags() -> dict[str, str]:
    s = get_settings()
    return {"amazon_ca_tag": s.amazon_ca_tag, "amazon_com_tag": s.amazon_com_tag, "iherb_partner_code": s.iherb_partner_code}


class PlanService:
    def __init__(self, db: Session, keys: KeyRing | None = None) -> None:
        self.db = db
        self.keys = keys or KeyRing(db)
        self.settings = get_settings()

    # ------------------------------------------------------------------ access
    def plan_token(self, plan: Plan) -> str:
        return tokens.sign(self.settings.secret_key, "plan", {"pid": plan.id, "sub": plan.subject_id}, PLAN_TOKEN_TTL)

    def authorize(self, plan_id: str, token: str | None, user: User | None) -> Plan:
        plan = self.db.get(Plan, plan_id)
        if plan is None:
            raise NotFound("unknown_plan", "Plan not found")
        if user is not None and user.subject_id == plan.subject_id:
            return plan
        if not token:
            raise Unauthorized("plan_token_required", "Missing plan token")
        claims = tokens.verify(self.settings.secret_key, "plan", token)
        if claims.get("pid") != plan_id and claims.get("sub") != plan.subject_id:
            raise Forbidden("wrong_plan", "This token belongs to another plan")
        return plan

    def result(self, plan: Plan) -> dict[str, Any]:
        return self.keys.decrypt(plan.subject_id, plan.result_enc, aad=f"plan:{plan.id}")

    def inputs(self, plan: Plan) -> PlanInput:
        return _inputs_from_json(self.keys.decrypt(plan.subject_id, plan.inputs_enc, aad=f"inputs:{plan.id}"))  # type: ignore[arg-type]

    # ------------------------------------------------------------------ build
    def build_from_session(self, session_row: IntakeSession, user: User | None = None, start_date: date | None = None, reason: str = "intake", parent: Plan | None = None) -> Plan:
        intake = IntakeService(self.db, self.keys)
        engine = intake.engine_for(session_row)
        state = intake.load_state(session_row)
        step = engine.next_step(state)
        if step.kind == "stop" and state.terminal_stop:
            raise Conflict("intake_stopped", "This intake ended at a stop card, so there's no plan to build.")
        if step.kind not in ("review",):
            # Allow building once the safety block has run (the "Show my results" rule).
            if not self._safety_done(engine, state):
                raise Conflict("intake_incomplete", "Finish the safety questions first.")
            engine.apply_defaults(state)
            intake.save_state(session_row, state)
        features = self._features_for(session_row.subject_id, user)
        kb = engine.kb
        snap = current_catalog(self.db)
        inp = plan_input_from_state(engine, state, features=features)
        result = RulesEngine(kb).build(inp)
        plan = self._persist(session_row.subject_id, session_row.id, inp, result, snap, start_date or (date.fromisoformat(state.context_date) + timedelta(days=1)), reason, parent)
        intake.mark_completed(session_row)
        return plan

    def _safety_done(self, engine: Any, state: Any) -> bool:
        from stacksense.core import expr

        ctx, _ = engine.evaluate(state)
        for n in engine.graph.data.nodes:
            if n.phase == "safety" and n.required and n.id not in state.answers and expr.truthy(n.preconditions, ctx):
                return False
        return True

    def _features_for(self, subject_id: str, user: User | None) -> dict[str, Any] | None:
        from stacksense.modules.profile.consent import ConsentService
        from stacksense.modules.profile.service import ProfileService

        if user is None or user.subject_id != subject_id or not ConsentService(self.db).allows(user.id, "personalisation"):
            return None
        return ProfileService(self.db, self.keys).features(subject_id)

    def _persist(self, subject_id: str, session_id: str | None, inp: PlanInput, result: dict[str, Any], snap: CatalogSnapshot, start: date, reason: str, parent: Plan | None) -> Plan:
        snapshot_id = store_snapshot(self.db, snap)
        prev = parent or self.db.scalar(select(Plan).where(Plan.subject_id == subject_id, Plan.status == "active").order_by(Plan.created_at.desc()))
        calendar_key = prev.calendar_key if prev else new_id("cal")
        plan_id = new_id("pl")
        plan = Plan(
            id=plan_id, subject_id=subject_id, session_id=session_id, parent_plan_id=prev.id if prev else None,
            rules_version=result["rules_version"], graph_version=result["graph_version"], impact_version=result["impact_version"],
            catalog_snapshot_id=snapshot_id, status="active", reason=reason,
            result_enc=self.keys.encrypt(subject_id, result, aad=f"plan:{plan_id}"),
            inputs_enc=self.keys.encrypt(subject_id, _inputs_to_json(inp), aad=f"inputs:{plan_id}"),
            summary={
                "active": [it["ingredient_id"] for it in result["items"]], "locked": [x["ingredient_id"] for x in result["locked"]],
                "excluded": [x["ingredient_id"] for x in result["excluded"]], "monthly_cost": result["totals"]["monthly_cost"],
                "low_confidence": result["low_confidence"], "goals": inp.goals,
            },
            start_date=start, calendar_key=calendar_key,
        )
        self.db.add(plan)
        if prev and prev.status == "active":
            prev.status, prev.superseded_at = "superseded", utcnow()
        self.db.flush()
        products = match_plan(result, snap, prefs_from_facts(inp.facts, inp.features), affiliate_tags())
        best = {p["ingredient_id"]: p for p in products["items"]}
        for it in result["items"]:
            row = PlanItem(plan_id=plan.id, ingredient_id=it["ingredient_id"], form=it["delivery"]["form"], dose=it["dose"], unit=it["unit"], state="active", reason_codes=it["reason_codes"])
            self.db.add(row)
            self.db.flush()
            match = best.get(it["ingredient_id"])
            if match:
                ranked = [match["best"], *match["alternatives"]] if match["best"] else []
                for rank, p in enumerate(ranked):
                    offer = p.get("offer") or {}
                    self.db.add(PlanItemProduct(plan_item_id=row.id, product_id=p["product_id"], rank=rank, retailer=offer.get("retailer"), affiliate_url=offer.get("url")))
        for state_name, key in (("locked", "locked"), ("excluded", "excluded"), ("dropped", "dropped")):
            for x in result[key]:
                self.db.add(PlanItem(plan_id=plan.id, ingredient_id=x["ingredient_id"], state=state_name, reason_codes=[x.get("rule_code") or x.get("reason_code") or state_name]))
        schedule = self.schedule_for(plan, result=result, products=products)
        events = {e.uid: e for e in schedule.vevents(calendar_key, 365) if e.rrule}
        for it in schedule.items:
            ev = events.get(stable_uid(calendar_key, it.id, it.slot))
            if ev is None:
                continue
            self.db.add(DoseEvent(
                plan_id=plan.id, ingredient_id=it.id, slot=it.slot, rrule=ev.rrule or "", local_time=f"{(it.minutes % 1440) // 60:02d}:{it.minutes % 60:02d}",
                tz=schedule.routine.tz, start_date=ev.start, end_date=schedule.date_of(365), uid=ev.uid, sequence=ev.sequence,
            ))
        self.db.flush()
        return plan

    # ------------------------------------------------------------------ views
    def payload(self, plan: Plan, features: set[str]) -> dict[str, Any]:
        result = self.result(plan)
        out = redaction.redact_plan(result, features)
        out.update({
            "plan_id": plan.id, "created_at": plan.created_at.isoformat(), "status": plan.status, "start_date": plan.start_date.isoformat(),
            "catalog_snapshot_id": plan.catalog_snapshot_id, "parent_plan_id": plan.parent_plan_id, "reason": plan.reason,
        })
        out["audit_summary"] = {"stages": sorted({a["stage"] for a in result.get("audit", [])}), "records": len(result.get("audit", []))}
        out.pop("audit", None)
        return out

    def impact(self, plan: Plan, features: set[str]) -> dict[str, Any]:
        from stacksense.knowledge.base import default_kb
        from stacksense.modules.impact.model import aria_summary

        im = self.result(plan)["impact"]
        kb = registry.kb_for_version(self.db, plan.rules_version) if plan.rules_version != default_kb().version else default_kb()
        payload = {"plan_id": plan.id, **im, "aria_summary": aria_summary(kb, im)}
        if "impact_full" not in features:
            payload = {"plan_id": plan.id, **redaction.redact_impact(im)}
            payload["aria_summary"] = "Top three areas shown; the rest unlock with the Full Report."
        return payload

    def products(self, plan: Plan, features: set[str]) -> dict[str, Any]:
        result = self.result(plan)
        inp = self.inputs(plan)
        snap = snapshot_by_id(self.db, plan.catalog_snapshot_id)
        out = match_plan(result, snap, prefs_from_facts(inp.facts, inp.features), affiliate_tags())
        out["disclosure"] = "We may earn a commission when you buy through these links. It never changes what we recommend."
        return {"plan_id": plan.id, **redaction.redact_products(out, features)}

    def schedule_for(self, plan: Plan, result: dict[str, Any] | None = None, products: dict[str, Any] | None = None) -> Schedule:
        result = result or self.result(plan)
        inp = self.inputs(plan)
        if products is None:
            snap = snapshot_by_id(self.db, plan.catalog_snapshot_id)
            products = match_plan(result, snap, prefs_from_facts(inp.facts, inp.features), affiliate_tags())
        prod_map = {}
        for p in products["items"]:
            b = p.get("best")
            if b:
                prod_map[p["ingredient_id"]] = {"servings": b["doses_per_container"], "product_id": b["product_id"], "link": (b.get("offer") or {}).get("url")}
        result = {**result, "checkin_areas": [self._area_name(plan, g) for g in inp.goals][:3]}
        return build_schedule(result, Routine.from_facts(inp.facts.get("routine")), ScheduleSettings(start_date=plan.start_date), event=inp.facts.get("event"), products=prod_map)

    def _area_name(self, plan: Plan, goal: str) -> str:
        kb = registry.kb_for_version(self.db, plan.rules_version)
        g = kb.goals.get(goal)
        return kb.areas[g.area].name.lower() if g else goal

    def schedule_range(self, plan: Plan, start: date, end: date, features: set[str], today: date) -> dict[str, Any]:
        from stacksense.modules.billing.entitlements import Entitlements

        limit = Entitlements(self.db).limits(features)["calendar_days"]
        allowed_end = max(today, plan.start_date) + timedelta(days=limit - 1)
        locked_after = None
        if end > allowed_end:
            locked_after = allowed_end.isoformat()
            end = allowed_end
        if (end - start).days > 120:
            raise DomainError("range_too_long", "Ask for at most 120 days at a time")
        schedule = self.schedule_for(plan)
        days = schedule.days(start, end) if start <= end else []
        if "exact_doses" not in features:
            for d in days:
                for s in d["slots"]:
                    for i in s["items"]:
                        i["amount_text"], i["dose_label"] = None, None
        logs = self.db.scalars(select(DoseLog).where(DoseLog.plan_id == plan.id, DoseLog.occurred_on >= start, DoseLog.occurred_on <= end)).all()
        taken: dict[str, dict[str, str]] = {}
        for lg in logs:
            taken.setdefault(lg.occurred_on.isoformat(), {})[lg.slot] = lg.status
        for d in days:
            d["logged"] = taken.get(d["date"], {})
        return {
            "plan_id": plan.id, "from": start.isoformat(), "to": end.isoformat(), "days": days, "locked_after": locked_after,
            "calendar_days": limit, "refills": schedule.refills, "spacing_notes": schedule.spacing_notes,
            "slots": {k: {"label": v, "minutes": schedule.routine.slot_times()[k] % 1440} for k, v in SLOT_LABELS.items()},
            "tz": schedule.routine.tz, "start_date": plan.start_date.isoformat(), "streak": self.streak(plan, schedule, today),
        }

    def streak(self, plan: Plan, schedule: Schedule, today: date) -> int:
        logs = self.db.scalars(select(DoseLog).where(DoseLog.plan_id == plan.id)).all()
        taken = {(lg.occurred_on, lg.slot) for lg in logs if lg.status in ("taken", "late")}
        n = 0
        d = today
        day = schedule.day(d)
        slots = [s["id"] for s in day["slots"] if any(not i["off"] for i in s["items"])]
        if not slots or not all((d, s) in taken for s in slots):
            d -= timedelta(days=1)
        while d >= plan.start_date and n < 400:
            day = schedule.day(d)
            slots = [s["id"] for s in day["slots"] if any(not i["off"] for i in s["items"])]
            if not slots or not all((d, s) in taken for s in slots):
                break
            n += 1
            d -= timedelta(days=1)
        return n

    # ------------------------------------------------------------------ calendar feed
    def calendar_token(self, plan: Plan, user_id: str | None) -> str:
        feed = self.db.get(CalendarFeed, plan.calendar_key)
        if feed is None:
            feed = CalendarFeed(calendar_key=plan.calendar_key, subject_id=plan.subject_id, feed_state={})
            self.db.add(feed)
            self.db.flush()
        return tokens.sign(self.settings.secret_key, "calendar", {"cal": plan.calendar_key, "uid": user_id, "v": feed.token_version}, CAL_TOKEN_TTL)

    def ics_for_token(self, token: str) -> str:
        from stacksense.modules.billing.entitlements import Entitlements

        claims = tokens.verify(self.settings.secret_key, "calendar", token)
        feed = self.db.get(CalendarFeed, claims["cal"])
        if feed is None or claims.get("v") != feed.token_version:
            raise Unauthorized("feed_revoked", "This calendar link was reset")
        feats = Entitlements(self.db).features(claims.get("uid"))
        if not ({"calendar_90d", "calendar_ongoing"} & feats):
            raise PaymentRequired("calendar_locked", "Calendar subscriptions come with the Full Report or Plus")
        plan = self.db.scalar(select(Plan).where(Plan.calendar_key == feed.calendar_key, Plan.status == "active").order_by(Plan.created_at.desc()))
        if plan is None:
            raise NotFound("no_plan", "No active plan for this calendar")
        horizon = 365 if "calendar_ongoing" in feats else 90
        schedule = self.schedule_for(plan)
        text = schedule.ics(feed.calendar_key, horizon, previous=feed.feed_state)
        feed.feed_state = schedule.feed_state(feed.calendar_key, horizon, previous=feed.feed_state)
        return text

    def ics_download(self, plan: Plan, features: set[str]) -> str:
        if not ({"calendar_90d", "calendar_ongoing"} & features):
            raise PaymentRequired("calendar_locked", ".ics export comes with the Full Report or Plus")
        feed = self.db.get(CalendarFeed, plan.calendar_key)
        horizon = 365 if "calendar_ongoing" in features else 90
        schedule = self.schedule_for(plan)
        return schedule.ics(plan.calendar_key, horizon, previous=feed.feed_state if feed else None)

    # ------------------------------------------------------------------ doctor note
    def doctor_note(self, plan: Plan, features: set[str]) -> bytes:
        from stacksense.modules.llm.service import gateway_for

        if "doctor_note" not in features:
            raise PaymentRequired("doctor_note_locked", "The doctor note comes with the Full Report or Plus")
        result = self.result(plan)
        inp = self.inputs(plan)
        kb = registry.kb_for_version(self.db, plan.rules_version)
        symptoms = []
        for lk in result["locked"]:
            symptoms.extend(s["text"] for s in lk.get("sources", []))
        for sid in ("b12_risk", "vitamin_d_risk"):
            if inp.signals.get(sid, 0) >= 0.6:
                symptoms.extend(f"{s['text']} ({kb.signals[sid].label.lower()})" for s in inp.signal_sources.get(sid, [])[:2])
        tests = [f"{lk['unlock']['name']} test" for lk in result["locked"] if lk.get("unlock")]
        if tests:
            tests.append("CBC")
        facts = {
            "reason": "Request for blood tests and review of a planned supplement routine" if tests else "Review of a planned supplement routine",
            "symptoms": list(dict.fromkeys(symptoms)), "tests": tests,
            "medications": [kb.drugs[m].name for m in inp.facts.get("medications", []) if m in kb.drugs] + list(inp.facts.get("unknown_meds") or []),
            "supplements": [f"{it['name']} {it['dose_label']}, {it['frequency_text'].lower()}" for it in result["items"]],
            "ingredient_ids": [it["ingredient_id"] for it in result["items"]],
        }
        summary = gateway_for(self.db, kb).doctor_summary(facts)
        doc = PdfDoc("StackSense - note for your doctor")
        doc.heading("Note for your doctor or pharmacist", 16)
        doc.paragraph(f"Prepared by StackSense on {utcnow().date().isoformat()} from a self-reported intake. Not a diagnosis.", 9.5)
        age, sex = inp.facts.get("age"), inp.facts.get("sex")
        if age:
            doc.paragraph(f"Patient: {age}, {sex or 'sex not given'}", 10.5, bold=True)
        doc.heading("Reason", 12)
        doc.paragraph(summary["reason_for_visit"])
        if summary["requested_tests"]:
            doc.heading("Requested tests", 12)
            doc.bullets(summary["requested_tests"])
        if summary["reported_symptoms"]:
            doc.heading("What they reported", 12)
            doc.bullets(summary["reported_symptoms"])
        doc.heading("Current medication", 12)
        doc.bullets(summary["current_medications"])
        doc.heading(f"Supplements planned (starting {plan.start_date.isoformat()})", 12)
        doc.bullets(summary["planned_supplements"])
        if result["locked"]:
            doc.paragraph("On hold until results are available: " + ", ".join(lk["name"] for lk in result["locked"]) + ".")
        if result["excluded"]:
            doc.heading("Left out for safety or fit", 12)
            doc.bullets([f"{e['name']}: {e['reason']}" for e in result["excluded"] if not e.get("substituted_by")])
        doc.spacer()
        doc.paragraph(summary["notes"], 9)
        return doc.render()

    # ------------------------------------------------------------------ labs, re-plans, diffs
    def add_labs_and_replan(self, plan: Plan, labs: list[dict[str, Any]], user: User | None) -> Plan:
        from stacksense.modules.profile.service import ProfileService

        if plan.session_id is None:
            raise Conflict("no_session", "This plan has no intake session to rebuild from")
        session_row = self.db.get(IntakeSession, plan.session_id)
        intake = IntakeService(self.db, self.keys)
        engine = intake.engine_for(session_row)  # type: ignore[arg-type]
        state = intake.load_state(session_row)  # type: ignore[arg-type]
        engine.add_labs(state, labs)
        intake.save_state(session_row, state)  # type: ignore[arg-type]
        profile = ProfileService(self.db, self.keys)
        for lab in labs:
            profile.add_lab(plan.subject_id, lab["analyte"], float(lab["value"]), lab.get("unit"), lab.get("drawn_at"))
        new = self.build_from_session(session_row, user, start_date=max(plan.start_date, utcnow().date()), reason="labs", parent=plan)  # type: ignore[arg-type]
        return new

    def rebuild_preview(self, plan: Plan, kb: Any) -> dict[str, Any]:
        """Re-run the stored inputs with another rules release (admin 'why did my plan change?')."""
        new = RulesEngine(kb).build(self.inputs(plan))
        return diff_results(self.result(plan), new)

    def reproduce(self, plan: Plan) -> bool:
        kb = registry.kb_for_version(self.db, plan.rules_version)
        rebuilt = RulesEngine(kb).build(self.inputs(plan))
        return _strip(rebuilt) == _strip(self.result(plan))

    # ------------------------------------------------------------------ adherence + check-ins
    def log_dose(self, plan: Plan, day: date, slot: str, status: str) -> DoseLog:
        if status not in ("taken", "skipped", "late"):
            raise DomainError("bad_status", "status must be taken, skipped or late")
        if slot not in SLOT_LABELS:
            raise DomainError("bad_slot", "Unknown slot")
        row = self.db.scalar(select(DoseLog).where(DoseLog.plan_id == plan.id, DoseLog.occurred_on == day, DoseLog.slot == slot, DoseLog.ingredient_id == "*"))
        if row is None:
            row = DoseLog(subject_id=plan.subject_id, plan_id=plan.id, ingredient_id="*", slot=slot, occurred_on=day, status=status)
            self.db.add(row)
        else:
            row.status, row.logged_at = status, utcnow()
        self.db.flush()
        return row

    def checkin(self, plan: Plan, week: int, area_scores: dict[str, float], side_effects: list[dict[str, Any]]) -> Checkin:
        kb = registry.kb_for_version(self.db, plan.rules_version)
        for a, v in area_scores.items():
            if a not in kb.areas or not isinstance(v, (int, float)) or not 0 <= v <= 10:
                raise DomainError("bad_score", "Scores are 0-10 per body area")
        payload = {"area_scores": area_scores, "side_effects": side_effects}
        row = Checkin(subject_id=plan.subject_id, plan_id=plan.id, week=week, payload_enc=self.keys.encrypt(plan.subject_id, payload, aad="checkin"))
        self.db.add(row)
        self.db.flush()
        return row

    def reported_vs_projected(self, plan: Plan) -> dict[str, Any]:
        """Calibration view: the user's own 0-10 ratings next to the projection (copy says 'projected', never 'will')."""
        rows = self.db.scalars(select(Checkin).where(Checkin.plan_id == plan.id).order_by(Checkin.created_at)).all()
        im = self.result(plan)["impact"]
        return {
            "projected": {a["area"]: a["projected"] for a in im["areas"]},
            "need": {a["area"]: a["need"] for a in im["areas"]},
            "reported": [{"week": r.week, "at": r.created_at.isoformat(), **self.keys.decrypt(plan.subject_id, r.payload_enc, aad="checkin")} for r in rows],
        }


def _strip(r: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in r.items() if k != "optimiser"}


def diff_results(old: dict[str, Any], new: dict[str, Any]) -> dict[str, Any]:
    o = {it["ingredient_id"]: it for it in old["items"]}
    n = {it["ingredient_id"]: it for it in new["items"]}
    dose_changes = [
        {"ingredient_id": k, "from": o[k]["dose_label"], "to": n[k]["dose_label"]}
        for k in sorted(set(o) & set(n)) if (o[k]["dose"], o[k]["unit"]) != (n[k]["dose"], n[k]["unit"]) or o[k]["frequency"] != n[k]["frequency"]
    ]
    oe = {e["ingredient_id"] for e in old["excluded"]}
    ne = {e["ingredient_id"] for e in new["excluded"]}
    ol = {e["ingredient_id"] for e in old["locked"]}
    nl = {e["ingredient_id"] for e in new["locked"]}
    return {
        "from_version": old["rules_version"], "to_version": new["rules_version"],
        "added": sorted(set(n) - set(o)), "removed": sorted(set(o) - set(n)), "dose_changes": dose_changes,
        "exclusions_added": sorted(ne - oe), "exclusions_removed": sorted(oe - ne),
        "locks_added": sorted(nl - ol), "locks_removed": sorted(ol - nl),
        "cost_change": round(new["totals"]["monthly_cost"] - old["totals"]["monthly_cost"], 2),
        "changed": bool(set(n) ^ set(o) or dose_changes or ne ^ oe or nl ^ ol),
    }
