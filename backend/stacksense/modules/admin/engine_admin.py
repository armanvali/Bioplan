"""Recommendation-engine workspace (section 15.3): question graph and knowledge editors,
release workflow, simulator and change-impact reports.

Draft -> Automated checks (schema, graph checks, golden personas) -> Clinical review ->
Approved -> Published to a % of new plans -> 100%. One-click rollback. Existing plans are
never silently changed.
"""

from __future__ import annotations

import copy
import json
import re
from typing import Any

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from stacksense import registry
from stacksense.core.errors import Conflict, DomainError, Forbidden, NotFound
from stacksense.core.ids import new_id
from stacksense.db import utcnow
from stacksense.knowledge.base import KnowledgeBase
from stacksense.knowledge.models import KnowledgeData
from stacksense.modules.admin.audit import audit
from stacksense.modules.admin.models import AdminUser, Release
from stacksense.modules.intake.graph import Graph, GraphData
from stacksense.personas import load_personas, run_persona, run_suite

KEY_FIELDS = {"areas": "id", "goals": "id", "signals": "id", "ingredients": "id", "evidence_claims": "id", "dose_bands": "id",
              "upper_limits": "id", "contraindications": "id", "interactions": "id", "timing_rules": "ingredient_id",
              "drugs": "id", "lab_analytes": "id", "restricted_libraries": "id", "tips": "id", "nodes": "id"}


def _bump(version: str) -> str:
    m = re.match(r"^(.*?)(\d+)$", version)
    return f"{m.group(1)}{int(m.group(2)) + 1}" if m else f"{version}.1"


