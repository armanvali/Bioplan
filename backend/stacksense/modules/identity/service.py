"""Accounts and passwordless auth.

Magic links in v1 (a managed provider with passkeys can replace this behind the same
``current_user`` dependency). Access tokens are signed and short-lived enough for a
PWA; the intake works without an account and data is linked only when the user saves.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from stacksense.config import get_settings
from stacksense.core import tokens
from stacksense.core.errors import DomainError, Unauthorized
from stacksense.core.ids import new_id
from stacksense.db import utcnow
from stacksense.modules.identity.models import MagicLink, User
from stacksense.modules.profile.keys import decrypt_identity, email_hash, encrypt_identity

ACCESS_TTL = 30 * 24 * 3600
MAGIC_TTL = 15 * 60


def _valid_email(email: str) -> bool:
    email = email.strip()
    return 3 <= len(email) <= 254 and "@" in email and "." in email.split("@")[-1] and " " not in email


class IdentityService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.settings = get_settings()

    def get_or_create_user(self, email: str, locale: str = "en", country: str | None = None) -> tuple[User, bool]:
        if not _valid_email(email):
            raise DomainError("bad_email", "Enter a valid email address")
        h = email_hash(email)
        user = self.db.scalar(select(User).where(User.email_hash == h))
        if user:
            if user.status == "deleted":
                user.status = "active"
                user.deleted_at = None
                user.email_enc = encrypt_identity(email.strip().lower())
            return user, False
        user = User(id=new_id("usr"), email_hash=h, email_enc=encrypt_identity(email.strip().lower()), locale=locale, country=country)
        self.db.add(user)
        self.db.flush()
        return user, True

    def email_of(self, user: User) -> str:
        return str(decrypt_identity(user.email_enc))

    def request_magic_link(self, email: str, purpose: str = "login", payload: dict[str, Any] | None = None) -> str:
        if not _valid_email(email):
            raise DomainError("bad_email", "Enter a valid email address")
        jti = new_id("ml")
        h = email_hash(email)
        self.db.add(MagicLink(jti=jti, email_hash=h, purpose=purpose, payload={**(payload or {}), "email_enc": encrypt_identity(email.strip().lower())}, expires_at=utcnow() + timedelta(seconds=MAGIC_TTL)))
        self.db.flush()
        token = tokens.sign(self.settings.secret_key, "magic", {"jti": jti}, MAGIC_TTL)
        from stacksense.modules.notify.service import NotifyService

        NotifyService(self.db).enqueue(None, "email", "magic_link", {"to_enc": encrypt_identity(email.strip().lower()), "link": f"{self.settings.public_web_url}/auth/callback?token={token}"}, dedupe_key=f"ml:{jti}")
        return token

    def verify_magic_link(self, token: str) -> tuple[User, MagicLink, bool]:
        claims = tokens.verify(self.settings.secret_key, "magic", token)
        link = self.db.get(MagicLink, claims["jti"])
        if link is None or link.used_at is not None:
            raise Unauthorized("link_used", "This link was already used. Request a new one.")
        if link.expires_at < utcnow():
            raise Unauthorized("link_expired", "This link expired. Request a new one.")
        link.used_at = utcnow()
        email = str(decrypt_identity(link.payload["email_enc"]))
        user, created = self.get_or_create_user(email)
        user.last_active_at = utcnow()
        return user, link, created

    def access_token(self, user: User) -> str:
        return tokens.sign(self.settings.secret_key, "access", {"sub": user.id}, ACCESS_TTL)

    def user_from_token(self, token: str) -> User:
        claims = tokens.verify(self.settings.secret_key, "access", token)
        user = self.db.get(User, claims["sub"])
        if user is None or user.status != "active":
            raise Unauthorized("no_user", "Account not found or suspended")
        return user

    def public(self, user: User) -> dict[str, Any]:
        email = self.email_of(user)
        local, _, domain = email.partition("@")
        return {
            "id": user.id, "email": email, "email_masked": f"{local[:1]}***@{domain}", "locale": user.locale, "tz": user.tz,
            "country": user.country, "has_profile": bool(user.subject_id), "created_at": user.created_at.isoformat(),
        }
