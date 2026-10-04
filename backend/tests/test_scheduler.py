"""Scheduler correctness (section 6.4): property tests over random routines and stacks assert
no spacing violation, no slot outside wake-bed, totals per day equal the prescribed dose,
cycles honoured, and DST transitions keep local times. Plus RFC 5545 output checks."""

from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from dateutil.rrule import rrulestr
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from stacksense.modules.scheduler import ics
from stacksense.modules.scheduler.calendar import ScheduleSettings, build_schedule, stable_uid
from stacksense.modules.scheduler.solver import ALL_SLOTS, FOOD_SLOTS, Routine

CATALOG = {
    "vitamin_d3_k2": (["breakfast", "lunch", "dinner"], True, "daily", [], None),
    "omega3_algae": (["lunch", "dinner", "breakfast"], True, "daily", [], None),
    "creatine_monohydrate": (["breakfast", "lunch", "dinner", "wake"], False, "daily", [], None),
    "vitamin_b12": (["breakfast", "wake"], False, "weekdays", ["mo", "we", "fr"], None),
    "magnesium_bisglycinate": (["winddown"], False, "daily", [], None),
    "ashwagandha_ksm66": (["dinner", "breakfast"], True, "cycle", [], (8, 2)),
    "curcumin_enhanced": (["dinner", "lunch", "breakfast"], True, "daily", [], None),
    "iron_bisglycinate": (["lunch", "breakfast", "dinner"], True, "alternate", [], None),
    "zinc": (["lunch", "dinner"], True, "daily", [], None),
    "melatonin": (["winddown", "bed"], False, "daily", [], None),
}
SPACING = [("iron_bisglycinate", "magnesium_bisglycinate", 2), ("iron_bisglycinate", "zinc", 2), ("zinc", "magnesium_bisglycinate", 2)]


def make_plan(ids, pills=1):
    items = []
    for i, iid in enumerate(ids):
        slots, food, freq, days, cyc = CATALOG[iid]
        items.append({
            "ingredient_id": iid, "name": iid, "short": iid[:8], "prefer_slots": slots, "with_food": food, "frequency": freq,
            "weekdays": days, "cycle": {"on_weeks": cyc[0], "off_weeks": cyc[1]} if cyc else None, "delivery": {"form": "capsule", "pills": pills, "scoops": 0},
            "ramp_order": i, "side_effect_risk": 1 + (i % 3), "amount_text": "1 capsule", "dose_label": "x", "cue": "", "training_cue": None,
        })
    spacing = [{"a": a, "b": b, "hours": h} for a, b, h in SPACING if a in ids and b in ids]
    return {"items": items, "spacing": spacing, "locked": [], "scheduler_hints": []}


@st.composite
def routines(draw):
    wake = draw(st.integers(300, 600))
    breakfast = wake + draw(st.integers(10, 90))
    lunch = breakfast + draw(st.integers(180, 300))
    dinner = lunch + draw(st.integers(240, 420))
    bed = dinner + draw(st.integers(150, 300))
    tz = draw(st.sampled_from(["America/Toronto", "America/Vancouver", "America/New_York", "America/Regina", "Europe/London"]))
    return Routine(wake=wake, breakfast=breakfast, lunch=lunch, dinner=dinner, bed=bed % 1440, training_days=["tue"], tz=tz)