class EngineAdmin:
    def __init__(self, db: Session, actor: AdminUser) -> None:
        self.db = db
        self.actor = actor

    def _audit(self, action: str, target: str | None, before: Any = None, after: Any = None, reason: str | None = None) -> None:
        audit(self.db, self.actor.id, self.actor.role, action, "release", target, before, after, reason)

    # ------------------------------------------------------------------ reads
    def live(self, kind: str) -> dict[str, Any]:
        if kind == "rules":
            kb = registry.live_kb(self.db)
            return {"version": kb.version, "data": json.loads(kb.data.model_dump_json())}
        g = registry.live_graph(self.db)
        return {"version": g.version, "data": json.loads(g.data.model_dump_json(by_alias=True)), "check": g.check(registry.live_kb(self.db))}

    def list(self, kind: str | None = None) -> list[dict[str, Any]]:
        stmt = select(Release).order_by(Release.created_at.desc())
        if kind:
            stmt = stmt.where(Release.kind == kind)
        return [self.summary(r) for r in self.db.scalars(stmt).all()]

    def summary(self, r: Release) -> dict[str, Any]:
        return {
            "id": r.id, "kind": r.kind, "version": r.version, "base_version": r.base_version, "status": r.status, "author": r.author,
            "reviewer": r.reviewer, "rollout_pct": r.rollout_pct, "notes": r.notes, "check_report": r.check_report,
            "created_at": r.created_at.isoformat(), "published_at": r.published_at.isoformat() if r.published_at else None,
        }

    def get(self, release_id: str) -> Release:
        r = self.db.get(Release, release_id)
        if r is None:
            raise NotFound("unknown_release", "Release not found")
        return r

    # ------------------------------------------------------------------ drafting
    def create_draft(self, kind: str, notes: str | None = None, data: dict[str, Any] | None = None) -> Release:
        if kind not in ("rules", "graph"):
            raise DomainError("bad_kind", "kind must be rules or graph")
        live = self.live(kind)
        base = live["data"] if data is None else data
        version = _bump(live["version"])
        while self.db.scalar(select(Release).where(Release.kind == kind, Release.version == version)):
            version = _bump(version)
        base = copy.deepcopy(base)
        base["version"] = version
        r = Release(id=new_id("rel"), kind=kind, version=version, base_version=live["version"], status="draft", data=base, author=self.actor.id, notes=notes)
        self.db.add(r)
        self.db.flush()
        self._audit("release.create", r.id, None, {"kind": kind, "version": version})
        return r

    def edit(self, release_id: str, ops: list[dict[str, Any]], reason: str | None = None) -> Release:
        """Row-level edits: {"op": "upsert"|"delete", "table": ..., "row": {...} | "id": ...}
        or {"op": "set_param", "key": ..., "value": ...}. Every knowledge row needs a source."""
        r = self.get(release_id)
        if r.status not in ("draft", "checks_failed", "checks_passed", "rejected"):
            raise Conflict("not_editable", f"Release is {r.status}; create a new draft")
        data = copy.deepcopy(r.data)
        before_snapshot: list[Any] = []
        for op in ops:
            kind = op.get("op")
            if kind == "set_param":
                data.setdefault("params", {})[op["key"]] = op["value"]
                continue
            table = op.get("table")
            allowed = {"nodes"} if r.kind == "graph" else set(KnowledgeData.TABLES)
            if table not in allowed:
                raise DomainError("bad_table", f"Can't edit {table} in a {r.kind} release")
            key = KEY_FIELDS[table]
            rows = data.setdefault(table, [])
            if kind == "upsert":
                row = op["row"]
                if r.kind == "rules" and not row.get("source"):
                    raise DomainError("source_required", "Every knowledge row needs a source citation")
                row.setdefault("reviewed_by", None)
                row.setdefault("reviewed_at", None)
                idx = next((i for i, x in enumerate(rows) if x.get(key) == row.get(key)), None)
                before_snapshot.append(rows[idx] if idx is not None else None)
                if idx is None:
                    rows.append(row)
                else:
                    rows[idx] = row
            elif kind == "delete":
                idx = next((i for i, x in enumerate(rows) if x.get(key) == op["id"]), None)
                if idx is None:
                    raise NotFound("unknown_row", f"No {table} row {op['id']}")
                before_snapshot.append(rows.pop(idx))
            else:
                raise DomainError("bad_op", "op must be upsert, delete or set_param")
        try:
            (KnowledgeData if r.kind == "rules" else GraphData)(**data)
        except ValidationError as e:
            raise DomainError("schema_error", "Edit doesn't match the schema", errors=json.loads(e.json())[:10]) from e
        r.data = data
        r.status = "draft"
        r.check_report = {}
        self._audit("release.edit", r.id, {"rows": before_snapshot}, {"ops": ops}, reason)
        return r

    # ------------------------------------------------------------------ automated checks
    def _pair(self, r: Release) -> tuple[Graph, KnowledgeBase]:
        if r.kind == "rules":
            return registry.live_graph(self.db), KnowledgeBase(KnowledgeData(**r.data))
        return Graph(GraphData(**r.data)), registry.live_kb(self.db)

    def check(self, release_id: str) -> Release:
        r = self.get(release_id)
        report: dict[str, Any] = {"ran_at": utcnow().isoformat()}
        try:
            graph, kb = self._pair(r)
        except ValidationError as e:
            report.update({"passed": False, "schema": json.loads(e.json())[:20]})
            r.check_report, r.status = report, "checks_failed"
            return r
        report["knowledge"] = kb.validate()
        report["graph"] = graph.check(kb)
        report["personas"] = run_suite(graph, kb)
        report["unreviewed_rows"] = sum(
            1 for t in KnowledgeData.TABLES for row in r.data.get(t, []) if not row.get("reviewed_by") or row.get("reviewed_by") == "pending-clinical-review"
        ) if r.kind == "rules" else 0
        report["passed"] = not report["knowledge"] and not report["graph"]["errors"] and report["personas"]["passed"]
        r.check_report = report
        r.status = "checks_passed" if report["passed"] else "checks_failed"
        self._audit("release.check", r.id, None, {"passed": report["passed"]})
        return r

    def submit(self, release_id: str) -> Release:
        r = self.get(release_id)
        if r.status != "checks_passed":
            raise Conflict("checks_required", "Automated checks must pass before clinical review")
        r.status, r.submitted_at = "in_review", utcnow()
        self._audit("release.submit", r.id)
        return r

    def review(self, release_id: str, approve: bool, notes: str | None) -> Release:
        r = self.get(release_id)
        if r.status != "in_review":
            raise Conflict("not_in_review", "Release isn't waiting for review")
        if r.author == self.actor.id:
            raise Forbidden("self_review", "You can't approve your own changes")
        r.reviewer, r.reviewed_at = self.actor.id, utcnow()
        r.status = "approved" if approve else "rejected"
        if notes:
            r.notes = ((r.notes or "") + f"\n[review] {notes}").strip()
        if approve and r.kind == "rules":
            # Stamp the clinical sign-off onto every row this release carries.
            for t in KnowledgeData.TABLES:
                for row in r.data.get(t, []):
                    row["reviewed_by"], row["reviewed_at"] = self.actor.id, r.reviewed_at.date().isoformat()
            r.data = copy.deepcopy(r.data)
        self._audit("release.approve" if approve else "release.reject", r.id, None, {"notes": notes})
        return r

    def publish(self, release_id: str, rollout_pct: int) -> Release:
        r = self.get(release_id)
        if r.status not in ("approved", "published"):
            raise Conflict("not_approved", "Only clinically approved releases can be published")
        if not r.reviewer:
            raise Forbidden("no_approver", "A clinical approver is required")
        if not 1 <= rollout_pct <= 100:
            raise DomainError("bad_rollout", "rollout_pct must be 1-100")
        before = {"status": r.status, "rollout_pct": r.rollout_pct}
        r.status, r.rollout_pct = "published", rollout_pct
        r.published_at = r.published_at or utcnow()
        registry.clear_caches()
        self._audit("release.publish", r.id, before, {"rollout_pct": rollout_pct})
        return r

    def rollback(self, release_id: str, reason: str) -> Release:
        r = self.get(release_id)
        if r.status != "published":
            raise Conflict("not_published", "Only published releases can be rolled back")
        r.status = "rolled_back"
        registry.clear_caches()
        self._audit("release.rollback", r.id, {"status": "published"}, {"status": "rolled_back"}, reason)
        return r

    # ------------------------------------------------------------------ simulator + impact
    def simulate(self, release_id: str, persona_id: str | None = None, answers: dict[str, Any] | None = None, labs: list[dict[str, Any]] | None = None) -> dict[str, Any]:
        from stacksense.modules.plans.service import diff_results

        r = self.get(release_id)
        if persona_id:
            persona = next((p for p in load_personas() if p["id"] == persona_id), None)
            if persona is None:
                raise NotFound("unknown_persona", "Unknown persona")
        elif answers:
            persona = {"id": "custom", "answers": answers, "labs": labs or [], "context_date": utcnow().date().isoformat()}
        else:
            raise DomainError("persona_required", "Pick a persona or provide answers")
        draft_graph, draft_kb = self._pair(r)
        live_run = run_persona(persona, registry.live_graph(self.db), registry.live_kb(self.db), strict=False)
        draft_run = run_persona(persona, draft_graph, draft_kb, strict=False)

        def brief(run: Any) -> dict[str, Any]:
            res = run.result
            return {
                "asked": run.asked, "stops": run.stops, "terminal_stop": run.terminal_stop,
                "stack": [{"ingredient_id": it["ingredient_id"], "dose": it["dose_label"], "frequency": it["frequency_text"]} for it in (res or {}).get("items", [])],
                "excluded": [{"ingredient_id": e["ingredient_id"], "reason": e["reason"]} for e in (res or {}).get("excluded", [])],
                "locked": [x["ingredient_id"] for x in (res or {}).get("locked", [])],
                "monthly_cost": (res or {}).get("totals", {}).get("monthly_cost"),
            }

        diff = diff_results(live_run.result, draft_run.result) if live_run.result and draft_run.result else None
        self._audit("release.simulate", r.id, None, {"persona": persona["id"]})
        return {"persona": persona["id"], "live": brief(live_run), "draft": brief(draft_run), "diff": diff}

    def impact_report(self, release_id: str, limit: int = 500) -> dict[str, Any]:
        """How many existing active plans would change, by how much, and which safety rules are touched."""
        from stacksense.modules.plans.service import PlanService, diff_results
        from stacksense.modules.profile.models import Plan
        from stacksense.modules.rules.engine import RulesEngine

        r = self.get(release_id)
        if r.kind != "rules":
            return {"note": "Graph changes affect new intakes only; existing plans are unchanged.", "plans_checked": 0}
        kb = KnowledgeBase(KnowledgeData(**r.data))
        ps = PlanService(self.db)
        checked = changed = safety = 0
        examples = []
        for plan in self.db.scalars(select(Plan).where(Plan.status == "active").limit(limit)).all():
            try:
                old = ps.result(plan)
                new = RulesEngine(kb).build(ps.inputs(plan))
            except Exception:  # noqa: BLE001 - shredded or unreadable plans are skipped
                continue
            checked += 1
            d = diff_results(old, new)
            if d["changed"]:
                changed += 1
                if d["exclusions_added"] or d["exclusions_removed"] or d["locks_added"] or d["locks_removed"]:
                    safety += 1
                if len(examples) < 10:
                    examples.append({"plan_id": plan.id, **{k: d[k] for k in ("added", "removed", "dose_changes", "exclusions_added", "exclusions_removed")}})
        return {"plans_checked": checked, "plans_changed": changed, "safety_changes": safety, "examples": examples,
                "policy": "Existing plans are never silently changed; affected users get a 'your plan has an update' notice."}
