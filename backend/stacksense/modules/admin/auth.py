"""Staff authentication: SSO subject + TOTP MFA, short sessions (section 15.1).

In production the identity provider asserts ``sso_subject``; the TOTP code is the
enforced second factor. ``dev_login`` (email + TOTP, or email alone in dev/test) exists
only outside production.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from stacksense.config import get_settings
from stacksense.core import tokens, totp
from stacksense.core.errors import Forbidden, Unauthorized
from stacksense.core.ids import new_id
from stacksense.db import utcnow
from stacksense.modules.admin.audit import audit
from stacksense.modules.admin.models import AdminUser
from stacksense.modules.admin.roles import ROLES, scopes_for
from stacksense.modules.profile.keys import decrypt_identity, encrypt_identity


class AdminAuth:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.settings = get_settings()

    def create_admin(self, email: str, name: str, role: str, actor: str = "system") -> tuple[AdminUser, str]:
        if role not in ROLES:
            raise Forbidden("bad_role", f"Unknown role {role}")
        secret = totp.new_secret()
        admin = AdminUser(id=new_id("adm"), email=email.lower(), name=name, role=role, totp_secret_enc=encrypt_identity(secret))
        self.db.add(admin)
        self.db.flush()
        audit(self.db, actor, "super_admin" if actor != "system" else "system", "staff.create", "admin_user", admin.id, None, {"email": admin.email, "role": role})
        return admin, secret

    def login(self, email: str, code: str | None, sso_subject: str | None = None) -> dict[str, Any]:
        admin = self.db.scalar(select(AdminUser).where(AdminUser.email == email.lower(), AdminUser.active.is_(True)))
        if admin is None:
            raise Unauthorized("bad_login", "Unknown or inactive staff account")
        if sso_subject is not None and admin.sso_subject and admin.sso_subject != sso_subject:
            raise Unauthorized("bad_login", "SSO identity mismatch")
        dev_bypass = self.settings.admin_dev_login and self.settings.env in ("dev", "test") and not code
        if not dev_bypass:
            secret = decrypt_identity(admin.totp_secret_enc) if admin.totp_secret_enc else None
            if not secret or not code or not totp.verify(secret, code):
                raise Unauthorized("bad_mfa", "Invalid MFA code")
        admin.last_login_at = utcnow()
        token = tokens.sign(self.settings.secret_key, "admin", {"sub": admin.id, "role": admin.role}, self.settings.admin_session_minutes * 60)
        audit(self.db, admin.id, admin.role, "staff.login", "admin_user", admin.id, None, {"mfa": not dev_bypass})
        return {"access_token": token, "admin": self.public(admin), "expires_in": self.settings.admin_session_minutes * 60}

    def from_token(self, token: str) -> AdminUser:
        claims = tokens.verify(self.settings.secret_key, "admin", token)
        admin = self.db.get(AdminUser, claims["sub"])
        if admin is None or not admin.active:
            raise Unauthorized("bad_admin", "Staff session no longer valid")
        if admin.role != claims.get("role"):
            raise Unauthorized("role_changed", "Your role changed; sign in again")
        return admin

    def public(self, admin: AdminUser) -> dict[str, Any]:
        return {"id": admin.id, "email": admin.email, "name": admin.name, "role": admin.role, "role_label": ROLES[admin.role]["label"], "scopes": sorted(scopes_for(admin.role))}

    def set_role(self, actor: AdminUser, admin_id: str, role: str) -> AdminUser:
        target = self.db.get(AdminUser, admin_id)
        if target is None or role not in ROLES:
            raise Forbidden("bad_target", "Unknown staff member or role")
        before = {"role": target.role}
        target.role = role
        audit(self.db, actor.id, actor.role, "staff.role", "admin_user", target.id, before, {"role": role})
        return target

    def provisioning(self, admin: AdminUser) -> str:
        return totp.provisioning_uri(decrypt_identity(admin.totp_secret_enc), admin.email)  # type: ignore[arg-type]
