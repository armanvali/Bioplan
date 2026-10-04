"""Server-side enforcement of gated fields (section 13.2).

The API returns redacted payloads -- e.g. ``"doses": {"locked": true, "range": "200-400 mg"}``.
Gated data is never sent to the browser and hidden with CSS. Exclusions, interactions,
locked items, stop cards and safety banners are always present, whatever the tier.
"""

from __future__ import annotations

import copy
from typing import Any


def _fmt(x: float) -> str:
    return f"{int(x):,}" if float(x).is_integer() else f"{x:g}"


def dose_range_text(item: dict[str, Any]) -> str:
    r = item["range"]
    if r["min"] == r["max"]:
        return f"{_fmt(r['min'])} {r['unit']}"
    return f"{_fmt(r['min'])}–{_fmt(r['max'])} {r['unit']}"


def redact_plan(result: dict[str, Any], features: set[str]) -> dict[str, Any]:
    out = copy.deepcopy(result)
    gated: list[str] = []
    if "exact_doses" not in features:
        gated.append("exact_doses")
        for it in out.get("items", []):
            it["dose"] = {"locked": True, "range": dose_range_text(it)}
            it["dose_label"] = None
            it["amount_text"] = None
            it["dose_level"] = None
        for rec in out.get("audit", []):
            rec.pop("amount", None)
    if "impact_full" not in features and "impact" in out:
        gated.append("impact_full")
        out["impact"] = redact_impact(out["impact"])
    out.pop("inputs", None)
    out["gated"] = gated
    return out


def redact_impact(impact: dict[str, Any], top_n: int = 3) -> dict[str, Any]:
    """Free tier: top 3 areas by need with their numbers; the rest are blurred server-side."""
    im = copy.deepcopy(impact)
    ranked = sorted(im["areas"], key=lambda a: (-a["need"], a["area"]))
    visible = {a["area"] for a in ranked[:top_n] if a["need"] > 0}
    areas = []
    for a in im["areas"]:
        if a["area"] in visible:
            areas.append({**a, "contributors": [{"ingredient": c["ingredient"], "locked": True} for c in a["contributors"]], "locked": False})
        else:
            areas.append({"area": a["area"], "locked": True, "gap_reason": a.get("gap_reason") if a.get("gap_reason", {}) and a["gap_reason"].get("code") == "locked_ingredient" else None})
    im["areas"] = areas
    im["onset_weeks"] = {k: v for k, v in im.get("onset_weeks", {}).items() if k in visible}
    im["locked"] = True
    return im


def redact_products(products: dict[str, Any], features: set[str]) -> dict[str, Any]:
    out = copy.deepcopy(products)
    if "product_alternatives" not in features:
        for it in out["items"]:
            it["alternatives_locked"] = len(it["alternatives"])
            it["alternatives"] = []
            if it.get("best"):
                it["best"]["why_this_product"] = []
                it["best"]["score_breakdown"] = None
        out["gated"] = ["product_alternatives"]
    else:
        out["gated"] = []
    return out
