"""Slot assignment: a small constraint solver over the user's daily slots (section 6.2).

Hard constraints : allowed slots (bedtime / morning preferences), food requirements,
                   spacing pairs (``avoid_with`` + ``min_gap_hours``, interaction spacing).
Objective        : fewest distinct dose moments per day, then fewest pills per moment
                   (with a soft cap), then each item's own slot preference order.

Stacks have at most ~8 items with 1-4 allowed slots each, so an exhaustive search with
pruning is exact and runs in well under a millisecond.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

FOOD_SLOTS = ("breakfast", "lunch", "dinner")
ALL_SLOTS = ("wake", "breakfast", "lunch", "dinner", "winddown", "bed")
SLOT_LABELS = {"wake": "Wake", "breakfast": "Breakfast", "lunch": "Lunch", "dinner": "Dinner", "winddown": "Wind-down", "bed": "Bedtime"}

W_MOMENT = 100
W_PILL_EXCESS = 60
W_MAX_PILLS = 10
W_RANK = 12


@dataclass
class Routine:
    wake: int
    breakfast: int
    lunch: int
    dinner: int
    bed: int
    training_days: list[str] = field(default_factory=list)
    tz: str = "America/Toronto"

    @classmethod
    def from_facts(cls, r: dict[str, Any] | None) -> Routine:
        r = r or {}
        return cls(
            wake=int(r.get("wake", 420)), breakfast=int(r.get("breakfast", 450)), lunch=int(r.get("lunch", 750)),
            dinner=int(r.get("dinner", 1110)), bed=int(r.get("bed", 1350)), training_days=list(r.get("training_days") or []),
            tz=r.get("tz") or "America/Toronto",
        )

    def slot_times(self) -> dict[str, int]:
        """Minutes from the start of the plan day. Values >= 1440 fall after midnight."""
        def norm(m: int) -> int:
            return m if m >= self.wake else m + 1440

        bed = norm(self.bed)
        return {
            "wake": self.wake,
            "breakfast": norm(self.breakfast),
            "lunch": norm(self.lunch),
            "dinner": norm(self.dinner),
            "winddown": max(norm(self.dinner), bed - 90),
            "bed": bed - 15,
        }


@dataclass
class SchedItem:
    id: str
    allowed: list[str]
    with_food: bool = False
    pills: int = 0
    scoops: int = 0


@dataclass
class Assignment:
    slots: dict[str, str]
    cost: float
    relaxed: list[str] = field(default_factory=list)
    conflicts: list[str] = field(default_factory=list)


def _allowed(item: SchedItem, avoid: set[str], relax: bool) -> list[str]:
    slots = list(item.allowed) if not relax else list(dict.fromkeys([*item.allowed, *ALL_SLOTS]))
    if item.with_food:
        slots = [s for s in slots if s in FOOD_SLOTS]
    kept = [s for s in slots if s not in avoid]
    return kept or slots


def assign(
    items: list[SchedItem], routine: Routine, spacing: list[dict[str, Any]] | None = None,
    avoid_slots: set[str] | None = None, soft_pill_cap: int = 4,
) -> Assignment:
    times = routine.slot_times()
    spacing = [s for s in (spacing or []) if s.get("hours")]
    avoid = avoid_slots or set()
    for relax in (False, True):
        result = _search(items, times, spacing, avoid, soft_pill_cap, relax)
        if result is not None:
            if relax:
                result.relaxed = [it.id for it in items if result.slots[it.id] not in it.allowed]
            return result
    # Spacing impossible even when relaxed (e.g. a very short day): best effort, flagged.
    result = _search(items, times, [], avoid, soft_pill_cap, True)
    assert result is not None
    result.conflicts = [f"{s['a']}~{s['b']}" for s in spacing]
    return result


def _search(items: list[SchedItem], times: dict[str, int], spacing: list[dict[str, Any]], avoid: set[str], cap: int, relax: bool) -> Assignment | None:
    options = {it.id: _allowed(it, avoid, relax) for it in items}
    order = sorted(items, key=lambda it: (len(options[it.id]), it.id))
    pairs: dict[str, list[tuple[str, float]]] = {}
    for s in spacing:
        pairs.setdefault(s["a"], []).append((s["b"], float(s["hours"])))
        pairs.setdefault(s["b"], []).append((s["a"], float(s["hours"])))
    best: Assignment | None = None
    current: dict[str, str] = {}

    def cost_of(assign: dict[str, str]) -> float:
        moments: dict[str, int] = {}
        for it in items:
            slot = assign[it.id]
            moments[slot] = moments.get(slot, 0) + it.pills
        max_pills = max(moments.values(), default=0)
        rank = sum(_rank(options_orig[it.id], assign[it.id]) for it in items)
        return W_MOMENT * len(moments) + W_PILL_EXCESS * max(0, max_pills - cap) + W_MAX_PILLS * max_pills + W_RANK * rank

    options_orig = {it.id: it.allowed for it in items}

    def ok(item_id: str, slot: str) -> bool:
        for other, hours in pairs.get(item_id, []):
            if other in current and abs(times[current[other]] - times[slot]) < hours * 60:
                return False
        return True

    def dfs(i: int) -> None:
        nonlocal best
        if i == len(order):
            c = cost_of(current)
            if best is None or c < best.cost or (c == best.cost and _key(current) < _key(best.slots)):
                best = Assignment(dict(current), c)
            return
        if best is not None and W_MOMENT * len(set(current.values())) > best.cost:
            return
        it = order[i]
        for slot in options[it.id]:
            if ok(it.id, slot):
                current[it.id] = slot
                dfs(i + 1)
                del current[it.id]

    dfs(0)
    return best


def _rank(allowed: list[str], slot: str) -> int:
    return allowed.index(slot) if slot in allowed else len(allowed) + 1


def _key(d: dict[str, str]) -> tuple[tuple[str, str], ...]:
    return tuple(sorted(d.items()))
