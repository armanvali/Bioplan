# StackSense API

FastAPI modular monolith (Python 3.11+, SQLAlchemy 2, pydantic v2). See the root `README.md`
for the overview and `../AGENTS.md` for the rules every change must follow.

## Run

```sh
python3 -m venv .venv && .venv/bin/pip install -e '.[dev,llm]'
.venv/bin/uvicorn stacksense.main:app --reload     # http://localhost:8000/docs
.venv/bin/stacksense-worker                        # background jobs (or --once / --job NAME)
```

In `dev` and `test` the app creates its tables and seeds reference data on start-up (SQLite by
default). Against Postgres, use migrations:

```sh
export STACKSENSE_DATABASE_URL=postgresql+psycopg://stacksense:stacksense@localhost:5432/stacksense
.venv/bin/alembic upgrade head
.venv/bin/stacksense-seed --dev        # billing plans, catalog, and dev staff accounts
.venv/bin/alembic revision --autogenerate -m "describe the change"   # after model changes
```

## Layout

```
stacksense/
  api/v1/           intake, plans (+ calendar feed), account (auth, consent, privacy), commerce (billing, webhooks, clicks), meta
  api/admin/        /admin/v1, every route scoped and every write audited
  modules/          one package per domain (intake, rules, impact, scheduler, catalog, affiliate,
                    billing, profile, identity, notify, llm, plans, admin)
  knowledge/        knowledge-base models, loader and validator
  core/             expression language (safe, no eval), crypto, tokens, TOTP, PDF, rate limiting
  data/             seed graph, knowledge, catalog, billing config, golden personas
migrations/         Alembic (initial schema + append-only audit trigger)
tests/              pytest + Hypothesis
```

## Settings

All settings are `STACKSENSE_*` environment variables (`stacksense/config.py`):

| Variable | Default | Notes |
|---|---|---|
| `ENV` | `dev` | `dev`, `test`, `staging`, `production` |
| `DATABASE_URL` | `sqlite:///./stacksense.db` | Postgres in staging/production |
| `REDIS_URL` | – | Shared rate limits (in-memory without it) |
| `SECRET_KEY` | dev value | Signs tokens; production refuses the default |
| `MASTER_KEY` | dev value | Wraps per-subject data keys; production refuses the default |
| `PUBLIC_WEB_URL`, `PUBLIC_API_URL` | localhost | Links in emails, checkout return URLs, calendar feeds |
| `CORS_ORIGINS` | web + admin on localhost | JSON list |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | –, `whsec_dev` | No key means fake checkout |
| `ANTHROPIC_API_KEY` | – | No key means template wording |
| `LLM_FAST_MODEL`, `LLM_STRONG_MODEL` | `claude-haiku-4-5`, `claude-opus-5-5` | |
| `LLM_MONTHLY_BUDGET_USD` | 200 | Hard cap; over budget falls back to templates |
| `AMAZON_CA_TAG`, `AMAZON_COM_TAG`, `IHERB_PARTNER_CODE` | placeholders | Affiliate tags |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | – | Web Push |
| `SMTP_URL` | – | Email delivery (otherwise logged) |
| `ANONYMOUS_RETENTION_DAYS` | 30 | Abandoned anonymous sessions are erased after this |
| `ADMIN_SESSION_MINUTES` | 30 | Staff token lifetime |

## Tests

```sh
.venv/bin/pytest                         # 124 tests on SQLite
STACKSENSE_TEST_DATABASE_URL=postgresql+psycopg://… .venv/bin/pytest tests/test_api_contract.py tests/test_entitlements_billing.py tests/test_privacy_admin.py
.venv/bin/ruff check stacksense tests migrations
```

The golden personas in `stacksense/data/personas/` are the definition of done: each one freezes
the expected stack, exclusions, locks, stop cards, cost and pill limits. If a change alters a
persona's plan, explain why in the PR. Don't loosen the expectation.
