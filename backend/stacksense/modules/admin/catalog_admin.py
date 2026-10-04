"""Affiliate & catalog workspace (section 15.4). Overrides change product order only,
never which ingredient is recommended, and always need a written reason."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from stacksense.core.errors import DomainError, NotFound
from stacksense.db import utcnow
from stacksense.modules.admin.audit import audit
from stacksense.modules.admin.models import AdminUser
from stacksense.modules.affiliate.router import PRICE_MAX_AGE
from stacksense.modules.catalog.models import (
    Click,
    Conversion,
    LinkCheck,
    Product,
    ProductOverride,
    RetailerProgram,
)
from stacksense.modules.catalog.scoring import RANK_STEPS, certification_score
from stacksense.modules.catalog.service import load_seed_catalog

REQUIRED_PRODUCT_FIELDS = ("id", "brand", "name", "form", "ingredients", "units_per_serving", "servings_per_container", "certs", "rating", "review_count", "attributes", "offers")


def seed_catalog(db: Session) -> None:
    if db.scalar(select(Product).limit(1)):
        return
    seed = load_seed_catalog()
    for p in seed.products:
        db.add(Product(id=p["id"], data=p))
    for r in seed.retailers:
        db.add(RetailerProgram(id=r["id"], data=r, active=r.get("active", True)))
    db.flush()


class CatalogAdmin:
    def __init__(self, db: Session, actor: AdminUser) -> None:
        self.db = db
        self.actor = actor

    def _audit(self, action: str, target_type: str, target: str | None, before: Any = None, after: Any = None, reason: str | None = None) -> None:
        audit(self.db, self.actor.id, self.actor.role, action, target_type, target, before, after, reason)

    def products(self, ingredient: str | None = None) -> list[dict[str, Any]]:
        rows = self.db.scalars(select(Product).order_by(Product.id)).all()
        out = []
        for r in rows:
            d = r.data
            if ingredient and not any(x["ingredient_id"] == ingredient for x in d.get("ingredients", [])):
                continue
            cert, tier = certification_score(d.get("certs", []))
            out.append({**d, "active": r.active, "certification_tier": tier, "certification_score": cert, "updated_at": r.updated_at.isoformat()})
        return out

    def upsert_product(self, data: dict[str, Any], reason: str | None = None) -> dict[str, Any]:
        missing = [f for f in REQUIRED_PRODUCT_FIELDS if f not in data]
        if missing:
            raise DomainError("missing_fields", f"Missing fields: {', '.join(missing)}")
        for line in data["ingredients"]:
            if not {"ingredient_id", "amount", "unit"} <= set(line):
                raise DomainError("bad_label", "Each label line needs ingredient_id, amount and unit")
        data = {**data, "updated_at": utcnow().isoformat().replace("+00:00", "Z")}
        row = self.db.get(Product, data["id"])
        before = row.data if row else None
        if row is None:
            row = Product(id=data["id"], data=data, updated_by=self.actor.id)
            self.db.add(row)
        else:
            row.data, row.updated_by = data, self.actor.id
        self.db.flush()
        self._audit("catalog.product", "product", data["id"], before, data, reason)
        return data

    def set_active(self, product_id: str, active: bool, reason: str) -> dict[str, Any]:
        row = self.db.get(Product, product_id)
        if row is None:
            raise NotFound("unknown_product", "Product not found")
        row.active = active
        self._audit("catalog.product_active", "product", product_id, None, {"active": active}, reason)
        return {"id": product_id, "active": active}

    def retailers(self) -> list[dict[str, Any]]:
        out = []
        for r in self.db.scalars(select(RetailerProgram).order_by(RetailerProgram.id)).all():
            d = dict(r.data)
            d["tag_ref"] = d.get("tag_ref")  # vault key name only; secrets are never returned in full
            out.append({**d, "active": r.active})
        return out

    def upsert_retailer(self, data: dict[str, Any], reason: str | None = None) -> dict[str, Any]:
        for f in ("id", "name", "storefront", "network", "commission_rate", "link_template", "search_template"):
            if f not in data:
                raise DomainError("missing_fields", f"Missing {f}")
        if any(k in data for k in ("tag", "secret", "api_key")):
            raise DomainError("no_secrets", "Store tags and credentials in the secrets vault; reference them with tag_ref")
        row = self.db.get(RetailerProgram, data["id"])
        before = row.data if row else None
        if row is None:
            self.db.add(RetailerProgram(id=data["id"], data=data, active=data.get("active", True)))
        else:
            row.data, row.active = data, data.get("active", True)
        self.db.flush()
        self._audit("catalog.retailer", "retailer", data["id"], before, data, reason)
        return data

    def overrides(self) -> list[dict[str, Any]]:
        rows = self.db.scalars(select(ProductOverride).order_by(ProductOverride.created_at.desc())).all()
        return [{"id": o.id, "product_id": o.product_id, "action": o.action, "reason": o.reason, "actor": o.actor, "active": o.active,
                 "created_at": o.created_at.isoformat(), "expires_at": o.expires_at.isoformat() if o.expires_at else None} for o in rows]

    def add_override(self, product_id: str, action: str, reason: str, expires_days: int | None = None) -> dict[str, Any]:
        if action not in ("pin", "demote", "ban"):
            raise DomainError("bad_action", "action must be pin, demote or ban")
        if not reason or len(reason.strip()) < 5:
            raise DomainError("reason_required", "Overrides need a written reason (quality issue, recall, supplier problem)")
        if self.db.get(Product, product_id) is None:
            raise NotFound("unknown_product", "Product not found")
        for o in self.db.scalars(select(ProductOverride).where(ProductOverride.product_id == product_id, ProductOverride.active.is_(True))).all():
            o.active = False
        o = ProductOverride(product_id=product_id, action=action, reason=reason.strip(), actor=self.actor.id,
                            expires_at=utcnow() + timedelta(days=expires_days) if expires_days else None)
        self.db.add(o)
        self.db.flush()
        self._audit("catalog.override", "product", product_id, None, {"action": action}, reason)
        return {"id": o.id, "product_id": product_id, "action": action}

    def remove_override(self, override_id: int, reason: str) -> dict[str, Any]:
        o = self.db.get(ProductOverride, override_id)
        if o is None:
            raise NotFound("unknown_override", "Override not found")
        o.active = False
        self._audit("catalog.override_removed", "product", o.product_id, {"action": o.action}, None, reason)
        return {"ok": True}

    def run_link_health(self, tags: dict[str, str], now: datetime | None = None) -> dict[str, Any]:
        return run_link_health(self.db, tags, now)

    def link_health(self) -> list[dict[str, Any]]:
        sub = select(LinkCheck.product_id, LinkCheck.retailer, func.max(LinkCheck.id).label("mid")).group_by(LinkCheck.product_id, LinkCheck.retailer).subquery()
        rows = self.db.scalars(select(LinkCheck).join(sub, LinkCheck.id == sub.c.mid).order_by(LinkCheck.status, LinkCheck.product_id)).all()
        return [{"product_id": r.product_id, "retailer": r.retailer, "status": r.status, "detail": r.detail, "checked_at": r.checked_at.isoformat()} for r in rows]

    def performance(self, days: int = 30) -> dict[str, Any]:
        since = utcnow() - timedelta(days=days)
        clicks = self.db.scalars(select(Click).where(Click.ts >= since)).all()
        convs = self.db.scalars(select(Conversion).where(Conversion.ts >= since)).all()
        by_retailer: dict[str, dict[str, float]] = {}
        by_product: dict[str, dict[str, float]] = {}
        for c in clicks:
            by_retailer.setdefault(c.retailer, {"clicks": 0, "conversions": 0, "revenue": 0.0, "commission": 0.0})["clicks"] += 1
            by_product.setdefault(c.product_id, {"clicks": 0, "conversions": 0, "revenue": 0.0, "commission": 0.0})["clicks"] += 1
        for v in convs:
            r = by_retailer.setdefault(v.retailer, {"clicks": 0, "conversions": 0, "revenue": 0.0, "commission": 0.0})
            r["conversions"] += 1
            r["revenue"] += v.amount
            r["commission"] += v.commission
            if v.product_id:
                p = by_product.setdefault(v.product_id, {"clicks": 0, "conversions": 0, "revenue": 0.0, "commission": 0.0})
                p["conversions"] += 1
                p["revenue"] += v.amount
                p["commission"] += v.commission
        for d in (*by_retailer.values(), *by_product.values()):
            d["epc"] = round(d["commission"] / d["clicks"], 4) if d["clicks"] else 0.0
        return {"days": days, "by_retailer": by_retailer, "by_product": by_product, "rank_steps": RANK_STEPS}


def run_link_health(db: Session, tags: dict[str, str], now: datetime | None = None) -> dict[str, Any]:
    """Nightly checker: out-of-stock offers, stale prices, missing tags, price jumps."""
    now = now or utcnow()
    retailers = {r.id: r.data for r in db.scalars(select(RetailerProgram)).all()}
    counts: dict[str, int] = {}
    prev = {(lc.product_id, lc.retailer): lc for lc in db.scalars(select(LinkCheck).order_by(LinkCheck.id)).all()}
    for row in db.scalars(select(Product).where(Product.active.is_(True))).all():
        p = row.data
        updated = p.get("updated_at")
        stale = False
        if updated:
            try:
                stale = now - datetime.fromisoformat(updated.replace("Z", "+00:00")) > PRICE_MAX_AGE
            except ValueError:
                stale = True
        for o in p.get("offers", []):
            r = retailers.get(o["retailer"])
            status, detail = "ok", None
            if r is None:
                status, detail = "broken", "Retailer program missing or inactive"
            elif r.get("tag_ref") and not tags.get(r["tag_ref"]):
                status, detail = "missing_tag", f"No value configured for {r['tag_ref']}"
            elif not o.get("in_stock", True):
                status, detail = "out_of_stock", "Next product is auto-promoted"
            elif stale:
                status, detail = "stale_price", "Price older than 24 h; UI shows 'price as of'"
            last = prev.get((p["id"], o["retailer"]))
            if status == "ok" and last and last.detail and last.detail.startswith("price="):
                old = float(last.detail.split("=")[1])
                if old and abs(o["price"] - old) / old > 0.3:
                    status, detail = "price_jump", f"{old} -> {o['price']}"
            db.add(LinkCheck(product_id=p["id"], retailer=o["retailer"], status=status, detail=detail or f"price={o['price']}", checked_at=now))
            counts[status] = counts.get(status, 0) + 1
    db.flush()
    return {"checked_at": now.isoformat(), "counts": counts}
