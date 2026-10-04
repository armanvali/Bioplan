"""Tiny template interpolation for editor-written copy: ``"Because you're {facts.diet}"``.

Placeholders are dotted paths into a context dict with optional filters:
``{facts.routine.bed|time24}``, ``{answer.ranked|goal_list}``. Unknown paths render
as an empty string; there is no code execution.
"""

from __future__ import annotations

import re
from collections.abc import Callable, Mapping
from typing import Any

_PLACEHOLDER = re.compile(r"\{([a-zA-Z_][\w.]*)(?:\|([a-z_0-9]+))?\}")


def _resolve(ctx: Mapping[str, Any], path: str) -> Any:
    cur: Any = ctx
    for part in path.split("."):
        if isinstance(cur, Mapping):
            cur = cur.get(part)
        else:
            return None
    return cur


def join_list(items: list[str], conj: str = "and") -> str:
    items = [str(i) for i in items if i]
    if len(items) <= 1:
        return "".join(items)
    return ", ".join(items[:-1]) + f" {conj} " + items[-1]


def render(template: str, ctx: Mapping[str, Any], filters: Mapping[str, Callable[[Any], str]] | None = None) -> str:
    filters = filters or {}

    def sub(m: re.Match[str]) -> str:
        val = _resolve(ctx, m.group(1))
        f = m.group(2)
        if f and f in filters:
            return filters[f](val)
        if val is None:
            return ""
        if isinstance(val, list):
            return join_list([str(v) for v in val])
        if isinstance(val, float) and val.is_integer():
            return str(int(val))
        return str(val)

    return _PLACEHOLDER.sub(sub, template)
