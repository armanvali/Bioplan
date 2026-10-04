# AGENTS.md — rules for anyone (human or AI) changing StackSense

StackSense turns an adaptive health intake into a supplement plan: an impact map, a buy list and a
dosage calendar. The source of truth for the design is `docs/StackSense-Technical-Architecture-Build-Spec.pdf`.
Section numbers below (§) refer to it.

## Hard rules (§12.5, §10, §13)

1. **The rules engine is the only source of doses, exclusions, interactions and locks.**
   `backend/stacksense/modules/rules/` decides; nothing else may add, remove or change a dose.
   The UI, the LLM layer and the catalog only display what the engine returned.
2. **The LLM only writes words.** It phrases questions, maps free text to signal IDs that the code then
   validates, and explains a finished plan. Its output passes `modules/llm/guardrails.py` (numbers and
   ingredient names must match the plan, no disease claims) or the template fallback is used. Never let
   model output pick ingredients, doses or exclusions.
3. **Never edit `backend/stacksense/data/knowledge/` or `data/graph/` without a linked clinician
   approval.** Every knowledge row needs a `source`. In production these change only through the admin
   release workflow (draft → automated checks → clinical review by someone other than the author →
   publish → rollback). If you must touch the seed files, say so in the PR and leave
   `reviewed_by: "pending-clinical-review"` on new rows.
4. **Every change ships with tests.** The golden personas (`data/personas/*.json`) are the definition of
   done: a PR is mergeable only when the suite passes and **any change to a persona's plan output is
   explained** in the PR description. Don't loosen a persona expectation to make a test pass.
5. **Payment and affiliate data never feed the rules engine.** Commission only breaks ties between
   equally good offers in `modules/affiliate/router.py`, after availability and price. A paying user gets
   the same stack as a free user; the paywall redacts depth server-side (`modules/billing/redaction.py`).
6. **Safety information is always free.** Exclusions, interactions, locked items, stop cards, spacing
   and warnings appear on every tier. `tests/test_entitlements_billing.py` enforces this.
7. **Health data needs consent.** Nothing is stored to a profile without `profile_storage`;
   personalisation needs storage first; withdrawal erases the data and crypto-shreds the subject key at
   once (`modules/profile/`). Staff reads of health data need a logged reason and are shown to the user.
8. **Every admin write goes through `modules/admin/audit.py`.** The audit log is append-only.

## Humans review

Agents may write code, tests and migrations. A human must review anything that touches `rules/`,
`knowledge/` or `graph/` data, privacy and consent code, or affiliate compliance (disclosures, tags).

## Repository map

```
backend/            FastAPI modular monolith (Python 3.11+)
  stacksense/
    core/           expression language (no eval), crypto, tokens, TOTP, PDF, rate limits
    knowledge/      knowledge-base models + loader/validator
    modules/
      intake/       question graph, answer normalisation, signal model, next-question selection
      rules/        six-stage rules engine + exact optimiser   <- doses live here only
      impact/       impact model (need, contribution, saturation, synergy)
      scheduler/    slot solver, ramp-up, cycles, refills, RFC 5545 calendar
      catalog/      product matching and scoring
      affiliate/    link router (availability -> price -> commission tie-break)
      billing/      plans, entitlements, redaction, Stripe gateway + webhooks, experiments
      profile/      subjects, envelope encryption, consent ledger, privacy export/delete
      identity/     magic-link auth          notify/  outbox, email, Web Push
      llm/          gateway, providers, guardrails     plans/  plan service (assembles everything)
      admin/        roles/scopes, audit, release workflow, simulator, catalog/revenue/user tools
    api/v1/         public API          api/admin/  staff API (/admin/v1)
    data/           seed knowledge, graph, catalog, billing config, golden personas
    worker.py       background jobs     seed.py  reference data + dev staff
  tests/            pytest + Hypothesis
web/                Next.js PWA (user app)
admin/              Next.js staff console
backend/migrations/ Alembic migrations (Postgres schemas, append-only audit trigger)
infra/docker/       Dockerfiles (API/worker, Next.js apps); docker-compose.yml at the root
prototype/          the original clickable prototype (reference for UX)
docs/               specs
```

## Working on the backend

```sh
cd backend
python3 -m venv .venv && .venv/bin/pip install -e '.[dev]'
.venv/bin/pytest -q                       # full suite, including golden personas
.venv/bin/ruff check stacksense tests     # lint (line length 110)
.venv/bin/uvicorn stacksense.main:app --reload   # http://localhost:8000/docs
```

- Knowledge and graph changes: run `pytest tests/test_golden_personas.py tests/test_graph_and_knowledge.py`.
- Model changes need a migration: `alembic revision --autogenerate -m "..."`, then `alembic check`
  against Postgres (CI does both). Never edit an applied migration.
- Add a persona when you add a branch, a red flag or a safety rule: copy one in `data/personas/`, give it
  answers and freeze its `expect` block (stack, excluded, locked, stop cards, cost, pill limits).
- Engine outputs carry `rules_version`, `graph_version`, `impact_version` and `catalog_snapshot_id`; a plan
  must be reproducible from its stored inputs (`PlanService.reproduce`).
- Errors are `DomainError` subclasses (`core/errors.py`) and render as `{"error": {code, message, details}}`.
- Gate features by **feature key**, never by plan name (`modules/billing/entitlements.py`).

## Definition of done (CI runs all of it)

`make lint test`, the Postgres suites (`make test-pg`), `alembic check`, both frontends'
typecheck, unit tests and build, and `make e2e` (golden personas through the UI, admin release
workflow, axe). See `.github/workflows/ci.yml`.

## Tickets

Each ticket names the module, the API contract it affects and its acceptance tests, e.g.
"Implement `POST /v1/intake/sessions/{id}/answers` so Maya's B3 answer returns the response in §9.2"
(see `tests/test_api_contract.py`).
