from __future__ import annotations

import json
import os
from collections.abc import Iterator
from pathlib import Path
from typing import Any

os.environ.setdefault("STACKSENSE_ENV", "test")
os.environ.setdefault("STACKSENSE_DATABASE_URL", "sqlite://")

import pytest
from fastapi.testclient import TestClient

from stacksense import db as dbmod
from stacksense.config import DATA_DIR
from stacksense.knowledge.base import default_kb
from stacksense.modules.intake.engine import IntakeEngine
from stacksense.modules.intake.graph import default_graph


@pytest.fixture(scope="session")
def kb():
    return default_kb()


@pytest.fixture(scope="session")
def graph():
    return default_graph()


@pytest.fixture
def engine(kb, graph) -> IntakeEngine:
    return IntakeEngine(graph, kb)


def load_persona(pid: str) -> dict[str, Any]:
    return json.loads((DATA_DIR / "personas" / f"{pid}.json").read_text())


@pytest.fixture
def maya() -> dict[str, Any]:
    return load_persona("maya")


@pytest.fixture
def database(tmp_path: Path) -> Iterator[None]:
    """A fresh SQLite database per test, with tables and reference data."""
    from stacksense import deps, registry
    from stacksense.core.ratelimit import RateLimiter

    dbmod.init_engine(f"sqlite:///{tmp_path / 'test.db'}")
    dbmod.create_all()
    registry.clear_caches()
    deps._limiter = RateLimiter(None)
    from stacksense.seed import seed_reference

    with dbmod.session_scope() as s:
        seed_reference(s)
    yield


@pytest.fixture
def session(database):
    with dbmod.session_scope() as s:
        yield s


@pytest.fixture
def client(database) -> Iterator[TestClient]:
    from stacksense.main import create_app

    with TestClient(create_app()) as c:
        yield c


def run_intake_api(client: TestClient, persona: dict[str, Any], headers: dict[str, str] | None = None) -> dict[str, Any]:
    """Drive a persona through the public API; returns session id/token and final step."""
    r = client.post("/v1/intake/sessions", json={"locale": "en", "context_date": persona.get("context_date", "2026-10-04")}, headers=headers or {})
    assert r.status_code == 200, r.text
    s = r.json()
    h = {**(headers or {}), "X-Session-Token": s["session_token"]}
    step = s["next"]
    asked = []
    responses = []
    while step["kind"] in ("node", "stop", "confirm"):
        if step["kind"] == "stop":
            if not step["card"]["can_continue"]:
                break
            step = client.post(f"/v1/intake/sessions/{s['session_id']}/stops/{step['card']['id']}/acknowledge", headers=h).json()["next"]
            continue
        if step["kind"] == "confirm":
            out = client.post(f"/v1/intake/sessions/{s['session_id']}/answers", json={"node_id": step["node"]["id"], "value": {"changed": persona.get("changed", [])}}, headers=h).json()
            step = out["next"]
            continue
        nid = step["node"]["id"]
        asked.append(nid)
        out = client.post(f"/v1/intake/sessions/{s['session_id']}/answers", json={"node_id": nid, "value": persona["answers"][nid]}, headers=h)
        assert out.status_code == 200, out.text
        responses.append((nid, out.json()))
        step = out.json()["next"]
    return {"session_id": s["session_id"], "session_token": s["session_token"], "headers": h, "step": step, "asked": asked, "responses": responses, "created": s}


def build_plan_api(client: TestClient, run: dict[str, Any], start_date: str = "2026-10-05") -> dict[str, Any]:
    r = client.post("/v1/plans", json={"session_id": run["session_id"], "start_date": start_date}, headers=run["headers"])
    assert r.status_code == 200, r.text
    return r.json()


def login(client: TestClient, email: str) -> dict[str, str]:
    tok = client.post("/v1/auth/magic-link", json={"email": email}).json()["dev_token"]
    access = client.post("/v1/auth/verify", json={"token": tok}).json()["access_token"]
    return {"Authorization": f"Bearer {access}"}


def admin_login(client: TestClient, email: str) -> dict[str, str]:
    r = client.post("/admin/v1/auth/login", json={"email": email})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def buy(client: TestClient, plan_key: str, price_id: str, email: str, plan_id: str | None = None) -> dict[str, Any]:
    co = client.post("/v1/billing/checkout", json={"plan_key": plan_key, "price_id": price_id, "email": email, "plan_id": plan_id}).json()
    return client.post(f"/v1/billing/fake-checkout/{co['checkout_id']}/complete", json={"email": email}).json()
