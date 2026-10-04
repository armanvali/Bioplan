"""A small, safe expression language for graph preconditions and rule conditions.

Never ``eval``: source text is tokenised, parsed into a tiny AST and interpreted
against a plain dict context. Only literals, dotted paths, comparisons, boolean
logic, arithmetic and a whitelist of pure functions exist.

    signals.fatigue >= 0.4 OR goals contains 'energy'
    answer.picks contains 'legs' AND NOT flags contains 'stop_sleep'
    facts.age >= 18 AND facts.sex == 'female'
    len(answer.picks) >= 2
    facts.diet in ['vegetarian', 'vegan']

Semantics worth knowing:
  * A missing path resolves to ``null``. Ordering comparisons with ``null`` are false,
    so a precondition on an unanswered question is simply not met.
  * ``contains`` works on lists, strings and dict keys; ``in`` is its mirror.
  * Keywords are case-insensitive; ``&&``/``||``/``!`` are accepted aliases.
"""

from __future__ import annotations

import re
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass
from functools import lru_cache
from typing import Any


class ExprError(ValueError):
    pass


# --------------------------------------------------------------------------- tokens

_TOKEN_RE = re.compile(
    r"""
    (?P<ws>\s+)
  | (?P<num>\d+\.\d*|\.\d+|\d+)
  | (?P<str>'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")
  | (?P<op>==|!=|<=|>=|&&|\|\||[<>()\[\],.+\-*/!])
  | (?P<name>[A-Za-z_][A-Za-z0-9_]*)
    """,
    re.VERBOSE,
)

_KEYWORDS = {"and", "or", "not", "contains", "in", "true", "false", "null", "none"}


@dataclass(frozen=True, slots=True)
class Tok:
    kind: str  # num | str | op | name | kw | end
    value: Any
    pos: int


def tokenize(src: str) -> list[Tok]:
    out: list[Tok] = []
    i = 0
    while i < len(src):
        m = _TOKEN_RE.match(src, i)
        if not m:
            raise ExprError(f"Unexpected character {src[i]!r} at {i}")
        kind = m.lastgroup
        text = m.group(0)
        if kind == "num":
            out.append(Tok("num", float(text) if "." in text else int(text), i))
        elif kind == "str":
            body = text[1:-1]
            out.append(Tok("str", re.sub(r"\\(.)", r"\1", body), i))
        elif kind == "op":
            alias = {"&&": "and", "||": "or", "!": "not"}.get(text)
            out.append(Tok("kw", alias, i) if alias else Tok("op", text, i))
        elif kind == "name":
            low = text.lower()
            out.append(Tok("kw", low, i) if low in _KEYWORDS else Tok("name", text, i))
        i = m.end()
    out.append(Tok("end", None, len(src)))
    return out


# --------------------------------------------------------------------------- parser

# AST nodes are tuples: ("lit", v) ("path", (a, b)) ("not", x) ("and", a, b) ("or", a, b)
# ("cmp", op, a, b) ("bin", op, a, b) ("neg", x) ("list", [..]) ("call", name, [..])