@settings(max_examples=120, deadline=None, suppress_health_check=[HealthCheck.too_slow])
@given(routines(), st.lists(st.sampled_from(sorted(CATALOG)), min_size=1, max_size=8, unique=True), st.dates(date(2026, 1, 1), date(2027, 6, 1)))
def test_schedule_properties(routine, ids, start):
    plan = make_plan(ids)
    sched = build_schedule(plan, routine, ScheduleSettings(start_date=start))
    times = routine.slot_times()
    wake, bed = times["wake"], times["bed"] + 15
    by_id = {it.id: it for it in sched.items}
    for it in sched.items:
        # Slot inside the waking day and food rules honoured.
        assert wake <= times[it.slot] <= bed
        if it.with_food:
            assert it.slot in FOOD_SLOTS
    # Spacing constraints (when satisfiable they must hold).
    if not sched.assignment.conflicts:
        for sp in plan["spacing"]:
            assert abs(times[by_id[sp["a"]].slot] - times[by_id[sp["b"]].slot]) >= sp["hours"] * 60
    # Totals per day equal the prescribed doses, and cycles/frequencies are honoured.
    for offset in range(0, 120, 3):
        d = start + timedelta(days=offset)
        day = sched.day(d)
        expected = 0
        for it in sched.items:
            rel = offset - it.start_index
            if rel < 0:
                continue
            on = True
            if it.frequency == "weekdays":
                on = d.weekday() in {0, 2, 4}
            elif it.frequency == "alternate":
                on = rel % 2 == 0
            if on and it.cycle_on:
                on = rel % ((it.cycle_on + it.cycle_off) * 7) < it.cycle_on * 7
            expected += 1 if on else 0
        assert day["pills"] == expected


def test_ramp_up_one_or_two_items_every_three_days():
    plan = make_plan(["vitamin_d3_k2", "omega3_algae", "magnesium_bisglycinate", "ashwagandha_ksm66", "curcumin_enhanced"])
    plan["items"][0]["side_effect_risk"] = plan["items"][1]["side_effect_risk"] = 1
    plan["items"][2]["side_effect_risk"] = 2
    sched = build_schedule(plan, Routine(420, 450, 750, 1140, 1380), ScheduleSettings(start_date=date(2026, 10, 5)))
    starts = sorted({it.start_index for it in sched.items})
    assert starts[0] == 0 and all(b - a == 3 for a, b in zip(starts, starts[1:], strict=False))
    per_step = [sum(1 for it in sched.items if it.start_index == s) for s in starts]
    assert max(per_step) <= 2


def test_no_new_items_on_race_day():
    plan = make_plan(["vitamin_d3_k2", "omega3_algae", "magnesium_bisglycinate", "curcumin_enhanced"])
    for it in plan["items"]:
        it["side_effect_risk"] = 2
    event = {"type": "half", "date": "2026-10-11"}  # day 6 and its eve would get new items
    sched = build_schedule(plan, Routine(420, 450, 750, 1140, 1380), ScheduleSettings(start_date=date(2026, 10, 5)), event=event)
    starts = {sched.date_of(it.start_index) for it in sched.items}
    assert date(2026, 10, 11) not in starts and date(2026, 10, 10) not in starts
    assert any(t["type"] == "event" for t in sched.tasks)


def test_refill_date_counts_servings_and_reminds_five_days_early():
    plan = make_plan(["vitamin_d3_k2"])
    sched = build_schedule(plan, Routine(420, 450, 750, 1140, 1380), ScheduleSettings(start_date=date(2026, 10, 5)), products={"vitamin_d3_k2": {"servings": 60, "link": "https://x"}})
    r = sched.refills[0]
    assert r["runout"] == (date(2026, 10, 5) + timedelta(days=60)).isoformat()
    assert r["remind_on"] == (date(2026, 10, 5) + timedelta(days=55)).isoformat()


