"""Question graph: versioned data owned by clinicians and content editors (section 3.1).

Nodes carry preconditions (safe expressions), the signals they inform (``targets``),
likelihood-ratio ``effects``, ``red_flags`` that route to stop cards, and ``facts``
they establish (diet, medications, routine ...). Engineers own the engine; the graph
can change without a frontend release because the client renders whatever node the
API returns.
"""

from __future__ import annotations

import json
from functools import cached_property
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from stacksense.config import DATA_DIR
from stacksense.core import expr

GRAPH_PATH = DATA_DIR / "graph" / "graph.json"

AnswerType = Literal[
    "single", "multi", "rank", "scale", "time", "energy_curve", "body_map", "pss4", "meds",
    "budget", "pills", "routine", "training", "demographics", "free_text", "number",
]

# Names a node expression may read.
NODE_EXPR_ROOTS = {"answer", "answers", "signals", "goals", "facts", "flags", "labs", "season", "asked", "before", "true", "false"}


class Option(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    id: str
    label: str
    icon: str | None = None
    sub: str | None = None
    level: int | None = None
    exclusive: bool = False


class FollowField(BaseModel):
    """A sub-question shown inside the same card when ``when`` holds (e.g. 'For how many years?')."""

    model_config = ConfigDict(extra="forbid", frozen=True)
    key: str
    when: str | None = None
    type: Literal["chips", "stepper", "labs"]
    label: str
    options: list[Option] = Field(default_factory=list)
    min: float | None = None
    max: float | None = None
    step: float | None = None
    unit: str | None = None
    analytes: list[str] = Field(default_factory=list)


class Field_(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    key: str
    type: str
    label: str
    options: list[Option] = Field(default_factory=list)
    min: float | None = None
    max: float | None = None
    step: float | None = None
    unit: str | None = None


class PssItem(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    q: str
    reverse: bool = False


class AnswerSchema(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    type: AnswerType
    options: list[Option] = Field(default_factory=list)
    allow_unsure: bool = False
    none_label: str | None = None
    max_picks: int | None = None
    min_picks: int | None = None
    follow: list[FollowField] = Field(default_factory=list)
    fields: list[Field_] = Field(default_factory=list)
    hours: list[int] = Field(default_factory=list)
    items: list[PssItem] = Field(default_factory=list)
    scale: list[str] = Field(default_factory=list)
    sources: list[str] = Field(default_factory=list)
    min: float | None = None
    max: float | None = None
    step: float | None = None
    default: float | None = None
    max_length: int | None = None

    @cached_property
    def option_ids(self) -> set[str]:
        return {o.id for o in self.options}

    def option(self, oid: str) -> Option | None:
        return next((o for o in self.options if o.id == oid), None)


class Effect(BaseModel):
    """``if`` an option is picked (or ``when`` an expression holds), multiply the
    signal's odds by ``lr`` -- or, for definitive inputs, set its probability."""

    model_config = ConfigDict(extra="forbid", frozen=True, populate_by_name=True)
    if_: str | None = Field(default=None, alias="if")
    when: str | None = None
    signal: str
    lr: float | None = None
    lr_absent: float | None = None
    set_p: float | None = None
    p_true: float | None = None  # P(condition | signal true), for info-gain modelling
    text: str | None = None


class RedFlag(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, populate_by_name=True)
    if_: str | None = Field(default=None, alias="if")
    when: str | None = None
    card: str


class Toast(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    when: str
    text: str
    key: str | None = None


class FollowUpTemplate(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    id: str
    text: str
    slots: dict[str, list[str]] = Field(default_factory=dict)
    answer: dict[str, Any] = Field(default_factory=dict)


class Node(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    id: str
    version: int = 1
    phase: str
    priority: int = 100
    required: bool = False
    optional: bool = False
    prompt: str
    helper: str | None = None
    why: str = ""
    answer: AnswerSchema
    preconditions: str | None = None
    targets: list[str] = Field(default_factory=list)
    effects: list[Effect] = Field(default_factory=list)
    facts: dict[str, str] = Field(default_factory=dict)
    red_flags: list[RedFlag] = Field(default_factory=list)
    toasts: list[Toast] = Field(default_factory=list)
    follow_up_templates: list[FollowUpTemplate] = Field(default_factory=list)
    free_text_signals: list[str] = Field(default_factory=list)
    evidence_refs: list[str] = Field(default_factory=list)
    lab_entry: bool = False
    burden: float = 0.2
    sensitive: bool = False
    boost: float = 0.0
    locale: dict[str, dict[str, Any]] = Field(default_factory=dict)


class StopCard(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    action: Literal["stop", "restrict"]
    severity: Literal["info", "caution", "urgent"] = "caution"
    title: str
    body: str
    referral: str = ""
    flags: list[str] = Field(default_factory=list)
    suppress_signals: list[str] = Field(default_factory=list)
    suppress_goals: list[str] = Field(default_factory=list)
    locale: dict[str, dict[str, Any]] = Field(default_factory=dict)


class GraphData(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: str
    title: str = ""
    phases: list[str]
    adaptive_phases: list[str]
    params: dict[str, Any] = Field(default_factory=dict)
    stop_cards: dict[str, StopCard]
    nodes: list[Node]


class Graph:
    def __init__(self, data: GraphData) -> None:
        self.data = data
        self.version = data.version
        self.params = data.params
        self.nodes: dict[str, Node] = {n.id: n for n in data.nodes}
        self.phase_index = {p: i for i, p in enumerate(data.phases)}

    def node(self, node_id: str) -> Node:
        return self.nodes[node_id]

    def param(self, key: str, default: Any = None) -> Any:
        return self.params.get(key, default)

    def localized(self, node: Node, locale: str | None) -> dict[str, Any]:
        """Client payload for a node, with locale overrides applied."""
        payload = node.model_dump(
            by_alias=True,
            include={"id", "version", "phase", "prompt", "helper", "why", "answer", "optional", "lab_entry"},
        )
        loc = node.locale.get(locale or "", {})
        for key in ("prompt", "helper", "why"):
            if loc.get(key):
                payload[key] = loc[key]
        labels = loc.get("options", {})
        if labels:
            for opt in payload["answer"]["options"]:
                opt["label"] = labels.get(opt["id"], opt["label"])
        return payload

    def stop_card_payload(self, card_id: str, locale: str | None) -> dict[str, Any]:
        card = self.data.stop_cards[card_id]
        payload = {"id": card_id, **card.model_dump(include={"action", "severity", "title", "body", "referral"})}
        payload.update({k: v for k, v in card.locale.get(locale or "", {}).items() if v})
        payload["can_continue"] = card.action == "restrict"
        return payload

    # ------------------------------------------------------------------ graph checks (section 12.1)
    def check(self, kb: Any = None) -> dict[str, list[str]]:
        """Static checks run on every save in the admin graph editor.

        errors   -> block publishing (bad expressions, unknown references, red flags
                    pointing nowhere, preconditions on later-phase answers).
        warnings -> missing translations, ingredients no node can reach.
        """
        errors: list[str] = []
        warnings: list[str] = []
        phases = self.phase_index
        known_signals = set(kb.signals) if kb else None

        for n in self.data.nodes:
            if n.phase not in phases:
                errors.append(f"{n.id}: unknown phase {n.phase}")
                continue
            exprs = [("preconditions", n.preconditions)]
            exprs += [(f"effect {i}", e.when) for i, e in enumerate(n.effects)]
            exprs += [(f"red flag {i}", r.when) for i, r in enumerate(n.red_flags)]
            exprs += [(f"toast {i}", t.when) for i, t in enumerate(n.toasts)]
            exprs += [(f"fact {k}", v) for k, v in n.facts.items()]
            exprs += [(f"follow {f.key}", f.when) for f in n.answer.follow]
            for label, src in exprs:
                if not src:
                    continue
                for p in expr.validate(src, NODE_EXPR_ROOTS):
                    errors.append(f"{n.id} {label}: {p}")
                try:
                    used = expr.paths(src)
                except expr.ExprError:
                    continue
                for path in used:
                    if path[0] == "answers" and len(path) > 1:
                        ref = path[1]
                        if ref not in self.nodes:
                            errors.append(f"{n.id} {label}: references unknown node {ref}")
                        elif label == "preconditions" and phases[self.nodes[ref].phase] > phases[n.phase]:
                            errors.append(f"{n.id}: precondition depends on later-phase node {ref} (unreachable)")
                    if path[0] == "signals" and len(path) > 1 and known_signals is not None and path[1] not in known_signals:
                        errors.append(f"{n.id} {label}: unknown signal {path[1]}")
            for e in n.effects:
                if known_signals is not None and e.signal not in known_signals:
                    errors.append(f"{n.id}: effect on unknown signal {e.signal}")
                if e.if_ and e.if_ not in n.answer.option_ids:
                    errors.append(f"{n.id}: effect on unknown option {e.if_}")
                if not e.if_ and not e.when:
                    errors.append(f"{n.id}: effect needs 'if' or 'when'")
                if (e.lr is None) == (e.set_p is None):
                    errors.append(f"{n.id}: effect needs exactly one of lr / set_p")
                if e.lr is not None and e.lr <= 0:
                    errors.append(f"{n.id}: lr must be > 0")
            for t in n.targets:
                if known_signals is not None and t not in known_signals:
                    errors.append(f"{n.id}: unknown target signal {t}")
            for r in n.red_flags:
                if r.card not in self.data.stop_cards:
                    errors.append(f"{n.id}: red flag routes to unknown stop card {r.card}")
                if r.if_ and r.if_ not in n.answer.option_ids:
                    errors.append(f"{n.id}: red flag on unknown option {r.if_} (unreachable)")
            if "fr-CA" not in n.locale:
                warnings.append(f"{n.id}: missing fr-CA translation")
            elif n.answer.options and set(n.locale["fr-CA"].get("options", {})) != n.answer.option_ids and n.answer.type in ("single", "multi", "rank", "scale"):
                warnings.append(f"{n.id}: fr-CA option labels incomplete")

        if kb is not None:
            informed = {e.signal for n in self.data.nodes for e in n.effects}
            informed |= {s for n in self.data.nodes for s in n.free_text_signals}
            for ing in kb.ingredients.values():
                linked = {s for s, _ in kb.signals_by_ingredient.get(ing.id, [])}
                if not (linked & informed) and ing.general_benefit in ("false", "") and not ing.essential_when:
                    warnings.append(f"ingredient {ing.id}: no question can raise any of its signals")
        return {"errors": errors, "warnings": warnings}


def load_graph_data(path: Path = GRAPH_PATH) -> GraphData:
    return GraphData(**json.loads(path.read_text()))


_default: Graph | None = None


def default_graph() -> Graph:
    global _default
    if _default is None:
        _default = Graph(load_graph_data())
    return _default
