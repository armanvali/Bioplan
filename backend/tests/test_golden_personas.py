"""Rules golden tests (sections 10 and 12.1): every persona produces its exact expected
plan; any diff fails CI and needs clinician sign-off."""

import pytest

from stacksense.modules.rules.engine import RulesEngine
from stacksense.modules.rules.inputs import plan_input_from_state
from stacksense.personas import check_expectations, load_personas, run_persona

PERSONAS = load_personas()


@pytest.mark.parametrize("persona", PERSONAS, ids=[p["id"] for p in PERSONAS])
def test_persona_matches_expectations(persona, graph, kb):
    run = run_persona(persona, graph, kb)
    assert check_expectations(persona, run) == []


def test_maya_matches_the_prototype(graph, kb, maya):
    run = run_persona(maya, graph, kb)
    r = run.result
    assert run.stack == sorted(["vitamin_d3_k2", "omega3_algae", "creatine_monohydrate", "vitamin_b12", "magnesium_bisglycinate", "ashwagandha_ksm66", "curcumin_enhanced"])
    excluded = {e["ingredient_id"]: e for e in r["excluded"]}
    assert excluded["collagen_peptides"]["rule_code"] == "diet.vegetarian"
    assert excluded["st_johns_wort"]["rule_code"] == "drug_class.hormonal_contraceptive"
    assert "birth control" in excluded["st_johns_wort"]["reason"]
    assert excluded["melatonin"]["kind"] == "fit"
    assert excluded["omega3_fish"]["substituted_by"] == "omega3_algae"
    assert [x["ingredient_id"] for x in r["locked"]] == ["iron_bisglycinate"]
    assert r["locked"][0]["unlock"]["analyte"] == "ferritin"
    assert r["totals"]["max_pills_day"] == 6 and r["totals"]["scoops"] == 2
    assert r["totals"]["monthly_cost"] <= 80
    by_id = {it["ingredient_id"]: it for it in r["items"]}
    assert by_id["vitamin_b12"]["frequency"] == "weekdays" and by_id["vitamin_b12"]["weekdays"] == ["mo", "we", "fr"]
    assert by_id["ashwagandha_ksm66"]["cycle"] == {"on_weeks": 8, "off_weeks": 2}
    assert by_id["magnesium_bisglycinate"]["delivery"]["form"] == "powder"
    # Health Impact Map: skin & hair gap explained by the locked iron.
    skin = next(a for a in r["impact"]["areas"] if a["area"] == "skin_hair")
    assert skin["gap_reason"] == {"code": "locked_ingredient", "ingredient": "iron_bisglycinate"}
    # Lifestyle tip from the caffeine answer.
    assert any(t["id"] == "tip_caffeine" and "3:00 pm" in t["title"] for t in r["tips"])


def test_every_item_and_exclusion_traces_to_rules_and_citations(graph, kb):
    """G2: 100% of items and exclusions trace to rules + citations."""
    for p in PERSONAS:
        run = run_persona(p, graph, kb)
        if not run.result:
            continue
        audit_ings = {a["ingredient"] for a in run.result["audit"] if a["ingredient"]}
        for it in run.result["items"]:
            assert it["ingredient_id"] in audit_ings
            assert it["evidence"] and all(e["citations"] for e in it["evidence"])
            assert it["reason_codes"]
        for e in run.result["excluded"]:
            assert e["rule_id"] and e["reason"]


def test_plans_are_reproducible(graph, kb, maya, engine):
    """Same (answers, labs, graph_version, rules_version) -> identical output."""
    st_ = engine.new_state(context_date="2026-10-04")
    step = engine.next_step(st_)
    while step.kind == "node":
        step = engine.answer(st_, step.node["id"], maya["answers"][step.node["id"]]).next
    inp = plan_input_from_state(engine, st_)
    a = RulesEngine(kb).build(inp)
    b = RulesEngine(kb).build(inp)
    assert a == b


def test_payment_and_affiliate_data_are_not_rules_inputs():
    import dataclasses

    from stacksense.modules.rules.engine import PlanInput

    fields = {f.name for f in dataclasses.fields(PlanInput)}
    assert not any(k in fields for k in ("entitlements", "features_paid", "commission", "retailer", "tier"))
