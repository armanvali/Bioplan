"""Signal model (section 3.2).

Each signal is a log-odds score that starts from a prior (which may depend on
demographics once known) and is multiplied by the likelihood ratio of every
matching answer effect. "Not sure" applies no update but marks the signal as
asked. Lab values override questionnaire evidence. Signals stay plain data:
``{id, logit, p, sources[]}`` so the UI can always show *why* a signal exists.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date
from typing import Any

from stacksense.core import expr
from stacksense.modules.intake.graph import Effect, Graph, Node
from stacksense.modules.intake.state import IntakeState

LOW_UVB_MONTHS = {10, 11, 12, 1, 2, 3}


def logit(p: float) -> float:
    p = min(max(p, 1e-6), 1 - 1e-6)
    return math.log(p / (1 - p))


def sigmoid(x: float) -> float:
    return 1 / (1 + math.exp(-x))


@dataclass
class Signal:
    id: str
    prior: float
    logit: float
    sources: list[dict[str, Any]] = field(default_factory=list)
    asked: bool = False
    removed: bool = False
    suppressed: bool = False
    lab: dict[str, Any] | None = None

    @property
    def p(self) -> float:
        if self.suppressed:
            return 0.0
        return sigmoid(self.logit)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id, "p": round(self.p, 4), "logit": round(self.logit, 4), "prior": round(self.prior, 4),
            "asked": self.asked, "removed": self.removed, "suppressed": self.suppressed,
            "sources": self.sources, "lab": self.lab,
        }


# --------------------------------------------------------------------------- facts & context


def answer_values(state: IntakeState) -> dict[str, dict[str, Any]]:
    return {nid: state.answers[nid].value for nid in state.order}


def derive_facts(graph: Graph, state: IntakeState) -> dict[str, Any]:
    """Stable facts (diet, medications, routine ...) from each answered node's ``facts`` map."""
    facts: dict[str, Any] = {}
    for nid in state.order:
        rec = state.answers[nid]
        node = graph.nodes.get(nid)
        if node is None or rec.value.get("unsure"):
            continue
        ctx = {"answer": rec.value}
        for key, src in node.facts.items():
            val = expr.evaluate(src, ctx)
            if val is not None:
                facts[key] = val
    return facts


def season_of(context_date: str, facts: dict[str, Any]) -> dict[str, Any]:
    month = date.fromisoformat(context_date).month
    lat = facts.get("latitude")
    if isinstance(lat, (int, float)):
        northern = lat >= 0
        high_lat = abs(lat) >= 40
    else:
        northern = True
        high_lat = facts.get("country") == "CA"
    winter = month in LOW_UVB_MONTHS if northern else month in {4, 5, 6, 7, 8, 9}
    return {"month": month, "northern": northern, "winter": winter, "low_uvb": bool(high_lat and winter)}


def suppressed_goals(graph: Graph, state: IntakeState) -> set[str]:
    out: set[str] = set()
    for card_id in state.stops:
        card = graph.data.stop_cards.get(card_id)
        if card:
            out.update(card.suppress_goals)
    return out


def base_context(graph: Graph, state: IntakeState, facts: dict[str, Any] | None = None) -> dict[str, Any]:
    facts = facts if facts is not None else derive_facts(graph, state)
    hidden = suppressed_goals(graph, state)
    goals = [g for g in (facts.get("goals") or []) if g not in hidden]
    return {
        "answers": answer_values(state),
        "facts": facts,
        "goals": goals,
        "flags": list(state.flags),
        "labs": {k: v.value for k, v in state.labs.items()},
        "season": season_of(state.context_date, facts),
        "asked": list(state.order),
    }


# --------------------------------------------------------------------------- effects


def effect_matches(effect: Effect, value: dict[str, Any], ctx: dict[str, Any]) -> bool:
    if effect.if_ is not None:
        if effect.if_ in (value.get("picks") or []):
            return True
        if value.get("choice") == effect.if_:
            return True
        return effect.if_ in (value.get("ranked") or [])
    if effect.when:
        return bool(expr.evaluate(effect.when, {**ctx, "answer": value}))
    return False


