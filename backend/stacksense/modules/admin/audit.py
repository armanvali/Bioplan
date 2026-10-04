"""Append-only audit log: every admin write and every staff data access (section 15)."""

from __future__ import annotations

import csv
import io
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from stacksense.db import utcnow
from stacksense.modules.admin.models import AuditLog


def audit(
    db: Session, actor: str, role: str, action: str, target_type: str, target_id: str | None,
    before: dict[str, Any] | None = None, after: dict[str, Any] | None = None, reason: str | None = None,
) -> AuditLog:
    row = AuditLog(actor=actor, role=role, action=action, target_type=target_type, target_id=target_id, before=before, after=after, reason=reason, ts=utcnow())
    db.add(row)
    db.flush()
    return row


def query(db: Session, *, actor: str | None = None, action: str | None = None, target_id: str | None = None, limit: int = 200) -> list[dict[str, Any]]:
    stmt = select(AuditLog).order_by(AuditLog.ts.desc(), AuditLog.id.desc()).limit(min(limit, 1000))
    if actor:
        stmt = stmt.where(AuditLog.actor == actor)
    if action:
        stmt = stmt.where(AuditLog.action.like(f"{action}%"))
    if target_id:
        stmt = stmt.where(AuditLog.target_id == target_id)
    return [as_dict(r) for r in db.scalars(stmt).all()]


def as_dict(r: AuditLog) -> dict[str, Any]:
    return {
        "id": r.id, "actor": r.actor, "role": r.role, "action": r.action, "target_type": r.target_type, "target_id": r.target_id,
        "before": r.before, "after": r.after, "reason": r.reason, "ts": r.ts.isoformat(),
    }


def export_csv(db: Session) -> str:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["id", "ts", "actor", "role", "action", "target_type", "target_id", "reason", "before", "after"])
    for r in db.scalars(select(AuditLog).order_by(AuditLog.id)).all():
        w.writerow([r.id, r.ts.isoformat(), r.actor, r.role, r.action, r.target_type, r.target_id or "", r.reason or "", r.before or "", r.after or ""])
    return buf.getvalue()
