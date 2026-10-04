"""Contract tests for the public API (section 9.2), including Maya's B3 exchange."""

from tests.conftest import build_plan_api, run_intake_api


def test_maya_b3_answer_returns_the_spec_response_shape(client, maya):
    s = client.post("/v1/intake/sessions", json={"locale": "en", "context_date": "2026-10-04"}).json()
    assert set(s) >= {"session_id", "session_token", "next", "confidence", "graph_version", "rules_version"}
    h = {"X-Session-Token": s["session_token"]}
    step = s["next"]
    while step["node"]["id"] != "B3_diet":
        step = client.post(f"/v1/intake/sessions/{s['session_id']}/answers", json={"node_id": step["node"]["id"], "value": maya["answers"][step["node"]["id"]]}, headers=h).json()["next"]
    r = client.post(f"/v1/intake/sessions/{s['session_id']}/answers", json={"node_id": "B3_diet", "value": {"choice": "vegetarian", "years": 6}}, headers=h)
    body = r.json()
    assert r.status_code == 200
    assert set(body) == {"next", "toast", "signals_delta", "exclusions_added", "confidence"}
    assert body["next"]["kind"] == "node" and {"id", "prompt", "why", "answer"} <= set(body["next"]["node"])
    assert "vegetarian" in body["toast"]["text"]
    deltas = {d["signal"]: d["p"] for d in body["signals_delta"]}
    assert deltas["b12_risk"] >= 0.6 and deltas["omega3_gap"] >= 0.7
    assert 0 < body["confidence"] < 1


def test_session_requires_its_own_token(client, maya):
    a = client.post("/v1/intake/sessions", json={}).json()
    b = client.post("/v1/intake/sessions", json={}).json()
    r = client.get(f"/v1/intake/sessions/{a['session_id']}", headers={"X-Session-Token": b["session_token"]})
    assert r.status_code == 403
    assert client.get(f"/v1/intake/sessions/{a['session_id']}").status_code == 401


def test_validation_errors_are_structured(client):
    s = client.post("/v1/intake/sessions", json={}).json()
    r = client.post(f"/v1/intake/sessions/{s['session_id']}/answers", json={"node_id": "A0_about", "value": {"age": 7000, "sex": "x"}}, headers={"X-Session-Token": s["session_token"]})
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_answer"


def test_review_signals_patch_and_live_preview(client, maya):
    run = run_intake_api(client, maya)
    sid, h = run["session_id"], run["headers"]
    rv = client.get(f"/v1/intake/sessions/{sid}/review", headers=h).json()
    tags = {s["id"] for g in rv["groups"] for s in g["signals"]}
    assert {"low_iron_risk", "sleep_onset", "b12_risk"} <= tags
    iron = next(s for g in rv["groups"] for s in g["signals"] if s["id"] == "low_iron_risk")
    assert any("Legs feel restless" in src["text"] for src in iron["sources"])
    before = {x["ingredient_id"] for x in rv["preview"]["stack"]}
    rv2 = client.patch(f"/v1/intake/sessions/{sid}/signals", json={"signal_id": "exercise_soreness", "action": "remove"}, headers=h).json()
    after = {x["ingredient_id"] for x in rv2["preview"]["stack"]}
    assert "curcumin_enhanced" in before and "curcumin_enhanced" not in after


def test_plan_build_views_and_reproducibility(client, maya):
    run = run_intake_api(client, maya)
    plan = build_plan_api(client, run)
    pid, h = plan["plan_id"], {"X-Plan-Token": plan["plan_token"]}
    assert plan["rules_version"] and plan["graph_version"] and plan["impact_version"] and plan["catalog_snapshot_id"]
    assert {e["ingredient_id"] for e in plan["excluded"]} >= {"collagen_peptides", "st_johns_wort", "melatonin"}
    assert client.get(f"/v1/plans/{pid}/audit", headers=h).json()["records"]
    sched = client.get(f"/v1/plans/{pid}/schedule?from=2026-10-19&to=2026-10-19&today=2026-10-19", headers=h).json()
    day = sched["days"][0]
    assert day["pills"] == 6 and day["scoops"] == 2
    assert [s["label"] for s in day["slots"]] == ["Breakfast", "Dinner", "Wind-down"]
    # Same inputs -> identical plan output.
    from stacksense.db import session_scope
    from stacksense.modules.plans.service import PlanService
    from stacksense.modules.profile.models import Plan

    with session_scope() as db:
        assert PlanService(db).reproduce(db.get(Plan, pid))


def test_terminal_stop_blocks_plan(client):
    from tests.conftest import load_persona

    teo = load_persona("teo_teen")
    run = run_intake_api(client, teo)
    assert run["step"]["kind"] == "stop" and run["step"]["card"]["id"] == "under_18"
    r = client.post("/v1/plans", json={"session_id": run["session_id"]}, headers=run["headers"])
    assert r.status_code == 409


def test_medicine_search_shows_live_interaction_check(client):
    res = client.get("/v1/intake/drugs?q=zol").json()["results"]
    assert res[0]["id"] == "sertraline"
    assert any(b["ingredient_id"] == "st_johns_wort" for b in res[0]["blocks"])
    assert client.get("/v1/intake/drugs?q=zo").json()["results"] == []  # autocomplete after 3 letters


def test_meta_and_openapi(client):
    meta = client.get("/v1/meta").json()
    assert len(meta["areas"]) == 8 and len(meta["consent"]["purposes"]) == 5
    spec = client.get("/openapi.json").json()
    for path in ["/v1/intake/sessions", "/v1/intake/sessions/{session_id}/answers", "/v1/plans", "/v1/plans/{plan_id}/impact",
                 "/v1/plans/{plan_id}/products", "/v1/plans/{plan_id}/schedule", "/v1/billing/offers", "/v1/webhooks/stripe",
                 "/v1/me/consents/{purpose}", "/v1/me/privacy/export", "/admin/v1/engine/releases"]:
        assert path in spec["paths"], path


def test_health(client):
    assert client.get("/healthz").json()["status"] == "ok"
    assert client.get("/readyz").json()["status"] == "ready"
