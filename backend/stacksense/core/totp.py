"""RFC 6238 TOTP for admin MFA (the second factor behind staff SSO)."""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import struct
import time


def new_secret() -> str:
    return base64.b32encode(os.urandom(20)).decode().rstrip("=")


def code_at(secret: str, at: float | None = None, step: int = 30, digits: int = 6) -> str:
    key = base64.b32decode(secret + "=" * (-len(secret) % 8), casefold=True)
    counter = int((at if at is not None else time.time()) // step)
    digest = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    value = struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF
    return str(value % 10**digits).zfill(digits)


def verify(secret: str, code: str, window: int = 1, at: float | None = None) -> bool:
    now = at if at is not None else time.time()
    return any(hmac.compare_digest(code_at(secret, now + i * 30), code) for i in range(-window, window + 1))


def provisioning_uri(secret: str, account: str, issuer: str = "StackSense Admin") -> str:
    from urllib.parse import quote

    return f"otpauth://totp/{quote(issuer)}:{quote(account)}?secret={secret}&issuer={quote(issuer)}"
