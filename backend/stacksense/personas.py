"""Golden personas: scripted users with expected stacks, exclusions, locks and stop cards.

They are the definition of done for any rules or graph change (section 12.5): CI runs
every persona against the engine, and the admin release workflow runs them against a
draft before it can go to clinical review.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from stacksense.config import DATA_DIR
from stacksense.modules.intake.engine import IntakeEngine
from stacksense.modules.intake.graph import Graph
from stacksense.modules.rules.engine import RulesEngine
from stacksense.modules.rules.inputs import plan_input_from_state

PERSONA_DIR = DATA_DIR / "personas"


def load_personas(directory: Path = PERSONA_DIR) -> list[dict[str, Any]]:
    return [json.loads(p.read_text()) for p in sorted(directory.glob("*.json"))]


@dataclass
class PersonaRun:
    persona: str
    asked: list[str] = field(default_factory=list)
    stops: list[str] = field(default_factory=list)
    terminal_stop: str | None = None
    result: dict[str, Any] | None = None
    missing_answers: list[str] = field(default_factory=list)
    confidence: float = 0.0

    @property
    def stack(self) -> list[str]:
        return sorted(it["ingredient_id"] for it in (self.result or {}).get("items", []))


def run_persona(persona: dict[str, Any], graph: Graph, kb: Any, features: dict[str, Any] | None = None, strict: bool = True) -> PersonaRun:
    engine = IntakeEngine(graph, kb)
    state = engine.new_state(context_date=persona.get("context_date"), prefill=persona.get("prefill"))
    run = PersonaRun(persona=persona["id"])
    answers = persona["answers"]
    step = engine.next_step(state)
    guard = 0
    while step.kind in ("node", "stop", "confirm") and guard < 60:
        guard += 1
        if step.kind == "stop":
            card = step.card or {}
            run.stops.append(card["id"])
            if not card.get("can_continue"):
                run.terminal_stop = card["id"]
                break
            step = engine.acknowledge_stop(state, card["id"])
            continue
        if step.kind == "confirm":
            step = engine.answer(state, step.node["id"], {"changed": persona.get("changed", [])}).next  # type: ignore[index]
            continue
        nid = step.node["id"]  # type: ignore[index]
        run.asked.append(nid)
        if nid not in answers:
            run.missing_answers.append(nid)
            if strict:
                raise KeyError(f"persona {persona['id']} has no answer for {nid}")
            node = graph.node(nid)
            if node.answer.allow_unsure:
                value: dict[str, Any] = {"unsure": True}
            elif node.answer.type == "free_text":
                value = {"skip": True}
            else:
                raise KeyError(f"persona {persona['id']} has no answer for required question {nid}")
        else:
            value = answers[nid]
        step = engine.answer(state, nid, value).next
    for lab in persona.get("labs", []):
        engine.add_labs(state, [lab])
    run.confidence = engine.confidence(state)
    if run.terminal_stop is None:
        engine.apply_defaults(state)
        run.result = RulesEngine(kb).build(plan_input_from_state(engine, state, features=features or persona.get("features")))
    return run


def check_expectations(persona: dict[str, Any], run: PersonaRun) -> list[str]:
    """Compare a run to the persona's ``expect`` block. Empty list = pass."""
    exp = persona.get("expect", {})
    problems: list[str] = []
    if "terminal_stop" in exp and run.terminal_stop != exp["terminal_stop"]:
        problems.append(f"terminal stop {run.terminal_stop!r} != {exp['terminal_stop']!r}")
    if "stop_cards" in exp and sorted(run.stops) != sorted(exp["stop_cards"]):
        problems.append(f"stop cards {run.stops} != {exp['stop_cards']}")
    if run.result is None:
        if "stack" in exp:
            problems.append("no plan built")
        return problems
    r = run.result
    if "stack" in exp and run.stack != sorted(exp["stack"]):
        problems.append(f"stack {run.stack} != {sorted(exp['stack'])}")
    for i in exp.get("stack_includes", []):
        if i not in run.stack:
            problems.append(f"expected {i} in stack")
    for i in exp.get("stack_excludes", []):
        if i in run.stack:
            problems.append(f"{i} must not be in stack")
    locked = sorted(x["ingredient_id"] for x in r["locked"])
    if "locked" in exp and locked != sorted(exp["locked"]):
        problems.append(f"locked {locked} != {sorted(exp['locked'])}")
    excluded = {x["ingredient_id"] for x in r["excluded"]}
    for i in exp.get("excluded_include", []):
        if i not in excluded:
            problems.append(f"expected {i} to be excluded")
    if "max_pills_per_day_at_most" in exp and r["totals"]["max_pills_day"] > exp["max_pills_per_day_at_most"]:
        problems.append(f"pills {r['totals']['max_pills_day']} > {exp['max_pills_per_day_at_most']}")
    if "monthly_cost_at_most" in exp and r["totals"]["monthly_cost"] > exp["monthly_cost_at_most"] + 1e-6:
        problems.append(f"cost {r['totals']['monthly_cost']} > {exp['monthly_cost_at_most']}")
    banners = {b["kind"] for b in r["banners"]}
    for b in exp.get("banners", []):
        if b not in banners:
            problems.append(f"expected banner {b}")
    if "low_confidence" in exp and r["low_confidence"] != exp["low_confidence"]:
        problems.append(f"low_confidence {r['low_confidence']} != {exp['low_confidence']}")
    for a in exp.get("asked_include", []):
        if a not in run.asked:
            problems.append(f"expected {a} to be asked")
    if "cards_between" in exp:
        lo, hi = exp["cards_between"]
        if not lo <= len(run.asked) <= hi:
            problems.append(f"{len(run.asked)} cards outside [{lo}, {hi}]")
    return problems


def run_suite(graph: Graph, kb: Any, personas: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    personas = personas if personas is not None else load_personas()
    results = []
    for p in personas:
        try:
            run = run_persona(p, graph, kb)
            problems = check_expectations(p, run)
        except Exception as e:  # noqa: BLE001 - a broken persona is a failed check, not a crash
            run, problems = None, [f"error: {e}"]
        results.append({"persona": p["id"], "passed": not problems, "problems": problems, "stack": run.stack if run else [], "cards": len(run.asked) if run else 0})
    return {"passed": all(r["passed"] for r in results), "results": results}
