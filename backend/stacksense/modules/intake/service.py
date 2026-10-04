"""Intake sessions with persistence (section 3.5).

``IntakeSession`` rows are stored server-side with the state encrypted under the
subject's data key; the client keeps a copy for offline resilience. Sessions are
anonymous until the user saves results, and every plan records the graph and rules
versions it was built from.
"""

from __future__ import annotations

import hashlib
from typing import Any

from sqlalchemy.orm import Session

from stacksense import registry
from stacksense.config import get_settings
from stacksense.core import tokens
from stacksense.core.errors import Forbidden, NotFound, Unauthorized
from stacksense.core.ids import new_id
from stacksense.db import utcnow
from stacksense.modules.identity.models import User
from stacksense.modules.intake.engine import IntakeEngine, Step
from stacksense.modules.intake.state import IntakeState
from stacksense.modules.profile.keys import KeyRing
from stacksense.modules.profile.models import Answer, IntakeSession
from stacksense.modules.rules.engine import RulesEngine
from stacksense.modules.rules.inputs import plan_input_from_state

SESSION_TTL = 30 * 24 * 3600  # anonymous sessions are deleted after 30 days anyway


def _secret_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class IntakeService:
    def __init__(self, db: Session, keys: KeyRing | None = None) -> None:
        self.db = db
        self.keys = keys or KeyRing(db)
        self.settings = get_settings()

    # ------------------------------------------------------------------ helpers
    def engine_for(self, row: IntakeSession) -> IntakeEngine:
        graph = registry.graph_for_version(self.db, row.graph_version)
        kb = registry.kb_for_version(self.db, row.rules_version) if row.rules_version else registry.live_kb(self.db, row.subject_id)
        return IntakeEngine(graph, kb, self.settings.max_cards, self.settings.follow_signal_budget)

    def load_state(self, row: IntakeSession) -> IntakeState:
        return IntakeState.from_dict(self.keys.decrypt(row.subject_id, row.state_enc, aad=f"session:{row.id}"))

    def save_state(self, row: IntakeSession, state: IntakeState) -> None:
        row.state_enc = self.keys.encrypt(row.subject_id, state.to_dict(), aad=f"session:{row.id}")
        row.flags = list(state.flags)
        row.cards_answered = state.answered_count
        row.updated_at = utcnow()

    def session_token(self, row: IntakeSession) -> str:
        return tokens.sign(self.settings.secret_key, "intake", {"sid": row.id, "sub": row.subject_id}, SESSION_TTL)

    def authorize(self, session_id: str, token: str | None, user: User | None) -> IntakeSession:
        row = self.db.get(IntakeSession, session_id)
        if row is None:
            raise NotFound("unknown_session", "Intake session not found")
        if user is not None and user.subject_id and user.subject_id == row.subject_id:
            return row
        if not token:
            raise Unauthorized("session_token_required", "Missing session token")
        claims = tokens.verify(self.settings.secret_key, "intake", token)
        if claims.get("sid") != session_id or _secret_hash(token) != row.secret_hash:
            raise Forbidden("wrong_session", "This token belongs to another session")
        return row

    # ------------------------------------------------------------------ lifecycle
    def create(self, locale: str = "en", user: User | None = None, prefill: dict[str, Any] | None = None, context_date: str | None = None) -> tuple[IntakeSession, str, Step, IntakeState]:
        from stacksense.modules.profile.consent import ConsentService
        from stacksense.modules.profile.service import ProfileService

        consent = ConsentService(self.db)
        subject_id = None
        returning = False
        if user is not None and user.subject_id and consent.allows(user.id, "profile_storage"):
            subject_id = user.subject_id
            if prefill is None and consent.allows(user.id, "personalisation"):
                prefill = ProfileService(self.db, self.keys).prefill(subject_id)
                returning = bool(prefill and prefill.get("answers"))
        if subject_id is None:
            subject_id = self.keys.new_subject(anonymous=True).id
        graph = registry.live_graph(self.db, subject_id)
        kb = registry.live_kb(self.db, subject_id)
        engine = IntakeEngine(graph, kb, self.settings.max_cards, self.settings.follow_signal_budget)
        state = engine.new_state(locale=locale, prefill=prefill, context_date=context_date)
        row = IntakeSession(id=new_id("ses"), subject_id=subject_id, graph_version=graph.version, rules_version=kb.version, locale=locale, state_enc="", secret_hash="", returning_user=returning)
        self.db.add(row)
        self.db.flush()
        token = self.session_token(row)
        row.secret_hash = _secret_hash(token)
        self.save_state(row, state)
        step = engine.next_step(state)
        row.phase = step.node["phase"] if step.node and "phase" in step.node else step.kind
        self.db.flush()
        return row, token, step, state

    def answer(self, row: IntakeSession, node_id: str, value: Any) -> dict[str, Any]:
        engine = self.engine_for(row)
        state = self.load_state(row)
        before_excl = self._exclusions(engine, state)
        out = engine.answer(state, node_id, value)
        after_excl = self._exclusions(engine, state)
        self.save_state(row, state)
        if node_id in state.answers:
            rec = state.answers[node_id]
            self.db.add(Answer(session_id=row.id, node_id=node_id, node_version=rec.node_version, value_enc=self.keys.encrypt(row.subject_id, rec.value, aad=f"answer:{row.id}"), source=rec.source))
        if out.toast:
            row.branch_events += 1
        row.confidence = out.confidence
        row.phase = out.next.node["phase"] if out.next.node and "phase" in out.next.node else out.next.kind
        row.status = {"review": "review", "stop": "stopped" if state.terminal_stop else "active"}.get(out.next.kind, "active")
        new_excl = [e for e in after_excl if e["ingredient_id"] not in {b["ingredient_id"] for b in before_excl}]
        return {
            "next": out.next.to_dict(), "toast": out.toast, "signals_delta": out.signals_delta, "confidence": out.confidence,
            "exclusions_added": [{"ingredient": e["ingredient_id"], "name": e["name"], "reason": e["short"], "rule": e["rule_code"]} for e in new_excl],
        }

    def _exclusions(self, engine: IntakeEngine, state: IntakeState) -> list[dict[str, Any]]:
        """Run the rules engine's candidate + eligibility stages on the answers so far, so the
        client can show exclusions as they happen (e.g. collagen <- vegetarian)."""
        excluded = RulesEngine(engine.kb).preview_exclusions(plan_input_from_state(engine, state))
        return [e for e in excluded if not e.get("substituted_by")]

    def step(self, row: IntakeSession) -> dict[str, Any]:
        engine = self.engine_for(row)
        state = self.load_state(row)
        return {"step": engine.next_step(state).to_dict(), "confidence": engine.confidence(state), "state": self.client_copy(state)}

    def client_copy(self, state: IntakeState) -> dict[str, Any]:
        """What the client may cache offline: its own answers and progress, nothing derived."""
        return {
            "answers": {k: v.value for k, v in state.answers.items() if v.source == "user"}, "order": state.order,
            "stops": state.stops, "removed_signals": state.removed_signals, "graph_version": state.graph_version,
        }

    def mutate(self, row: IntakeSession, fn: Any) -> tuple[IntakeState, Any]:
        engine = self.engine_for(row)
        state = self.load_state(row)
        result = fn(engine, state)
        self.save_state(row, state)
        return state, result

    def mark_completed(self, row: IntakeSession) -> None:
        row.status = "completed"
        row.completed_at = utcnow()
