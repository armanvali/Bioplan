"""Guardrails for every LLM output (section 10).

* Faithfulness: every number and every ingredient name in the output must exist in
  the plan JSON. Any mismatch rejects the output.
* Claims filter: blocks disease-treatment language that supplement rules don't allow
  ("cures", "treats anxiety") and adds the standard disclaimer.
* Reading level: Flesch-Kincaid grade, target <= 8 (rejected above the hard cap).
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from typing import Any

DISCLAIMER = (
    "StackSense gives general information, not medical advice. Talk to a doctor or pharmacist before "
    "starting supplements, especially if you take medication, are pregnant, or have a health condition."
)

_CLAIM_PATTERNS = [
    r"\bcure[sd]?\b", r"\bcuring\b", r"\btreat(s|ed|ing|ment)?\b", r"\bheal(s|ed|ing)?\b",
    r"\bprevent(s|ed|ing)?\s+(disease|cancer|diabetes|depression|covid|heart disease|alzheimer)",
    r"\bdiagnos(e|es|ed|is|ing)\b", r"\breverse[sd]?\b", r"\bguarantee[sd]?\b", r"\bmiracle\b",
    r"\b(anxiety|depression|insomnia|arthritis|anemia|anaemia)\s+(disorder|disease)\b",
    r"\bwill (fix|cure|eliminate|get rid of)\b", r"\bclinically proven to\b",
]
_CLAIM_RE = re.compile("|".join(_CLAIM_PATTERNS), re.I)
_NUM_RE = re.compile(r"(?<![\w.])(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(?![\w])")


def claim_violations(text: str) -> list[str]:
    return sorted({m.group(0).lower() for m in _CLAIM_RE.finditer(text or "")})


def numbers_in(text: str) -> set[str]:
    return {_norm_num(m.group(1)) for m in _NUM_RE.finditer(text or "")}


def _norm_num(s: str) -> str:
    s = s.replace(",", "")
    try:
        f = float(s)
    except ValueError:
        return s
    return str(int(f)) if f.is_integer() else str(f)


def allowed_numbers(obj: Any) -> set[str]:
    """Every number that appears anywhere in the source JSON (values and inside strings)."""
    out: set[str] = set()

    def walk(x: Any) -> None:
        if isinstance(x, bool) or x is None:
            return
        if isinstance(x, (int, float)):
            out.add(_norm_num(str(x)))
        elif isinstance(x, str):
            out.update(numbers_in(x))
        elif isinstance(x, dict):
            for v in x.values():
                walk(v)
        elif isinstance(x, (list, tuple)):
            for v in x:
                walk(v)

    walk(obj)
    # Small counting words a sentence may need ("1 capsule", "2 weeks off") are only allowed if present.
    return out


def faithfulness_problems(texts: Iterable[str], source: Any, vocabulary: dict[str, set[str]], allowed_ingredients: set[str]) -> list[str]:
    """Numbers must come from ``source``; ingredient mentions must be in ``allowed_ingredients``.
    ``vocabulary`` maps lower-case names/aliases -> the ingredient ids that name can refer to."""
    problems: list[str] = []
    nums = allowed_numbers(source)
    for t in texts:
        for n in numbers_in(t):
            if n not in nums:
                problems.append(f"number {n} not in plan")
        low = (t or "").lower()
        for name, ing in vocabulary.items():
            if re.search(rf"\b{re.escape(name)}\b", low) and not (ing & allowed_ingredients):
                problems.append(f"mentions {name} which isn't in this plan")
    return sorted(set(problems))


def _syllables(word: str) -> int:
    word = word.lower()
    groups = re.findall(r"[aeiouy]+", word)
    n = len(groups)
    if word.endswith("e") and n > 1 and not word.endswith("le"):
        n -= 1
    return max(1, n)


def reading_grade(text: str) -> float:
    sentences = max(1, len(re.findall(r"[.!?]+", text)) or 1)
    words = re.findall(r"[A-Za-z']+", text)
    if not words:
        return 0.0
    syl = sum(_syllables(w) for w in words)
    return round(0.39 * (len(words) / sentences) + 11.8 * (syl / len(words)) - 15.59, 1)


def ingredient_vocabulary(kb: Any) -> dict[str, set[str]]:
    """Names that refer to an ingredient. Shared names (e.g. "omega-3") map to every member."""
    vocab: dict[str, set[str]] = {}
    for ing in kb.ingredients.values():
        for name in {ing.name.lower(), ing.short.lower(), ing.id.replace("_", " ")}:
            if len(name) >= 4:
                vocab.setdefault(name, set()).add(ing.id)
    return vocab
