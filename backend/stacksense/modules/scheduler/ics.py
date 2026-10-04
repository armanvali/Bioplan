"""RFC 5545 output: stable UIDs, SEQUENCE bumps, TZID-anchored wall-clock times and a
real VTIMEZONE built from the IANA database, so Google and Apple calendars update
subscribed events in place and keep 21:30 at 21:30 across DST changes."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

PRODID = "-//StackSense//Dosage Calendar 1.0//EN"


def escape(text: str) -> str:
    return str(text).replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\r\n", "\\n").replace("\n", "\\n")


def fold(line: str) -> str:
    """Fold to 75 octets per line (RFC 5545 3.1), never splitting a UTF-8 sequence."""
    raw = line.encode("utf-8")
    if len(raw) <= 75:
        return line
    parts, cur, size = [], "", 0
    limit = 75
    for ch in line:
        b = len(ch.encode("utf-8"))
        if size + b > limit:
            parts.append(cur)
            cur, size, limit = ch, b, 74  # continuation lines start with a space
        else:
            cur += ch
            size += b
    parts.append(cur)
    return "\r\n ".join(parts)


def fmt_local(d: date, minutes: int) -> str:
    extra_days, m = divmod(minutes, 1440)
    d = d + timedelta(days=extra_days)
    return f"{d:%Y%m%d}T{m // 60:02d}{m % 60:02d}00"


def fmt_utc(dt: datetime) -> str:
    return dt.astimezone(UTC).strftime("%Y%m%dT%H%M%SZ")


@dataclass
class VEvent:
    uid: str
    summary: str
    start: date
    minutes: int
    duration_min: int = 10
    rrule: str | None = None
    exdates: list[date] = field(default_factory=list)
    description: str = ""
    sequence: int = 0
    status: str | None = None  # CANCELLED for removed items
    categories: list[str] = field(default_factory=list)
    url: str | None = None
    alarm_minutes: int | None = None
    all_day: bool = False


def vtimezone(tz: str, start: date, end: date) -> list[str]:
    """STANDARD/DAYLIGHT sub-components for every offset change between start and end."""
    zone = ZoneInfo(tz)
    t = datetime(start.year, 1, 1, tzinfo=UTC)
    stop = datetime(end.year + 1, 1, 1, tzinfo=UTC)
    prev = t.astimezone(zone).utcoffset() or timedelta()
    first_name = t.astimezone(zone).tzname() or tz
    transitions: list[tuple[datetime, timedelta, timedelta, str]] = []
    while t < stop:
        nxt = t + timedelta(days=1)
        off = nxt.astimezone(zone).utcoffset() or timedelta()
        if off != prev:
            h = t
            while ((h + timedelta(hours=1)).astimezone(zone).utcoffset() or timedelta()) == prev:
                h += timedelta(hours=1)
            at = h + timedelta(hours=1)  # first UTC instant on the new offset
            transitions.append((at, prev, off, at.astimezone(zone).tzname() or tz))
            prev = off
        t = nxt

    def offs(td: timedelta) -> str:
        total = int(td.total_seconds() // 60)
        sign = "+" if total >= 0 else "-"
        h, m = divmod(abs(total), 60)
        return f"{sign}{h:02d}{m:02d}"

    lines = ["BEGIN:VTIMEZONE", f"TZID:{tz}"]
    if not transitions:
        lines += ["BEGIN:STANDARD", "DTSTART:19700101T000000", f"TZOFFSETFROM:{offs(prev)}", f"TZOFFSETTO:{offs(prev)}", f"TZNAME:{first_name}", "END:STANDARD"]
    for at_utc, frm, to, name in transitions:
        kind = "DAYLIGHT" if to > frm else "STANDARD"
        local = (at_utc + frm).replace(tzinfo=None)  # wall-clock time just before the change
        lines += [f"BEGIN:{kind}", f"DTSTART:{local:%Y%m%dT%H%M%S}", f"TZOFFSETFROM:{offs(frm)}", f"TZOFFSETTO:{offs(to)}", f"TZNAME:{name}", f"END:{kind}"]
    lines.append("END:VTIMEZONE")
    return lines


def calendar(events: Iterable[VEvent], tz: str, name: str = "StackSense plan", dtstamp: datetime | None = None, horizon: tuple[date, date] | None = None) -> str:
    events = list(events)
    stamp = fmt_utc(dtstamp or datetime.now(UTC))
    if horizon is None:
        starts = [e.start for e in events] or [date.today()]
        horizon = (min(starts), max(starts) + timedelta(days=400))
    lines = [
        "BEGIN:VCALENDAR", "VERSION:2.0", f"PRODID:{PRODID}", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
        f"X-WR-CALNAME:{escape(name)}", f"X-WR-TIMEZONE:{tz}", "REFRESH-INTERVAL;VALUE=DURATION:PT12H", "X-PUBLISHED-TTL:PT12H",
    ]
    lines += vtimezone(tz, *horizon)
    for e in events:
        lines += ["BEGIN:VEVENT", f"UID:{e.uid}", f"DTSTAMP:{stamp}", f"SEQUENCE:{e.sequence}"]
        if e.all_day:
            lines += [f"DTSTART;VALUE=DATE:{e.start:%Y%m%d}", f"DTEND;VALUE=DATE:{e.start + timedelta(days=1):%Y%m%d}"]
        else:
            lines += [f"DTSTART;TZID={tz}:{fmt_local(e.start, e.minutes)}", f"DTEND;TZID={tz}:{fmt_local(e.start, e.minutes + e.duration_min)}"]
        lines.append(f"SUMMARY:{escape(e.summary)}")
        if e.description:
            lines.append(f"DESCRIPTION:{escape(e.description)}")
        if e.rrule:
            lines.append(f"RRULE:{e.rrule}")
        if e.exdates:
            lines.append(f"EXDATE;TZID={tz}:" + ",".join(fmt_local(d, e.minutes) for d in sorted(e.exdates)))
        if e.categories:
            lines.append("CATEGORIES:" + ",".join(escape(c) for c in e.categories))
        if e.url:
            lines.append(f"URL:{e.url}")
        if e.status:
            lines.append(f"STATUS:{e.status}")
        lines.append("TRANSP:TRANSPARENT")
        if e.alarm_minutes is not None and not e.status:
            lines += ["BEGIN:VALARM", "ACTION:DISPLAY", f"DESCRIPTION:{escape(e.summary)}", f"TRIGGER:-PT{e.alarm_minutes}M", "END:VALARM"]
        lines.append("END:VEVENT")
    lines.append("END:VCALENDAR")
    return "\r\n".join(fold(line) for line in lines) + "\r\n"
