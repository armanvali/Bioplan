"""Choosing the next question (section 3.3).

1. Hard gates first (red-flag stop cards, safety block) -- handled by the engine.
2. Candidate set: unasked nodes whose preconditions pass.
3. Score: value = sum_s goal_weight(s) * expected_info_gain(s | node) - burden(node)
4. Pick the max; ties broken by phase order, then editorial priority.
5. Stop when nothing is worth asking, the follow-up budget is spent, or 30 cards.

Expected information gain uses the node's own effect table: each effect is a
binary "condition holds" observation with P(cond | s) = q1 and P(cond | not s) = q0,
where q1/q0 equals the effect's likelihood ratio. Under that model the expected
posterior entropy is never above the current entropy, so gains are non-negative.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

from stacksense.core import expr
from stacksense.modules.intake.graph import Effect, Graph, Node
from stacksense.modules.intake.signals import Signal
from stacksense.modules.intake.state import IntakeState


def entropy(p: float) -> float:
    if p <= 0 or p >= 1:
        return 0.0
    return -(p * math.log2(p) + (1 - p) * math.log2(1 - p))


def effect_model(effect: Effect, base_rate: float) -> tuple[float, float]:
    """(q1, q0) for an LR effect."""
    lr = effect.lr or 1.0
    if effect.p_true is not None:
        q1 = min(max(effect.p_true, 0.01), 0.99)
        q0 = min(max(q1 / lr, 0.001), 0.99)
    else:
        q0 = base_rate
        q1 = min(max(lr * q0, 0.001), 0.98)
    return q1, q0


def expected_gain(p: float, q1: float, q0: float) -> float:
    P = p * q1 + (1 - p) * q0
    if P <= 0 or P >= 1:
        return 0.0
    post_yes = p * q1 / P
    post_no = p * (1 - q1) / (1 - P)
    return max(0.0, entropy(p) - (P * entropy(post_yes) + (1 - P) * entropy(post_no)))


def goal_weights(kb: Any, goals: list[str]) -> dict[str, float]:
    ranks = kb.param("goal_rank_weights", [1.0, 0.8, 0.6])
    out: dict[str, float] = {}
    for i, g in enumerate(goals):
        goal = kb.goals.get(g)
        if not goal:
            continue
        w = ranks[i] if i < len(ranks) else ranks[-1] * 0.8
        out[goal.area] = max(out.get(goal.area, 0.0), w)
    return out


def signal_weight(kb: Any, graph: Graph, sid: str, area_w: dict[str, float]) -> float:
    sdef = kb.signals.get(sid)
    if sdef is None:
        return 0.0
    if sdef.safety:
        return float(graph.param("safety_signal_weight", 1.0))
    ws = [area_w[a] for a in sdef.areas if a in area_w]
    return max(ws) if ws else float(graph.param("unranked_goal_weight", 0.3))


@dataclass
class Scored:
    node: Node
    value: float
    gains: dict[str, float]


def score_node(node: Node, kb: Any, graph: Graph, state: IntakeState, signals: dict[str, Signal], area_w: dict[str, float]) -> Scored:
    base_rate = float(graph.param("default_base_rate", 0.2))
    gains: dict[str, float] = {}
    for eff in node.effects:
        sig = signals.get(eff.signal)
        if sig is None or sig.suppressed or sig.removed or sig.lab is not None:
            continue
        p = sig.p
        if eff.set_p is not None:
            g = base_rate * max(0.0, entropy(p) - entropy(eff.set_p))
        else:
            g = expected_gain(p, *effect_model(eff, base_rate))
        gains[eff.signal] = gains.get(eff.signal, 0.0) + g
    value = 0.0
    for sid, g in gains.items():
        g = min(g, entropy(signals[sid].p))
        gains[sid] = g
        value += signal_weight(kb, graph, sid, area_w) * g
    value += node.boost
    value -= float(graph.param("burden_weight", 0.04)) * node.burden
    if node.sensitive and state.answered_count < int(graph.param("sensitive_min_answers", 5)):
        value -= float(graph.param("sensitive_penalty", 0.08))
    return Scored(node=node, value=value, gains=gains)


def unlocks(graph: Graph) -> dict[str, list[Node]]:
    """Nodes whose preconditions read ``answers.<id>``: answering <id> is what opens them."""
    cache = getattr(graph, "_unlocks", None)
    if cache is not None:
        return cache
    out: dict[str, list[Node]] = {}
    for n in graph.data.nodes:
        if not n.preconditions:
            continue
        for path in expr.paths(n.preconditions):
            if path[0] == "answers" and len(path) > 1 and path[1] in graph.nodes and path[1] != n.id:
                out.setdefault(path[1], []).append(n)
    graph._unlocks = out  # type: ignore[attr-defined]
    return out


def score_with_lookahead(node: Node, kb: Any, graph: Graph, state: IntakeState, signals: dict[str, Signal], area_w: dict[str, float]) -> Scored:
    """One-step lookahead: a gateway card (e.g. the body map) is worth part of the best card it opens."""
    scored = score_node(node, kb, graph, state, signals, area_w)
    followers = [m for m in unlocks(graph).get(node.id, []) if m.id not in state.answers]
    if followers:
        best = max(score_node(m, kb, graph, state, signals, area_w).value for m in followers)
        if best > 0:
            scored.value += float(graph.param("lookahead_discount", 0.6)) * best
    return scored


def eligible(node: Node, state: IntakeState, ctx: dict[str, Any]) -> bool:
    if node.id in state.answers:
        return False
    return expr.truthy(node.preconditions, ctx)


def choose_next(
    kb: Any, graph: Graph, state: IntakeState, signals: dict[str, Signal], ctx: dict[str, Any], max_cards: int, follow_budget: int,
) -> tuple[Node | None, list[Scored]]:
    """Return the next node (or None for "review") and the scored adaptive candidates (for debugging/admin)."""
    area_w = goal_weights(kb, ctx["goals"])
    min_value = float(graph.param("min_value", 0.012))
    over_cap = state.answered_count >= max_cards
    scored_all: list[Scored] = []

    for phase in graph.data.phases:
        nodes = [n for n in graph.data.nodes if n.phase == phase and eligible(n, state, ctx)]
        if not nodes:
            continue
        nodes.sort(key=lambda n: (n.priority, n.id))
        if phase not in graph.data.adaptive_phases:
            if state.finish_requested and phase != "safety" and phase != "about":
                continue  # "Show my results": preferences fall back to defaults
            if over_cap:
                nodes = [n for n in nodes if n.required]
                if not nodes:
                    continue
            return nodes[0], scored_all

        # Adaptive phase.
        if state.finish_requested:
            continue
        asked_here = sum(1 for nid in state.order if graph.nodes.get(nid) and graph.nodes[nid].phase == phase and state.answers[nid].source == "user")
        budget_spent = asked_here >= follow_budget or over_cap
        scored = [score_with_lookahead(n, kb, graph, state, signals, area_w) for n in nodes]
        scored.sort(key=lambda s: (-round(s.value, 6), s.node.priority, s.node.id))
        scored_all = scored
        if not budget_spent and scored and scored[0].value > min_value:
            return scored[0].node, scored_all
        required = [s.node for s in scored if s.node.required]
        if required:
            required.sort(key=lambda n: (n.priority, n.id))
            return required[0], scored_all
    return None, scored_all
