"""Runtime settings. Everything comes from the environment (prefix ``STACKSENSE_``).

Dev defaults run the whole API on SQLite with no Redis, no Stripe and no LLM key:
every external service has a local stand-in, so ``uvicorn stacksense.main:app`` just works.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

PACKAGE_DIR = Path(__file__).resolve().parent
DATA_DIR = PACKAGE_DIR / "data"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="STACKSENSE_", env_file=".env", extra="ignore")

    env: Literal["dev", "test", "staging", "production"] = "dev"
    database_url: str = "sqlite:///./stacksense.db"
    redis_url: str | None = None

    # Secrets. The dev values are deliberately obvious; production refuses to boot with them.
    secret_key: str = "dev-secret-change-me"
    # 32-byte urlsafe-base64 master key for envelope encryption (stand-in for a KMS key).
    master_key: str = "ZGV2LW1hc3Rlci1rZXktMzItYnl0ZXMtbG9uZyEhISE="

    public_web_url: str = "http://localhost:3000"
    public_api_url: str = "http://localhost:8000"
    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:3000", "http://localhost:3001"])

    # Stripe. Without a key, checkout uses the built-in fake that completes immediately.
    stripe_secret_key: str | None = None
    stripe_webhook_secret: str = "whsec_dev"

    # LLM. Without a key, every job uses its deterministic template fallback.
    anthropic_api_key: str | None = None
    llm_fast_model: str = "claude-haiku-4-5"
    llm_strong_model: str = "claude-opus-5-5"
    llm_timeout_s: float = 8.0
    llm_monthly_budget_usd: float = 200.0

    # Affiliate tags per storefront (real values live in the secrets vault).
    amazon_ca_tag: str = "stacksense0c-20"
    amazon_com_tag: str = "stacksense-20"
    iherb_partner_code: str = "STACKSENSE"

    # Web Push (VAPID). Empty in dev: reminders go to the outbox log instead.
    vapid_public_key: str = ""
    vapid_private_key: str = ""

    # Intake engine tuning (also versioned with the graph; these are safe defaults).
    max_cards: int = 30
    follow_signal_budget: int = 18

    # Retention (section 11): anonymous sessions deleted after this many days.
    anonymous_retention_days: int = 30

    # Admin
    admin_session_minutes: int = 30
    admin_dev_login: bool = True  # forced off in production
    rate_limit_per_minute: int = 120

    @property
    def is_production(self) -> bool:
        return self.env == "production"

    def validate_for_production(self) -> None:
        if not self.is_production:
            return
        problems = []
        if self.secret_key.startswith("dev-"):
            problems.append("STACKSENSE_SECRET_KEY uses the dev default")
        if self.master_key == Settings.model_fields["master_key"].default:
            problems.append("STACKSENSE_MASTER_KEY uses the dev default")
        if self.database_url.startswith("sqlite"):
            problems.append("production needs Postgres")
        if problems:
            raise RuntimeError("Refusing to start: " + "; ".join(problems))


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    if s.is_production:
        s.admin_dev_login = False
    s.validate_for_production()
    return s
