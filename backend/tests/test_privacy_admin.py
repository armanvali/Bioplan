"""Consent (section 11), privacy rights, admin scopes and the clinical release workflow
(section 15), plus the worker jobs that enforce retention and consent."""

from datetime import date, timedelta

import pytest
from sqlalchemy import select

from stacksense.core.errors import NotFound
from stacksense.db import session_scope, utcnow
from stacksense.modules.admin.models import AuditLog, Outbox
from stacksense.modules.admin.roles import ROLES
from stacksense.modules.identity.models import User
from stacksense.modules.profile.keys import KeyRing
from stacksense.modules.profile.models import Answer, IntakeSession, Plan, Subject
from tests.conftest import admin_login, build_plan_api, buy, login, run_intake_api


def _saved_maya(client, maya, email="saved@example.com", personalisation=False):
    run = run_intake_api(client, maya)
    plan = build_plan_api(client, run)
    auth = login(client, email)
    r = client.post("/v1/me/save", json={"plan_id": plan["plan_id"], "profile_storage": True, "personalisation": personalisation},
                    headers={**auth, "X-Plan-Token": plan["plan_token"]})
    assert r.status_code == 200 and r.json()["saved"] is True
    return plan, auth


# ---------------------------------------------------------------- consent


def test_nothing_is_stored_without_profile_storage(client, maya):
    run = run_intake_api(client, maya)
    plan = build_plan_api(client, run)
    auth = login(client, "nostore@example.com")
    r = client.post("/v1/me/save", json={"plan_id": plan["plan_id"], "profile_storage": False}, headers={**auth, "X-Plan-Token": plan["plan_token"]}).json()
    assert r["saved"] is False
    assert client.get("/v1/me/profile", headers=auth).json()["profile"] is None
    assert client.get("/v1/me/plans", headers=auth).json()["plans"] == []
    assert client.post("/v1/me/preferences", json={"product_id": "th-mg", "rating": 5}, headers=auth).status_code == 400
    # Personalisation can't be granted on its own.
    r = client.put("/v1/me/consents/personalisation", json={"granted": True}, headers=auth)
    assert r.status_code == 400 and r.json()["error"]["code"] == "needs_profile_storage"


def test_saved_profile_is_encrypted_at_rest(client, maya, session):
    plan, auth = _saved_maya(client, maya)
    prof = client.get("/v1/me/profile", headers=auth).json()["profile"]
    assert "vegetarian" in prof["stable_facts"]["B3_diet"].lower()
    row = session.scalar(select(Answer).limit(1))
    assert "vegetarian" not in row.value_enc and row.value_enc  # ciphertext, not plaintext
    assert [p["id"] for p in client.get("/v1/me/plans", headers=auth).json()["plans"]] == [plan["plan_id"]]


def test_withdrawing_storage_erases_and_shreds_immediately(client, maya, session):
    plan, auth = _saved_maya(client, maya, personalisation=True)
    user_id = client.get("/v1/me", headers=auth).json()["id"]
    subject_id = session.get(User, user_id).subject_id
    out = client.put("/v1/me/consents/profile_storage", json={"granted": False}, headers=auth).json()
    states = {p["purpose"]: p["granted"] for p in out["purposes"]}
    assert states["profile_storage"] is False and states["personalisation"] is False  # withdrawal cascades
    session.expire_all()
    assert session.get(User, user_id).subject_id is None
    assert session.get(Subject, subject_id).wrapped_dek is None
    assert session.scalar(select(Plan).where(Plan.subject_id == subject_id)) is None
    assert session.scalar(select(IntakeSession).where(IntakeSession.subject_id == subject_id)) is None
    with pytest.raises(NotFound):
        KeyRing(session).dek(subject_id)  # crypto-shredded: backups can't be decrypted
    hist = client.get("/v1/me/privacy/history", headers=auth).json()["consents"]
    assert any(h["purpose"] == "profile_storage" and h["granted"] is False for h in hist)


def test_reminders_need_consent(client, maya):
    _, auth = _saved_maya(client, maya, email="push@example.com")
    sub = {"endpoint": "https://push.example/abc", "keys": {"p256dh": "x", "auth": "y"}}
    assert client.post("/v1/me/push-subscriptions", json=sub, headers=auth).status_code == 400
    client.put("/v1/me/consents/reminders", json={"granted": True}, headers=auth)
    assert client.post("/v1/me/push-subscriptions", json=sub, headers=auth).status_code == 200


# ---------------------------------------------------------------- privacy rights


