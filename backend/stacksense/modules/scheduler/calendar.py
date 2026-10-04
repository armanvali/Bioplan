"""Dosage scheduling and calendar engine (section 6).

Turns a plan's items into dated dose events:
  1. expand each item into daily dose units (frequency, cycles)
  2. assign units to slots (``solver.assign``)
  3. apply the ramp-up order -- lowest side-effect risk first, 1-2 items every 3 days,
     never starting something new on an event day
  4. lay cycles and events over the dates; add check-in tasks (weeks 2, 4, 8) and lab
     tasks for locked items
  5. refill dates: runout = start + days until the bottle's servings are used;
     reminder 5 days earlier, carrying the product's affiliate link

Everything is local wall-clock time + an IANA zone, so DST never moves a dose.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any

from stacksense.modules.scheduler import ics
from stacksense.modules.scheduler.solver import SLOT_LABELS, Assignment, Routine, SchedItem, assign

DAY_IDS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
RRULE_DAYS = {"mo": "MO", "tu": "TU", "we": "WE", "th": "TH", "fr": "FR", "sa": "SA", "su": "SU"}
WEEKDAY_NUM = {"mo": 0, "tu": 1, "we": 2, "th": 3, "fr": 4, "sa": 5, "su": 6}
CHECKIN_DAYS = (14, 28, 56)
EVENT_NAMES = {"5k": "5K race", "10k": "10K race", "half": "Half-marathon", "full": "Marathon", "other": "Event"}


@dataclass
class ScheduleSettings:
    start_date: date
    ramp_interval_days: int = 3
    low_risk_per_step: int = 2
    refill_lead_days: int = 5
    soft_pill_cap: int = 4
    horizon_days: int = 365


@dataclass
class ItemSchedule:
    id: str
    name: str
    short: str
    slot: str
    minutes: int
    start_index: int
    frequency: str
    weekdays: list[str]
    cycle_on: int | None
    cycle_off: int | None
    pills: int
    scoops: int
    amount_text: str
    dose_label: str
    cue: str
    training_cue: str | None
    color: str
    with_food: bool

    def active_on(self, idx: int, d: date) -> dict[str, Any]:
        rel = idx - self.start_index
        if rel < 0:
            return {"on": False}
        if self.frequency == "weekdays" and d.weekday() not in {WEEKDAY_NUM[w] for w in self.weekdays}:
            return {"on": False}
        if self.frequency == "alternate" and rel % 2:
            return {"on": False}
        if self.cycle_on and self.cycle_off:
            period = (self.cycle_on + self.cycle_off) * 7
            if rel % period >= self.cycle_on * 7:
                restart = idx - (rel % period) + period
                return {"on": True, "off": True, "restart_index": restart}
        return {"on": True, "off": False, "is_new": rel <= 2, "started_today": rel == 0}


@dataclass
class Schedule:
    settings: ScheduleSettings
    routine: Routine
    items: list[ItemSchedule]
    assignment: Assignment
    tasks: list[dict[str, Any]] = field(default_factory=list)
    refills: list[dict[str, Any]] = field(default_factory=list)
    spacing_notes: list[str] = field(default_factory=list)

    @property
    def start(self) -> date:
        return self.settings.start_date

    def date_of(self, idx: int) -> date:
        return self.start + timedelta(days=idx)

    def index_of(self, d: date) -> int:
        return (d - self.start).days

    # ------------------------------------------------------------------ views
    def day(self, d: date) -> dict[str, Any]:
        idx = self.index_of(d)
        times = self.routine.slot_times()
        training = DAY_IDS[d.weekday()] in self.routine.training_days
        slots: dict[str, dict[str, Any]] = {}
        for it in self.items:
            st = it.active_on(idx, d)
            if not st["on"]:
                continue
            slot = slots.setdefault(it.slot, {"id": it.slot, "label": SLOT_LABELS[it.slot], "minutes": times[it.slot] % 1440, "items": [], "cues": []})
            entry = {
                "ingredient_id": it.id, "name": it.name, "short": it.short, "amount_text": it.amount_text, "dose_label": it.dose_label,
                "off": st.get("off", False), "is_new": st.get("is_new", False), "started_today": st.get("started_today", False),
                "color": it.color, "pills": 0 if st.get("off") else it.pills, "scoops": 0 if st.get("off") else it.scoops,
            }
            if st.get("off"):
                entry["off_reason"] = f"Off-week ({it.cycle_on} weeks on, {it.cycle_off} off). Restarts {self.date_of(st['restart_index']).isoformat()}."
            if training and it.training_cue:
                entry["training_note"] = it.training_cue
            slot["items"].append(entry)
            if not st.get("off") and it.cue and it.cue not in slot["cues"]:
                slot["cues"].append(it.cue)
        ordered = sorted(slots.values(), key=lambda s: times[s["id"]])
        tasks = [t for t in self.tasks if t["date"] == d.isoformat()]
        return {
            "date": d.isoformat(), "index": idx, "weekday": DAY_IDS[d.weekday()], "training_day": training,
            "slots": ordered, "tasks": tasks,
            "pills": sum(i["pills"] for s in ordered for i in s["items"]),
            "scoops": sum(i["scoops"] for s in ordered for i in s["items"]),
        }

    def days(self, start: date, end: date) -> list[dict[str, Any]]:
        out, d = [], start
        while d <= end:
            out.append(self.day(d))
            d += timedelta(days=1)
        return out

    # ------------------------------------------------------------------ RFC 5545
    def _events(self, calendar_key: str, horizon_days: int, previous: dict[str, dict[str, Any]], reminders: bool) -> list[tuple[ics.VEvent, dict[str, Any]]]:
        horizon_end = self.date_of(horizon_days)
        out: list[tuple[ics.VEvent, dict[str, Any]]] = []
        times = self.routine.slot_times()
        for it in self.items:
            start = self.date_of(it.start_index)
            if it.frequency == "weekdays":
                rrule = "FREQ=WEEKLY;BYDAY=" + ",".join(RRULE_DAYS[w] for w in it.weekdays)
                # DTSTART must itself be an occurrence: move to the first matching weekday.
                while start.weekday() not in {WEEKDAY_NUM[w] for w in it.weekdays}:
                    start += timedelta(days=1)
            elif it.frequency == "alternate":
                rrule = "FREQ=DAILY;INTERVAL=2"
            else:
                rrule = "FREQ=DAILY"
            rrule += f";UNTIL={horizon_end:%Y%m%d}T235959Z"
            exdates = []
            if it.cycle_on and it.cycle_off:
                d = start
                while d <= horizon_end:
                    if it.active_on(self.index_of(d), d).get("off"):
                        exdates.append(d)
                    d += timedelta(days=1)
            uid = stable_uid(calendar_key, it.id, it.slot)
            summary = f"{SLOT_LABELS[it.slot]}: {it.short} ({it.amount_text})"
            fp = fingerprint(rrule, times[it.slot], it.amount_text, start.isoformat(), ",".join(d.isoformat() for d in exdates))
            ev = ics.VEvent(
                uid=uid, summary=summary, start=start, minutes=times[it.slot], rrule=rrule, exdates=exdates,
                description=f"{it.dose_label}. {it.cue}".strip(), sequence=_sequence(previous.get(uid), fp),
                categories=["StackSense", "Supplements"], alarm_minutes=0 if reminders else None,
            )
            out.append((ev, {"kind": "dose", "fingerprint": fp}))
        for t in self.tasks:
            if t["date"] > horizon_end.isoformat() or t["type"] in ("new", "off", "restart"):
                continue
            uid = stable_uid(calendar_key, t["type"], t.get("ingredient_id") or "", t["date"])
            fp = fingerprint(t["title"], t["date"], t.get("sub", ""))
            ev = ics.VEvent(
                uid=uid, summary=t["title"], start=date.fromisoformat(t["date"]), minutes=9 * 60, duration_min=15,
                description=t.get("sub", ""), sequence=_sequence(previous.get(uid), fp), url=t.get("link"),
                categories=["StackSense"], alarm_minutes=0 if reminders else None,
            )
            out.append((ev, {"kind": "task", "fingerprint": fp}))
        # Items that disappeared since the last feed: cancel rather than orphan them.
        live = {e.uid for e, _ in out}
        for uid, prev in previous.items():
            if uid not in live and prev.get("kind") == "dose" and not prev.get("cancelled"):
                ev = ics.VEvent(uid=uid, summary=prev.get("summary", "Removed from your plan"), start=self.start, minutes=int(prev.get("minutes", 540)), sequence=int(prev.get("sequence", 0)) + 1, status="CANCELLED")
                out.append((ev, {"kind": "dose", "fingerprint": "cancelled", "cancelled": True}))
        return out

    def vevents(self, calendar_key: str, horizon_days: int, previous: dict[str, dict[str, Any]] | None = None, reminders: bool = True) -> list[ics.VEvent]:
        """Recurring dose events with stable UIDs. ``previous`` maps uid -> {sequence, fingerprint}
        from the last published feed, so changed events bump SEQUENCE instead of duplicating."""
        return [e for e, _ in self._events(calendar_key, horizon_days, previous or {}, reminders)]

    def ics(self, calendar_key: str, horizon_days: int, name: str = "StackSense plan", previous: dict[str, dict[str, Any]] | None = None, dtstamp: Any = None) -> str:
        events = self.vevents(calendar_key, horizon_days, previous)
        return ics.calendar(events, self.routine.tz, name, dtstamp=dtstamp, horizon=(self.start, self.date_of(horizon_days)))

    def feed_state(self, calendar_key: str, horizon_days: int, previous: dict[str, dict[str, Any]] | None = None) -> dict[str, dict[str, Any]]:
        """What to store after publishing a feed, for the next SEQUENCE computation."""
        return {
            e.uid: {"sequence": e.sequence, "summary": e.summary, "minutes": e.minutes, **meta}
            for e, meta in self._events(calendar_key, horizon_days, previous or {}, True)
        }


def stable_uid(calendar_key: str, *parts: str) -> str:
    h = hashlib.sha256("|".join([calendar_key, *parts]).encode()).hexdigest()[:24]
    return f"{h}@stacksense.app"


def fingerprint(*parts: Any) -> str:
    return hashlib.sha256("|".join(str(p) for p in parts).encode()).hexdigest()[:16]


def _sequence(prev: dict[str, Any] | None, fp: str) -> int:
    if not prev:
        return 0
    return int(prev.get("sequence", 0)) + (0 if prev.get("fingerprint") == fp else 1)


# --------------------------------------------------------------------------- builder


def build_schedule(
    plan: dict[str, Any],
    routine: Routine,
    settings: ScheduleSettings,
    event: dict[str, Any] | None = None,
    products: dict[str, dict[str, Any]] | None = None,
    avoid_slots: set[str] | None = None,
) -> Schedule:
    items = plan["items"]
    sched_items = [
        SchedItem(id=it["ingredient_id"], allowed=list(it.get("prefer_slots") or ["breakfast"]), with_food=bool(it.get("with_food")),
                  pills=int(it["delivery"].get("pills", 0)), scoops=int(it["delivery"].get("scoops", 0)))
        for it in items
    ]
    hints = {h["slot"] for h in plan.get("scheduler_hints", []) if h.get("type") == "avoid_slot"}
    assignment = assign(sched_items, routine, plan.get("spacing"), (avoid_slots or set()) | hints, settings.soft_pill_cap)
    times = routine.slot_times()

    event_date = None
    if event and event.get("date"):
        try:
            event_date = date.fromisoformat(str(event["date"])[:10])
        except ValueError:
            event_date = None

    # Ramp-up: items arrive in the rules engine's ramp order; low-risk items pair up.
    ordered = sorted(items, key=lambda it: it.get("ramp_order", 0))
    starts: dict[str, int] = {}
    day = 0
    i = 0
    while i < len(ordered):
        batch = [ordered[i]]
        if ordered[i].get("side_effect_risk", 1) <= 1 and i + 1 < len(ordered) and ordered[i + 1].get("side_effect_risk", 1) <= 1 and settings.low_risk_per_step > 1:
            batch.append(ordered[i + 1])
        d = settings.start_date + timedelta(days=day)
        while event_date and (d == event_date or d == event_date - timedelta(days=1)):
            day += 1  # nothing new on (or the day before) race day
            d = settings.start_date + timedelta(days=day)
        for it in batch:
            starts[it["ingredient_id"]] = day
        i += len(batch)
        day += settings.ramp_interval_days

    sched = []
    for it in items:
        cyc = it.get("cycle") or {}
        slot = assignment.slots[it["ingredient_id"]]
        sched.append(ItemSchedule(
            id=it["ingredient_id"], name=it["name"], short=it["short"], slot=slot, minutes=times[slot],
            start_index=starts[it["ingredient_id"]], frequency=it["frequency"], weekdays=list(it.get("weekdays") or []),
            cycle_on=cyc.get("on_weeks"), cycle_off=cyc.get("off_weeks"),
            pills=int(it["delivery"].get("pills", 0)), scoops=int(it["delivery"].get("scoops", 0)),
            amount_text=it.get("amount_text", ""), dose_label=it.get("dose_label", ""), cue=it.get("cue", ""),
            training_cue=it.get("training_cue"), color=it.get("color", "#6E7486"), with_food=bool(it.get("with_food")),
        ))
    schedule = Schedule(settings=settings, routine=routine, items=sched, assignment=assignment)

    tasks: list[dict[str, Any]] = []
    for it in sched:
        d = schedule.date_of(it.start_index)
        tasks.append({"date": d.isoformat(), "type": "new", "title": f"Start {it.short}", "sub": "New this week. Note how you feel for 3 days.", "ingredient_id": it.id})
        if it.cycle_on and it.cycle_off:
            period = (it.cycle_on + it.cycle_off) * 7
            k = 0
            while it.start_index + k * period + it.cycle_on * 7 <= settings.horizon_days:
                off_idx = it.start_index + k * period + it.cycle_on * 7
                restart_idx = off_idx + it.cycle_off * 7
                tasks.append({"date": schedule.date_of(off_idx).isoformat(), "type": "off", "title": f"{it.short} off-weeks start", "sub": f"Restarts {schedule.date_of(restart_idx).isoformat()}", "ingredient_id": it.id})
                if restart_idx <= settings.horizon_days:
                    tasks.append({"date": schedule.date_of(restart_idx).isoformat(), "type": "restart", "title": f"{it.short} restarts", "sub": f"Back on for {it.cycle_on} weeks", "ingredient_id": it.id})
                k += 1
    for n, idx in enumerate(CHECKIN_DAYS):
        areas = plan.get("checkin_areas") or []
        tasks.append({"date": schedule.date_of(idx).isoformat(), "type": "checkin", "title": "60-second re-score", "sub": "Rate " + (", ".join(areas) if areas else "your goal areas") + " from 0 to 10.", "week": idx // 7, "n": n + 1})
    for lk in plan.get("locked", []):
        unlock = lk.get("unlock") or {}
        tasks.append({"date": schedule.date_of(2).isoformat(), "type": "lab", "title": f"Book a {unlock.get('name', 'blood').lower()} test", "sub": "Doctor-request note attached. Enter the result to unlock this item.", "ingredient_id": lk["ingredient_id"], "analyte": unlock.get("analyte")})
    if event_date:
        tasks.append({"date": event_date.isoformat(), "type": "event", "title": f"{EVENT_NAMES.get(event.get('type', 'other'), 'Event')} day", "sub": "Nothing new today. Keep your usual routine."})

    # Refills from the chosen product's servings.
    refills = []
    for it in sched:
        prod = (products or {}).get(it.id)
        if not prod or not prod.get("servings"):
            continue
        servings = int(prod["servings"])
        used, idx = 0, it.start_index
        while idx < it.start_index + 3 * settings.horizon_days:
            d = schedule.date_of(idx)
            st = it.active_on(idx, d)
            if st["on"] and not st.get("off"):
                used += 1
            if used >= servings:
                runout = schedule.date_of(idx + 1)
                remind = runout - timedelta(days=settings.refill_lead_days)
                refills.append({"ingredient_id": it.id, "runout": runout.isoformat(), "remind_on": remind.isoformat(), "product_id": prod.get("product_id"), "link": prod.get("link")})
                tasks.append({"date": remind.isoformat(), "type": "refill", "title": f"Refill {it.short}", "sub": f"Runs out {runout.isoformat()}", "ingredient_id": it.id, "link": prod.get("link"), "product_id": prod.get("product_id")})
                break
            idx += 1
    tasks.sort(key=lambda t: (t["date"], t["type"], t.get("ingredient_id") or ""))
    schedule.tasks = tasks
    schedule.refills = refills
    if assignment.relaxed:
        schedule.spacing_notes.append("Some items moved outside their usual time to keep required spacing.")
    if assignment.conflicts:
        schedule.spacing_notes.append("Your day is too short to space every item; a pharmacist can help adjust timing.")
    return schedule
