"""Intake engine: pure functions over ``IntakeState``.

The client never decides what to ask. It posts an answer and renders whatever
``Step`` comes back: a question node, a stop card, a "still true?" confirm card for
returning users, or ``review``.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

from stacksense.core import clock, expr
from stacksense.core.errors import Conflict, DomainError, NotFound
from stacksense.core.templates import join_list, render
from stacksense.modules.intake import answers as answer_types
from stacksense.modules.intake.graph import Graph
from stacksense.modules.intake.selector import choose_next, goal_weights, signal_weight
from stacksense.modules.intake.signals import Signal, base_context, compute_signals, probabilities
from stacksense.modules.intake.state import AnswerRecord, IntakeState, LabValue

CONFIRM_NODE_ID = "R0_still_true"

# Stable-fact nodes a returning user confirms instead of re-answering (section 14.2).
STABLE_NODES = ("A0_about", "B3_diet", "C1_medications", "C2_conditions", "C3_allergies", "D1_budget", "D2_pills", "D3_routine")

DEFAULT_PREFERENCES: dict[str, dict[str, Any]] = {
    "D1_budget": {"amount": 120},
    "D2_pills": {"max": 8, "powders": True},
    "D3_routine": {"wake": 420, "breakfast": 450, "lunch": 750, "dinner": 1110, "bed": 1350, "training_days": [], "tz": "America/Toronto"},
}


def resolution(p: float, lo: float = 0.2, hi: float = 0.8) -> float:
    """1.0 once a signal counts as resolved (p < lo or p > hi), falling linearly to 0 at p = 0.5."""
    if p >= 0.5:
        return min(1.0, (p - 0.5) / (hi - 0.5))
    return min(1.0, (0.5 - p) / (0.5 - lo))


@dataclass
class Step:
    kind: str  # node | stop | confirm | review
    node: dict[str, Any] | None = None
    card: dict[str, Any] | None = None
    progress: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {"kind": self.kind, "progress": self.progress}
        if self.node is not None:
            out["node"] = self.node
        if self.card is not None:
            out["card"] = self.card
        return out


@dataclass
class AnswerOutcome:
    state: IntakeState
    next: Step
    toast: dict[str, Any] | None
    signals_delta: list[dict[str, Any]]
    confidence: float


class IntakeEngine:
    def __init__(self, graph: Graph, kb: Any, max_cards: int = 30, follow_budget: int = 18) -> None:
        self.graph = graph
        self.kb = kb
        self.max_cards = max_cards
        self.follow_budget = follow_budget

    # ------------------------------------------------------------------ lifecycle
    def new_state(self, locale: str = "en", prefill: dict[str, Any] | None = None, context_date: str | None = None) -> IntakeState:
        state = IntakeState(graph_version=self.graph.version, context_date=context_date or clock.today().isoformat(), locale=locale)
        if prefill:
            answers = {k: v for k, v in (prefill.get("answers") or {}).items() if k in STABLE_NODES and k in self.graph.nodes}
            state.prefill_answers = answers
            state.prefill_pending = bool(answers)
            state.signal_priors = dict(prefill.get("signal_priors") or {})
            state.pending_labs = [a for a in prefill.get("pending_labs") or [] if a in self.kb.labs]
            for lab in prefill.get("labs") or []:
                state.labs[lab["analyte"]] = LabValue(**lab)
        return state

    def evaluate(self, state: IntakeState) -> tuple[dict[str, Any], dict[str, Signal]]:
        ctx = base_context(self.graph, state)
        signals = compute_signals(self.graph, self.kb, state, ctx)
        ctx["signals"] = probabilities(signals)
        return ctx, signals

    def next_step(self, state: IntakeState) -> Step:
        progress = self.progress(state)
        if state.terminal_stop:
            return Step("stop", card=self.graph.stop_card_payload(state.terminal_stop, state.locale), progress=progress)
        pending = [c for c in state.stops if c not in state.acknowledged_stops]
        if pending:
            return Step("stop", card=self.graph.stop_card_payload(pending[0], state.locale), progress=progress)
        if state.prefill_pending:
            return Step("confirm", node=self.confirm_card(state), progress=progress)
        ctx, signals = self.evaluate(state)
        node, _ = choose_next(self.kb, self.graph, state, signals, ctx, self.max_cards, self.follow_budget)
        if node is None:
            return Step("review", progress=progress)
        return Step("node", node=self.node_payload(node.id, state, ctx), progress=progress)

    def node_payload(self, node_id: str, state: IntakeState, ctx: dict[str, Any] | None = None) -> dict[str, Any]:
        node = self.graph.node(node_id)
        payload = self.graph.localized(node, state.locale)
        payload["required"] = node.required
        if node.answer.type == "rank":
            payload["answer"]["options"] = [
                {**o, "area": self.kb.goals[o["id"]].area} if o["id"] in self.kb.goals else o for o in payload["answer"]["options"]
            ]
        if node.answer.type == "body_map":
            payload["answer"]["spots"] = answer_types.BODY_SPOTS
        if node.answer.type == "demographics":
            from stacksense.modules.intake.regions import options as region_options

            payload["answer"]["regions"] = region_options()
        prev = state.answers.get(node_id)
        if prev:
            payload["previous"] = prev.value
        elif node_id in state.prefill_answers:
            payload["previous"] = state.prefill_answers[node_id]
        return payload

    def confirm_card(self, state: IntakeState) -> dict[str, Any]:
        items = []
        for nid, raw in state.prefill_answers.items():
            node = self.graph.node(nid)
            try:
                summary = answer_types.normalize(node, raw, self.kb).get("summary", "")
            except DomainError:
                continue
            items.append({"node_id": nid, "label": node.prompt, "summary": summary})
        lab_due = [
            {"analyte": a, "name": self.kb.labs[a].name, "unit": self.kb.labs[a].unit, "prompt": f"Did you get your {self.kb.labs[a].name.lower()} tested?"}
            for a in state.pending_labs if a not in state.labs
        ]
        return {
            "id": CONFIRM_NODE_ID, "prompt": "Still true?", "helper": "Tap anything that has changed. We'll only ask about that.",
            "why": "We saved these from your last visit, so you don't have to answer them again.",
            "answer": {"type": "confirm"}, "items": items, "lab_due": lab_due,
        }

    # ------------------------------------------------------------------ answering
    def answer(self, state: IntakeState, node_id: str, raw: Any) -> AnswerOutcome:
        if state.terminal_stop:
            raise Conflict("intake_stopped", "This intake ended at a stop card.")
        if node_id == CONFIRM_NODE_ID:
            return self._confirm(state, raw)
        node = self.graph.nodes.get(node_id)
        if node is None:
            raise NotFound("unknown_node", f"Unknown question {node_id}")
        ctx_before, before = self.evaluate(state)
        if node_id not in state.answers and not expr.truthy(node.preconditions, ctx_before):
            raise Conflict("node_not_eligible", f"{node_id} isn't part of this intake right now")

        value = answer_types.normalize(node, raw, self.kb)
        if node_id in state.answers:
            # Editing an earlier answer: drop it (and its stop card) and re-apply.
            self._forget(state, node_id)
        state.answers[node_id] = AnswerRecord(node_id, node.version, value, clock.now().isoformat())
        state.order.append(node_id)

        # Labs entered inline (B7 "Yes, enter values").
        for lab in value.get("labs", []) or []:
            state.labs[lab["analyte"]] = LabValue(lab["analyte"], lab["value"], lab.get("unit"), lab.get("drawn_at"))

        # Red flags: stop or restrict, never overridable.
        if not value.get("unsure"):
            for rf in node.red_flags:
                hit = (rf.if_ is not None and (rf.if_ in (value.get("picks") or []) or value.get("choice") == rf.if_)) or (
                    rf.when is not None and expr.truthy(rf.when, {**ctx_before, "answer": value})
                )
                if hit and rf.card not in state.stops:
                    card = self.graph.data.stop_cards[rf.card]
                    state.stops.append(rf.card)
                    state.flags.extend(f for f in card.flags if f not in state.flags)
                    if card.action == "stop":
                        state.terminal_stop = rf.card

        ctx_after, after = self.evaluate(state)
        delta = self.signals_delta(before, after)
        toast = self._toast(node_id, value, ctx_before, ctx_after) if not value.get("unsure") else None
        return AnswerOutcome(state=state, next=self.next_step(state), toast=toast, signals_delta=delta, confidence=self.confidence(state, after, ctx_after))

    def _forget(self, state: IntakeState, node_id: str) -> None:
        state.answers.pop(node_id, None)
        state.order = [n for n in state.order if n != node_id]
        node = self.graph.node(node_id)
        for rf in node.red_flags:
            if rf.card in state.stops:
                state.stops.remove(rf.card)
                card = self.graph.data.stop_cards[rf.card]
                state.flags = [f for f in state.flags if f not in card.flags]
                if state.terminal_stop == rf.card:
                    state.terminal_stop = None
                if rf.card in state.acknowledged_stops:
                    state.acknowledged_stops.remove(rf.card)

    def _confirm(self, state: IntakeState, raw: Any) -> AnswerOutcome:
        if not state.prefill_pending:
            raise Conflict("nothing_to_confirm", "No saved answers to confirm")
        changed = set((raw or {}).get("changed", []))
        _, before = self.evaluate(state)
        now = clock.now().isoformat()
        for nid, prev in state.prefill_answers.items():
            if nid in changed:
                continue
            node = self.graph.node(nid)
            try:
                value = answer_types.normalize(node, prev, self.kb)
            except DomainError:
                continue
            state.answers[nid] = AnswerRecord(nid, node.version, value, now, source="profile")
            state.order.append(nid)
        state.prefill_pending = False
        ctx, after = self.evaluate(state)
        return AnswerOutcome(state, self.next_step(state), None, self.signals_delta(before, after), self.confidence(state, after, ctx))

    def acknowledge_stop(self, state: IntakeState, card_id: str) -> Step:
        if card_id not in state.stops:
            raise NotFound("unknown_stop", "That stop card isn't active")
        if state.terminal_stop == card_id:
            raise Conflict("terminal_stop", "This stop card ends the intake")
        if card_id not in state.acknowledged_stops:
            state.acknowledged_stops.append(card_id)
        return self.next_step(state)

    def back(self, state: IntakeState) -> Step:
        """Undo the most recent user answer."""
        for nid in reversed(state.order):
            if state.answers[nid].source == "user":
                self._forget(state, nid)
                break
        return self.next_step(state)

    def request_finish(self, state: IntakeState) -> Step:
        """'Show my results' -- allowed once the safety block has run (section 3.3)."""
        state.finish_requested = True
        step = self.next_step(state)
        if step.kind == "review":
            self.apply_defaults(state)
        return step

    def apply_defaults(self, state: IntakeState) -> None:
        now = clock.now().isoformat()
        for nid, raw in DEFAULT_PREFERENCES.items():
            if nid in state.answers or nid not in self.graph.nodes:
                continue
            node = self.graph.node(nid)
            raw = dict(raw)
            if nid == "D3_routine" and state.locale:
                raw.setdefault("tz", "America/Toronto")
            state.answers[nid] = AnswerRecord(nid, node.version, answer_types.normalize(node, raw, self.kb), now, source="default")
            state.order.append(nid)

    # ------------------------------------------------------------------ outputs
    def signals_delta(self, before: dict[str, Signal], after: dict[str, Signal]) -> list[dict[str, Any]]:
        out = []
        for sid, s in after.items():
            b = before.get(sid)
            if b is None or abs(s.p - b.p) >= 0.05:
                out.append({"signal": sid, "p": round(s.p, 2), "from": round(b.p, 2) if b else None})
        out.sort(key=lambda d: -abs(d["p"] - (d["from"] or 0)))
        return out

    def _toast(self, node_id: str, value: dict[str, Any], ctx_before: dict[str, Any], ctx_after: dict[str, Any]) -> dict[str, Any] | None:
        node = self.graph.node(node_id)
        ctx = {**ctx_after, "answer": value, "before": ctx_before["signals"]}
        for t in node.toasts:
            if expr.truthy(t.when, ctx):
                return {"text": render(t.text, ctx, self.filters()), "key": t.key or node_id}
        return None

    def filters(self) -> dict[str, Any]:
        def goal_list(ids: Any) -> str:
            words = [self.kb.goals[g].word for g in (ids or []) if g in self.kb.goals]
            if not words:
                return ""
            return words[0] + (", then " + ", then ".join(words[1:]) if len(words) > 1 else "")

        return {
            "goal_list": goal_list,
            "time12": answer_types.time12,
            "time24": answer_types.time24,
            "lower": lambda v: str(v or "").lower(),
            "list": lambda v: join_list(v or []),
        }

    def confidence(self, state: IntakeState, signals: dict[str, Signal] | None = None, ctx: dict[str, Any] | None = None) -> float:
        """The confidence ring: how resolved the signals that matter are, plus progress
        through the required blocks. Unasked signals count as unresolved."""
        if ctx is None or signals is None:
            ctx, signals = self.evaluate(state)
        area_w = goal_weights(self.kb, ctx["goals"])
        threshold = float(self.kb.param("signal_active_threshold", 0.6))
        lo = float(self.kb.param("signal_resolved_low", 0.2))
        hi = float(self.kb.param("signal_resolved_high", 0.8))
        relevant: set[str] = set()
        for n in self.graph.data.nodes:
            if n.id in state.answers or expr.truthy(n.preconditions, ctx):
                relevant.update(n.targets)
        relevant |= {sid for sid, s in signals.items() if s.p >= threshold}
        num = den = 0.0
        for sid in relevant:
            s = signals.get(sid)
            if s is None or s.suppressed:
                continue
            w = signal_weight(self.kb, self.graph, sid, area_w)
            den += w
            if s.asked:
                num += w * resolution(s.p, lo, hi)
        sig_part = num / den if den else 0.0
        required = [n for n in self.graph.data.nodes if n.required and (n.id in state.answers or expr.truthy(n.preconditions, ctx))]
        done = sum(1 for n in required if n.id in state.answers)
        req_part = done / len(required) if required else 0.0
        unsure = sum(1 for nid in state.order if state.is_unsure(nid))
        value = 0.6 * sig_part + 0.4 * req_part - 0.03 * unsure
        return round(min(0.99, max(0.0, value)), 2)

    def progress(self, state: IntakeState) -> dict[str, Any]:
        answered = state.answered_count
        # Rough remaining estimate for the progress bar: required nodes not yet answered + a few follow-ups.
        remaining_required = sum(1 for n in self.graph.data.nodes if n.required and n.id not in state.answers)
        est_total = max(answered + remaining_required + max(0, 4 - answered // 4), answered + 1)
        return {"answered": answered, "estimated_total": min(est_total, self.max_cards), "max_cards": self.max_cards}

    def review(self, state: IntakeState) -> dict[str, Any]:
        """'Here's what we heard': active signals grouped by body area, each with its sources."""
        ctx, signals = self.evaluate(state)
        threshold = float(self.kb.param("signal_active_threshold", 0.6))
        groups: dict[str, list[dict[str, Any]]] = {a: [] for a in self.kb.area_ids}
        groups["other"] = []
        for sid, s in signals.items():
            if s.suppressed or not s.sources:
                continue
            if s.p < threshold and not s.removed:
                continue
            sdef = self.kb.signals[sid]
            item = {
                "id": sid, "label": sdef.label, "tag": sdef.tag, "p": round(s.p, 2), "removed": s.removed,
                "confirmed": sid in state.confirmed_signals, "sources": s.sources, "lab": s.lab, "tip_only": sdef.tip_only,
                "areas": sdef.areas,
            }
            groups[sdef.areas[0] if sdef.areas else "other"].append(item)
        for items in groups.values():
            items.sort(key=lambda i: -i["p"])
        facts = ctx["facts"]
        return {
            "groups": [{"area": a, "signals": items} for a, items in groups.items() if items],
            "facts": {
                "goals": ctx["goals"], "diet": facts.get("diet"), "medications": [self.kb.drugs[m].name for m in facts.get("medications", []) if m in self.kb.drugs],
                "unknown_meds": facts.get("unknown_meds", []), "conditions": [c for c in facts.get("conditions", []) if c != "none"],
                "allergies": [a for a in facts.get("allergies", []) if a != "none"], "pregnancy": facts.get("pregnancy"),
            },
            "labs": {k: {"value": v.value, "unit": v.unit} for k, v in state.labs.items()},
            "stops": [self.graph.stop_card_payload(c, state.locale) for c in state.stops],
            "confidence": self.confidence(state, signals, ctx),
            "unsure_count": sum(1 for nid in state.order if state.is_unsure(nid)),
            "cards_answered": state.answered_count,
        }

    def patch_signal(self, state: IntakeState, signal_id: str, action: str) -> None:
        if signal_id not in self.kb.signals:
            raise NotFound("unknown_signal", f"Unknown signal {signal_id}")
        if action == "remove":
            if signal_id not in state.removed_signals:
                state.removed_signals.append(signal_id)
            state.confirmed_signals = [s for s in state.confirmed_signals if s != signal_id]
        elif action == "restore":
            state.removed_signals = [s for s in state.removed_signals if s != signal_id]
        elif action == "confirm":
            state.removed_signals = [s for s in state.removed_signals if s != signal_id]
            if signal_id not in state.confirmed_signals:
                state.confirmed_signals.append(signal_id)
        else:
            raise DomainError("bad_action", "action must be remove, restore or confirm")

    def add_labs(self, state: IntakeState, labs: list[dict[str, Any]]) -> None:
        for lab in labs:
            analyte = lab.get("analyte")
            if analyte not in self.kb.labs:
                raise DomainError("unknown_lab", f"Unknown analyte {analyte}")
            value = lab.get("value")
            if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value) or value < 0:
                raise DomainError("bad_lab_value", "Lab value must be a positive number")
            state.labs[analyte] = LabValue(analyte, float(value), lab.get("unit") or self.kb.labs[analyte].unit, lab.get("drawn_at"), lab.get("source", "self_reported"))

    def plan_inputs(self, state: IntakeState) -> dict[str, Any]:
        """Everything the rules engine needs, and nothing else (no payment or affiliate data)."""
        ctx, signals = self.evaluate(state)
        return {"ctx": ctx, "signals": signals, "unsure_count": sum(1 for nid in state.order if state.is_unsure(nid))}
