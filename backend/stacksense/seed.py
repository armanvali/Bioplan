"""Seed reference data (billing plans, catalog) and, in dev, demo staff accounts.

    stacksense-seed            # reference data only (safe in production)
    stacksense-seed --dev      # plus demo staff with printed TOTP secrets
"""

from __future__ import annotations

import argparse

from sqlalchemy import select
from sqlalchemy.orm import Session

from stacksense.config import get_settings
from stacksense.db import create_all, get_engine, session_scope

DEV_STAFF = [
    ("admin@stacksense.dev", "Avery Admin", "super_admin"),
    ("editor@stacksense.dev", "Elliot Editor", "clinical_editor"),
    ("pharmacist@stacksense.dev", "Pat Pharmacist", "clinical_reviewer"),
    ("catalog@stacksense.dev", "Casey Catalog", "catalog_manager"),
    ("revenue@stacksense.dev", "Riley Revenue", "revenue_manager"),
    ("support@stacksense.dev", "Sam Support", "support_agent"),
    ("analyst@stacksense.dev", "Alex Analyst", "analyst"),
]


def seed_reference(db: Session) -> None:
    from stacksense.modules.admin.catalog_admin import seed_catalog
    from stacksense.modules.billing.entitlements import seed_billing

    seed_billing(db)
    seed_catalog(db)
    if get_settings().env in ("dev", "test"):
        seed_dev_staff(db, quiet=True)


def seed_dev_staff(db: Session, quiet: bool = False) -> list[tuple[str, str, str]]:
    from stacksense.modules.admin.auth import AdminAuth
    from stacksense.modules.admin.models import AdminUser

    out = []
    for email, name, role in DEV_STAFF:
        if db.scalar(select(AdminUser).where(AdminUser.email == email)):
            continue
        _, secret = AdminAuth(db).create_admin(email, name, role)
        out.append((email, role, secret))
        if not quiet:
            print(f"{role:18s} {email:28s} TOTP secret {secret}")
    return out


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dev", action="store_true", help="also create demo staff accounts")
    parser.add_argument("--create-tables", action="store_true", help="create tables directly (dev only; production uses Alembic)")
    args = parser.parse_args()
    if args.create_tables:
        create_all(get_engine())
    with session_scope() as db:
        from stacksense.modules.admin.catalog_admin import seed_catalog
        from stacksense.modules.billing.entitlements import seed_billing

        seed_billing(db)
        seed_catalog(db)
        if args.dev:
            seed_dev_staff(db)
    print("seeded")


if __name__ == "__main__":
    main()
