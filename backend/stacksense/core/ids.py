"""Prefixed, sortable, URL-safe identifiers (``pl_01J9...``, ``ses_01J9...``)."""

from __future__ import annotations

import os
import time

_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz"  # Crockford base32, lower case


def _b32(n: int, length: int) -> str:
    out = []
    for _ in range(length):
        out.append(_ALPHABET[n & 31])
        n >>= 5
    return "".join(reversed(out))


def new_id(prefix: str) -> str:
    """48-bit millisecond timestamp + 80 random bits, like a ULID, with a type prefix."""
    ts = int(time.time() * 1000) & ((1 << 48) - 1)
    rnd = int.from_bytes(os.urandom(10), "big")
    return f"{prefix}_{_b32(ts, 10)}{_b32(rnd, 16)}"
