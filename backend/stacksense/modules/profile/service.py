"""Health profile (section 14): event-sourced history, projections, personalisation
features, returning-user prefill, and the user's privacy rights (export, delete).

Nothing is kept beyond the anonymous session unless the user opts in. Health data is
stored only with ``profile_storage`` consent and used to personalise only with
``personalisation`` consent.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from stacksense.core.errors import Conflict, DomainError
from stacksense.db import utcnow
from stacksense.modules.identity.models import User
from stacksense.modules.intake.engine import STABLE_NODES
from stacksense.modules.profile.consent import ConsentService
from stacksense.modules.profile.keys import KeyRing
from stacksense.modules.profile.models import (
    Answer,
    CalendarFeed,
    Checkin,
    DoseLog,
    IntakeSession,
    Lab,
    Plan,
    ProfileEvent,
    StaffAccess,
    Subject,
    UserFeatures,
)

HEALTH_TABLES = (Answer, DoseLog, Checkin, ProfileEvent, UserFeatures, CalendarFeed, Lab)


class ProfileService:
    def __init__(self, db: Session, keys: KeyRing | None = None) -> None:
        self.db = db
        self.keys = keys or KeyRing(db)

    # ------------------------------------------------------------------ events
    def record(self, subject_id: str, type_: str, payload: dict[str, Any]) -> ProfileEvent:
        ev = ProfileEvent(subject_id=subject_id, type=type_, payload_enc=self.keys.encrypt(subject_id, payload, aad="event"), ts=utcnow())
        self.db.add(ev)
        self.db.flush()
        return ev

    def events(self, subject_id: str, type_: str | None = None) -> list[dict[str, Any]]:
        stmt = select(ProfileEvent).where(ProfileEvent.subject_id == subject_id).order_by(ProfileEvent.ts, ProfileEvent.id)
        if type_:
            stmt = stmt.where(ProfileEvent.type == type_)
        return [{"type": e.type, "ts": e.ts.isoformat(), **self.keys.decrypt(subject_id, e.payload_enc, aad="event")} for e in self.db.scalars(stmt).all()]

    def add_lab(self, subject_id: str, analyte: str, value: float, unit: str | None, drawn_at: str | None, source: str = "self_reported") -> Lab:
        lab = Lab(subject_id=subject_id, analyte=analyte, value_enc=self.keys.encrypt(subject_id, value, aad="lab"), unit=unit,
                  drawn_at=date.fromisoformat(drawn_at[:10]) if drawn_at else None, source=source)
        self.db.add(lab)
        self.record(subject_id, "lab", {"analyte": analyte, "value": value, "unit": unit, "drawn_at": drawn_at})
        self.db.flush()
        return lab

    def labs(self, subject_id: str) -> list[dict[str, Any]]:
        rows = self.db.scalars(select(Lab).where(Lab.subject_id == subject_id).order_by(Lab.created_at)).all()
        return [{"analyte": r.analyte, "value": self.keys.decrypt(subject_id, r.value_enc, aad="lab"), "unit": r.unit, "drawn_at": r.drawn_at.isoformat() if r.drawn_at else None, "source": r.source} for r in rows]

    # ------------------------------------------------------------------ linking anonymous data to an account
    def link(self, user: User, anon_subject_id: str) -> str:
        """Attach an anonymous subject's sessions and plans to the user's health profile.
        Requires ``profile_storage``; re-encrypts under the user's key and shreds the anonymous key."""
        if not ConsentService(self.db).allows(user.id, "profile_storage"):
            raise DomainError("needs_profile_storage", "Saving to your account needs the 'Save my health profile' consent")
        anon = self.db.get(Subject, anon_subject_id)
        if anon is None or anon.wrapped_dek is None:
            raise Conflict("subject_gone", "That session no longer exists")
        if user.subject_id is None:
            anon.anonymous, anon.linked_at = False, utcnow()
            user.subject_id = anon.id
            return anon.id
        if user.subject_id == anon_subject_id:
            return anon_subject_id
        target = user.subject_id
        self._rekey(anon_subject_id, target)
        return target

    def _rekey(self, src: str, dst: str) -> None:
        for s in self.db.scalars(select(IntakeSession).where(IntakeSession.subject_id == src)).all():
            state = self.keys.decrypt(src, s.state_enc, aad=f"session:{s.id}")
            for a in self.db.scalars(select(Answer).where(Answer.session_id == s.id)).all():
                a.value_enc = self.keys.encrypt(dst, self.keys.decrypt(src, a.value_enc, aad=f"answer:{s.id}"), aad=f"answer:{s.id}")
            s.subject_id = dst
            s.state_enc = self.keys.encrypt(dst, state, aad=f"session:{s.id}")
        for p in self.db.scalars(select(Plan).where(Plan.subject_id == src)).all():
            p.result_enc = self.keys.encrypt(dst, self.keys.decrypt(src, p.result_enc, aad=f"plan:{p.id}"), aad=f"plan:{p.id}")
            if p.inputs_enc:
                p.inputs_enc = self.keys.encrypt(dst, self.keys.decrypt(src, p.inputs_enc, aad=f"inputs:{p.id}"), aad=f"inputs:{p.id}")
            p.subject_id = dst
        for lab in self.db.scalars(select(Lab).where(Lab.subject_id == src)).all():
            lab.value_enc = self.keys.encrypt(dst, self.keys.decrypt(src, lab.value_enc, aad="lab"), aad="lab")
            lab.subject_id = dst
        for model in (ProfileEvent,):
            for e in self.db.scalars(select(model).where(model.subject_id == src)).all():
                e.payload_enc = self.keys.encrypt(dst, self.keys.decrypt(src, e.payload_enc, aad="event"), aad="event")
                e.subject_id = dst
        for model in (DoseLog, Checkin, CalendarFeed):
            for r in self.db.scalars(select(model).where(model.subject_id == src)).all():
                if isinstance(r, Checkin):
                    r.payload_enc = self.keys.encrypt(dst, self.keys.decrypt(src, r.payload_enc, aad="checkin"), aad="checkin")
                r.subject_id = dst
        self.db.flush()
        self.keys.shred(src)

    # ------------------------------------------------------------------ projection
    def profile(self, subject_id: str) -> dict[str, Any]:
        sessions = self.db.scalars(select(IntakeSession).where(IntakeSession.subject_id == subject_id).order_by(IntakeSession.created_at)).all()
        stable: dict[str, Any] = {}
        history: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for s in sessions:
            state = self.keys.decrypt(subject_id, s.state_enc, aad=f"session:{s.id}")
            for nid, rec in state.get("answers", {}).items():
                history[nid].append({"session_id": s.id, "at": rec["answered_at"], "summary": rec["value"].get("summary")})
                if nid in STABLE_NODES and not rec["value"].get("unsure"):
                    stable[nid] = rec["value"].get("summary")
        plans = self.db.scalars(select(Plan).where(Plan.subject_id == subject_id).order_by(Plan.created_at)).all()
        checkins = self.db.scalars(select(Checkin).where(Checkin.subject_id == subject_id).order_by(Checkin.created_at)).all()
        feats = self.features(subject_id)
        return {
            "stable_facts": stable,
            "answer_history": dict(history),
            "labs": self.labs(subject_id),
            "plans": [{"id": p.id, "created_at": p.created_at.isoformat(), "status": p.status, "rules_version": p.rules_version, "items": p.summary.get("active", []), "reason": p.reason} for p in plans],
            "checkins": [{"plan_id": c.plan_id, "week": c.week, "at": c.created_at.isoformat(), **self.keys.decrypt(subject_id, c.payload_enc, aad="checkin")} for c in checkins],
            "features": feats,
            "sessions": [{"id": s.id, "created_at": s.created_at.isoformat(), "status": s.status, "cards": s.cards_answered, "returning": s.returning_user} for s in sessions],
        }

    # ------------------------------------------------------------------ personalisation features (nightly job)
    def compute_features(self, subject_id: str, today: date | None = None) -> dict[str, Any]:
        from stacksense.modules.plans.service import PlanService

        today = today or utcnow().date()
        plan = self.db.scalar(select(Plan).where(Plan.subject_id == subject_id, Plan.status == "active").order_by(Plan.created_at.desc()))
        feats: dict[str, Any] = {"adherence": {}, "slot_adherence": {}, "outcome_deltas": {}, "side_effects": [], "season": None, "computed_for": today.isoformat()}
        if plan is not None:
            ps = PlanService(self.db, self.keys)
            schedule = ps.schedule_for(plan)
            logs = self.db.scalars(select(DoseLog).where(DoseLog.plan_id == plan.id)).all()
            taken = {(lg.occurred_on, lg.slot) for lg in logs if lg.status in ("taken", "late")}
            start = plan.start_date
            per_item: dict[str, list[int]] = defaultdict(lambda: [0, 0])
            per_slot: dict[str, list[int]] = defaultdict(lambda: [0, 0])
            d = start
            while d < today:
                day = schedule.day(d)
                for slot in day["slots"]:
                    live = [i for i in slot["items"] if not i["off"]]
                    if not live:
                        continue
                    hit = (d, slot["id"]) in taken
                    per_slot[slot["id"]][0] += int(hit)
                    per_slot[slot["id"]][1] += 1
                    for i in live:
                        per_item[i["ingredient_id"]][0] += int(hit)
                        per_item[i["ingredient_id"]][1] += 1
                d += timedelta(days=1)
            result = ps.result(plan)
            for iid, (h, n) in per_item.items():
                item = next((it for it in result["items"] if it["ingredient_id"] == iid), None)
                target = item["evidence"][0]["area"] if item and item.get("evidence") else None
                feats["adherence"][iid] = {"rate": round(h / n, 3) if n else 0.0, "weeks": n // 7 if n else 0, "doses": n, "target_area": target}
            feats["slot_adherence"] = {s: round(h / n, 3) for s, (h, n) in per_slot.items() if n >= 7}
            # Outcome deltas: latest check-in score minus the first one, per area (0-10 scale).
            checkins = self.db.scalars(select(Checkin).where(Checkin.plan_id == plan.id).order_by(Checkin.created_at)).all()
            if len(checkins) >= 2:
                first = self.keys.decrypt(subject_id, checkins[0].payload_enc, aad="checkin").get("area_scores", {})
                last = self.keys.decrypt(subject_id, checkins[-1].payload_enc, aad="checkin").get("area_scores", {})
                feats["outcome_deltas"] = {a: round(last[a] - first[a], 2) for a in last if a in first}
        for c in self.db.scalars(select(Checkin).where(Checkin.subject_id == subject_id)).all():
            for se in self.keys.decrypt(subject_id, c.payload_enc, aad="checkin").get("side_effects", []):
                if se.get("ingredient_id") and se not in feats["side_effects"]:
                    feats["side_effects"].append({"ingredient_id": se["ingredient_id"], "form": se.get("form"), "symptom": se.get("symptom")})
        prefs = [e for e in self.events(subject_id, "preference")]
        feats["product_ratings"] = {e["product_id"]: e["rating"] for e in prefs if e.get("product_id") and e.get("rating") is not None}
        feats["hard_to_swallow"] = sorted({e["product_id"] for e in prefs if e.get("hard_to_swallow")})
        feats["liked_brands"] = sorted({e["brand"] for e in prefs if e.get("liked_brand")})
        row = self.db.get(UserFeatures, subject_id)
        enc = self.keys.encrypt(subject_id, feats, aad="features")
        if row is None:
            self.db.add(UserFeatures(subject_id=subject_id, features_enc=enc, computed_at=utcnow()))
        else:
            row.features_enc, row.computed_at = enc, utcnow()
        self.db.flush()
        return feats

    def features(self, subject_id: str) -> dict[str, Any] | None:
        row = self.db.get(UserFeatures, subject_id)
        return self.keys.decrypt(subject_id, row.features_enc, aad="features") if row else None

    # ------------------------------------------------------------------ returning users (section 14.3)
    def prefill(self, subject_id: str) -> dict[str, Any] | None:
        """Stable facts from the last completed intake, stored signal probabilities as
        priors, and labs a previous plan asked for ('Did you get your ferritin tested?')."""
        last = self.db.scalar(select(IntakeSession).where(IntakeSession.subject_id == subject_id, IntakeSession.status == "completed").order_by(IntakeSession.completed_at.desc()))
        if last is None:
            return None
        state = self.keys.decrypt(subject_id, last.state_enc, aad=f"session:{last.id}")
        answers = {nid: rec["value"] for nid, rec in state.get("answers", {}).items() if nid in STABLE_NODES and not rec["value"].get("unsure")}
        raw = {nid: _raw_answer(v) for nid, v in answers.items()}
        plan = self.db.scalar(select(Plan).where(Plan.subject_id == subject_id).order_by(Plan.created_at.desc()))
        priors: dict[str, float] = {}
        pending: list[str] = []
        if plan is not None and plan.inputs_enc:
            inputs = self.keys.decrypt(subject_id, plan.inputs_enc, aad=f"inputs:{plan.id}")
            priors = {k: v for k, v in inputs.get("signals", {}).items() if k in inputs.get("evidenced", [])}
            result = self.keys.decrypt(subject_id, plan.result_enc, aad=f"plan:{plan.id}")
            pending = [lk["unlock"]["analyte"] for lk in result.get("locked", []) if lk.get("unlock")]
        labs = [{"analyte": lab["analyte"], "value": lab["value"], "unit": lab["unit"], "drawn_at": lab["drawn_at"], "source": lab["source"]} for lab in self.labs(subject_id)]
        return {"answers": raw, "signal_priors": priors, "pending_labs": pending, "labs": _latest_labs(labs)}

    # ------------------------------------------------------------------ privacy rights
    def export(self, user: User) -> dict[str, Any]:
        from stacksense.modules.billing.service import BillingService
        from stacksense.modules.identity.service import IdentityService

        out: dict[str, Any] = {
            "exported_at": utcnow().isoformat(), "account": IdentityService(self.db).public(user),
            "consents": ConsentService(self.db).history(user.id), "billing": BillingService(self.db).billing_summary(user),
            "staff_access": self.staff_access(user.id),
        }
        if user.subject_id and self.db.get(Subject, user.subject_id) and self.db.get(Subject, user.subject_id).wrapped_dek:  # type: ignore[union-attr]
            out["health_profile"] = self.profile(user.subject_id)
            out["events"] = self.events(user.subject_id)
        return out

    def staff_access(self, user_id: str) -> list[dict[str, Any]]:
        rows = self.db.scalars(select(StaffAccess).where(StaffAccess.user_id == user_id).order_by(StaffAccess.ts.desc())).all()
        return [{"role": r.admin_role, "reason": r.reason, "scope": r.scope, "ts": r.ts.isoformat()} for r in rows]

    def erase_health(self, subject_id: str) -> None:
        """Delete every health row and shred the key (backups become unreadable)."""
        plan_ids = [p for p in self.db.scalars(select(Plan.id).where(Plan.subject_id == subject_id)).all()]
        session_ids = [s for s in self.db.scalars(select(IntakeSession.id).where(IntakeSession.subject_id == subject_id)).all()]
        if session_ids:
            self.db.execute(delete(Answer).where(Answer.session_id.in_(session_ids)))
        for model in (DoseLog, Checkin, ProfileEvent, UserFeatures, CalendarFeed, Lab):
            self.db.execute(delete(model).where(model.subject_id == subject_id))
        if plan_ids:
            from stacksense.modules.profile.models import DoseEvent, PlanItem, PlanItemProduct

            item_ids = list(self.db.scalars(select(PlanItem.id).where(PlanItem.plan_id.in_(plan_ids))).all())
            if item_ids:
                self.db.execute(delete(PlanItemProduct).where(PlanItemProduct.plan_item_id.in_(item_ids)))
            self.db.execute(delete(PlanItem).where(PlanItem.plan_id.in_(plan_ids)))
            self.db.execute(delete(DoseEvent).where(DoseEvent.plan_id.in_(plan_ids)))
            self.db.execute(delete(Plan).where(Plan.id.in_(plan_ids)))
        self.db.execute(delete(IntakeSession).where(IntakeSession.subject_id == subject_id))
        self.keys.shred(subject_id)
        self.db.flush()

    def delete_account(self, user: User) -> dict[str, Any]:
        """Delete everything in two clicks. Billing records stay as tax law requires,
        tied to a now-anonymous account row."""
        from stacksense.modules.identity.models import MagicLink, PushSubscription
        from stacksense.modules.notify.service import NotifyService
        from stacksense.modules.profile.keys import encrypt_identity
        from stacksense.modules.profile.models import Consent

        if user.subject_id:
            self.erase_health(user.subject_id)
        NotifyService(self.db).cancel_reminders(user.id)
        self.db.execute(delete(PushSubscription).where(PushSubscription.user_id == user.id))
        self.db.execute(delete(Consent).where(Consent.user_id == user.id))
        self.db.execute(delete(MagicLink).where(MagicLink.email_hash == user.email_hash))
        user.email_hash = f"deleted:{user.id}"
        user.email_enc = encrypt_identity("")
        user.subject_id = None
        user.status = "deleted"
        user.deleted_at = utcnow()
        self.db.flush()
        return {"deleted": True, "kept": ["billing records (tax law)"]}


def _raw_answer(value: dict[str, Any]) -> dict[str, Any]:
    """Turn a stored normalised answer back into what the client would post."""
    drop = {"summary", "label", "count", "names", "drug_classes", "supplies", "unknown", "hours", "latitude", "weekly_km", "event_name", "level", "kinds"}
    raw = {k: v for k, v in value.items() if k not in drop}
    if "unknown" in value and value["unknown"]:
        raw["free_text"] = value["unknown"]
    return raw


def _latest_labs(labs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    latest: dict[str, dict[str, Any]] = {}
    for lab in labs:
        latest[lab["analyte"]] = lab
    return list(latest.values())
