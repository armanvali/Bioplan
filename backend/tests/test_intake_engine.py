"""Signal model, next-question selection and the intake engine (section 3)."""

import math

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from stacksense.core.errors import Conflict
from stacksense.modules.intake.answers import AnswerError
from stacksense.modules.intake.selector import entropy, expected_gain
from stacksense.modules.intake.signals import logit, sigmoid


@given(st.floats(0.001, 0.999), st.floats(0.01, 0.98), st.floats(0.001, 0.99))
def test_expected_information_gain_is_never_negative(p, q1, q0):
    assert expected_gain(p, q1, q0) >= 0
    assert expected_gain(p, q1, q0) <= entropy(p) + 1e-9


def test_log_odds_roundtrip():
    for p in (0.01, 0.2, 0.5, 0.8, 0.99):
        assert math.isclose(sigmoid(logit(p)), p, rel_tol=1e-9)


def test_maya_path_matches_the_spec_story(engine, maya):
    st_ = engine.new_state(context_date="2026-10-04")
    step = engine.next_step(st_)
    toasts, asked = {}, []
    while step.kind == "node":
        nid = step.node["id"]
        asked.append(nid)
        out = engine.answer(st_, nid, maya["answers"][nid])
        if out.toast:
            toasts[nid] = out.toast["text"]
        step = out.next
    assert step.kind == "review"
    # Restless legs -> iron branch, iron cluster -> high, vegetarian -> B12/iron, no labs -> lock.
    assert "iron" in toasts["A3_lying_down"].lower()
    assert "high" in toasts["B2_iron_cluster"]
    assert "vegetarian" in toasts["B3_diet"]
    assert "blood test" in toasts["B7_bloodwork"]
    assert asked.index("A3_lying_down") < asked.index("B2_iron_cluster")
    assert 15 <= len(asked) <= 25  # G1: median 15-25 cards
    assert len(toasts) >= 3  # G1: >= 3 visible branch events
    _, sig = engine.evaluate(st_)
    assert sig["low_iron_risk"].p > 0.8
    assert sig["b12_risk"].p >= 0.6 and sig["stress_load"].p >= 0.6
    assert engine.confidence(st_) >= 0.8


def test_not_sure_marks_asked_without_updating(engine):
    st_ = engine.new_state(context_date="2026-10-04")
    engine.answer(st_, "A0_about", {"age": 30, "sex": "male", "country": "CA", "region": "ON"})
    engine.answer(st_, "A1_goals", {"ranked": ["sleep"]})
    _, before = engine.evaluate(st_)
    engine.answer(st_, "A2_sleep_problem", {"unsure": True})
    _, after = engine.evaluate(st_)
    assert after["sleep_onset"].p == before["sleep_onset"].p
    assert after["sleep_onset"].asked


def test_labs_override_questionnaire_evidence(engine, maya):
    st_ = engine.new_state(context_date="2026-10-04")
    for nid in ("A0_about", "A1_goals", "A2_sleep_problem", "A3_lying_down"):
        engine.answer(st_, nid, maya["answers"][nid])
    engine.add_labs(st_, [{"analyte": "ferritin", "value": 90}])
    _, sig = engine.evaluate(st_)
    assert sig["low_iron_risk"].p < 0.1
    assert sig["low_iron_risk"].sources[-1]["lab"]


def test_red_flag_restrict_and_stop(engine):
    st_ = engine.new_state(context_date="2026-10-04")
    engine.answer(st_, "A0_about", {"age": 50, "sex": "male", "country": "CA", "region": "AB"})
    engine.answer(st_, "A1_goals", {"ranked": ["sleep", "energy"]})
    out = engine.answer(st_, "A2_sleep_problem", {"picks": ["snoring"]})
    assert out.next.kind == "stop" and out.next.card["id"] == "sleep_apnea" and out.next.card["can_continue"]
    nxt = engine.acknowledge_stop(st_, "sleep_apnea")
    assert nxt.kind == "node"
    _, sig = engine.evaluate(st_)
    assert sig["sleep_onset"].suppressed
    ctx, _ = engine.evaluate(st_)
    assert "sleep" not in ctx["goals"]

    st2 = engine.new_state(context_date="2026-10-04")
    out = engine.answer(st2, "A0_about", {"age": 16, "sex": "female", "country": "CA", "region": "ON"})
    assert out.next.kind == "stop" and not out.next.card["can_continue"]
    with pytest.raises(Conflict):
        engine.answer(st2, "A1_goals", {"ranked": ["sleep"]})


def test_editing_an_answer_removes_its_red_flag(engine):
    st_ = engine.new_state(context_date="2026-10-04")
    engine.answer(st_, "A0_about", {"age": 50, "sex": "male", "country": "CA", "region": "AB"})
    engine.answer(st_, "A1_goals", {"ranked": ["sleep"]})
    engine.answer(st_, "A2_sleep_problem", {"picks": ["snoring"]})
    engine.answer(st_, "A2_sleep_problem", {"picks": ["falling"]})
    assert st_.stops == [] and "stop_sleep" not in st_.flags


def test_preconditions_are_enforced(engine):
    st_ = engine.new_state(context_date="2026-10-04")
    engine.answer(st_, "A0_about", {"age": 30, "sex": "male", "country": "CA", "region": "ON"})
    with pytest.raises(Conflict):
        engine.answer(st_, "B5_period_heaviness", {"choice": "heavy"})


