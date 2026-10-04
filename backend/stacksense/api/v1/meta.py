"""/v1/meta: static content the client renders (areas, goals, signal labels, versions)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from stacksense import registry
from stacksense.deps import DB
from stacksense.modules.intake.regions import options as region_options
from stacksense.modules.llm.guardrails import DISCLAIMER
from stacksense.modules.profile.consent import POLICY_VERSION, PURPOSES

router = APIRouter(prefix="/meta", tags=["meta"])


@router.get("", summary="Areas, goals, signal labels, consent purposes, versions")
def meta(db: DB) -> dict[str, Any]:
    kb = registry.live_kb(db)
    graph = registry.live_graph(db)
    return {
        "rules_version": kb.version,
        "graph_version": graph.version,
        "areas": [a.model_dump(exclude={"source", "reviewed_by", "reviewed_at"}) for a in kb.data.areas],
        "goals": [g.model_dump(exclude={"source", "reviewed_by", "reviewed_at"}) for g in kb.data.goals],
        "signals": {s.id: {"label": s.label, "tag": s.tag, "areas": s.areas} for s in kb.data.signals},
        "ingredients": {i.id: {"name": i.name, "short": i.short, "sub": i.sub, "color": i.color} for i in kb.data.ingredients},
        "labs": {lab.id: {"name": lab.name, "unit": lab.unit} for lab in kb.data.lab_analytes},
        "consent": {"policy_version": POLICY_VERSION, "purposes": [{"key": p.key, "label": p.label, "text": p.text, "if_withdrawn": p.if_withdrawn} for p in PURPOSES.values()]},
        "regions": region_options(),
        "disclaimer": DISCLAIMER,
        "affiliate_disclosure": "We may earn a commission when you buy through these links. It never changes what we recommend.",
    }
