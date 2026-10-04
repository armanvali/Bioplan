"""FastAPI dependencies: database session, users, intake/plan tokens, staff scopes, rate limits."""

from __future__ import annotations

from collections.abc import Callable
from typing import Annotated

from fastapi import Depends, Header, Request
from sqlalchemy.orm import Session

from stacksense.config import get_settings
from stacksense.core.errors import Forbidden, Unauthorized
from stacksense.core.ratelimit import RateLimiter
from stacksense.db import get_db
from stacksense.modules.admin.models import AdminUser
from stacksense.modules.admin.roles import scopes_for
from stacksense.modules.billing.entitlements import Entitlements
from stacksense.modules.identity.models import User
from stacksense.modules.identity.service import IdentityService

DB = Annotated[Session, Depends(get_db)]

_limiter: RateLimiter | None = None


def limiter() -> RateLimiter:
    global _limiter
    if _limiter is None:
        _limiter = RateLimiter(get_settings().redis_url)
    return _limiter


def _bearer(authorization: str | None) -> str | None:
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    return None


def optional_user(db: DB, authorization: Annotated[str | None, Header()] = None) -> User | None:
    token = _bearer(authorization)
    if not token:
        return None
    try:
        return IdentityService(db).user_from_token(token)
    except Unauthorized:
        return None


def current_user(db: DB, authorization: Annotated[str | None, Header()] = None) -> User:
    token = _bearer(authorization)
    if not token:
        raise Unauthorized("login_required", "Sign in to continue")
    return IdentityService(db).user_from_token(token)


OptionalUser = Annotated[User | None, Depends(optional_user)]
CurrentUser = Annotated[User, Depends(current_user)]


def features_of(db: Session, user: User | None) -> set[str]:
    return Entitlements(db).features(user.id if user else None)


def session_token(x_session_token: Annotated[str | None, Header()] = None) -> str | None:
    return x_session_token


def plan_token(x_plan_token: Annotated[str | None, Header()] = None, token: str | None = None) -> str | None:
    return x_plan_token or token


SessionToken = Annotated[str | None, Depends(session_token)]
PlanToken = Annotated[str | None, Depends(plan_token)]


def rate_limit(group: str, per_minute: int | None = None) -> Callable[[Request], None]:
    def dep(request: Request) -> None:
        ip = request.headers.get("x-forwarded-for", "").split(",")[0].strip() or (request.client.host if request.client else "unknown")
        limiter().hit(f"{group}:{ip}", per_minute or get_settings().rate_limit_per_minute)

    return dep


def current_admin(db: DB, authorization: Annotated[str | None, Header()] = None) -> AdminUser:
    from stacksense.modules.admin.auth import AdminAuth

    token = _bearer(authorization)
    if not token:
        raise Unauthorized("admin_login_required", "Staff sign-in required")
    return AdminAuth(db).from_token(token)


CurrentAdmin = Annotated[AdminUser, Depends(current_admin)]


def require(scope: str) -> Callable[[AdminUser], AdminUser]:
    """Least-privilege scope check on every /admin/v1 endpoint."""

    def dep(admin: CurrentAdmin) -> AdminUser:
        if scope not in scopes_for(admin.role):
            raise Forbidden("missing_scope", f"Your role can't do this ({scope})")
        return admin

    return dep
