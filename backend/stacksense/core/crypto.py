"""Envelope encryption for health data (section 14.4).

Each pseudonymous subject gets its own data key (DEK). Answers, labs, medications
and profile-event payloads are encrypted with that DEK using AES-256-GCM. The DEK
is stored only wrapped by a master key. In production the master key lives in a
KMS (``KeyProvider`` is the seam); in dev it comes from ``STACKSENSE_MASTER_KEY``.

Deleting a subject's wrapped DEK makes every copy of their ciphertext unreadable,
including backups: crypto-shredding.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
from typing import Any, Protocol

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

_VERSION = "v1"


def _b64e(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def _b64d(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


class KeyProvider(Protocol):
    def wrap(self, dek: bytes) -> str: ...
    def unwrap(self, wrapped: str) -> bytes: ...


class LocalKeyProvider:
    """AES-GCM key wrapping with a locally configured master key (dev / tests)."""

    def __init__(self, master_key_b64: str) -> None:
        raw = _b64d(master_key_b64)
        # Derive a proper 256-bit key from whatever was configured.
        self._key = hashlib.sha256(b"stacksense-kek|" + raw).digest()

    def wrap(self, dek: bytes) -> str:
        nonce = os.urandom(12)
        ct = AESGCM(self._key).encrypt(nonce, dek, b"dek")
        return f"{_VERSION}.{_b64e(nonce + ct)}"

    def unwrap(self, wrapped: str) -> bytes:
        version, body = wrapped.split(".", 1)
        if version != _VERSION:
            raise ValueError(f"Unknown key version {version}")
        raw = _b64d(body)
        return AESGCM(self._key).decrypt(raw[:12], raw[12:], b"dek")


def new_dek() -> bytes:
    return AESGCM.generate_key(bit_length=256)


def encrypt_json(dek: bytes, value: Any, aad: str = "") -> str:
    nonce = os.urandom(12)
    pt = json.dumps(value, separators=(",", ":"), sort_keys=True, default=str).encode()
    ct = AESGCM(dek).encrypt(nonce, pt, aad.encode())
    return f"{_VERSION}.{_b64e(nonce + ct)}"


def decrypt_json(dek: bytes, token: str, aad: str = "") -> Any:
    version, body = token.split(".", 1)
    if version != _VERSION:
        raise ValueError(f"Unknown ciphertext version {version}")
    raw = _b64d(body)
    return json.loads(AESGCM(dek).decrypt(raw[:12], raw[12:], aad.encode()))


def keyed_hash(secret: str, value: str, purpose: str = "id") -> str:
    """Stable pseudonymous hash, e.g. the ``user_hash`` in click logs."""
    return hmac.new(f"{purpose}|{secret}".encode(), value.encode(), hashlib.sha256).hexdigest()[:32]


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()
