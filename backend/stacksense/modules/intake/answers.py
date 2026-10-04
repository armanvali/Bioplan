"""Answer types: validate what the client posts, then derive the fields expressions read.

Engineers own these handlers; editors only reference their derived fields in the
graph (``answer.crash``, ``answer.score``, ``answer.drug_classes`` ...). Every handler
returns a plain dict with the normalised value, its derived fields and a short
human ``summary`` used for "why" text and the review screen.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from stacksense.core import expr
from stacksense.core.errors import DomainError
from stacksense.modules.intake import regions
from stacksense.modules.intake.graph import Node


class AnswerError(DomainError):
    status_code = 422

    def __init__(self, message: str, **details: object) -> None:
        super().__init__("invalid_answer", message, **details)


DAY_IDS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]

BODY_SPOTS: dict[str, dict[str, str]] = {
    "front": {
        "neck": "Neck", "shoulder_l": "Left shoulder", "shoulder_r": "Right shoulder", "elbow_l": "Left elbow",
        "elbow_r": "Right elbow", "wrist_l": "Left wrist or hand", "wrist_r": "Right wrist or hand",
        "hip_l": "Left hip", "hip_r": "Right hip", "knee_l": "Left knee", "knee_r": "Right knee",
        "ankle_l": "Left ankle or foot", "ankle_r": "Right ankle or foot",
    },
    "back": {
        "neck_b": "Back of neck", "upperback": "Upper back", "lowerback": "Lower back", "glute_l": "Left glute",
        "glute_r": "Right glute", "hamstring_l": "Left hamstring", "hamstring_r": "Right hamstring",
        "calf_l": "Left calf", "calf_r": "Right calf", "heel_l": "Left heel", "heel_r": "Right heel",
    },
}
ALL_SPOTS = {k: v for side in BODY_SPOTS.values() for k, v in side.items()}


def time12(minutes: float | None) -> str:
    if minutes is None:
        return ""
    m = int(minutes) % 1440
    h, mm = divmod(m, 60)
    suffix = "am" if h < 12 else "pm"
    return f"{h % 12 or 12}:{mm:02d} {suffix}"


def time24(minutes: float | None) -> str:
    if minutes is None:
        return ""
    m = int(minutes) % 1440
    return f"{m // 60}:{m % 60:02d}"


# --------------------------------------------------------------------------- helpers


def _num(value: Any, name: str, lo: float | None = None, hi: float | None = None, integer: bool = False) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise AnswerError(f"{name} must be a number")
    if lo is not None and value < lo or hi is not None and value > hi:
        raise AnswerError(f"{name} must be between {lo} and {hi}")
    return int(value) if integer else value


def _follow(node: Node, raw: dict[str, Any], out: dict[str, Any]) -> None:
    """Validate sub-questions whose ``when`` holds for the main answer."""
    for f in node.answer.follow:
        if f.when and not expr.truthy(f.when, {"answer": out}):
            continue
        val = raw.get(f.key)
        if val is None:
            continue
        if f.type == "chips":
            ids = {o.id for o in f.options}
            if val not in ids:
                raise AnswerError(f"{f.key} must be one of {sorted(ids)}")
            out[f.key] = val
        elif f.type == "stepper":
            out[f.key] = _num(val, f.key, f.min, f.max, integer=True)
        elif f.type == "labs":
            out[f.key] = _labs(val, f.analytes)


def _labs(val: Any, allowed: list[str]) -> list[dict[str, Any]]:
    if not isinstance(val, list):
        raise AnswerError("labs must be a list")
    out = []
    for item in val:
        if not isinstance(item, dict) or item.get("analyte") not in allowed:
            raise AnswerError(f"lab analyte must be one of {allowed}")
        value = _num(item.get("value"), "lab value", 0, 100000)
        out.append({"analyte": item["analyte"], "value": value, "unit": item.get("unit"), "drawn_at": item.get("drawn_at")})
    return out


# --------------------------------------------------------------------------- handlers


def _single(node: Node, raw: dict[str, Any], kb: Any) -> dict[str, Any]:
    choice = raw.get("choice")
    opt = node.answer.option(choice) if isinstance(choice, str) else None
    if not opt:
        raise AnswerError(f"choice must be one of {sorted(node.answer.option_ids)}")
    out: dict[str, Any] = {"choice": choice, "label": opt.label}
    if opt.level is not None:
        out["level"] = opt.level
    _follow(node, raw, out)
    out["summary"] = opt.label + (f" for {out['years']} years" if out.get("years") else "")
    return out


def _multi(node: Node, raw: dict[str, Any], kb: Any) -> dict[str, Any]:
    picks = raw.get("picks")
    if not isinstance(picks, list) or not all(isinstance(p, str) for p in picks):
        raise AnswerError("picks must be a list of option ids")
    picks = list(dict.fromkeys(picks))
    unknown = [p for p in picks if p not in node.answer.option_ids]
    if unknown:
        raise AnswerError(f"unknown options {unknown}")
    exclusive = {o.id for o in node.answer.options if o.exclusive}
    if any(p in exclusive for p in picks) and len(picks) > 1:
        raise AnswerError("'None of these' can't be combined with other options")
    if not picks:
        raise AnswerError("pick at least one option (or 'None of these')")
    out: dict[str, Any] = {"picks": picks, "count": len([p for p in picks if p not in exclusive])}
    _follow(node, raw, out)
    labels = [node.answer.option(p).label for p in picks]  # type: ignore[union-attr]
    out["summary"] = ", ".join(labels)
    return out


def _rank(node: Node, raw: dict[str, Any], kb: Any) -> dict[str, Any]:
    ranked = raw.get("ranked")
    if not isinstance(ranked, list) or not ranked:
        raise AnswerError("ranked must be a non-empty list")
    if len(set(ranked)) != len(ranked):
        raise AnswerError("ranked has duplicates")
    if any(r not in node.answer.option_ids for r in ranked):
        raise AnswerError("ranked has unknown options")
    if node.answer.max_picks and len(ranked) > node.answer.max_picks:
        raise AnswerError(f"pick at most {node.answer.max_picks}")
    return {"ranked": ranked, "summary": " > ".join(node.answer.option(r).label for r in ranked)}  # type: ignore[union-attr]


def _time(node: Node, raw: dict[str, Any], kb: Any) -> dict[str, Any]:
    if raw.get("none"):
        return {"none": True, "minutes": None, "summary": node.answer.none_label or "None"}
    minutes = _num(raw.get("minutes"), "minutes", 0, 1439, integer=True)
    return {"minutes": minutes, "hours": minutes / 60, "summary": time12(minutes)}


def _energy(node: Node, raw: dict[str, Any], kb: Any) -> dict[str, Any]:
    hours = node.answer.hours or [6, 8, 10, 12, 14, 16, 18, 20, 22]
    pts = raw.get("points")
    if not isinstance(pts, list) or len(pts) != len(hours):
        raise AnswerError(f"points must have {len(hours)} values")
    pts = [float(_num(p, "point", 0, 10)) for p in pts]
    # Peak in the morning window, dip in the early afternoon window.
    morning = [i for i, h in enumerate(hours) if 8 <= h <= 12] or [1]
    afternoon = [i for i, h in enumerate(hours) if 14 <= h <= 16] or [4]
    peak_i = max(morning, key=lambda i: pts[i])
    dip = min(pts[i] for i in afternoon)
    mean = sum(pts) / len(pts)
    crash = pts[peak_i] - dip >= 3
    low_all_day = mean < 4 and not crash
    parts = []
    if pts[0] <= 4:
        parts.append("low start")
    if crash:
        h = hours[peak_i]
        parts.append(f"peak around {'noon' if h == 12 else f'{h % 12} ' + ('am' if h < 12 else 'pm')}")
        parts.append("crash 2–4 pm")
    elif low_all_day:
        parts.append("low all day")
    else:
        parts.append("fairly steady")
    text = ", ".join(parts)
    return {
        "points": pts, "crash": crash, "low_all_day": low_all_day, "mean": round(mean, 2),
        "peak_hour": hours[peak_i], "pattern": text, "summary": text[:1].upper() + text[1:],
    }


def _body_map(node: Node, raw: dict[str, Any], kb: Any) -> dict[str, Any]:
    if raw.get("none"):
        return {"spots": [], "count": 0, "kinds": [], "summary": node.answer.none_label or "Nothing"}
    spots = raw.get("spots")
    if not isinstance(spots, list) or any(s not in ALL_SPOTS for s in spots):
        raise AnswerError("spots must be known body-map ids")
    spots = list(dict.fromkeys(spots))
    kinds: dict[str, list[str]] = {}
    for s in spots:
        kinds.setdefault(s.split("_")[0], []).append(s)
    parts = []
    for k, ids in kinds.items():
        if len(ids) == 2 and k not in ("neck", "upperback", "lowerback"):
            parts.append(f"Both {k}s")
        else:
            parts.extend(ALL_SPOTS[i] for i in ids)
    return {"side": raw.get("side", "front"), "spots": spots, "count": len(spots), "kinds": list(kinds), "summary": ", ".join(parts) or "Nothing"}


def _pss4(node: Node, raw: dict[str, Any], kb: Any) -> dict[str, Any]:
    items = raw.get("items")
    defs = node.answer.items
    if not isinstance(items, list) or len(items) != len(defs):
        raise AnswerError(f"items must have {len(defs)} answers")
    score = 0
    for v, d in zip(items, defs, strict=True):
        v = _num(v, "item", 0, 4, integer=True)
        score += 4 - v if d.reverse else v
    source = raw.get("source")
    if source is not None and node.answer.sources and source not in node.answer.sources:
        raise AnswerError("unknown stress source")
    summary = f"Stress score {score} of 16" + (f"; main source: {source.lower()}" if source else "")
    return {"items": items, "score": score, "source": source, "summary": summary}


def _meds(node: Node, raw: dict[str, Any], kb: Any) -> dict[str, Any]:
    if raw.get("none"):
        return {"meds": [], "unknown": [], "drug_classes": [], "supplies": [], "names": [], "summary": node.answer.none_label or "Nothing"}
    meds = raw.get("meds", [])
    free = raw.get("free_text", [])
    if not isinstance(meds, list) or not isinstance(free, list):
        raise AnswerError("meds and free_text must be lists")
    unknown_ids = [m for m in meds if m not in kb.drugs]
    if unknown_ids:
        raise AnswerError(f"unknown medicine ids {unknown_ids}")
    classes: list[str] = []
    supplies: list[dict[str, Any]] = []
    for m in meds:
        d = kb.drugs[m]
        classes.extend(c for c in d.classes if c not in classes)
        supplies.extend(s.model_dump(exclude_none=True) | {"drug_id": m} for s in d.supplies)
    unknown = [str(t).strip()[:80] for t in free if str(t).strip()]
    names = [kb.drugs[m].name for m in meds] + unknown
    return {
        "meds": meds, "unknown": unknown, "drug_classes": classes, "supplies": supplies, "names": names,
        "summary": ", ".join(names) if names else "Nothing",
    }


def _budget(node: Node, raw: dict[str, Any], kb: Any) -> dict[str, Any]:
    amount = _num(raw.get("amount"), "amount", node.answer.min, node.answer.max)
    return {"amount": amount, "summary": f"${amount:g} a month"}


def _pills(node: Node, raw: dict[str, Any], kb: Any) -> dict[str, Any]:
    mx = _num(raw.get("max"), "max", node.answer.min, node.answer.max, integer=True)
    powders = raw.get("powders", True)
    if not isinstance(powders, bool):
        raise AnswerError("powders must be true or false")
    return {"max": mx, "powders": powders, "summary": f"Up to {mx} pills" + (", powders OK" if powders else ", no powders")}


def _routine(node: Node, raw: dict[str, Any], kb: Any) -> dict[str, Any]:
    keys = ("wake", "breakfast", "lunch", "dinner", "bed")
    vals = {k: _num(raw.get(k), k, 0, 1439, integer=True) for k in keys}
    # Bedtime after midnight is allowed: compare on a timeline starting at wake.
    timeline = [vals[k] if vals[k] >= vals["wake"] else vals[k] + 1440 for k in keys]
    if timeline != sorted(timeline):
        raise AnswerError("times must run wake < breakfast < lunch < dinner < bed")
    if timeline[-1] - timeline[0] < 8 * 60:
        raise AnswerError("wake and bed must be at least 8 hours apart")
    days = raw.get("training_days", [])
    if not isinstance(days, list) or any(d not in DAY_IDS for d in days):
        raise AnswerError(f"training_days must be from {DAY_IDS}")
    tz = raw.get("tz") or "America/Toronto"
    try:
        ZoneInfo(tz)
    except (ZoneInfoNotFoundError, ValueError) as e:
        raise AnswerError("tz must be an IANA time zone") from e
    out = {**vals, "training_days": days, "tz": tz}
    out["summary"] = f"Up {time24(vals['wake'])}, bed {time24(vals['bed'])}"
    return out


def _training(node: Node, raw: dict[str, Any], kb: Any) -> dict[str, Any]:
    sessions = _num(raw.get("sessions", 0), "sessions", 0, 14, integer=True)
    km = _num(raw.get("km", 0), "km", 0, 300)
    event = raw.get("event")
    if event is not None:
        if not isinstance(event, dict) or event.get("type") not in {"5k", "10k", "half", "full", "other"} or not event.get("date"):
            raise AnswerError("event needs a type and an ISO date")
        event = {"type": event["type"], "date": str(event["date"])[:10], "name": event.get("name")}
    names = {"5k": "5K race", "10k": "10K race", "half": "Half-marathon", "full": "Marathon", "other": "Event"}
    summary = f"{sessions} sessions, ~{km:g} km a week"
    if event:
        summary += f"; {names[event['type']].lower()} on {event['date']}"
    return {"sessions": sessions, "km": km, "weekly_km": km, "event": event, "event_name": names[event["type"]] if event else None, "summary": summary}


def _demographics(node: Node, raw: dict[str, Any], kb: Any) -> dict[str, Any]:
    age = _num(raw.get("age"), "age", 13, 110, integer=True)
    sex = raw.get("sex")
    if sex not in ("female", "male", "prefer_not"):
        raise AnswerError("sex must be female, male or prefer_not")
    country = raw.get("country") or "other"
    if country not in ("CA", "US", "other"):
        raise AnswerError("country must be CA, US or other")
    region = raw.get("region")
    lat = regions.latitude(country, region)
    if lat is None and isinstance(raw.get("latitude"), (int, float)):
        lat = float(raw["latitude"])
    return {"age": age, "sex": sex, "country": country, "region": region, "latitude": lat, "summary": f"{age}, {sex.replace('_', ' ')}, {region or country}"}


def _free_text(node: Node, raw: dict[str, Any], kb: Any) -> dict[str, Any]:
    if raw.get("skip"):
        return {"text": "", "mapped": [], "summary": "Skipped"}
    text = str(raw.get("text", "")).strip()
    limit = node.answer.max_length or 500
    if len(text) > limit:
        raise AnswerError(f"text must be at most {limit} characters")
    mapped = raw.get("mapped", [])
    allowed = set(node.free_text_signals)
    clean = []
    for m in mapped if isinstance(mapped, list) else []:
        if isinstance(m, dict) and m.get("signal_id") in allowed:
            clean.append({
                "signal_id": m["signal_id"], "confidence": float(m.get("confidence", 0)),
                "quote": str(m.get("quote", ""))[:120], "confirmed": bool(m.get("confirmed", False)),
            })
    return {"text": text, "mapped": clean, "summary": text[:60] + ("…" if len(text) > 60 else "") if text else "Skipped"}


def _number(node: Node, raw: dict[str, Any], kb: Any) -> dict[str, Any]:
    v = _num(raw.get("value"), "value", node.answer.min, node.answer.max)
    return {"value": v, "summary": f"{v:g}"}


HANDLERS: dict[str, Callable[[Node, dict[str, Any], Any], dict[str, Any]]] = {
    "single": _single, "scale": _single, "multi": _multi, "rank": _rank, "time": _time,
    "energy_curve": _energy, "body_map": _body_map, "pss4": _pss4, "meds": _meds, "budget": _budget,
    "pills": _pills, "routine": _routine, "training": _training, "demographics": _demographics,
    "free_text": _free_text, "number": _number,
}


def normalize(node: Node, raw: Any, kb: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise AnswerError("answer value must be an object")
    if raw.get("unsure"):
        if not node.answer.allow_unsure:
            raise AnswerError("this question can't be answered with 'Not sure'")
        return {"unsure": True, "summary": "Not sure"}
    return HANDLERS[node.answer.type](node, raw, kb)
