"""Catalog snapshots and plan-level product matching.

A snapshot is an immutable copy of products + retailers + overrides identified by a
content hash. Plans record the snapshot they were matched against, which keeps
"(answers, labs, graph_version, rules_version, catalog_snapshot) -> identical output" true.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from functools import cached_property
from typing import Any

from stacksense.config import DATA_DIR
from stacksense.modules.affiliate.router import LinkRouter, storefront_for
from stacksense.modules.catalog import scoring

CATALOG_DIR = DATA_DIR / "catalog"


@dataclass
class CatalogSnapshot:
    products: list[dict[str, Any]]
    retailers: list[dict[str, Any]]
    form_variants: list[dict[str, Any]]
    overrides: dict[str, dict[str, Any]] = field(default_factory=dict)

    @cached_property
    def version(self) -> str:
        blob = json.dumps({"p": self.products, "r": self.retailers, "f": self.form_variants, "o": self.overrides}, sort_keys=True, default=str)
        return "cat_" + hashlib.sha256(blob.encode()).hexdigest()[:16]

    @cached_property
    def variants(self) -> dict[str, dict[str, Any]]:
        return {v["variant"]: v for v in self.form_variants}

    @cached_property
    def by_id(self) -> dict[str, dict[str, Any]]:
        return {p["id"]: p for p in self.products}

    def to_dict(self) -> dict[str, Any]:
        return {"products": self.products, "retailers": self.retailers, "form_variants": self.form_variants, "overrides": self.overrides}


def load_seed_catalog() -> CatalogSnapshot:
    return CatalogSnapshot(
        products=json.loads((CATALOG_DIR / "products.json").read_text()),
        retailers=json.loads((CATALOG_DIR / "retailers.json").read_text()),
        form_variants=json.loads((CATALOG_DIR / "form_variants.json").read_text()),
    )


def _pick_payload(pk: scoring.Pick, item: dict[str, Any]) -> dict[str, Any]:
    p = pk.product
    servings_units = p["servings_per_container"] * max(1, p.get("units_per_serving", 1))
    doses_per_bottle = servings_units // max(1, pk.units_per_dose)
    per_month = {"daily": 30.4, "alternate": 15.2, "cycle": 30.4 * 8 / 10}.get(item["frequency"], len(item.get("weekdays") or []) * 52 / 12 or 30.4)
    offer = pk.offer or {}
    price = offer.get("price_local")
    return {
        "product_id": p["id"], "brand": p["brand"], "name": p["name"], "form": p["form"], "note": p.get("note"),
        "certs": p.get("certs", []), "rating": p["rating"], "review_count": p["review_count"],
        "units_per_dose": pk.units_per_dose, "doses_per_container": doses_per_bottle,
        "monthly_cost": round(pk.cost_per_dose * per_month, 2) if price is not None else None,
        "score": pk.score, "score_breakdown": pk.breakdown, "certification_tier": pk.cert_tier,
        "why_this_product": pk.notes,
        "offer": offer or None, "npn": p.get("npn"), "image": None,
    }


def match_plan(
    plan: dict[str, Any], snapshot: CatalogSnapshot, prefs: dict[str, Any], tags: dict[str, str],
) -> dict[str, Any]:
    storefront = storefront_for(prefs.get("country"))
    router = LinkRouter(snapshot.retailers, tags)
    out = []
    for item in plan["items"]:
        res = scoring.match(item, snapshot.products, prefs, snapshot.variants, lambda p: router.offer_for(p, storefront), snapshot.overrides)
        out.append({
            "ingredient_id": item["ingredient_id"],
            "best": _pick_payload(res.best, item) if res.best else None,
            "alternatives": [_pick_payload(a, item) for a in res.alternatives],
            "filtered": res.filtered,
            "swapped": res.swapped,
        })
    return {"catalog_version": snapshot.version, "storefront": storefront, "items": out, "rank_steps": scoring.RANK_STEPS}


def prefs_from_facts(facts: dict[str, Any], features: dict[str, Any] | None = None) -> dict[str, Any]:
    feats = features or {}
    return {
        "country": facts.get("country"), "diet": facts.get("diet"), "allergies": facts.get("allergies") or [],
        "powders_ok": facts.get("powders_ok", True),
        "product_ratings": feats.get("product_ratings") or {}, "hard_to_swallow": feats.get("hard_to_swallow") or [],
        "liked_brands": feats.get("liked_brands") or [],
    }
