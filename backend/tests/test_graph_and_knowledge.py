"""Graph tests (section 12.1): no unreachable nodes, no loops, every red flag reachable,
every ingredient reachable by at least one path; knowledge base integrity."""

import copy
import random

from stacksense.core import expr
from stacksense.knowledge.base import KnowledgeBase
from stacksense.knowledge.models import KnowledgeData
from stacksense.modules.intake.engine import IntakeEngine
from stacksense.modules.intake.graph import Graph, GraphData
from stacksense.personas import load_personas, run_persona
from tests.test_intake_engine import answer_strategy


def test_static_graph_checks_pass(graph, kb):
    report = graph.check(kb)
    assert report["errors"] == []
    assert report["warnings"] == []


def test_knowledge_base_validates(kb):
    assert kb.validate() == []


def test_every_row_has_a_source(kb):
    for table in KnowledgeData.TABLES:
        for row in getattr(kb.data, table):
            assert row.source, (table, row)


def test_check_catches_broken_graph(graph, kb):
    data = copy.deepcopy(graph.data.model_dump(by_alias=True))
    node = next(n for n in data["nodes"] if n["id"] == "A2_sleep_problem")
    node["preconditions"] = "answers.D3_routine.wake > 0"  # depends on a later phase
    node["red_flags"][0]["card"] = "nope"
    node["effects"][0]["signal"] = "no_such_signal"
    report = Graph(GraphData(**data)).check(kb)
    joined = " ".join(report["errors"])
    assert "later-phase" in joined and "unknown stop card" in joined and "no_such_signal" in joined


def test_upper_limit_violation_is_caught(kb):
    data = kb.data.model_dump()
    for band in data["dose_bands"]:
        if band["id"] == "db_mg_adult":
            band["max"] = 600
    assert any("exceeds upper limit" in p for p in KnowledgeBase(KnowledgeData(**data)).validate())


def _random_walks(graph, kb, n=400, seed=7):
    rng = random.Random(seed)
    engine = IntakeEngine(graph, kb)
    asked, stops, stacks = set(), set(), set()
    for _ in range(n):
        st_ = engine.new_state(context_date=rng.choice(["2026-01-15", "2026-07-15", "2026-10-04"]))
        step = engine.next_step(st_)
        for _ in range(60):
            if step.kind == "stop":
                stops.add(step.card["id"])
                if not step.card["can_continue"]:
                    break
                step = engine.acknowledge_stop(st_, step.card["id"])
                continue
            if step.kind != "node":
                break
            node = graph.node(step.node["id"])
            asked.add(node.id)
            value = answer_strategy(node, kb).example() if False else _sample(node, kb, rng)
            step = engine.answer(st_, node.id, value).next
        if step.kind == "review":
            from stacksense.modules.rules.engine import RulesEngine
            from stacksense.modules.rules.inputs import plan_input_from_state

            engine.apply_defaults(st_)
            res = RulesEngine(kb).build(plan_input_from_state(engine, st_))
            stacks.update(it["ingredient_id"] for it in res["items"])
            stacks.update(x["ingredient_id"] for x in res["locked"])
    return asked, stops, stacks


def _sample(node, kb, rng):
    a = node.answer
    if a.allow_unsure and rng.random() < 0.1:
        return {"unsure": True}
    t = a.type
    if t in ("single", "scale"):
        c = rng.choice([o.id for o in a.options])
        return {"choice": c, "years": rng.randint(0, 10), "legs_freq": rng.choice(["rarely", "sometimes", "most_nights"])}
    if t == "multi":
        normal = [o.id for o in a.options if not o.exclusive]
        excl = [o.id for o in a.options if o.exclusive]
        if excl and rng.random() < 0.2:
            return {"picks": [excl[0]]}
        return {"picks": rng.sample(normal, rng.randint(1, min(3, len(normal)))), "legs_freq": "sometimes", "lasts": rng.choice(["day", "days", "longer"])}
    if t == "rank":
        return {"ranked": rng.sample([o.id for o in a.options], rng.randint(1, 3))}
    if t == "time":
        return {"minutes": rng.randint(360, 1320)}
    if t == "energy_curve":
        return {"points": [rng.randint(0, 10) for _ in range(9)]}
    if t == "body_map":
        return {"spots": rng.sample(["knee_l", "knee_r", "lowerback", "calf_l", "shoulder_l"], rng.randint(1, 3))}
    if t == "pss4":
        return {"items": [rng.randint(0, 4) for _ in range(4)], "source": "Work"}
    if t == "meds":
        return {"meds": rng.sample(sorted(kb.drugs), rng.randint(0, 2))}
    if t == "budget":
        return {"amount": rng.randint(30, 200)}
    if t == "pills":
        return {"max": rng.randint(2, 10), "powders": rng.random() < 0.8}
    if t == "routine":
        return {"wake": 420, "breakfast": 450, "lunch": 750, "dinner": 1140, "bed": 1380, "training_days": ["tue"], "tz": "America/Toronto"}
    if t == "training":
        s = rng.randint(0, 7)
        return {"sessions": s, "km": s * rng.randint(0, 10)}
    if t == "demographics":
        return {"age": rng.randint(16, 85), "sex": rng.choice(["female", "male", "prefer_not"]), "country": rng.choice(["CA", "US"]), "region": rng.choice(["ON", "BC", "NY", "TX"]) }
    return {"skip": True}


def test_every_node_red_flag_and_ingredient_is_reachable(graph, kb):
    asked, stops, stacks = _random_walks(graph, kb)
    # Personas cover deliberate paths the random walk may miss.
    for p in load_personas():
        run = run_persona(p, graph, kb, strict=False)
        asked.update(run.asked)
        stops.update(run.stops)
        if run.result:
            stacks.update(it["ingredient_id"] for it in run.result["items"])
            stacks.update(x["ingredient_id"] for x in run.result["locked"])
    assert set(graph.nodes) - asked == set(), "unreachable nodes"
    assert set(graph.data.stop_cards) - stops == set(), "unreachable red flags"
    # Every ingredient is either recommendable on some path or deliberately exists only to be excluded.
    exclusion_only = {"st_johns_wort", "melatonin", "collagen_peptides"}
    missing = set(kb.ingredients) - stacks - exclusion_only
    assert missing == set(), f"ingredients no path reaches: {missing}"


def test_preconditions_only_reference_known_paths(graph):
    for n in graph.data.nodes:
        if n.preconditions:
            for path in expr.paths(n.preconditions):
                if path[0] == "answers":
                    assert path[1] in graph.nodes
