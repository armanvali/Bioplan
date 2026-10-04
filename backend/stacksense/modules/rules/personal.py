"""Personal response rules (section 14.3).

They run inside the rules engine, so they are auditable and go through the same
clinical review as every other rule. Their only personal input is ``user_features``
(adherence, outcome deltas, side-effect flags), which the profile module computes
nightly and passes in only when the user has granted ``personalisation`` consent.
"""

from __future__ import annotations

from typing import Any

ADHERENCE_HIGH = 0.8
ADHERENCE_WEEKS = 8
SLOT_ADHERENCE_LOW = 0.5
SEASONAL_VITAMIN_D_MULTIPLIER = 1.2


def apply_eligibility(engine: Any, inp: Any, cands: dict[str, Any], excluded: list[dict[str, Any]]) -> None:
    feats = inp.features or {}
    for se in feats.get("side_effects", []):
        cid = se.get("ingredient_id")
        cand = cands.get(cid)
        if not cand or cand.state != "candidate":
            continue
        ing = engine.kb.ingredients[cid]
        form = se.get("form")
        other_forms = [d for d in ing.delivery if d.form != form]
        if form and other_forms:
            cand.notes.append(f"Switched away from the {form} form because you reported side effects with it.")
            engine._log("eligibility", cid, "form_switched", "personal.side_effect_form", form=form)
            continue
        engine._exclude(
            excluded, cand, "personal", "personal.side_effect", "personal.side_effect",
            "You reported side effects with this before.", "you reported side effects", "eligibility",
        )

    for cid, a in (feats.get("adherence") or {}).items():
        cand = cands.get(cid)
        if not cand or cand.state != "candidate":
            continue
        if a.get("rate", 0) >= ADHERENCE_HIGH and a.get("weeks", 0) >= ADHERENCE_WEEKS:
            target = a.get("target_area")
            delta = (feats.get("outcome_deltas") or {}).get(target)
            if target and delta is not None and delta <= 0:
                cand.value_multiplier *= 0.5
                engine.suggestions.append({
                    "type": "swap_or_remove", "ingredient_id": cid,
                    "text": f"You took {engine.kb.ingredients[cid].short} on most days for {a['weeks']} weeks without a change in {engine.kb.areas[target].name.lower()}. Consider swapping or stopping it.",
                })
                engine._log("eligibility", cid, "deprioritised", "personal.no_response", weeks=a["weeks"])

    for slot, rate in (feats.get("slot_adherence") or {}).items():
        if rate < SLOT_ADHERENCE_LOW:
            engine.scheduler_hints.append({"type": "avoid_slot", "slot": slot, "reason": f"You take about {round(rate * 100)}% of your {slot} doses."})
            engine._log("eligibility", None, "scheduler_hint", "personal.low_slot_adherence", slot=slot)


def filter_delivery(inp: Any, ingredient_id: str, options: list[Any]) -> list[Any]:
    feats = inp.features or {}
    bad_forms = {se.get("form") for se in feats.get("side_effects", []) if se.get("ingredient_id") == ingredient_id and se.get("form")}
    kept = [d for d in options if d.form not in bad_forms]
    return kept or options if not bad_forms else kept


def apply_value_rules(engine: Any, inp: Any, cands: dict[str, Any]) -> None:
    """Season and location: vitamin D weight rises from October to March for northern users."""
    if not inp.season.get("low_uvb"):
        return
    for cid, cand in cands.items():
        if cand.state == "candidate" and engine.kb.ingredients[cid].nutrient == "vitamin_d":
            cand.value_multiplier *= SEASONAL_VITAMIN_D_MULTIPLIER
            engine._log("optimise", cid, "seasonal_weight", "season.low_uvb", multiplier=SEASONAL_VITAMIN_D_MULTIPLIER)
