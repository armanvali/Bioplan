"""Approximate population-weighted latitude per province / state.

Used only to decide whether the sun is too low to make vitamin D in winter
(a coarse >= 40 deg N test), never stored beyond the region code itself.
"""

from __future__ import annotations

CA = {
    "AB": ("Alberta", 52.0), "BC": ("British Columbia", 49.5), "MB": ("Manitoba", 50.0),
    "NB": ("New Brunswick", 46.2), "NL": ("Newfoundland and Labrador", 47.6), "NS": ("Nova Scotia", 44.8),
    "NT": ("Northwest Territories", 62.5), "NU": ("Nunavut", 63.7), "ON": ("Ontario", 43.9),
    "PE": ("Prince Edward Island", 46.3), "QC": ("Quebec", 46.0), "SK": ("Saskatchewan", 51.5),
    "YT": ("Yukon", 60.7),
}

US = {
    "AL": ("Alabama", 33.0), "AK": ("Alaska", 61.2), "AZ": ("Arizona", 33.5), "AR": ("Arkansas", 34.9),
    "CA": ("California", 35.5), "CO": ("Colorado", 39.6), "CT": ("Connecticut", 41.6), "DE": ("Delaware", 39.4),
    "DC": ("District of Columbia", 38.9), "FL": ("Florida", 27.8), "GA": ("Georgia", 33.6), "HI": ("Hawaii", 21.3),
    "ID": ("Idaho", 43.6), "IL": ("Illinois", 41.5), "IN": ("Indiana", 39.9), "IA": ("Iowa", 41.9),
    "KS": ("Kansas", 38.5), "KY": ("Kentucky", 38.0), "LA": ("Louisiana", 30.6), "ME": ("Maine", 44.3),
    "MD": ("Maryland", 39.1), "MA": ("Massachusetts", 42.3), "MI": ("Michigan", 42.9), "MN": ("Minnesota", 45.3),
    "MS": ("Mississippi", 32.4), "MO": ("Missouri", 38.6), "MT": ("Montana", 46.5), "NE": ("Nebraska", 41.2),
    "NV": ("Nevada", 36.5), "NH": ("New Hampshire", 43.0), "NJ": ("New Jersey", 40.4), "NM": ("New Mexico", 35.0),
    "NY": ("New York", 41.5), "NC": ("North Carolina", 35.6), "ND": ("North Dakota", 47.4), "OH": ("Ohio", 40.3),
    "OK": ("Oklahoma", 35.6), "OR": ("Oregon", 44.9), "PA": ("Pennsylvania", 40.4), "RI": ("Rhode Island", 41.8),
    "SC": ("South Carolina", 34.0), "SD": ("South Dakota", 44.0), "TN": ("Tennessee", 35.9), "TX": ("Texas", 31.0),
    "UT": ("Utah", 40.6), "VT": ("Vermont", 44.3), "VA": ("Virginia", 37.8), "WA": ("Washington", 47.4),
    "WV": ("West Virginia", 38.6), "WI": ("Wisconsin", 43.8), "WY": ("Wyoming", 42.8),
}

REGIONS = {"CA": CA, "US": US}


def latitude(country: str | None, region: str | None) -> float | None:
    table = REGIONS.get(country or "")
    if not table or not region:
        return None
    entry = table.get(region.upper())
    return entry[1] if entry else None


def options() -> dict[str, list[dict[str, str]]]:
    return {c: [{"id": k, "label": v[0]} for k, v in sorted(t.items(), key=lambda kv: kv[1][0])] for c, t in REGIONS.items()}