@pytest.mark.parametrize(
    "node,value",
    [
        ("A1_goals", {"ranked": ["sleep", "sleep"]}),
        ("A1_goals", {"ranked": ["sleep", "energy", "joints", "mood"]}),
        ("A0_about", {"age": 300, "sex": "female"}),
        ("C1_medications", {"meds": ["not_a_drug"]}),
        ("D3_routine", {"wake": 420, "breakfast": 400, "lunch": 750, "dinner": 1140, "bed": 1380}),
    ],
)
def test_bad_answers_are_rejected(engine, node, value):
    st_ = engine.new_state(context_date="2026-10-04")
    with pytest.raises(AnswerError):
        engine.answer(st_, node, value)


def test_returning_user_answers_at_least_40_percent_fewer_cards(engine, maya):
    """G7: the graph starts from stored signals; stable facts show as confirm chips."""
    st_ = engine.new_state(context_date="2026-10-04")
    first = 0
    step = engine.next_step(st_)
    while step.kind == "node":
        step = engine.answer(st_, step.node["id"], maya["answers"][step.node["id"]]).next
        first += 1
    _, sig = engine.evaluate(st_)
    from stacksense.modules.intake.engine import STABLE_NODES

    prefill = {
        "answers": {k: maya["answers"][k] for k in STABLE_NODES if k in maya["answers"]},
        "signal_priors": {k: s.p for k, s in sig.items() if s.sources},
        "pending_labs": ["ferritin"],
    }
    st2 = engine.new_state(context_date="2027-01-10", prefill=prefill)
    step = engine.next_step(st2)
    assert step.kind == "confirm"
    assert step.node["lab_due"][0]["analyte"] == "ferritin"  # "Did you get your ferritin tested?"
    step = engine.answer(st2, step.node["id"], {"changed": []}).next
    second = 0
    while step.kind == "node":
        step = engine.answer(st2, step.node["id"], maya["answers"].get(step.node["id"], {"unsure": True})).next
        second += 1
    assert second <= 0.6 * first, (first, second)


@settings(max_examples=40, deadline=None)
@given(st.data())
def test_random_walks_terminate_without_loops(kb, graph, data):
    """No node is ever asked twice and every walk ends in review or a stop card."""
    from stacksense.modules.intake.engine import IntakeEngine

    engine = IntakeEngine(graph, kb)
    st_ = engine.new_state(context_date="2026-10-04")
    step = engine.next_step(st_)
    seen = set()
    for _ in range(60):
        if step.kind == "stop":
            if not step.card["can_continue"]:
                break
            step = engine.acknowledge_stop(st_, step.card["id"])
            continue
        if step.kind != "node":
            break
        nid = step.node["id"]
        assert nid not in seen
        seen.add(nid)
        step = engine.answer(st_, nid, data.draw(answer_strategy(engine.graph.node(nid), engine.kb))).next
    assert step.kind in ("review", "stop")


def answer_strategy(node, kb):
    a = node.answer
    t = a.type
    if t in ("single", "scale"):
        base = st.sampled_from([o.id for o in a.options]).map(lambda c: {"choice": c, "years": 3, "legs_freq": "sometimes"})
    elif t == "multi":
        normal = [o.id for o in a.options if not o.exclusive]
        excl = [o.id for o in a.options if o.exclusive]
        opts = st.lists(st.sampled_from(normal), min_size=1, max_size=3, unique=True)
        if excl:
            opts = st.one_of(opts, st.just([excl[0]]))
        base = opts.map(lambda p: {"picks": p, "legs_freq": "sometimes", "lasts": "day"})
    elif t == "rank":
        base = st.lists(st.sampled_from([o.id for o in a.options]), min_size=1, max_size=3, unique=True).map(lambda r: {"ranked": r})
    elif t == "time":
        base = st.integers(0, 1439).map(lambda m: {"minutes": m})
    elif t == "energy_curve":
        base = st.lists(st.integers(0, 10), min_size=9, max_size=9).map(lambda p: {"points": p})
    elif t == "body_map":
        base = st.lists(st.sampled_from(["knee_l", "knee_r", "lowerback", "calf_l"]), min_size=1, max_size=3, unique=True).map(lambda s: {"spots": s})
    elif t == "pss4":
        base = st.lists(st.integers(0, 4), min_size=4, max_size=4).map(lambda i: {"items": i})
    elif t == "meds":
        base = st.lists(st.sampled_from(sorted(kb.drugs)), max_size=3, unique=True).map(lambda m: {"meds": m})
    elif t == "budget":
        base = st.integers(20, 250).map(lambda x: {"amount": x})
    elif t == "pills":
        base = st.integers(1, 12).map(lambda x: {"max": x, "powders": True})
    elif t == "routine":
        base = st.just({"wake": 420, "breakfast": 450, "lunch": 750, "dinner": 1140, "bed": 1380, "training_days": [], "tz": "America/Toronto"})
    elif t == "training":
        base = st.integers(0, 7).map(lambda s: {"sessions": s, "km": s * 5})
    elif t == "demographics":
        base = st.tuples(st.integers(13, 90), st.sampled_from(["female", "male"])).map(lambda t_: {"age": t_[0], "sex": t_[1], "country": "CA", "region": "ON"})
    elif t == "free_text":
        base = st.just({"skip": True})
    else:
        base = st.just({"unsure": True})
    if a.allow_unsure:
        return st.one_of(base, st.just({"unsure": True}))
    return base
