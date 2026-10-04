"""Build a ``PlanInput`` from an intake session. This is the only bridge between
intake and rules, and it passes no payment or affiliate data."""

from __future__ import annotations

from typing import Any

from stacksense.modules.intake.engine import IntakeEngine
from stacksense.modules.intake.state import IntakeState
from stacksense.modules.rules.engine import PlanInput


def plan_input_from_state(
    engine: IntakeEngine, state: IntakeState, features: dict[str, Any] | None = None, cost_per_dose: dict[str, float] | None = None,
) -> PlanInput:
    ctx, signals = engine.evaluate(state)
    probs = {sid: (0.0 if s.removed or s.suppressed else s.p) for sid, s in signals.items()}
    evidenced = {sid for sid, s in signals.items() if s.sources and not s.removed and not s.suppressed}
    return PlanInput(
        facts=ctx["facts"],
        goals=ctx["goals"],
        signals=probs,
        signal_sources={sid: s.sources for sid, s in signals.items()},
        evidenced=evidenced,
        labs={k: {"value": v.value, "unit": v.unit, "drawn_at": v.drawn_at} for k, v in state.labs.items()},
        flags=list(state.flags),
        answers=ctx["answers"],
        season=ctx["season"],
        context_date=state.context_date,
        unsure_count=sum(1 for nid in state.order if state.is_unsure(nid)),
        features=features,
        cost_per_dose=cost_per_dose,
        graph_version=state.graph_version,
    )
