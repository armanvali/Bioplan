"""Property tests for the rules engine and optimiser (section 12.1): the optimiser never
exceeds budget or pill limit, upper limits hold, contraindicated items never ship."""

import itertools

from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from stacksense.modules.rules.engine import PlanInput, RulesEngine
from stacksense.modules.rules.optimiser import OptItem, objective, solve

SIGNALS = ["sleep_onset", "sleep_maintenance", "circadian_delay", "stress_arousal", "stress_load", "afternoon_crash", "fatigue",
           "low_iron_risk", "b12_risk", "vitamin_d_risk", "omega3_gap", "low_dietary_creatine", "exercise_soreness", "joint_stiffness",
           "endurance_load", "hair_shedding", "frequent_colds", "lipids_high"]


@st.composite
def plan_inputs(draw):
    signals = {s: draw(st.floats(0.0, 1.0)) for s in SIGNALS}
    signals["pregnancy_planning"] = 0.0
    pregnancy = draw(st.sampled_from([None, "no", "pregnant", "trying"]))
    if pregnancy in ("pregnant", "trying"):
        signals["pregnancy_planning"] = 0.99
    facts = {
        "age": draw(st.integers(18, 85)), "sex": draw(st.sampled_from(["female", "male"])), "country": draw(st.sampled_from(["CA", "US"])),
        "diet": draw(st.sampled_from(["meat", "pescatarian", "vegetarian", "vegan"])),
        "conditions": draw(st.lists(st.sampled_from(["thyroid", "liver", "kidney", "bleeding", "gallstones", "autoimmune", "hemochromatosis", "surgery_2w"]), max_size=2, unique=True)),
        "drug_classes": draw(st.lists(st.sampled_from(["hormonal_contraceptive", "ssri", "anticoagulant", "vitamin_k_antagonist", "thyroid_hormone", "sedative", "antiplatelet", "ppi"]), max_size=3, unique=True)),
        "allergies": draw(st.lists(st.sampled_from(["fish", "gelatin", "soy"]), max_size=2, unique=True)),
        "budget": draw(st.integers(20, 250)), "pill_limit": draw(st.integers(1, 12)), "powders_ok": draw(st.booleans()),
        "current_supplies": draw(st.sampled_from([[], [{"nutrient": "vitamin_d", "amount": 2000}], [{"nutrient": "magnesium", "amount": 300}], [{"nutrient": "iron", "amount": 30}]])),
    }
    if pregnancy:
        facts["pregnancy"] = pregnancy
    goals = draw(st.lists(st.sampled_from(["sleep", "energy", "joints", "mood", "performance", "skin", "immunity", "heart"]), min_size=1, max_size=3, unique=True))
    labs = {}
    if draw(st.booleans()):
        labs["ferritin"] = {"value": draw(st.floats(5, 150)), "unit": "µg/L", "drawn_at": "2026-09-01"}
    return PlanInput(
        facts=facts, goals=goals, signals=signals, signal_sources={}, evidenced={s for s, p in signals.items() if p > 0.3},
        labs=labs, flags=[], answers={}, season={"low_uvb": draw(st.booleans()), "month": 10}, context_date="2026-10-04",
        unsure_count=draw(st.integers(0, 6)),
    )


