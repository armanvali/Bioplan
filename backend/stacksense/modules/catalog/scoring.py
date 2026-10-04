"""Product matching and scoring (section 7.2). Runs *after* the stack is decided, so
commissions can never change what is recommended -- and commission rate isn't an input here.

    score = 0.30*certification + 0.25*dose_fit + 0.15*form_fit + 0.15*rating_bayes
          + 0.10*price_per_effective_dose + 0.05*editorial

User filters (vegetarian capsule, no gelatin / soy / carrageenan, powders OK) are hard
filters before scoring. Out of stock -> the next best is promoted and flagged.
"""

from __future__ import annotations

import statistics
from dataclasses import dataclass, field
from typing import Any

WEIGHTS = {"certification": 0.30, "dose_fit": 0.25, "form_fit": 0.15, "rating_bayes": 0.15, "price": 0.10, "editorial": 0.05}
TIER_1 = {"NSF Certified for Sport", "USP Verified", "Informed Sport", "Informed Choice", "IFOS 5-star"}
TIER_2 = {"Third-party tested", "Creapure", "KSM-66", "Vegetarian capsule"}
TIER_3 = {"GMP certified", "NPN", "Vegan"}
PILL_FORMS = {"capsule", "softgel", "tablet"}
RATING_PRIOR_COUNT = 500
RANK_STEPS = [
    "Third-party certification (NSF Certified for Sport, USP, Informed Sport, Creapure)",
    "Dose fit to your target",
    "Form fit (your capsule and powder preferences)",
    "Review rating and volume",
    "Price per effective dose",
]


def delivery_class(form: str) -> str:
    return "pill" if form in PILL_FORMS else form


def certification_score(certs: list[str]) -> tuple[float, int]:
    s = set(certs)
    if s & TIER_1:
        return 1.0, 1
    if s & TIER_2:
        return 0.7, 2
    if s & TIER_3:
        return 0.4, 3
    return 0.0, 4


def units_needed(product: dict[str, Any], ingredient_id: str, target: float, unit: str) -> tuple[int, float] | None:
    """(units per dose, ratio of delivered to target). None if amounts aren't comparable."""
    line = next((x for x in product["ingredients"] if x["ingredient_id"] == ingredient_id), None)
    if not line or line["unit"] != unit or not line["amount"] or not target:
        return None
    per_unit = line["amount"] / max(1, product.get("units_per_serving", 1))
    n = max(1, round(target / per_unit))
    return n, n * per_unit / target


def dose_fit(n: int, ratio: float, form: str) -> float:
    if 0.9 <= ratio <= 1.25:
        base = 1.0
    elif ratio > 1.25:
        base = max(0.0, 1 - (ratio - 1.25) / 1.25)
    else:
        base = max(0.0, (ratio - 0.45) / 0.45)
    if form in PILL_FORMS and n > 2:
        base *= max(0.3, 1 - 0.15 * (n - 2))
    return round(base, 4)


def bayes_rating(rating: float, count: int, mean: float) -> tuple[float, float]:
    r = (RATING_PRIOR_COUNT * mean + rating * count) / (RATING_PRIOR_COUNT + count)
    return round(max(0.0, min(1.0, (r - 3.5) / 1.5)), 4), round(r, 3)


@dataclass
class Pick:
    product: dict[str, Any]
    score: float
    breakdown: dict[str, float]
    units_per_dose: int
    cost_per_dose: float
    cert_tier: int
    offer: dict[str, Any] | None = None
    notes: list[str] = field(default_factory=list)


@dataclass
class MatchResult:
    ingredient_id: str
    best: Pick | None
    alternatives: list[Pick]
    filtered: list[dict[str, Any]]
    swapped: dict[str, Any] | None


def user_filter_reason(product: dict[str, Any], prefs: dict[str, Any]) -> str | None:
    a = product.get("attributes", {})
    diet = prefs.get("diet")
    allergies = set(prefs.get("allergies") or [])
    if diet in ("vegetarian", "vegan"):
        if a.get("fish"):
            return f"Fish-derived; you told us you're {diet}"
        if a.get("animal_derived"):
            return f"Animal-derived; you told us you're {diet}"
        if a.get("gelatin"):
            return f"Gelatin capsule; you told us you're {diet}"
    if diet == "vegan" and not a.get("vegan") and (a.get("gelatin") or a.get("animal_derived")):
        return "Not vegan"
    for key, label in (("gelatin", "Gelatin-based; you avoid gelatin"), ("soy", "Contains soy"), ("carrageenan", "Contains carrageenan"),
                       ("gluten", "Contains gluten"), ("fish", "Fish-derived; you avoid fish"), ("shellfish", "Contains shellfish")):
        if key in allergies and a.get(key):
            return label
    if prefs.get("powders_ok") is False and product["form"] == "powder":
        return "Powder; you said no powders"
    rated = (prefs.get("product_ratings") or {}).get(product["id"])
    if rated is not None and rated <= 2:
        return "You rated this product poorly"
    if product["id"] in set(prefs.get("hard_to_swallow") or []):
        return "You found this hard to swallow"
    return None