def test_export_contains_everything_and_pdf_works(client, maya):
    _, auth = _saved_maya(client, maya, email="export@example.com")
    data = client.post("/v1/me/privacy/export", headers=auth).json()["data"]
    assert {"account", "consents", "billing", "staff_access", "health_profile", "events"} <= set(data)
    assert data["account"]["email"] == "export@example.com"
    pdf = client.post("/v1/me/privacy/export?format=pdf", headers=auth)
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")


def test_delete_needs_confirmation_then_removes_everything(client, maya, session):
    plan, auth = _saved_maya(client, maya, email="bye@example.com")
    buy(client, "full_report", "price_full_report_cad", "bye@example.com", plan["plan_id"])
    user_id = client.get("/v1/me", headers=auth).json()["id"]
    subject_id = session.get(User, user_id).subject_id
    assert client.post("/v1/me/privacy/delete", json={}, headers=auth).status_code == 400
    out = client.post("/v1/me/privacy/delete", json={"confirm": True}, headers=auth).json()
    assert out["deleted"] is True and "billing records (tax law)" in out["kept"]
    session.expire_all()
    u = session.get(User, user_id)
    assert u.status == "deleted" and u.email_hash == f"deleted:{user_id}"
    assert session.get(Subject, subject_id).wrapped_dek is None
    assert client.get("/v1/me", headers=auth).status_code == 401  # old tokens stop working
    # Signing in again with the same email starts a fresh, empty account.
    again = login(client, "bye@example.com")
    me = client.get("/v1/me", headers=again).json()
    assert me["id"] != user_id and me["has_profile"] is False


def test_staff_reveal_is_logged_and_visible_to_the_user(client, maya):
    _, auth = _saved_maya(client, maya, email="reveal@example.com")
    uid = client.get("/v1/me", headers=auth).json()["id"]
    sup = admin_login(client, "support@stacksense.dev")
    rec = client.get(f"/admin/v1/users/{uid}", headers=sup).json()
    assert rec["health_profile"]["masked"] is True and rec["purchases"] == []
    assert client.post(f"/admin/v1/users/{uid}/reveal", json={"reason": "x"}, headers=sup).status_code in (400, 422)
    full = client.post(f"/admin/v1/users/{uid}/reveal", json={"reason": "Ticket #4412: wrong dose shown"}, headers=sup).json()
    assert full["logged"] is True and "vegetarian" in full["health_profile"]["stable_facts"]["B3_diet"].lower()
    seen = client.get("/v1/me/privacy/history", headers=auth).json()["staff_access"]
    assert seen[0]["role"] == "support_agent" and "4412" in seen[0]["reason"]


# ---------------------------------------------------------------- admin scopes

PROBES = {
    "/admin/v1/staff": "staff.manage", "/admin/v1/audit": "audit.read", "/admin/v1/users?q=nobody": "users.read",
    "/admin/v1/privacy-requests": "privacy.queue", "/admin/v1/cohorts": "cohorts.read", "/admin/v1/engine/releases": "engine.read",
    "/admin/v1/engine/personas": "engine.simulate", "/admin/v1/catalog/products": "catalog.read", "/admin/v1/revenue/plans": "revenue.read",
    "/admin/v1/revenue/dashboards": "dashboards.read", "/admin/v1/ops/outbox": "settings.manage",
}
STAFF = {"super_admin": "admin", "clinical_editor": "editor", "clinical_reviewer": "pharmacist", "catalog_manager": "catalog",
         "revenue_manager": "revenue", "support_agent": "support", "analyst": "analyst"}


def test_every_role_sees_exactly_its_scopes(client):
    for role, who in STAFF.items():
        h = admin_login(client, f"{who}@stacksense.dev")
        scopes = ROLES[role]["scopes"]
        for path, scope in PROBES.items():
            code = client.get(path, headers=h).status_code
            assert (code == 200) == (scope in scopes), (role, path, code)
            if scope not in scopes:
                assert code == 403
    assert client.get("/admin/v1/engine/releases").status_code == 401


def test_cohorts_suppress_small_counts(client, maya):
    _saved_maya(client, maya, email="cohort@example.com")
    out = client.get("/admin/v1/cohorts", headers=admin_login(client, "analyst@stacksense.dev")).json()
    for key in ("by_stack_item", "by_goal", "by_exclusion"):
        assert out[key]
        for v in out[key].values():
            assert v == "<5" or v >= 5  # small cells are suppressed


# ---------------------------------------------------------------- release workflow


TIP = {"id": "tip_test_light", "area": "sleep", "when": "signals.sleep_onset >= 0.6", "title": "Dim screens after 10pm",
       "text": "Bright light late in the evening delays sleep onset.", "source": "Chang et al., PNAS 2015"}


