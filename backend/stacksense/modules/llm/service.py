"""Gateway factory that records every call (hashes only) for the admin LLM dashboard."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from stacksense.config import get_settings
from stacksense.modules.admin.models import LLMCallLog
from stacksense.modules.llm.gateway import CallLog, LLMGateway, build_gateway


def gateway_for(db: Session, kb: Any) -> LLMGateway:
    def record(entry: CallLog) -> None:
        db.add(LLMCallLog(job=entry.job, model=entry.model, outcome=entry.outcome, prompt_hash=entry.prompt_hash,
                          response_hash=entry.response_hash, latency_ms=entry.latency_ms, cost_usd=entry.cost_usd))

    return build_gateway(kb, get_settings(), on_log=record)
