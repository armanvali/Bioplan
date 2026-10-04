"""Model gateway providers. One internal interface, per-job model choice, timeouts,
and only hashes of prompts/responses in logs (section 10, 'Model gateway').

``AnthropicProvider`` calls Claude through the official SDK with structured outputs
(``output_config.format``) so responses are schema-valid JSON. Without an API key the
app uses ``NullProvider`` and every job falls back to its deterministic template.
"""

from __future__ import annotations

import hashlib
import json
import logging
import time
from dataclasses import dataclass, field
from typing import Any, Protocol

log = logging.getLogger("stacksense.llm")

# Approximate list prices (USD per 1M tokens) for the monthly cost cap.
PRICES = {
    "claude-opus-5-5": (4.0, 20.0),
    "claude-sonnet-5-5": (2.0, 10.0),
    "claude-haiku-4-5": (1.0, 5.0),
}
# Models that support server-side refusal fallbacks with the "default" routing.
FALLBACK_MODELS = {"claude-opus-5-5", "claude-sonnet-5-5"}
# Models that take output_config.effort (Haiku 4.5 rejects it).
EFFORT_MODELS = {"claude-opus-5-5", "claude-sonnet-5-5"}


@dataclass
class ProviderResult:
    text: str | None
    refused: bool = False
    error: str | None = None
    input_tokens: int = 0
    output_tokens: int = 0
    model: str = ""
    latency_ms: int = 0

    @property
    def cost_usd(self) -> float:
        pin, pout = PRICES.get(self.model, (4.0, 20.0))
        return (self.input_tokens * pin + self.output_tokens * pout) / 1_000_000


class Provider(Protocol):
    name: str

    def complete_json(self, *, model: str, system: str, user: str, schema: dict[str, Any], max_tokens: int, effort: str | None) -> ProviderResult: ...


class NullProvider:
    """No model configured: every job uses its template fallback."""

    name = "none"

    def complete_json(self, **_: Any) -> ProviderResult:
        return ProviderResult(text=None, error="no_provider")


@dataclass
class ScriptedProvider:
    """Deterministic provider for tests and evals: returns queued responses in order."""

    responses: list[str | None] = field(default_factory=list)
    calls: list[dict[str, Any]] = field(default_factory=list)
    name: str = "scripted"

    def complete_json(self, **kw: Any) -> ProviderResult:
        self.calls.append(kw)
        text = self.responses.pop(0) if self.responses else None
        return ProviderResult(text=text, model=kw.get("model", ""), error=None if text is not None else "empty")


class AnthropicProvider:
    name = "anthropic"

    def __init__(self, api_key: str, timeout_s: float = 8.0) -> None:
        import anthropic  # optional dependency: pip install "stacksense[llm]"

        self._anthropic = anthropic
        self.client = anthropic.Anthropic(api_key=api_key, timeout=timeout_s, max_retries=1)

    def complete_json(self, *, model: str, system: str, user: str, schema: dict[str, Any], max_tokens: int, effort: str | None) -> ProviderResult:
        anthropic = self._anthropic
        output_config: dict[str, Any] = {"format": {"type": "json_schema", "schema": schema}}
        if effort and model in EFFORT_MODELS:
            output_config["effort"] = effort
        kwargs: dict[str, Any] = {
            "model": model,
            "max_tokens": max_tokens,
            "system": system,
            "messages": [{"role": "user", "content": user}],
            "output_config": output_config,
        }
        start = time.perf_counter()
        try:
            if model in FALLBACK_MODELS:
                # Server-side refusal fallback, routed by refusal category.
                resp = self.client.beta.messages.create(betas=["server-side-fallback-2026-07-01"], fallbacks="default", **kwargs)
            else:
                resp = self.client.messages.create(**kwargs)
        except anthropic.RateLimitError:
            return ProviderResult(text=None, error="rate_limited", model=model)
        except anthropic.APITimeoutError:
            return ProviderResult(text=None, error="timeout", model=model)
        except anthropic.APIStatusError as e:
            return ProviderResult(text=None, error=f"status_{e.status_code}", model=model)
        except anthropic.APIConnectionError:
            return ProviderResult(text=None, error="connection", model=model)
        latency = int((time.perf_counter() - start) * 1000)
        usage = getattr(resp, "usage", None)
        result = ProviderResult(
            text=None, model=getattr(resp, "model", model), latency_ms=latency,
            input_tokens=getattr(usage, "input_tokens", 0) or 0, output_tokens=getattr(usage, "output_tokens", 0) or 0,
        )
        if resp.stop_reason == "refusal":
            result.refused = True
            return result
        if resp.stop_reason == "max_tokens":
            result.error = "max_tokens"
            return result
        result.text = next((b.text for b in resp.content if b.type == "text"), None)
        return result


def digest(obj: Any) -> str:
    return hashlib.sha256(json.dumps(obj, sort_keys=True, default=str).encode()).hexdigest()[:16]
