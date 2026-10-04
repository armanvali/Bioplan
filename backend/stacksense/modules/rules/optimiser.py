"""Stack optimiser (section 4.1): an exact branch-and-bound search.

Maximise   sum_a N_a/10 * S_a(set)      (diminishing returns per area, same model as the impact map)
subject to sum cost <= budget, busiest-day pills <= pill limit, items <= max, one per substitute group.

The objective is submodular (1 - prod(1 - c) saturates), so an item's standalone value
is an upper bound on its marginal value; that bound prunes the search hard. With the
~25 candidates the spec expects this explores a few thousand nodes and runs in
milliseconds. A node cap keeps worst cases bounded; if it trips, the best solution found
so far is returned and flagged ``exact=False``. (OR-Tools CP-SAT can replace this behind
the same ``solve`` signature if the model grows non-submodular constraints.)
"""

from __future__ import annotations

from dataclasses import dataclass, field

from stacksense.modules.impact.model import combined


@dataclass(frozen=True)
class OptItem:
    """One selectable option. Variants of the same ingredient (capsule vs powder) share the
    group ``ing:<id>``; substitutes (D3 vs D3+K2) share ``grp:<group>``. At most one item per group."""

    id: str
    groups: frozenset[str]
    cost: float
    pills: tuple[int, ...]  # pills per weekday, Mon..Sun
    contrib: dict[str, float]  # c_i,a on 0-10
    bonus: float = 0.0  # essential items (e.g. folate when pregnant), small preference for canonical forms
    ingredient: str = ""

    @property
    def key(self) -> str:
        return self.ingredient or self.id


@dataclass
class OptResult:
    selected: list[str]
    objective: float
    exact: bool
    nodes: int
    reasons: dict[str, str] = field(default_factory=dict)  # why each unselected item was left out


def objective(items: list[OptItem], need: dict[str, float], synergy: dict[frozenset[str], dict[str, float]] | None = None) -> float:
    total = 0.0
    ids = {it.id for it in items}
    syn: dict[str, float] = {}
    if synergy:
        for pair, areas in synergy.items():
            if pair <= ids:
                for a, s in areas.items():
                    syn[a] = max(-0.5, min(0.5, syn.get(a, 0.0) + s))
    for area, n in need.items():
        if n <= 0:
            continue
        cs = [it.contrib.get(area, 0.0) for it in items if it.contrib.get(area)]
        if cs or syn.get(area):
            total += n / 10 * combined(cs, syn.get(area, 0.0))
    return total + sum(it.bonus for it in items)


def solve(
    items: list[OptItem],
    need: dict[str, float],
    budget: float,
    pill_limit: int,
    max_items: int,
    synergy: dict[frozenset[str], dict[str, float]] | None = None,
    node_cap: int = 250_000,
) -> OptResult:
    standalone = {it.id: objective([it], need) for it in items}
    syn_slack = 0.0
    if synergy:
        syn_slack = sum(max(0.0, s) * need.get(a, 0) / 10 for areas in synergy.values() for a, s in areas.items())
    order = sorted(items, key=lambda it: (-standalone[it.id], it.cost, it.id))

    def fits_alone(it: OptItem) -> bool:
        return it.cost <= budget + 1e-9 and max(it.pills) <= pill_limit

    feasible = [it for it in order if fits_alone(it)]
    suffix = [0.0] * (len(feasible) + 1)
    for i in range(len(feasible) - 1, -1, -1):
        suffix[i] = suffix[i + 1] + standalone[feasible[i].id]

    best: list[OptItem] = []
    best_val = 0.0
    nodes = 0
    exact = True

    def dfs(i: int, chosen: list[OptItem], cost: float, pills: list[int], groups: frozenset[str], val: float) -> None:
        nonlocal best, best_val, nodes, exact
        nodes += 1
        if val > best_val + 1e-12 or (abs(val - best_val) <= 1e-12 and _key(chosen) < _key(best)):
            best, best_val = list(chosen), val
        if i >= len(feasible) or len(chosen) >= max_items:
            return
        if val + suffix[i] + syn_slack <= best_val + 1e-12:
            return
        if nodes > node_cap:
            exact = False
            return
        it = feasible[i]
        new_pills = [p + q for p, q in zip(pills, it.pills, strict=True)]
        if (
            cost + it.cost <= budget + 1e-9
            and max(new_pills) <= pill_limit
            and not (it.groups & groups)
        ):
            chosen.append(it)
            dfs(i + 1, chosen, cost + it.cost, new_pills, groups | it.groups, objective(chosen, need, synergy))
            chosen.pop()
        dfs(i + 1, chosen, cost, pills, groups, val)

    dfs(0, [], 0.0, [0] * 7, frozenset(), 0.0)

    selected = {it.id for it in best}
    chosen_keys = {it.key for it in best}
    reasons: dict[str, str] = {}
    cost = sum(it.cost for it in best)
    pills = [sum(it.pills[d] for it in best) for d in range(7)]
    groups = frozenset().union(*(it.groups for it in best)) if best else frozenset()
    for it in order:
        if it.id in selected or it.key in chosen_keys or it.key in reasons:
            continue  # another variant of this ingredient was chosen, or already explained
        if it.groups & groups:
            reasons[it.key] = "alternative_chosen"
        elif not fits_alone(it):
            reasons[it.key] = "over_budget" if it.cost > budget else "pill_limit"
        elif len(best) >= max_items:
            reasons[it.key] = "max_items"
        elif cost + it.cost > budget + 1e-9:
            reasons[it.key] = "over_budget"
        elif max(p + q for p, q in zip(pills, it.pills, strict=True)) > pill_limit:
            reasons[it.key] = "pill_limit"
        else:
            reasons[it.key] = "lower_value"
    return OptResult(selected=[it.id for it in sorted(best, key=lambda x: (-standalone[x.id], x.id))], objective=round(best_val, 6), exact=exact, nodes=nodes, reasons=reasons)


def _key(items: list[OptItem]) -> tuple[str, ...]:
    return tuple(sorted(it.id for it in items))
