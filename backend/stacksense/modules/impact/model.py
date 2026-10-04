"""Health Impact scoring model (section 5).

Two numbers per body area on a 0-10 scale -- the user's **need** and the stack's
**projected benefit** -- plus each supplement's share. Everything comes from stored
data (signals, evidence claims, doses), so the chart is reproducible and explainable.

    N_a    = 10 * max(w_goal(a), max_{s in a} p_s)
    c_i,a  = 10 * b_i,a * g_i * f_i * r_i,a
    S_a    = 10 * (1 - prod_i (1 - c_i,a / 10)) + sum_(i,j) sigma_ij,a     (sigma bounded to +-0.5)
    coverage = min(S_a / N_a, 1)

The optimiser maximises sum_a N_a/10 * S_a, so what we optimise is exactly what we show.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

IMPACT_VERSION = "impact-1.0"


@dataclass
class Contribution:
    ingredient_id: str
    area: str
    c: float  # 0-10
    grade: str
    claim_id: str
    b: float
    g: float
    f: float
    r: float
    onset_weeks: tuple[int, int]
    summary: str


@dataclass
class AreaScore:
    area: str
    need: float
    projected: float
    coverage: float | None
    contributors: list[dict[str, Any]] = field(default_factory=list)
    gap_reason: dict[str, Any] | None = None


def goal_area_weights(kb: Any, goals: list[str]) -> dict[str, float]:
    ranks = kb.param("goal_rank_weights", [1.0, 0.8, 0.6])
    out: dict[str, float] = {}
    for i, g in enumerate(goals):
        goal = kb.goals.get(g)
        if goal:
            w = ranks[i] if i < len(ranks) else ranks[-1]
            out[goal.area] = max(out.get(goal.area, 0.0), w)
    return out


def needs(kb: Any, goals: list[str], signals: dict[str, float], evidenced: set[str]) -> dict[str, float]:
    """Need per area. Only signals with evidence (asked and answered) count, so an
    unasked signal sitting at its population prior doesn't invent a need."""
    gw = goal_area_weights(kb, goals)
    out: dict[str, float] = {}
    for area in kb.area_ids:
        ps = [
            signals.get(s.id, 0.0)
            for s in kb.data.signals
            if area in s.areas and s.id in evidenced and not s.tip_only
        ]
        out[area] = round(10 * max([gw.get(area, 0.0), *ps]), 2)
    return out


def dose_fit(dose: float | None, unit: str | None, studied: Any) -> float:
    if dose is None or studied is None or (unit and studied.unit != unit):
        return 1.0
    if dose >= studied.min:
        return 1.0
    half = studied.min / 2
    return max(0.0, min(1.0, (dose - half) / half)) if half > 0 else 1.0


def relevance(kb: Any, ingredient_id: str, claim: Any, active: set[str]) -> float:
    linked = claim.signals or [s for s, _ in kb.signals_by_ingredient.get(ingredient_id, []) if claim.body_area in kb.signals[s].areas]
    return 1.0 if any(s in active for s in linked) else 0.5


def contributions(kb: Any, ingredient_id: str, dose: float | None, unit: str | None, active: set[str]) -> dict[str, Contribution]:
    out: dict[str, Contribution] = {}
    for area in kb.area_ids:
        claim = kb.claim(ingredient_id, area)
        if not claim:
            continue
        b = claim.effect_size
        g = kb.grade_weight(claim.effect_grade)
        f = dose_fit(dose, unit, claim.studied_dose)
        r = relevance(kb, ingredient_id, claim, active)
        c = 10 * b * g * f * r
        if c <= 0:
            continue
        out[area] = Contribution(ingredient_id, area, round(c, 4), claim.effect_grade, claim.id, b, g, f, r, tuple(claim.onset_weeks), claim.summary)
    return out


def synergy_terms(kb: Any, ingredient_ids: set[str]) -> dict[str, float]:
    out: dict[str, float] = {}
    for x in kb.interactions:
        if x.severity == "synergy" and x.a in ingredient_ids and x.b in ingredient_ids:
            for area, sigma in x.synergy.items():
                out[area] = max(-0.5, min(0.5, out.get(area, 0.0) + sigma))
    return out


def combined(cs: list[float], sigma: float = 0.0) -> float:
    prod = 1.0
    for c in cs:
        prod *= 1 - min(c, 10.0) / 10
    return max(0.0, min(10.0, 10 * (1 - prod) + sigma))


def impact_map(
    kb: Any, need: dict[str, float], items: list[dict[str, Any]], active: set[str], locked: list[dict[str, Any]],
) -> dict[str, Any]:
    """The Health Impact Map payload (section 5 'API output')."""
    contribs: dict[str, list[Contribution]] = {a: [] for a in kb.area_ids}
    ids = {it["ingredient_id"] for it in items}
    for it in items:
        for area, c in contributions(kb, it["ingredient_id"], it.get("dose"), it.get("unit"), active).items():
            contribs[area].append(c)
    sig = synergy_terms(kb, ids)
    areas = []
    onset: dict[str, list[int]] = {}
    for area in kb.area_ids:
        n = need.get(area, 0.0)
        cs = sorted(contribs[area], key=lambda c: (-c.c, c.ingredient_id))
        s = combined([c.c for c in cs], sig.get(area, 0.0))
        total_c = sum(c.c for c in cs)
        shares = [
            {"ingredient": c.ingredient_id, "share": round(s * c.c / total_c, 2) if total_c else 0.0, "grade": c.grade, "c": round(c.c, 2), "summary": c.summary, "claim": c.claim_id}
            for c in cs
        ]
        coverage = round(min(s / n, 1.0), 2) if n > 0 else None
        gap = None
        if n > 0 and coverage is not None and coverage < 0.5:
            locked_here = [lk["ingredient_id"] for lk in locked if kb.claim(lk["ingredient_id"], area)]
            if locked_here:
                gap = {"code": "locked_ingredient", "ingredient": locked_here[0]}
            elif not cs:
                gap = {"code": "no_contributor"}
            else:
                gap = {"code": "partial"}
        top = [c for c in cs if c.c >= 1.0] or cs[:1]
        if top and n > 0:
            onset[area] = [min(c.onset_weeks[0] for c in top), max(c.onset_weeks[1] for c in top)]
        areas.append({"area": area, "need": round(n, 1), "projected": round(s, 1), "coverage": coverage, "contributors": shares, "gap_reason": gap})
    active_areas = [a for a in areas if a["need"] > 0]
    met = sum(1 for a in active_areas if (a["coverage"] or 0) >= 2 / 3 - 1e-9)
    return {
        "model_version": IMPACT_VERSION,
        "areas": areas,
        "onset_weeks": onset,
        "summary": {"areas_with_need": len(active_areas), "areas_met": met},
    }


def aria_summary(kb: Any, payload: dict[str, Any]) -> str:
    """Screen-reader summary, e.g. 'Sleep 69% covered, Energy 71% covered ...'."""
    parts = []
    for a in payload["areas"]:
        if a["coverage"] is not None:
            parts.append(f"{kb.areas[a['area']].name} {round(a['coverage'] * 100)}% covered")
    return ", ".join(parts)