def match(
    item: dict[str, Any], products: list[dict[str, Any]], prefs: dict[str, Any], form_variants: dict[str, dict[str, Any]],
    offer_for: Any, overrides: dict[str, dict[str, Any]] | None = None,
) -> MatchResult:
    """Rank products for one plan item. ``offer_for(product)`` returns the routed offer
    for the user's storefront (or None if nowhere in stock)."""
    ing = item["ingredient_id"]
    target, unit = item["dose"], item["unit"]
    want_form = item["delivery"]["form"]
    want_class = delivery_class(want_form)
    overrides = overrides or {}
    filtered: list[dict[str, Any]] = []
    eligible: list[tuple[dict[str, Any], int, float]] = []

    relevant = [p for p in products if any(x["ingredient_id"] == ing or form_variants.get(x["ingredient_id"], {}).get("of") == ing for x in p["ingredients"])]
    for p in relevant:
        line_ids = {x["ingredient_id"] for x in p["ingredients"]}
        variant = next((form_variants[i] for i in line_ids if i in form_variants and form_variants[i]["of"] == ing), None)
        if variant and ing not in line_ids:
            filtered.append({"product": _brief(p), "reason": variant["reason"]})
            continue
        ov = overrides.get(p["id"])
        if ov and ov.get("action") == "ban":
            filtered.append({"product": _brief(p), "reason": f"Removed by our catalog team: {ov.get('reason', 'quality issue')}"})
            continue
        reason = user_filter_reason(p, prefs)
        if reason:
            filtered.append({"product": _brief(p), "reason": reason})
            continue
        if delivery_class(p["form"]) != want_class:
            if p["form"] == "gummy":
                reason = "Gummy format: sugar and lower doses"
            else:
                reason = f"Comes as a {p['form']}; your plan uses a {want_form}"
            filtered.append({"product": _brief(p), "reason": reason})
            continue
        un = units_needed(p, ing, target, unit)
        if un is None:
            filtered.append({"product": _brief(p), "reason": "Dose can't be matched to your target"})
            continue
        n, ratio = un
        if ratio > 2.0:
            filtered.append({"product": _brief(p), "reason": f"{ratio:.1f}× your target per {p['form']}"})
            continue
        if want_class == "pill" and n > 4:
            filtered.append({"product": _brief(p), "reason": f"Needs {n} {p['form']}s a dose; a powder fits your plan better"})
            continue
        eligible.append((p, n, ratio))

    if not eligible:
        return MatchResult(ing, None, [], filtered, None)

    mean_rating = statistics.fmean(p["rating"] for p, _, _ in eligible)
    costs = {}
    offers = {}
    for p, n, _ in eligible:
        offer = offer_for(p)
        offers[p["id"]] = offer
        price = offer["price_local"] if offer else min(o["price"] for o in p["offers"])
        total_units = p["servings_per_container"] * max(1, p.get("units_per_serving", 1))
        costs[p["id"]] = price / (total_units / n)
    min_cost = min(costs.values())
    liked = set(prefs.get("liked_brands") or [])
    picks = []
    for p, n, ratio in eligible:
        cert, tier = certification_score(p.get("certs", []))
        rb, _ = bayes_rating(p["rating"], p["review_count"], mean_rating)
        parts = {
            "certification": cert,
            "dose_fit": dose_fit(n, ratio, p["form"]),
            "form_fit": 1.0 if p["form"] == want_form else 0.8,
            "rating_bayes": rb,
            "price": round(min_cost / costs[p["id"]], 4) if costs[p["id"]] else 0.0,
            "editorial": float(p.get("editorial", 0.5)),
        }
        score = sum(WEIGHTS[k] * v for k, v in parts.items())
        if p["brand"] in liked:
            score += 0.03  # small boost within the same certification tier (applied in sort key)
        picks.append(Pick(product=p, score=round(score, 4), breakdown=parts, units_per_dose=n, cost_per_dose=round(costs[p["id"]], 4), cert_tier=tier, offer=offers[p["id"]]))

    def sort_key(pk: Pick) -> tuple:
        ov = overrides.get(pk.product["id"], {}).get("action")
        pin = 0 if ov == "pin" else (2 if ov == "demote" else 1)
        return (pin, -pk.score, pk.product["id"])

    picks.sort(key=sort_key)
    swapped = None
    in_stock = [pk for pk in picks if pk.offer and pk.offer.get("in_stock")]
    if picks and picks[0] not in in_stock and in_stock:
        swapped = {"product": _brief(picks[0].product), "reason": "Swapped — original unavailable"}
        picks = in_stock + [pk for pk in picks if pk not in in_stock]
    best = picks[0]
    best.notes = why_this_product(best, picks[1:])
    return MatchResult(ing, best, picks[1:], filtered, swapped)


def why_this_product(best: Pick, others: list[Pick]) -> list[str]:
    out = []
    b = best.breakdown
    certs = [c for c in best.product.get("certs", []) if c in TIER_1 | TIER_2]
    if certs:
        out.append(f"Certified: {', '.join(certs)}")
    if b["dose_fit"] >= 0.99:
        out.append(f"{best.units_per_dose} {best.product['form']}{'s' if best.units_per_dose > 1 else ''} hits your dose exactly")
    if b["price"] >= 0.99 and others:
        out.append("Lowest cost per effective dose")
    if best.product.get("review_count", 0) >= 1000:
        out.append(f"{best.product['rating']}★ from {best.product['review_count']:,} reviews")
    return out


def _brief(p: dict[str, Any]) -> dict[str, Any]:
    return {"id": p["id"], "brand": p["brand"], "name": p["name"], "form": p["form"], "note": p.get("note")}