def source_text(node: Node, effect: Effect, value: dict[str, Any]) -> str:
    if effect.text:
        return effect.text
    if effect.if_:
        opt = node.answer.option(effect.if_)
        if opt:
            extra = ""
            follow_vals = [value[f.key] for f in node.answer.follow if f.type == "chips" and value.get(f.key)]
            if follow_vals:
                labels = {o.id: o.label for f in node.answer.follow for o in f.options}
                extra = f" ({', '.join(labels.get(v, v).lower() for v in follow_vals)})"
            if node.answer.type == "single" and value.get("years"):
                extra = f" for {value['years']} years"
            return opt.label + extra
    return value.get("summary") or node.prompt


def compute_signals(graph: Graph, kb: Any, state: IntakeState, ctx: dict[str, Any] | None = None) -> dict[str, Signal]:
    ctx = ctx or base_context(graph, state)
    facts = ctx["facts"]
    prior_ctx = {"facts": facts, "season": ctx["season"], "goals": ctx["goals"]}

    signals: dict[str, Signal] = {}
    for sdef in kb.data.signals:
        prior = sdef.prior
        for rule in sdef.prior_rules:
            if expr.truthy(rule.when, prior_ctx):
                prior = rule.prior
        if sdef.id in state.signal_priors:
            # Returning user: start halfway between the stored probability and the
            # population prior, so stored history informs but never locks in a signal.
            stored = state.signal_priors[sdef.id]
            prior = sigmoid((logit(stored) + logit(prior)) / 2)
        signals[sdef.id] = Signal(id=sdef.id, prior=prior, logit=logit(prior))

    for nid in state.order:
        node = graph.nodes.get(nid)
        if node is None:
            continue
        value = state.answers[nid].value
        for t in node.targets:
            if t in signals:
                signals[t].asked = True
        if value.get("unsure"):
            continue
        for eff in node.effects:
            sig = signals.get(eff.signal)
            if sig is None:
                continue
            sig.asked = True
            if effect_matches(eff, value, ctx):
                if eff.set_p is not None:
                    sig.logit = logit(eff.set_p)
                    sig.sources.append({"node": nid, "text": source_text(node, eff, value), "set_p": eff.set_p})
                else:
                    sig.logit += math.log(eff.lr)  # type: ignore[arg-type]
                    sig.sources.append({"node": nid, "text": source_text(node, eff, value), "lr": eff.lr, "option": eff.if_})
            elif eff.lr_absent is not None:
                sig.logit += math.log(eff.lr_absent)
        # Free-text answers mapped by the LLM: only confirmed or high-confidence mappings count.
        for m in value.get("mapped", []) or []:
            sig = signals.get(m["signal_id"])
            if sig and (m.get("confirmed") or m.get("confidence", 0) >= 0.8):
                sig.logit += math.log(3.0)
                sig.asked = True
                sig.sources.append({"node": nid, "text": f"“{m.get('quote') or value.get('text', '')[:40]}”", "lr": 3.0, "free_text": True})

    # Labs override questionnaire evidence.
    for analyte, lv in state.labs.items():
        lab = kb.labs.get(analyte)
        if not lab or not lab.signal or lab.signal not in signals:
            continue
        rng = lab.classify(lv.value)
        if rng.p is None:
            continue
        sig = signals[lab.signal]
        sig.logit = logit(rng.p)
        sig.asked = True
        sig.lab = {"analyte": analyte, "value": lv.value, "status": rng.status}
        sig.sources.append({"node": "LAB", "text": f"{lab.name} {lv.value:g} {lab.unit} ({rng.text})", "lab": True})

    # Red-flag restrictions and user removals.
    for card_id in state.stops:
        card = graph.data.stop_cards.get(card_id)
        if card:
            for sid in card.suppress_signals:
                if sid in signals:
                    signals[sid].suppressed = True
    for sid in state.removed_signals:
        if sid in signals:
            signals[sid].removed = True
    return signals


def probabilities(signals: dict[str, Signal], include_removed: bool = False) -> dict[str, float]:
    """``{signal: p}`` for expressions; removed signals read as 0 unless asked otherwise."""
    return {k: (0.0 if (s.removed and not include_removed) else round(s.p, 6)) for k, s in signals.items()}
