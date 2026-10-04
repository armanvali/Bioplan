"""Injectable clock so tests and golden personas are reproducible."""

from __future__ import annotations

from datetime import UTC, date, datetime

_frozen: datetime | None = None


def now() -> datetime:
    return _frozen or datetime.now(UTC)


def today() -> date:
    return now().date()


def freeze(at: datetime | None) -> None:
    """Freeze the clock (tests). ``None`` unfreezes."""
    global _frozen
    _frozen = at
