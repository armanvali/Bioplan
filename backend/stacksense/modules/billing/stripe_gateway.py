"""Stripe integration: Checkout, Customer Portal and verified webhooks.

Card data never touches our servers. Without ``STACKSENSE_STRIPE_SECRET_KEY`` the gateway
runs in *fake* mode: checkout returns a local URL, and completing it emits a synthetic
``checkout.session.completed`` event signed with the webhook secret, which goes through
exactly the same handler as real Stripe events.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import time
from typing import Any

import httpx

from stacksense.core.errors import DomainError, Unauthorized

STRIPE_API = "https://api.stripe.com/v1"
TOLERANCE_S = 300


def _flatten(prefix: str, value: Any, out: list[tuple[str, str]]) -> None:
    if isinstance(value, dict):
        for k, v in value.items():
            _flatten(f"{prefix}[{k}]" if prefix else k, v, out)
    elif isinstance(value, list):
        for i, v in enumerate(value):
            _flatten(f"{prefix}[{i}]", v, out)
    elif value is not None:
        out.append((prefix, "true" if value is True else "false" if value is False else str(value)))


class StripeGateway:
    def __init__(self, secret_key: str | None, webhook_secret: str) -> None:
        self.secret_key = secret_key
        self.webhook_secret = webhook_secret

    @property
    def fake(self) -> bool:
        return not self.secret_key

    def _post(self, path: str, data: dict[str, Any], idempotency_key: str | None = None) -> dict[str, Any]:
        form: list[tuple[str, str]] = []
        _flatten("", data, form)
        headers = {"Authorization": f"Bearer {self.secret_key}"}
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key
        resp = httpx.post(f"{STRIPE_API}{path}", data=form, headers=headers, timeout=15)
        if resp.status_code >= 400:
            raise DomainError("stripe_error", resp.json().get("error", {}).get("message", "Payment provider error"))
        return resp.json()

    def create_checkout(
        self, *, mode: str, stripe_price_id: str, success_url: str, cancel_url: str, client_reference_id: str,
        metadata: dict[str, str], customer: str | None = None, customer_email: str | None = None, trial_days: int | None = None,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        data: dict[str, Any] = {
            "mode": mode, "line_items": [{"price": stripe_price_id, "quantity": 1}], "success_url": success_url,
            "cancel_url": cancel_url, "client_reference_id": client_reference_id, "metadata": metadata,
            "automatic_tax": {"enabled": True}, "allow_promotion_codes": True,
        }
        if customer:
            data["customer"] = customer
        elif customer_email:
            data["customer_email"] = customer_email
        if mode == "subscription":
            data["subscription_data"] = {"metadata": metadata, **({"trial_period_days": trial_days} if trial_days else {})}
            data["payment_method_collection"] = "always"  # card required for trials
        else:
            data["payment_intent_data"] = {"metadata": metadata}
            data["customer_creation"] = "always"
        return self._post("/checkout/sessions", data, idempotency_key)

    def create_portal(self, customer: str, return_url: str) -> str:
        return self._post("/billing_portal/sessions", {"customer": customer, "return_url": return_url})["url"]

    def refund(self, payment_intent: str) -> dict[str, Any]:
        return self._post("/refunds", {"payment_intent": payment_intent})

    # ------------------------------------------------------------------ webhooks
    def sign(self, payload: bytes, ts: int | None = None) -> str:
        ts = ts or int(time.time())
        sig = hmac.new(self.webhook_secret.encode(), f"{ts}.".encode() + payload, hashlib.sha256).hexdigest()
        return f"t={ts},v1={sig}"

    def verify(self, payload: bytes, header: str | None, now: int | None = None) -> dict[str, Any]:
        if not header:
            raise Unauthorized("missing_signature", "Missing Stripe-Signature header")
        parts: dict[str, list[str]] = {}
        for item in header.split(","):
            k, _, v = item.strip().partition("=")
            parts.setdefault(k, []).append(v)
        try:
            ts = int(parts["t"][0])
        except (KeyError, ValueError) as e:
            raise Unauthorized("bad_signature", "Malformed Stripe-Signature header") from e
        expected = hmac.new(self.webhook_secret.encode(), f"{ts}.".encode() + payload, hashlib.sha256).hexdigest()
        if not any(hmac.compare_digest(expected, v1) for v1 in parts.get("v1", [])):
            raise Unauthorized("bad_signature", "Webhook signature mismatch")
        if abs((now or int(time.time())) - ts) > TOLERANCE_S:
            raise Unauthorized("stale_signature", "Webhook timestamp outside tolerance")
        return json.loads(payload)