class _Parser:
    def __init__(self, toks: list[Tok], src: str) -> None:
        self.toks = toks
        self.i = 0
        self.src = src

    @property
    def cur(self) -> Tok:
        return self.toks[self.i]

    def eat(self, kind: str, value: Any = None) -> Tok:
        t = self.cur
        if t.kind != kind or (value is not None and t.value != value):
            want = value or kind
            raise ExprError(f"Expected {want!r} at {t.pos} in {self.src!r}, got {t.value!r}")
        self.i += 1
        return t

    def accept(self, kind: str, value: Any = None) -> bool:
        t = self.cur
        if t.kind == kind and (value is None or t.value == value):
            self.i += 1
            return True
        return False

    def parse(self) -> tuple:
        node = self.or_expr()
        if self.cur.kind != "end":
            raise ExprError(f"Unexpected {self.cur.value!r} at {self.cur.pos} in {self.src!r}")
        return node

    def or_expr(self) -> tuple:
        node = self.and_expr()
        while self.accept("kw", "or"):
            node = ("or", node, self.and_expr())
        return node

    def and_expr(self) -> tuple:
        node = self.not_expr()
        while self.accept("kw", "and"):
            node = ("and", node, self.not_expr())
        return node

    def not_expr(self) -> tuple:
        if self.accept("kw", "not"):
            return ("not", self.not_expr())
        return self.comparison()

    def comparison(self) -> tuple:
        left = self.additive()
        t = self.cur
        if t.kind == "op" and t.value in ("==", "!=", "<", "<=", ">", ">="):
            self.i += 1
            return ("cmp", t.value, left, self.additive())
        if t.kind == "kw" and t.value in ("contains", "in"):
            self.i += 1
            return ("cmp", t.value, left, self.additive())
        if t.kind == "kw" and t.value == "not" and self.toks[self.i + 1].value == "in":
            self.i += 2
            return ("not", ("cmp", "in", left, self.additive()))
        return left

    def additive(self) -> tuple:
        node = self.term()
        while self.cur.kind == "op" and self.cur.value in ("+", "-"):
            op = self.eat("op").value
            node = ("bin", op, node, self.term())
        return node

    def term(self) -> tuple:
        node = self.unary()
        while self.cur.kind == "op" and self.cur.value in ("*", "/"):
            op = self.eat("op").value
            node = ("bin", op, node, self.unary())
        return node

    def unary(self) -> tuple:
        if self.accept("op", "-"):
            return ("neg", self.unary())
        return self.primary()

    def primary(self) -> tuple:
        t = self.cur
        if t.kind in ("num", "str"):
            self.i += 1
            return ("lit", t.value)
        if t.kind == "kw" and t.value in ("true", "false", "null", "none"):
            self.i += 1
            return ("lit", {"true": True, "false": False}.get(t.value))
        if self.accept("op", "("):
            node = self.or_expr()
            self.eat("op", ")")
            return node
        if self.accept("op", "["):
            items: list[tuple] = []
            if not self.accept("op", "]"):
                items.append(self.or_expr())
                while self.accept("op", ","):
                    items.append(self.or_expr())
                self.eat("op", "]")
            return ("list", items)
        if t.kind == "name":
            self.i += 1
            if self.accept("op", "("):
                if t.value not in FUNCTIONS:
                    raise ExprError(f"Unknown function {t.value!r}")
                args: list[tuple] = []
                if not self.accept("op", ")"):
                    args.append(self.or_expr())
                    while self.accept("op", ","):
                        args.append(self.or_expr())
                    self.eat("op", ")")
                return ("call", t.value, args)
            parts = [t.value]
            while self.accept("op", "."):
                parts.append(self.eat("name").value)
            return ("path", tuple(parts))
        raise ExprError(f"Unexpected {t.value!r} at {t.pos} in {self.src!r}")


# --------------------------------------------------------------------------- functions


def _len(x: Any) -> int:
    return len(x) if isinstance(x, (list, tuple, str, dict, set)) else 0


def _any_of(xs: Any, ys: Any) -> bool:
    xs = xs or []
    return any(y in xs for y in (ys or []))


def _all_of(xs: Any, ys: Any) -> bool:
    xs = xs or []
    return all(y in xs for y in (ys or []))


def _num(f: Callable[..., Any]) -> Callable[..., Any]:
    def wrapped(*args: Any) -> Any:
        vals = [a for a in args if isinstance(a, (int, float)) and not isinstance(a, bool)]
        return f(*vals) if vals else None

    return wrapped


FUNCTIONS: dict[str, Callable[..., Any]] = {
    "len": _len,
    "count": _len,
    "any_of": _any_of,
    "all_of": _all_of,
    "min": _num(min),
    "max": _num(max),
    "abs": _num(abs),
    "has": lambda x: x is not None and x != [] and x != "",
    "lower": lambda x: x.lower() if isinstance(x, str) else x,
}