def _expand(vevent_rrule: str, start: date, minutes: int, tz: str, until_days: int = 200):
    zone = ZoneInfo(tz)
    dtstart = datetime(start.year, start.month, start.day, minutes // 60, minutes % 60, tzinfo=zone)
    rule = rrulestr(vevent_rrule.split(";UNTIL=")[0], dtstart=dtstart)
    return list(rule.between(dtstart, dtstart + timedelta(days=until_days), inc=True))


def test_dst_keeps_local_wall_clock_times():
    plan = make_plan(["magnesium_bisglycinate", "vitamin_d3_k2"])
    routine = Routine(420, 450, 750, 1140, 1380, tz="America/Toronto")
    sched = build_schedule(plan, routine, ScheduleSettings(start_date=date(2026, 10, 20)))
    events = [e for e in sched.vevents("cal_x", 200) if e.rrule]
    for e in events:
        occurrences = _expand(e.rrule, e.start, e.minutes, "America/Toronto")
        assert len({(o.hour, o.minute) for o in occurrences}) == 1  # 21:30 stays 21:30 across Nov 1 and Mar 14
        offsets = {o.utcoffset() for o in occurrences}
        assert len(offsets) == 2  # the window spans both DST transitions


def test_ics_is_rfc5545_shaped():
    plan = make_plan(["vitamin_b12", "ashwagandha_ksm66"])
    sched = build_schedule(plan, Routine(420, 450, 750, 1140, 1380), ScheduleSettings(start_date=date(2026, 10, 5)))
    text = sched.ics("cal_maya", 90, dtstamp=datetime(2026, 10, 4, 12, 0, tzinfo=ZoneInfo("UTC")))
    lines = text.split("\r\n")
    assert lines[0] == "BEGIN:VCALENDAR" and lines[-2] == "END:VCALENDAR"
    assert all(len(line.encode()) <= 75 for line in lines)
    assert "BEGIN:VTIMEZONE" in text and "TZID:America/Toronto" in text
    assert "RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR" in text
    assert "EXDATE;TZID=America/Toronto:" in text  # ashwagandha off-weeks
    assert stable_uid("cal_maya", "vitamin_b12", "breakfast") in text


def test_sequence_bumps_only_when_an_event_changes():
    plan = make_plan(["vitamin_d3_k2", "magnesium_bisglycinate"])
    routine = Routine(420, 450, 750, 1140, 1380)
    s1 = build_schedule(plan, routine, ScheduleSettings(start_date=date(2026, 10, 5)))
    state = s1.feed_state("cal_k", 90)
    s2 = build_schedule(plan, routine, ScheduleSettings(start_date=date(2026, 10, 5)))
    assert {e.uid: e.sequence for e in s2.vevents("cal_k", 90, state)} == {e.uid: 0 for e in s1.vevents("cal_k", 90)}
    later = Routine(420, 450, 750, 1140, 1440 - 30)  # bedtime moves: magnesium's time changes
    s3 = build_schedule(plan, later, ScheduleSettings(start_date=date(2026, 10, 5)))
    seq = {e.uid: e.sequence for e in s3.vevents("cal_k", 90, state)}
    assert seq[stable_uid("cal_k", "magnesium_bisglycinate", "winddown")] == 1
    assert seq[stable_uid("cal_k", "vitamin_d3_k2", "breakfast")] == 0
    # Removing an item cancels it instead of orphaning it.
    s4 = build_schedule(make_plan(["vitamin_d3_k2"]), routine, ScheduleSettings(start_date=date(2026, 10, 5)))
    cancelled = [e for e in s4.vevents("cal_k", 90, state) if e.status == "CANCELLED"]
    assert [e.uid for e in cancelled] == [stable_uid("cal_k", "magnesium_bisglycinate", "winddown")]


def test_fold_and_escape():
    long = "SUMMARY:" + "é" * 100
    folded = ics.fold(long)
    assert all(len(p.encode()) <= 75 for p in folded.split("\r\n"))
    assert ics.escape("a,b;c\nd") == "a\\,b\\;c\\nd"


def test_short_day_is_flagged_not_crashed():
    plan = make_plan(["iron_bisglycinate", "magnesium_bisglycinate", "zinc"])
    routine = Routine(wake=600, breakfast=610, lunch=700, dinner=780, bed=1100)  # cramped day
    sched = build_schedule(plan, routine, ScheduleSettings(start_date=date(2026, 10, 5)))
    assert all(it.slot in ALL_SLOTS for it in sched.items)
