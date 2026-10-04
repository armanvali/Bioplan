"""Indexed, read-only view over one knowledge release, plus validation."""

from __future__ import annotations

import json
from collections import defaultdict
from functools import cached_property
from pathlib import Path
from typing import Any

from stacksense.config import DATA_DIR
from stacksense.core import expr
from stacksense.knowledge.models import (
    Contraindication,
    DoseBand,
    Drug,
    EvidenceClaim,
    Ingredient,
    Interaction,
    KnowledgeData,
    LabAnalyte,
    SignalDef,
    TimingRule,
    UpperLimit,
)

KNOWLEDGE_DIR = DATA_DIR / "knowledge"

# Names a knowledge expression may read (contraindication.when, tips, priors, ...).
EXPR_ROOTS = {"facts", "signals", "goals", "answers", "labs", "flags", "season", "derived", "features", "true", "false"}


class KnowledgeBase:
    def __init__(self, data: KnowledgeData) -> None:
        self.data = data
        self.version = data.version
        self.params: dict[str, Any] = data.params

    # ------------------------------------------------------------------ indexes
    @cached_property
    def areas(self) -> dict[str, Any]:
        return {a.id: a for a in self.data.areas}

    @cached_property
    def area_ids(self) -> list[str]:
        return [a.id for a in self.data.areas]

    @cached_property
    def goals(self) -> dict[str, Any]:
        return {g.id: g for g in self.data.goals}

    @cached_property
    def signals(self) -> dict[str, SignalDef]:
        return {s.id: s for s in self.data.signals}

    @cached_property
    def ingredients(self) -> dict[str, Ingredient]:
        return {i.id: i for i in self.data.ingredients}

    @cached_property
    def claims_by_ingredient(self) -> dict[str, list[EvidenceClaim]]:
        out: dict[str, list[EvidenceClaim]] = defaultdict(list)
        for c in self.data.evidence_claims:
            out[c.ingredient_id].append(c)
        return dict(out)

    def claim(self, ingredient_id: str, area: str) -> EvidenceClaim | None:
        best = None
        for c in self.claims_by_ingredient.get(ingredient_id, []):
            if c.body_area == area and (best is None or c.effect_size > best.effect_size):
                best = c
        return best

    @cached_property
    def dose_bands_by_ingredient(self) -> dict[str, list[DoseBand]]:
        out: dict[str, list[DoseBand]] = defaultdict(list)
        for d in self.data.dose_bands:
            out[d.ingredient_id].append(d)
        return dict(out)

    @cached_property
    def upper_limits(self) -> dict[str, UpperLimit]:
        return {u.nutrient: u for u in self.data.upper_limits if u.population == "adult"}

    @cached_property
    def contraindications_by_ingredient(self) -> dict[str, list[Contraindication]]:
        out: dict[str, list[Contraindication]] = defaultdict(list)
        for c in self.data.contraindications:
            out[c.ingredient_id].append(c)
        return dict(out)

    @cached_property
    def interactions(self) -> list[Interaction]:
        return list(self.data.interactions)

    @cached_property
    def timing(self) -> dict[str, TimingRule]:
        return {t.ingredient_id: t for t in self.data.timing_rules}

    @cached_property
    def ingredients_by_signal(self) -> dict[str, list[tuple[str, float]]]:
        out: dict[str, list[tuple[str, float]]] = defaultdict(list)
        for si in self.data.signal_ingredient:
            out[si.signal].append((si.ingredient_id, si.weight))
        return dict(out)

    @cached_property
    def signals_by_ingredient(self) -> dict[str, list[tuple[str, float]]]:
        out: dict[str, list[tuple[str, float]]] = defaultdict(list)
        for si in self.data.signal_ingredient:
            out[si.ingredient_id].append((si.signal, si.weight))
        return dict(out)

    @cached_property
    def drugs(self) -> dict[str, Drug]:
        return {d.id: d for d in self.data.drugs}

    @cached_property
    def labs(self) -> dict[str, LabAnalyte]:
        return {lab.id: lab for lab in self.data.lab_analytes}

    @cached_property
    def group_members(self) -> dict[str, list[str]]:
        out: dict[str, list[str]] = defaultdict(list)
        for i in self.data.ingredients:
            if i.group:
                out[i.group].append(i.id)
        return dict(out)

    def grade_weight(self, grade: str) -> float:
        return float(self.params.get("grade_weights", {}).get(grade, {"A": 1.0, "B": 0.75, "C": 0.5, "D": 0.25}[grade]))

    def param(self, key: str, default: Any = None) -> Any:
        return self.params.get(key, default)

    def search_drugs(self, query: str, limit: int = 8) -> list[Drug]:
        q = query.strip().lower()
        if len(q) < 2:
            return []
        scored = []
        for d in self.data.drugs:
            names = [d.name.lower(), *[a.lower() for a in d.aliases]]
            if any(n.startswith(q) for n in names):
                scored.append((0, d.name, d))
            elif any(q in n for n in names):
                scored.append((1, d.name, d))
        return [d for _, _, d in sorted(scored, key=lambda t: (t[0], t[1]))[:limit]]

    # ------------------------------------------------------------------ validation
    def validate(self) -> list[str]:
        """Referential integrity + expression checks. Empty list = publishable."""
        problems: list[str] = []
        areas, sigs, ings = set(self.areas), set(self.signals), set(self.ingredients)
        drug_classes = {c for d in self.data.drugs for c in d.classes}
        labs = set(self.labs)

        def check_expr(src: str | None, where: str) -> None:
            if src:
                problems.extend(f"{where}: {p}" for p in expr.validate(src, EXPR_ROOTS))

        for s in self.data.signals:
            for a in s.areas:
                if a not in areas:
                    problems.append(f"signal {s.id}: unknown area {a}")
            if not 0 < s.prior < 1:
                problems.append(f"signal {s.id}: prior must be in (0, 1)")
            for r in s.prior_rules:
                check_expr(r.when, f"signal {s.id} prior rule")
            if s.lab and s.lab not in labs:
                problems.append(f"signal {s.id}: unknown lab {s.lab}")
        for i in self.data.ingredients:
            check_expr(i.general_benefit, f"ingredient {i.id} general_benefit")
            check_expr(i.essential_when, f"ingredient {i.id} essential_when")
            if i.requires_lab and i.requires_lab.analyte not in labs:
                problems.append(f"ingredient {i.id}: unknown lab {i.requires_lab.analyte}")
            if not self.dose_bands_by_ingredient.get(i.id):
                problems.append(f"ingredient {i.id}: no dose band")
            if not i.delivery:
                problems.append(f"ingredient {i.id}: no delivery form")
            if i.id not in self.timing:
                problems.append(f"ingredient {i.id}: no timing rule")
            if not i.source:
                problems.append(f"ingredient {i.id}: missing source")
        for c in self.data.evidence_claims:
            if c.ingredient_id not in ings:
                problems.append(f"claim {c.id}: unknown ingredient {c.ingredient_id}")
            if c.body_area not in areas:
                problems.append(f"claim {c.id}: unknown area {c.body_area}")
            if not 0 <= c.effect_size <= 1:
                problems.append(f"claim {c.id}: effect_size must be 0–1")
            for s in c.signals:
                if s not in sigs:
                    problems.append(f"claim {c.id}: unknown signal {s}")
            if not c.source:
                problems.append(f"claim {c.id}: missing source")
        for d in self.data.dose_bands:
            if d.ingredient_id not in ings:
                problems.append(f"dose band {d.id}: unknown ingredient")
            if not d.min <= d.typical <= d.max:
                problems.append(f"dose band {d.id}: needs min <= typical <= max")
            if d.lab_max is not None and d.lab_max < d.max:
                problems.append(f"dose band {d.id}: lab_max below max")
            ing = self.ingredients.get(d.ingredient_id)
            ul = self.upper_limits.get(ing.nutrient) if ing and ing.nutrient else None
            if ul and ul.unit == d.unit and max(d.max, d.lab_max or 0) > ul.ul_value:
                problems.append(f"dose band {d.id}: exceeds upper limit {ul.ul_value} {ul.unit}")
        for c in self.data.contraindications:
            if c.ingredient_id not in ings:
                problems.append(f"contraindication {c.id}: unknown ingredient")
            if c.kind == "drug_class" and c.code not in drug_classes:
                problems.append(f"contraindication {c.id}: unknown drug class {c.code}")
            check_expr(c.when, f"contraindication {c.id}")
            if not c.source:
                problems.append(f"contraindication {c.id}: missing source")
        for x in self.data.interactions:
            for side in (x.a, x.b):
                if side.startswith("drug:"):
                    if side[5:] not in drug_classes:
                        problems.append(f"interaction {x.id}: unknown drug class {side[5:]}")
                elif side not in ings:
                    problems.append(f"interaction {x.id}: unknown ingredient {side}")
            for a, v in x.synergy.items():
                if a not in areas:
                    problems.append(f"interaction {x.id}: unknown area {a}")
                if abs(v) > 0.5:
                    problems.append(f"interaction {x.id}: synergy must be within ±0.5")
        for t in self.data.timing_rules:
            if t.ingredient_id not in ings:
                problems.append(f"timing {t.ingredient_id}: unknown ingredient")
            for o in t.avoid_with:
                if o not in ings:
                    problems.append(f"timing {t.ingredient_id}: unknown avoid_with {o}")
        for si in self.data.signal_ingredient:
            if si.signal not in sigs:
                problems.append(f"signal_ingredient: unknown signal {si.signal}")
            if si.ingredient_id not in ings:
                problems.append(f"signal_ingredient: unknown ingredient {si.ingredient_id}")
        for lib in self.data.restricted_libraries:
            check_expr(lib.when, f"library {lib.id}")
            for i in lib.allowed:
                if i not in ings:
                    problems.append(f"library {lib.id}: unknown ingredient {i}")
        for tip in self.data.tips:
            check_expr(tip.when, f"tip {tip.id}")
        for g in self.data.goals:
            if g.area not in areas:
                problems.append(f"goal {g.id}: unknown area {g.area}")
        return problems


def load_knowledge_data(directory: Path = KNOWLEDGE_DIR) -> KnowledgeData:
    release = json.loads((directory / "release.json").read_text())
    tables = {t: json.loads((directory / f"{t}.json").read_text()) for t in KnowledgeData.TABLES}
    review = release.get("review", {})
    # Rows without their own review stamp inherit the release's.
    for rows in tables.values():
        for row in rows:
            row.setdefault("reviewed_by", review.get("reviewed_by"))
            row.setdefault("reviewed_at", review.get("reviewed_at"))
    return KnowledgeData(**release, **tables)


_default: KnowledgeBase | None = None


def default_kb() -> KnowledgeBase:
    """The seed release shipped in the repo (used for tests and first boot)."""
    global _default
    if _default is None:
        _default = KnowledgeBase(load_knowledge_data())
    return _default
