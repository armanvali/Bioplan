"""Intake session state (section 3.5) as plain, serialisable data.

Signals and facts are *not* stored here: they are recomputed from answers, labs and
flags every time, so a session (and the plan built from it) is reproducible from
``(answers, labs, graph_version)``.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass
class AnswerRecord:
    node_id: str
    node_version: int
    value: dict[str, Any]
    answered_at: str
    source: str = "user"  # user | profile (confirmed prefill)


@dataclass
class LabValue:
    analyte: str
    value: float
    unit: str | None = None
    drawn_at: str | None = None
    source: str = "self_reported"


@dataclass
class IntakeState:
    graph_version: str
    context_date: str
    locale: str = "en"
    answers: dict[str, AnswerRecord] = field(default_factory=dict)
    order: list[str] = field(default_factory=list)
    labs: dict[str, LabValue] = field(default_factory=dict)
    flags: list[str] = field(default_factory=list)
    stops: list[str] = field(default_factory=list)  # stop cards triggered, in order
    acknowledged_stops: list[str] = field(default_factory=list)
    terminal_stop: str | None = None
    removed_signals: list[str] = field(default_factory=list)
    confirmed_signals: list[str] = field(default_factory=list)
    finish_requested: bool = False
    # Returning users (section 14.3): stable facts to confirm, and stored signal priors.
    prefill_answers: dict[str, dict[str, Any]] = field(default_factory=dict)
    prefill_pending: bool = False
    signal_priors: dict[str, float] = field(default_factory=dict)
    pending_labs: list[str] = field(default_factory=list)  # labs a previous plan asked for (locked items)

    @property
    def answered_count(self) -> int:
        return sum(1 for nid in self.order if self.answers[nid].source == "user")

    def is_unsure(self, node_id: str) -> bool:
        rec = self.answers.get(node_id)
        return bool(rec and rec.value.get("unsure"))

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> IntakeState:
        d = dict(d)
        d["answers"] = {k: AnswerRecord(**v) for k, v in d.get("answers", {}).items()}
        d["labs"] = {k: LabValue(**v) for k, v in d.get("labs", {}).items()}
        return cls(**d)
