"""Per-subject data keys and field-level encryption helpers.

``KeyRing.dek(subject_id)`` unwraps (and caches for the request) the subject's data
key. ``shred(subject_id)`` drops the wrapped key: every ciphertext for that subject,
including backups, becomes unreadable.
"""

from __future__ import annotations

import hashlib
from typing import Any

from sqlalchemy.orm import Session

from stacksense.config import get_settings
from stacksense.core import crypto
from stacksense.core.errors import NotFound
from stacksense.core.ids import new_id
from stacksense.db import utcnow
from stacksense.modules.profile.models import Subject


class KeyRing:
    def __init__(self, db: Session, provider: crypto.KeyProvider | None = None) -> None:
        self.db = db
        self.provider = provider or crypto.LocalKeyProvider(get_settings().master_key)
        self._cache: dict[str, bytes] = {}

    def new_subject(self, anonymous: bool = True) -> Subject:
        dek = crypto.new_dek()
        subj = Subject(id=new_id("sub"), wrapped_dek=self.provider.wrap(dek), anonymous=anonymous)
        self.db.add(subj)
        self.db.flush()
        self._cache[subj.id] = dek
        return subj

    def dek(self, subject_id: str) -> bytes:
        if subject_id in self._cache:
            return self._cache[subject_id]
        subj = self.db.get(Subject, subject_id)
        if subj is None or subj.wrapped_dek is None:
            raise NotFound("subject_shredded", "This health profile no longer exists")
        dek = self.provider.unwrap(subj.wrapped_dek)
        self._cache[subject_id] = dek
        return dek

    def encrypt(self, subject_id: str, value: Any, aad: str = "") -> str:
        return crypto.encrypt_json(self.dek(subject_id), value, aad=f"{subject_id}|{aad}")

    def decrypt(self, subject_id: str, token: str, aad: str = "") -> Any:
        return crypto.decrypt_json(self.dek(subject_id), token, aad=f"{subject_id}|{aad}")

    def shred(self, subject_id: str) -> None:
        subj = self.db.get(Subject, subject_id)
        if subj:
            subj.wrapped_dek = None
            subj.deleted_at = utcnow()
        self._cache.pop(subject_id, None)


def _system_key() -> bytes:
    return hashlib.sha256(b"stacksense-identity|" + get_settings().master_key.encode()).digest()


def encrypt_identity(value: Any) -> str:
    """Identity fields (email) use a system key separate from health keys."""
    return crypto.encrypt_json(_system_key(), value, aad="identity")


def decrypt_identity(token: str) -> Any:
    return crypto.decrypt_json(_system_key(), token, aad="identity")


def email_hash(email: str) -> str:
    return crypto.keyed_hash(get_settings().secret_key, email.strip().lower(), "email")


def user_hash(user_or_subject_id: str) -> str:
    """Pseudonymous id for click logs and analytics."""
    return crypto.keyed_hash(get_settings().secret_key, user_or_subject_id, "actor")