# --------------------------------------------------------------------------- evaluation


def _resolve(ctx: Mapping[str, Any], parts: tuple[str, ...]) -> Any:
    cur: Any = ctx
    for p in parts:
        if isinstance(cur, Mapping):
            cur = cur.get(p)
        elif hasattr(cur, "__dataclass_fields__") or hasattr(cur, "model_fields"):
            cur = getattr(cur, p, None)
        else:
            return None
        if cur is None:
            return None
    return cur


def _is_num(x: Any) -> bool:
    return isinstance(x, (int, float)) and not isinstance(x, bool)


def _cmp(op: str, a: Any, b: Any) -> bool:
    if op == "==":
        return a == b
    if op == "!=":
        return a != b
    if op == "contains":
        if a is None:
            return False
        if isinstance(a, (list, tuple, set, dict)):
            return b in a
        if isinstance(a, str) and isinstance(b, str):
            return b in a
        return False
    if op == "in":
        return _cmp("contains", b, a)
    if a is None or b is None:
        return False
    if _is_num(a) and _is_num(b) or isinstance(a, str) and isinstance(b, str):
        return {"<": a < b, "<=": a <= b, ">": a > b, ">=": a >= b}[op]
    return False


def _eval(node: tuple, ctx: Mapping[str, Any]) -> Any:
    kind = node[0]
    if kind == "lit":
        return node[1]
    if kind == "path":
        return _resolve(ctx, node[1])
    if kind == "and":
        return bool(_eval(node[1], ctx)) and bool(_eval(node[2], ctx))
    if kind == "or":
        return bool(_eval(node[1], ctx)) or bool(_eval(node[2], ctx))
    if kind == "not":
        return not _eval(node[1], ctx)
    if kind == "cmp":
        return _cmp(node[1], _eval(node[2], ctx), _eval(node[3], ctx))
    if kind == "neg":
        v = _eval(node[1], ctx)
        return -v if _is_num(v) else None
    if kind == "bin":
        a, b = _eval(node[2], ctx), _eval(node[3], ctx)
        if not (_is_num(a) and _is_num(b)):
            return None
        op = node[1]
        if op == "+":
            return a + b
        if op == "-":
            return a - b
        if op == "*":
            return a * b
        return a / b if b else None
    if kind == "list":
        return [_eval(x, ctx) for x in node[1]]
    if kind == "call":
        return FUNCTIONS[node[1]](*[_eval(x, ctx) for x in node[2]])
    raise ExprError(f"Bad node {kind}")  # pragma: no cover


@lru_cache(maxsize=4096)
def compile_expr(src: str) -> tuple:
    """Parse and cache. Raises ExprError on bad syntax."""
    if not src or not src.strip():
        return ("lit", True)
    return _Parser(tokenize(src), src).parse()


def evaluate(src: str | None, ctx: Mapping[str, Any]) -> Any:
    if src is None:
        return True
    return _eval(compile_expr(src), ctx)


def truthy(src: str | None, ctx: Mapping[str, Any]) -> bool:
    return bool(evaluate(src, ctx))


def paths(src: str) -> set[tuple[str, ...]]:
    """Every dotted path an expression reads (for graph and rule validation)."""
    found: set[tuple[str, ...]] = set()

    def walk(node: tuple) -> None:
        if node[0] == "path":
            found.add(node[1])
        for child in node[1:]:
            if isinstance(child, tuple) and child and isinstance(child[0], str):
                walk(child)
            elif isinstance(child, list):
                for c in child:
                    if isinstance(c, tuple):
                        walk(c)

    walk(compile_expr(src))
    return found


def validate(src: str, allowed_roots: Iterable[str]) -> list[str]:
    """Return problems (empty list if fine): syntax errors and unknown roots."""
    try:
        found = paths(src)
    except ExprError as e:
        return [str(e)]
    allowed = set(allowed_roots)
    return [f"unknown name {'.'.join(p)!r}" for p in sorted(found) if p[0] not in allowed]
