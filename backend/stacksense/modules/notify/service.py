"""Notifications: an outbox the worker drains (Web Push for the PWA, email digest).

Senders are pluggable. In dev everything goes to the log; with VAPID keys and
``pywebpush`` installed, push is delivered for real; with ``STACKSENSE_SMTP_URL``,
email goes out over SMTP. Reminders are only queued for users with ``reminders`` consent.
"""

from __future__ import annotations

import logging
import os
import smtplib
from datetime import datetime
from email.message import EmailMessage
from typing import Any, Protocol
from urllib.parse import urlparse

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from stacksense.config import get_settings
from stacksense.db import utcnow
from stacksense.modules.admin.models import Outbox

log = logging.getLogger("stacksense.notify")

TEMPLATES: dict[str, dict[str, str]] = {
    "magic_link": {"subject": "Your StackSense sign-in link", "body": "Tap to sign in: {link}\nThis link expires in 15 minutes."},
    "dose_reminder": {"title": "{slot}: {items}", "body": "{cue}"},
    "refill_reminder": {"title": "Refill {item}", "body": "Runs out {runout}. {link}"},
    "checkin_reminder": {"title": "60-second re-score", "body": "How are your goal areas this week?"},
    "lab_reminder": {"title": "Book your {analyte} test", "body": "Enter the result to unlock {item}."},
    "trial_ending": {"subject": "Your Plus trial ends in 2 days", "body": "You'll be charged {amount} on {date}. Cancel anytime in Account → Billing."},
    "renewal_notice": {"subject": "Your StackSense Plus renews soon", "body": "Renews {date} for {amount}. Manage it in Account → Billing."},
    "plan_updated": {"title": "Your plan has an update", "body": "We updated our rules. See what changed before you switch."},
    "privacy_export_ready": {"subject": "Your StackSense data export is ready", "body": "Download it from Account → Privacy."},
}


class Sender(Protocol):
    def send(self, row: Outbox) -> None: ...


class LogSender:
    def send(self, row: Outbox) -> None:
        payload = {k: v for k, v in row.payload.items() if not k.endswith("_enc")}
        log.info("notify channel=%s template=%s user=%s payload=%s", row.channel, row.template, row.user_id, payload)


class SmtpSender:
    def __init__(self, url: str) -> None:
        self.url = urlparse(url)

    def send(self, row: Outbox) -> None:
        from stacksense.modules.profile.keys import decrypt_identity

        to = row.payload.get("to") or (decrypt_identity(row.payload["to_enc"]) if row.payload.get("to_enc") else None)
        if not to:
            raise ValueError("email row without recipient")
        tpl = TEMPLATES[row.template]
        msg = EmailMessage()
        msg["From"] = os.environ.get("STACKSENSE_EMAIL_FROM", "StackSense <hello@stacksense.app>")
        msg["To"] = to
        msg["Subject"] = tpl.get("subject", "StackSense")
        msg.set_content(tpl["body"].format_map(_Safe(row.payload)))
        with smtplib.SMTP(self.url.hostname or "localhost", self.url.port or 587, timeout=10) as s:
            if self.url.scheme == "smtp+tls":
                s.starttls()
            if self.url.username:
                s.login(self.url.username, self.url.password or "")
            s.send_message(msg)


class WebPushSender:
    def __init__(self, private_key: str, subject: str) -> None:
        from pywebpush import webpush  # optional: pip install pywebpush

        self._webpush = webpush
        self.private_key = private_key
        self.subject = subject

    def send(self, row: Outbox) -> None:
        import json

        sub = row.payload["subscription"]
        tpl = TEMPLATES[row.template]
        data = {"title": tpl.get("title", "StackSense").format_map(_Safe(row.payload)), "body": tpl["body"].format_map(_Safe(row.payload)), "url": row.payload.get("url", "/")}
        self._webpush(subscription_info=sub, data=json.dumps(data), vapid_private_key=self.private_key, vapid_claims={"sub": self.subject})


class _Safe(dict):
    def __missing__(self, key: str) -> str:
        return ""


class NotifyService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def enqueue(self, user_id: str | None, channel: str, template: str, payload: dict[str, Any], scheduled_for: datetime | None = None, dedupe_key: str | None = None) -> Outbox | None:
        if template not in TEMPLATES:
            raise ValueError(f"unknown template {template}")
        if dedupe_key and self.db.scalar(select(Outbox).where(Outbox.dedupe_key == dedupe_key)):
            return None
        row = Outbox(user_id=user_id, channel=channel, template=template, payload=payload, scheduled_for=scheduled_for or utcnow(), dedupe_key=dedupe_key)
        self.db.add(row)
        try:
            with self.db.begin_nested():
                self.db.flush()
        except IntegrityError:
            return None
        return row

    def cancel_reminders(self, user_id: str) -> int:
        rows = self.db.scalars(select(Outbox).where(Outbox.user_id == user_id, Outbox.status == "pending", Outbox.template.in_(["dose_reminder", "refill_reminder", "checkin_reminder", "lab_reminder"]))).all()
        for r in rows:
            r.status = "cancelled"
        return len(rows)

    def deliver_due(self, limit: int = 200) -> dict[str, int]:
        settings = get_settings()
        senders: dict[str, Sender] = {"push": LogSender(), "email": LogSender()}
        smtp = os.environ.get("STACKSENSE_SMTP_URL")
        if smtp:
            senders["email"] = SmtpSender(smtp)
        if settings.vapid_private_key:
            try:
                senders["push"] = WebPushSender(settings.vapid_private_key, "mailto:ops@stacksense.app")
            except ImportError:
                log.warning("VAPID key set but pywebpush isn't installed; push goes to the log")
        due = self.db.scalars(select(Outbox).where(Outbox.status == "pending", Outbox.scheduled_for <= utcnow()).order_by(Outbox.scheduled_for).limit(limit)).all()
        counts = {"sent": 0, "failed": 0}
        for row in due:
            try:
                senders[row.channel].send(row)
                row.status, row.sent_at = "sent", utcnow()
                counts["sent"] += 1
            except Exception as e:  # noqa: BLE001 - delivery errors are recorded, never raised
                row.status, row.error = "failed", str(e)[:500]
                counts["failed"] += 1
        return counts