@settings(max_examples=150, deadline=None, suppress_health_check=[HealthCheck.too_slow])
@given(plan_inputs())
def test_engine_invariants(kb, inp):
    r = RulesEngine(kb).build(inp)
    items = r["items"]
    totals = r["totals"]
    # Budget, pill limit, item cap.
    assert totals["monthly_cost"] <= inp.facts["budget"] + 1e-6
    assert totals["max_pills_day"] <= inp.facts["pill_limit"]
    assert len(items) <= (3 if r["low_confidence"] else 8)
    # One per substitute group.
    groups = [it["group"] for it in items if it["group"]]
    assert len(groups) == len(set(groups))
    active = {it["ingredient_id"] for it in items}
    # Contraindicated items never ship.
    for ci in kb.data.contraindications:
        if ci.ingredient_id not in active or ci.severity != "exclude":
            continue
        f = inp.facts
        hit = {
            "diet": f.get("diet") == ci.code, "allergy": ci.code in f.get("allergies", []), "condition": ci.code in f.get("conditions", []),
            "drug_class": ci.code in f.get("drug_classes", []), "pregnancy": f.get("pregnancy") in ("pregnant", "trying", "breastfeeding"),
        }.get(ci.kind, False)
        assert not hit, (ci.id, active)
    # Restricted libraries.
    if inp.facts.get("pregnancy") in ("pregnant", "trying"):
        lib = next(lb for lb in kb.data.restricted_libraries if lb.id == "pregnancy")
        assert active <= set(lib.allowed)
    # Lab-locked ingredients never ship without a lab.
    for it in items:
        ing = kb.ingredients[it["ingredient_id"]]
        if ing.requires_lab:
            assert ing.requires_lab.analyte in inp.labs
    # Upper limits: plan + existing supplies stay under the UL per nutrient.
    totals_by_nutrient = {}
    for s in inp.facts["current_supplies"]:
        totals_by_nutrient[s["nutrient"]] = totals_by_nutrient.get(s["nutrient"], 0) + s["amount"]
    for it in items:
        n = kb.ingredients[it["ingredient_id"]].nutrient
        if n:
            totals_by_nutrient[n] = totals_by_nutrient.get(n, 0) + it["dose"]
    for n, total in totals_by_nutrient.items():
        ul = kb.upper_limits.get(n)
        if ul and any(kb.ingredients[it["ingredient_id"]].nutrient == n for it in items):
            assert total <= ul.ul_value + 1e-6, (n, total)
    # Doses stay inside their bands.
    for it in items:
        assert it["range"]["min"] <= it["dose"] <= it["range"]["max"]


@st.composite
def opt_instances(draw):
    areas = ["a", "b", "c"]
    n = draw(st.integers(1, 9))
    items = []
    for i in range(n):
        contrib = {a: draw(st.floats(0, 8)) for a in areas if draw(st.booleans())}
        pills = draw(st.integers(0, 3))
        items.append(OptItem(id=f"i{i}", groups=frozenset({f"g{draw(st.integers(0, 5))}"}) if draw(st.booleans()) else frozenset({f"u{i}"}),
                             cost=draw(st.floats(1, 30)), pills=tuple([pills] * 7), contrib=contrib))
    need = {a: draw(st.floats(0, 10)) for a in areas}
    return items, need, draw(st.floats(10, 80)), draw(st.integers(1, 8)), draw(st.integers(1, 5))


@settings(max_examples=200, deadline=None)
@given(opt_instances())
def test_optimiser_is_exact_and_feasible(inst):
    items, need, budget, pill_limit, max_items = inst
    res = solve(items, need, budget, pill_limit, max_items)
    chosen = [it for it in items if it.id in res.selected]
    assert sum(it.cost for it in chosen) <= budget + 1e-9
    assert max([sum(it.pills[d] for it in chosen) for d in range(7)] or [0]) <= pill_limit
    assert len(chosen) <= max_items
    seen = set()
    for it in chosen:
        assert not (it.groups & seen)
        seen |= it.groups
    # Brute force agrees on the optimum.
    best = 0.0
    for k in range(0, min(max_items, len(items)) + 1):
        for combo in itertools.combinations(items, k):
            groups = [g for it in combo for g in it.groups]
            if len(groups) != len(set(groups)):
                continue
            if sum(it.cost for it in combo) > budget + 1e-9:
                continue
            if max([sum(it.pills[d] for it in combo) for d in range(7)] or [0]) > pill_limit:
                continue
            best = max(best, objective(list(combo), need))
    assert abs(res.objective - best) < 1e-6
