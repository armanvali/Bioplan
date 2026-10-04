"""Consent ledger (section 14.1). Every grant or withdrawal is appended; services read
consent through one check, ``ConsentService.allows(user_id, purpose)``."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from stacksense.core import crypto
from stacksense.core.errors import DomainError
from stacksense.db import utcnow
from stacksense.modules.profile.models import Consent

POLICY_VERSION = "2026-10"


@dataclass(frozen=True)
class Purpose:
    key: str
    label: str
    text: str
    default: bool
    asked_when: str
    if_withdrawn: str


PURPOSES: dict[str, Purpose] = {
    p.key: p
    for p in [
        Purpose("profile_storage", "Save my health profile",
                "Keep my answers, lab values, plans and dose logs in my StackSense account so I can come back to them.",
                False, "When saving results", "Your account health data is deleted. Billing records are kept as tax law requires."),
        Purpose("personalisation", "Personalise my next plan",
                "Use my saved history to shorten future intakes and tailor my plans (for example, what worked and what didn't).",
                False, "With profile storage, as a separate box", "Future plans are built from the current session only."),
        Purpose("reminders", "Reminders",
                "Send push and email reminders for doses, refills and check-ins.",
                False, "When the calendar is first opened", "Reminders stop."),
        Purpose("research", "Help improve StackSense",
                "Use a de-identified copy of my data (no name, email or free text; dates shifted, ages banded) to improve the scoring models.",
                False, "Off; explicit opt-in", "You're excluded from future training sets."),
        Purpose("marketing", "Product news",
                "Email me product news and offers.",
                False, "Off; explicit opt-in", "You're unsubscribed."),
    ]
}


def text_hash(purpose: str) -> str:
    p = PURPOSES[purpose]
    return crypto.sha256_text(f"{POLICY_VERSION}|{p.key}|{p.text}")


class ConsentService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def latest(self, user_id: str) -> dict[str, Consent]:
        rows = self.db.scalars(select(Consent).where(Consent.user_id == user_id).order_by(Consent.ts, Consent.id)).all()
        out: dict[str, Consent] = {}
        for r in rows:
            out[r.purpose] = r
        return out

    def allows(self, user_id: str | None, purpose: str) -> bool:
        if not user_id:
            return False
        row = self.latest(user_id).get(purpose)
        return bool(row and row.granted)

    def record(self, user_id: str, purpose: str, granted: bool, method: str = "settings", actor: str = "user", policy_version: str | None = None) -> Consent:
        if purpose not in PURPOSES:
            raise DomainError("unknown_purpose", f"Unknown consent purpose {purpose}")
        if method not in ("checkbox", "settings", "support"):
            raise DomainError("bad_method", "method must be checkbox, settings or support")
        if purpose == "personalisation" and granted and not self.allows(user_id, "profile_storage"):
            raise DomainError("needs_profile_storage", "Personalisation needs profile storage first")
        row = Consent(
            user_id=user_id, purpose=purpose, granted=granted, policy_version=policy_version or POLICY_VERSION,
            text_hash=text_hash(purpose), method=method, actor=actor, ts=utcnow(),
        )
        self.db.add(row)
        # Withdrawing storage implies withdrawing personalisation.
        if purpose == "profile_storage" and not granted and self.allows(user_id, "personalisation"):
            self.db.flush()
            self.db.add(Consent(user_id=user_id, purpose="personalisation", granted=False, policy_version=POLICY_VERSION,
                                text_hash=text_hash("personalisation"), method=method, actor=actor, ts=utcnow()))
        self.db.flush()
        return row

    def summary(self, user_id: str) -> list[dict[str, Any]]:
        latest = self.latest(user_id)
        out = []
        for key, p in PURPOSES.items():
            row = latest.get(key)
            out.append({
                "purpose": key, "label": p.label, "text": p.text, "granted": bool(row and row.granted),
                "policy_version": row.policy_version if row else POLICY_VERSION, "updated_at": row.ts.isoformat() if row else None,
                "method": row.method if row else None, "if_withdrawn": p.if_withdrawn, "asked_when": p.asked_when,
            })
        return out

    def history(self, user_id: str) -> list[dict[str, Any]]:
        rows = self.db.scalars(select(Consent).where(Consent.user_id == user_id).order_by(Consent.ts.desc(), Consent.id.desc())).all()
        return [
            {"purpose": r.purpose, "granted": r.granted, "method": r.method, "actor": r.actor, "policy_version": r.policy_version, "ts": r.ts.isoformat()}
            for r in rows
        ]
