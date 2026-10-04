"""Job worker: retention, consent enforcement, personalisation features, reminders,
link health, experiment guardrails and outbox delivery.

    stacksense-worker            # run forever (each job on its own interval)
    stacksense-worker --once     # run every job once and exit (cron / CI)
    stacksense-worker --job NAME # run one job

Jobs are idempotent, so running them twice (or from two workers) is safe.
"""

from __future__ import annotations

import argparse
import logging
import time
from collections.abc import Callable
from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from stacksense.config import get_settings
from stacksense.db import session_scope, utcnow

log = logging.getLogger("stacksense.worker")


def job_deliver_outbox(db: Session) -> dict[str, Any]:
    from stacksense.modules.notify.service import NotifyService

    return NotifyService(db).deliver_due()


def job_retention(db: Session) -> dict[str, Any]:
    """Abandoned anonymous sessions are deleted after 30 days; click logs keep only hashes."""
    from stacksense.modules.identity.models import User
    from stacksense.modules.profile.models import IntakeSession, Subject
    from stacksense.modules.profile.service import ProfileService

    cutoff = utcnow() - timedelta(days=get_settings().anonymous_retention_days)
    linked = set(db.scalars(select(User.subject_id).where(User.subject_id.is_not(None))).all())
    removed = 0
    for subj in db.scalars(select(Subject).where(Subject.anonymous.is_(True), Subject.created_at < cutoff, Subject.deleted_at.is_(None))).all():
        if subj.id in linked:
            continue
        last = db.scalar(select(IntakeSession.updated_at).where(IntakeSession.subject_id == subj.id).order_by(IntakeSession.updated_at.desc()))
        if last and last > cutoff:
            continue
        ProfileService(db).erase_health(subj.id)
        removed += 1
    # Inactive accounts: deleted at 36 months unless renewed (reminder at 24 handled by notify templates).
    return {"anonymous_subjects_erased": removed}


def job_consent_enforcement(db: Session) -> dict[str, Any]:
    """Safety net: withdrawals take effect immediately in the API; this guarantees < 24 h."""
    from stacksense.modules.identity.models import User
    from stacksense.modules.notify.service import NotifyService
    from stacksense.modules.profile.consent import ConsentService
    from stacksense.modules.profile.models import Consent
    from stacksense.modules.profile.service import ProfileService

    enforced = 0
    pending = db.scalars(select(Consent).where(Consent.granted.is_(False), Consent.enforced_at.is_(None))).all()
    cs = ConsentService(db)
    for row in pending:
        user = db.get(User, row.user_id)
        if user is None:
            continue
        if cs.allows(user.id, row.purpose):
            row.enforced_at = utcnow()  # re-granted since
            continue
        if row.purpose == "profile_storage" and user.subject_id:
            ProfileService(db).erase_health(user.subject_id)
            user.subject_id = None
        if row.purpose == "reminders":
            NotifyService(db).cancel_reminders(user.id)
        row.enforced_at = utcnow()
        enforced += 1
    return {"enforced": enforced}


def job_user_features(db: Session) -> dict[str, Any]:
    """Nightly personalisation features, only for users with personalisation consent."""
    from stacksense.modules.identity.models import User
    from stacksense.modules.profile.consent import ConsentService
    from stacksense.modules.profile.service import ProfileService

    cs = ConsentService(db)
    n = 0
    for user in db.scalars(select(User).where(User.subject_id.is_not(None), User.status == "active")).all():
        if cs.allows(user.id, "personalisation"):
            try:
                ProfileService(db).compute_features(user.subject_id)  # type: ignore[arg-type]
                n += 1
            except Exception as e:  # noqa: BLE001 - one bad profile must not stop the batch
                log.warning("features failed for %s: %s", user.id, e)
    return {"computed": n}