def test_release_workflow_end_to_end(client, session):
    ed, ph, sa = (admin_login(client, f"{w}@stacksense.dev") for w in ("editor", "pharmacist", "admin"))
    live_version = client.get("/admin/v1/engine/knowledge", headers=ed).json()["version"]
    rel = client.post("/admin/v1/engine/releases", json={"kind": "rules", "notes": "Add a light tip"}, headers=ed).json()
    rid = rel["id"]
    assert rel["status"] == "draft" and rel["base_version"] == live_version
    # Every knowledge row needs a citation.
    nosrc = {**TIP, "source": ""}
    r = client.patch(f"/admin/v1/engine/releases/{rid}", json={"ops": [{"op": "upsert", "table": "tips", "row": nosrc}]}, headers=ed)
    assert r.status_code == 400 and r.json()["error"]["code"] == "source_required"
    client.patch(f"/admin/v1/engine/releases/{rid}", json={"ops": [{"op": "upsert", "table": "tips", "row": TIP}], "reason": "Evidence review 2026-10"}, headers=ed)
    # Can't skip automated checks, and the editor can't approve.
    assert client.post(f"/admin/v1/engine/releases/{rid}/submit", headers=ed).status_code == 409
    chk = client.post(f"/admin/v1/engine/releases/{rid}/check", headers=ed).json()
    assert chk["status"] == "checks_passed" and chk["check_report"]["personas"]["passed"]
    assert client.post(f"/admin/v1/engine/releases/{rid}/submit", headers=ed).json()["status"] == "in_review"
    assert client.post(f"/admin/v1/engine/releases/{rid}/review", json={"approve": True}, headers=ed).status_code == 403
    # Super admin can't publish without a clinical approver.
    assert client.post(f"/admin/v1/engine/releases/{rid}/publish", json={"rollout_pct": 100}, headers=sa).status_code == 409
    appr = client.post(f"/admin/v1/engine/releases/{rid}/review", json={"approve": True, "notes": "Citation checked"}, headers=ph).json()
    assert appr["status"] == "approved" and appr["reviewer"]
    data = client.get(f"/admin/v1/engine/releases/{rid}", headers=ph).json()["data"]
    assert next(t for t in data["tips"] if t["id"] == "tip_test_light")["reviewed_by"] == appr["reviewer"]
    sim = client.post("/admin/v1/engine/simulator", json={"release_id": rid, "persona_id": "maya"}, headers=ed).json()
    assert sim["live"]["stack"] == sim["draft"]["stack"]
    pub = client.post(f"/admin/v1/engine/releases/{rid}/publish", json={"rollout_pct": 100}, headers=ph).json()
    assert pub["status"] == "published"
    assert client.get("/admin/v1/engine/knowledge", headers=ed).json()["version"] == rel["version"]
    assert client.get("/v1/meta").json()["rules_version"] == rel["version"]
    rb = client.post(f"/admin/v1/engine/releases/{rid}/rollback", json={"reason": "Test rollback"}, headers=ph).json()
    assert rb["status"] == "rolled_back"
    assert client.get("/admin/v1/engine/knowledge", headers=ed).json()["version"] == live_version
    # Every write is in the append-only audit log, with its actor.
    actions = [a.action for a in session.scalars(select(AuditLog).where(AuditLog.target_id == rid).order_by(AuditLog.id)).all()]
    for a in ("release.create", "release.edit", "release.check", "release.submit", "release.approve", "release.simulate", "release.publish", "release.rollback"):
        assert a in actions, a
    export = client.get("/admin/v1/audit/export", headers=sa)
    assert export.status_code == 200 and "release.publish" in export.text


def test_audit_log_is_append_only_in_the_database(client, session):
    import sqlalchemy.exc

    admin_login(client, "admin@stacksense.dev")
    client.post("/admin/v1/engine/releases", json={"kind": "rules"}, headers=admin_login(client, "editor@stacksense.dev"))
    row = session.scalar(select(AuditLog).limit(1))
    assert row is not None
    for stmt in (sqlalchemy.update(AuditLog).values(reason="x"), sqlalchemy.delete(AuditLog)):
        with pytest.raises(sqlalchemy.exc.DatabaseError, match="append-only"):
            session.execute(stmt)
        session.rollback()


