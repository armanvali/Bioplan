"""Typed models for the editor-managed knowledge base (section 4.2).

A ``KnowledgeBase`` is an immutable snapshot identified by ``rules_version``.
Plans record the version they were built from, so old plans stay reproducible
after editors publish a new release.
"""

from __future__ import annotations

from typing import Any, ClassVar, Literal

from pydantic import BaseModel, ConfigDict, Field

Grade = Literal["A", "B", "C", "D"]


class Row(BaseModel):
    """Every knowledge row carries provenance (section 4.2, 'Content sources')."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    source: str = ""
    reviewed_by: str | None = None
    reviewed_at: str | None = None


class BodyArea(Row):
    id: str
    name: str
    short: str
    color: str
    icon: str


class Goal(Row):
    id: str
    label: str
    area: str
    icon: str
    word: str


class PriorRule(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    when: str
    prior: float


class SignalDef(Row):
    id: str
    label: str
    tag: str
    areas: list[str]
    prior: float
    prior_rules: list[PriorRule] = Field(default_factory=list)
    phrase: str = ""
    lab: str | None = None
    safety: bool = False
    tip_only: bool = False
    need_weight: float = 1.0  # how strongly this signal implies need in its areas (N_a uses p * need_weight)


class Delivery(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    form: str
    pills: int = 0
    scoops: int = 0


class RequiresLab(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    analyte: str
    max_age_days: int = 365
    reason: str = ""


class IngredientCopy(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    does: str = ""
    research: str = ""
    how: str = ""
    side: str = ""
    interacts: str = ""


class Ingredient(Row):
    id: str
    name: str
    short: str
    sub: str = ""
    color: str = "#6E7486"
    nutrient: str | None = None
    group: str | None = None
    forms: list[str] = Field(default_factory=list)
    animal_derived: bool = False
    requires_lab: RequiresLab | None = None
    side_effect_risk: int = 1
    ref_cost_per_dose: float = 0.3
    general_benefit: str = "false"
    essential_when: str | None = None
    delivery: list[Delivery] = Field(default_factory=list)
    info: IngredientCopy = Field(default_factory=IngredientCopy)


class StudiedDose(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    min: float
    max: float
    unit: str


class EvidenceClaim(Row):
    id: str
    ingredient_id: str
    body_area: str
    outcome: str
    population: str
    effect_grade: Grade
    effect_size: float
    studied_dose: StudiedDose
    onset_weeks: tuple[int, int]
    signals: list[str] = Field(default_factory=list)
    citations: list[str] = Field(default_factory=list)
    summary: str = ""


Frequency = Literal["daily", "alternate", "weekdays", "cycle"]


class DoseBand(Row):
    id: str
    ingredient_id: str
    population: Literal["adult", "adult_female", "adult_male", "pregnant", "older_adult"]
    min: float
    typical: float
    max: float
    lab_max: float | None = None
    unit: str
    step: float = 1
    with_food: bool = False
    frequency: Frequency = "daily"
    weekdays: list[str] = Field(default_factory=list)
    per_dose_cap: float | None = None
    label: str = "{dose} {unit}"


class UpperLimit(Row):
    id: str
    nutrient: str
    population: str
    ul_value: float
    unit: str


class Contraindication(Row):
    id: str
    ingredient_id: str
    kind: Literal["diet", "allergy", "condition", "drug_class", "pregnancy", "age", "fit"]
    code: str
    when: str | None = None
    severity: Literal["exclude", "warn"] = "exclude"
    short: str = ""
    rule_text: str


class Interaction(Row):
    id: str
    a: str
    b: str  # ingredient id or "drug:<class>"
    severity: Literal["major", "moderate", "timing", "synergy", "info"]
    mechanism: str = ""
    spacing_hours: float | None = None
    warning: str | None = None
    synergy: dict[str, float] = Field(default_factory=dict)


class TimingRule(Row):
    ingredient_id: str
    prefer_slots: list[str]
    with_food: bool = False
    avoid_with: list[str] = Field(default_factory=list)
    min_gap_hours: float = 0
    cycle_on_weeks: int | None = None
    cycle_off_weeks: int | None = None
    cue: str = ""
    training_cue: str | None = None


class SignalIngredient(Row):
    signal: str
    ingredient_id: str
    weight: float


class Supply(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    nutrient: str | None = None
    ingredient_id: str | None = None
    amount: float | None = None
    unit: str | None = None


class Drug(Row):
    id: str
    name: str
    aliases: list[str] = Field(default_factory=list)
    classes: list[str] = Field(default_factory=list)
    supplies: list[Supply] = Field(default_factory=list)


class LabRange(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    lt: float | None
    status: str
    p: float | None = None
    action: Literal["dose", "exclude", "keep"]
    dose_level: Literal["min", "typical", "max", "lab_max"] | None = None
    text: str = ""
    reason: str | None = None


class LabAnalyte(Row):
    id: str
    name: str
    unit: str
    aliases: list[str] = Field(default_factory=list)
    signal: str | None = None
    ingredient_id: str | None = None
    ranges: list[LabRange]
    retest_days: int = 90

    def classify(self, value: float) -> LabRange:
        for r in self.ranges:
            if r.lt is None or value < r.lt:
                return r
        return self.ranges[-1]


class RestrictedLibrary(Row):
    id: str
    label: str
    when: str
    allowed: list[str]
    banner: str


class Tip(Row):
    id: str
    area: str
    when: str
    title: str
    text: str


class ReleaseReview(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reviewed_by: str | None = None
    reviewed_at: str | None = None


class KnowledgeData(BaseModel):
    """The serialisable content of one rules release (what editors edit)."""

    model_config = ConfigDict(extra="forbid")

    version: str
    title: str = ""
    notes: str = ""
    review: ReleaseReview = Field(default_factory=ReleaseReview)
    params: dict[str, Any] = Field(default_factory=dict)
    areas: list[BodyArea]
    goals: list[Goal]
    signals: list[SignalDef]
    ingredients: list[Ingredient]
    evidence_claims: list[EvidenceClaim]
    dose_bands: list[DoseBand]
    upper_limits: list[UpperLimit]
    contraindications: list[Contraindication]
    interactions: list[Interaction]
    timing_rules: list[TimingRule]
    signal_ingredient: list[SignalIngredient]
    drugs: list[Drug]
    lab_analytes: list[LabAnalyte]
    restricted_libraries: list[RestrictedLibrary]
    tips: list[Tip]

    TABLES: ClassVar[tuple[str, ...]] = (
        "areas", "goals", "signals", "ingredients", "evidence_claims", "dose_bands", "upper_limits",
        "contraindications", "interactions", "timing_rules", "signal_ingredient", "drugs",
        "lab_analytes", "restricted_libraries", "tips",
    )
