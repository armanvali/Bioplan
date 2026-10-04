"""Affiliate link router (section 7.3).

1. Resolve the storefront from the user's country (amazon.ca for Canada, amazon.com for
   the US, iHerb as the global fallback).
2. Choose the retailer per product: availability first, then price, then commission rate
   -- commission only ever breaks a tie.
3. Build the URL with the right tag; clicks are logged as {user_hash, plan_id, product_id,
   retailer, ts} through ``/clicks`` and redirected by ``/go/{click_id}``.

Prices are cached for at most 24 hours and always shown with "price as of".
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import quote_plus

FX_TO = {("USD", "CAD"): 1.37, ("CAD", "USD"): 1 / 1.37}
PRICE_MAX_AGE = timedelta(hours=24)


def storefront_for(country: str | None) -> str:
    return {"CA": "CA", "US": "US"}.get(country or "", "GLOBAL")


def currency_for(storefront: str) -> str:
    return {"CA": "CAD", "US": "USD"}.get(storefront, "USD")


def convert(amount: float, frm: str, to: str) -> float:
    if frm == to:
        return amount
    return round(amount * FX_TO.get((frm, to), 1.0), 2)


class LinkRouter:
    def __init__(self, retailers: list[dict[str, Any]], tags: dict[str, str], now: datetime | None = None) -> None:
        self.retailers = {r["id"]: r for r in retailers if r.get("active", True)}
        self.tags = tags
        self.now = now

    def offer_for(self, product: dict[str, Any], storefront: str) -> dict[str, Any] | None:
        currency = currency_for(storefront)
        options = []
        for o in product.get("offers", []):
            r = self.retailers.get(o["retailer"])
            if not r or r["storefront"] not in (storefront, "GLOBAL"):
                continue
            price_local = convert(o["price"], o["currency"], currency)
            # Availability first, then price, then commission (tie-breaker only).
            options.append(((0 if o.get("in_stock", True) else 1, price_local, -r["commission_rate"], r["id"]), o, r, price_local))
        if not options:
            return None
        options.sort(key=lambda t: t[0])
        _, o, r, price_local = options[0]
        as_of = product.get("updated_at")
        stale = False
        if as_of:
            try:
                ts = datetime.fromisoformat(as_of.replace("Z", "+00:00"))
                stale = (self.now or datetime.now(UTC)) - ts > PRICE_MAX_AGE
            except ValueError:
                stale = False
        return {
            "retailer": r["id"], "retailer_name": r["name"], "price": o["price"], "currency": o["currency"],
            "price_local": price_local, "currency_local": currency, "in_stock": o.get("in_stock", True),
            "url": self.build_url(r, o, product), "price_as_of": as_of, "price_stale": stale,
            "disclosure": r.get("disclosure", ""),
        }

    def build_url(self, retailer: dict[str, Any], offer: dict[str, Any], product: dict[str, Any]) -> str:
        tag = self.tags.get(retailer.get("tag_ref") or "", "")
        if offer.get("asin") and "{asin}" in retailer["link_template"]:
            return retailer["link_template"].format(asin=offer["asin"], tag=tag)
        if offer.get("sku") and "{sku}" in retailer["link_template"]:
            return retailer["link_template"].format(sku=offer["sku"], tag=tag)
        query = offer.get("query") or f"{product['brand']} {product['name']}"
        return retailer["search_template"].format(query=quote_plus(query), tag=tag)