def test_unsafe_edit_fails_checks_and_cannot_be_submitted(client):
    ed = admin_login(client, "editor@stacksense.dev")
    rid = client.post("/admin/v1/engine/releases", json={"kind": "rules"}, headers=ed).json()["id"]
    kb = client.get(f"/admin/v1/engine/releases/{rid}", headers=ed).json()["data"]
    sjw = next(c["id"] for c in kb["contraindications"] if c["ingredient_id"] == "st_johns_wort" and c["code"] == "hormonal_contraceptive")
    client.patch(f"/admin/v1/engine/releases/{rid}", json={"ops": [{"op": "delete", "table": "contraindications", "id": sjw}]}, headers=ed)
    chk = client.post(f"/admin/v1/engine/releases/{rid}/check", headers=ed).json()
    assert chk["status"] == "checks_failed"
    failures = [p for p in chk["check_report"]["personas"]["results"] if not p["passed"]]
    assert any(p["persona"] == "maya" for p in failures)  # the golden persona catches the removed safety rule
    assert client.post(f"/admin/v1/engine/releases/{rid}/submit", headers=ed).status_code == 409


def test_partial_rollout_buckets_by_subject():
    from stacksense import registry

    buckets = [registry._bucket(f"subj_{i}") for i in range(400)]
    assert all(0 <= b < 100 for b in buckets)
    share = sum(1 for b in buckets if b < 20) / len(buckets)
    assert 0.12 < share < 0.28
    assert registry._bucket("subj_x") == registry._bucket("subj_x")


# ---------------------------------------------------------------- worker jobs


def test_retention_erases_abandoned_anonymous_sessions(client, maya, session):
    from stacksense.worker import job_retention

    stale = client.post("/v1/intake/sessions", json={}).json()
    _saved_maya(client, maya, email="keep@example.com")
    with session_scope() as db:
        s = db.get(IntakeSession, stale["session_id"])
        old = utcnow() - timedelta(days=31)
        s.updated_at = old
        db.get(Subject, s.subject_id).created_at = old
        for subj in db.scalars(select(Subject)).all():
            if subj.id != s.subject_id:
                subj.created_at = old  # linked subjects are old too, but must survive
        stale_subject = s.subject_id
    with session_scope() as db:
        out = job_retention(db)
    assert out["anonymous_subjects_erased"] >= 1
    session.expire_all()
    assert session.get(Subject, stale_subject).wrapped_dek is None
    linked = session.scalars(select(User.subject_id).where(User.subject_id.is_not(None))).all()
    assert linked and all(session.get(Subject, sid).wrapped_dek for sid in linked)


def test_reminders_queue_only_with_consent_and_entitlement(client, maya):
    from stacksense.worker import job_deliver_outbox, job_reminders

    plan, auth = _saved_maya(client, maya, email="remind@example.com")
    buy(client, "plus", "price_plus_month_cad", "remind@example.com", plan["plan_id"])
    with session_scope() as db:
        assert job_reminders(db, today=date(2026, 10, 20))["queued"] == 0  # no reminders consent yet
    client.put("/v1/me/consents/reminders", json={"granted": True}, headers=auth)
    client.post("/v1/me/push-subscriptions", json={"endpoint": "https://push.example/1", "keys": {"p256dh": "x", "auth": "y"}}, headers=auth)
    with session_scope() as db:
        first = job_reminders(db, today=date(2026, 10, 20))["queued"]
    with session_scope() as db:
        again = job_reminders(db, today=date(2026, 10, 20))["queued"]
    assert first >= 3 and again == 0  # one per slot, deduplicated on re-runs
    with session_scope() as db:
        rows = db.scalars(select(Outbox).where(Outbox.template == "dose_reminder")).all()
        for r in rows:
            r.scheduled_for = utcnow() - timedelta(minutes=1)
    with session_scope() as db:
        assert job_deliver_outbox(db)["sent"] >= first
    # Withdrawing reminders cancels anything still pending.
    with session_scope() as db:
        job_reminders(db, today=date(2026, 10, 21))
    client.put("/v1/me/consents/reminders", json={"granted": False}, headers=auth)
    with session_scope() as db:
        assert not db.scalars(select(Outbox).where(Outbox.template == "dose_reminder", Outbox.status == "pending")).all()


def test_consent_enforcement_job_is_a_safety_net(client, maya, session):
    from stacksense.modules.profile.consent import ConsentService
    from stacksense.worker import job_consent_enforcement

    _, auth = _saved_maya(client, maya, email="net@example.com")
    uid = client.get("/v1/me", headers=auth).json()["id"]
    subject_id = session.get(User, uid).subject_id
    with session_scope() as db:
        ConsentService(db).record(uid, "profile_storage", False)  # recorded outside the API: not yet enforced
    with session_scope() as db:
        assert job_consent_enforcement(db)["enforced"] >= 1
    session.expire_all()
    assert session.get(User, uid).subject_id is None and session.get(Subject, subject_id).wrapped_dek is None