def job_reminders(db: Session, today: date | None = None) -> dict[str, Any]:
    """Queue today's dose reminders and refill/check-in/lab nudges (reminders consent + entitlement)."""
    from zoneinfo import ZoneInfo

    from stacksense.modules.billing.entitlements import Entitlements
    from stacksense.modules.identity.models import PushSubscription, User
    from stacksense.modules.notify.service import NotifyService
    from stacksense.modules.plans.service import PlanService
    from stacksense.modules.profile.consent import ConsentService
    from stacksense.modules.profile.models import Plan

    cs, ent, notify = ConsentService(db), Entitlements(db), NotifyService(db)
    queued = 0
    for user in db.scalars(select(User).where(User.subject_id.is_not(None), User.status == "active")).all():
        if not cs.allows(user.id, "reminders") or "reminders" not in ent.features(user.id):
            continue
        plan = db.scalar(select(Plan).where(Plan.subject_id == user.subject_id, Plan.status == "active").order_by(Plan.created_at.desc()))
        if plan is None:
            continue
        subs = db.scalars(select(PushSubscription).where(PushSubscription.user_id == user.id, PushSubscription.active.is_(True))).all()
        schedule = PlanService(db).schedule_for(plan)
        tz = ZoneInfo(schedule.routine.tz)
        d = today or datetime.now(tz).date()
        day = schedule.day(d)
        for slot in day["slots"]:
            items = [i for i in slot["items"] if not i["off"]]
            if not items:
                continue
            at = datetime(d.year, d.month, d.day, tzinfo=tz) + timedelta(minutes=slot["minutes"])
            for sub in subs:
                if notify.enqueue(user.id, "push", "dose_reminder", {"subscription": {"endpoint": sub.endpoint, "keys": sub.keys}, "slot": slot["label"], "items": ", ".join(i["short"] for i in items), "cue": (slot["cues"] or [""])[0], "url": f"/plan/{plan.id}/calendar"},
                                  scheduled_for=at, dedupe_key=f"dose:{user.id}:{d}:{slot['id']}:{sub.id}"):
                    queued += 1
        for task in day["tasks"]:
            tpl = {"refill": "refill_reminder", "checkin": "checkin_reminder", "lab": "lab_reminder"}.get(task["type"])
            payload = {"item": task.get("ingredient_id"), "runout": task.get("sub"), "link": task.get("link"), "analyte": task.get("analyte")}
            if tpl and notify.enqueue(user.id, "email", tpl, payload, dedupe_key=f"task:{user.id}:{task['date']}:{task['type']}:{task.get('ingredient_id')}"):
                queued += 1
    return {"queued": queued}


def job_link_health(db: Session) -> dict[str, Any]:
    from stacksense.modules.admin.catalog_admin import run_link_health
    from stacksense.modules.plans.service import affiliate_tags

    return run_link_health(db, affiliate_tags())


def job_experiment_guardrails(db: Session) -> dict[str, Any]:
    from stacksense.modules.admin.revenue_admin import enforce_experiment_guardrails

    return {"stopped": enforce_experiment_guardrails(db)}


JOBS: dict[str, tuple[Callable[[Session], dict[str, Any]], int]] = {
    "deliver_outbox": (job_deliver_outbox, 60),
    "reminders": (job_reminders, 3600),
    "consent_enforcement": (job_consent_enforcement, 900),
    "retention": (job_retention, 86400),
    "user_features": (job_user_features, 86400),
    "link_health": (job_link_health, 86400),
    "experiment_guardrails": (job_experiment_guardrails, 3600),
}


def run_job(name: str) -> dict[str, Any]:
    from stacksense.modules.admin.models import JobRun

    fn, _ = JOBS[name]
    with session_scope() as db:
        result = fn(db)
        row = db.get(JobRun, name) or JobRun(name=name)
        row.last_run_at, row.status, row.detail = utcnow(), "ok", result
        db.merge(row)
    log.info("job %s -> %s", name, result)
    return result


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--job")
    args = parser.parse_args()
    if args.job:
        print(run_job(args.job))
        return
    if args.once:
        for name in JOBS:
            run_job(name)
        return
    last: dict[str, float] = {}
    while True:
        now = time.time()
        for name, (_, every) in JOBS.items():
            if now - last.get(name, 0) >= every:
                try:
                    run_job(name)
                except Exception:  # noqa: BLE001
                    log.exception("job %s failed", name)
                last[name] = now
        time.sleep(5)


if __name__ == "__main__":
    main()
