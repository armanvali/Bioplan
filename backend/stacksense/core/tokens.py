"""Signed, expiring tokens (HMAC-SHA256) for sessions, magic links and calendar feeds.

Format: ``<b64url(json payload)>.<b64url(signature)>``. The payload always carries
``pur`` (purpose) and ``exp`` (unix seconds) so a calendar token can never be used
as a session token and vice versa.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from typing import Any

from stacksense.core.errors import Unauthorized


def _b64e(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def _b64d(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def sign(secret: str, purpose: str, claims: dict[str, Any], ttl_seconds: int) -> str:
    payload = {**claims, "pur": purpose, "exp": int(time.time()) + ttl_seconds}
    body = _b64e(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode())
    sig = hmac.new(secret.encode(), f"{purpose}.{body}".encode(), hashlib.sha256).digest()
    return f"{body}.{_b64e(sig)}"


def verify(secret: str, purpose: str, token: str) -> dict[str, Any]:
    try:
        body, sig = token.split(".", 1)
    except ValueError as e:
        raise Unauthorized("bad_token", "Malformed token") from e
    expected = hmac.new(secret.encode(), f"{purpose}.{body}".encode(), hashlib.sha256).digest()
    if not hmac.compare_digest(expected, _b64d(sig)):
        raise Unauthorized("bad_token", "Invalid token signature")
    payload = json.loads(_b64d(body))
    if payload.get("pur") != purpose:
        raise Unauthorized("bad_token", "Token used for the wrong purpose")
    if int(payload.get("exp", 0)) < int(time.time()):
        raise Unauthorized("token_expired", "Token expired")
    return payload
