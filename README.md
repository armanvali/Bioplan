# StackSense

StackSense turns an adaptive health intake into a supplement plan you can act on. The plan has
three parts: a **Health Impact Map** across 8 body areas, a **buy list** matched to certified
products, and a **daily dosage calendar** that eases you in, cycles what needs cycling and
reminds you to refill.

This repository is a full implementation of
[`docs/StackSense-Technical-Architecture-Build-Spec.pdf`](docs/StackSense-Technical-Architecture-Build-Spec.pdf).
It contains the API, the user-facing PWA, the staff console, infrastructure and tests. Section
numbers (§) below refer to that spec. **Read [`AGENTS.md`](AGENTS.md) before changing anything:**
it lists the hard rules (the rules engine is the only source of doses; never edit knowledge data
without clinician approval; every change ships with tests).

```
backend/    FastAPI modular monolith: intake, rules, impact, scheduler, catalog, billing, consent, LLM, admin
web/        Next.js PWA: intake, results, calendar, pricing, account
admin/      Next.js staff console for /admin/v1
infra/      Dockerfiles; docker-compose.yml at the root
prototype/  The original clickable prototype (UX reference)
docs/       Spec, architecture notes, roadmap
```

## Quick start

**Docker (everything, on Postgres and Redis):**

```sh
docker compose up --build
# Web http://localhost:3000 · Admin http://localhost:3001 · API docs http://localhost:8000/docs
```

**Local development (SQLite, hot reload):**

```sh
make setup              # backend venv + npm installs
make api                # :8000, creates and seeds a SQLite DB in dev
make web                # :3000   (another terminal)
make admin              # :3001   (another terminal; sign in as editor@stacksense.dev, etc.)
```

No keys are needed in dev:

- Stripe runs in **fake mode**. Checkout goes to a local test page, and the API emits signed
  synthetic webhooks through the same handler as production.
- Without an Anthropic key, every LLM job uses its **template fallback**.
- Sign-in links come back in the API response ("Dev mode: sign in now"), and emails go to the log.

To try the demo persona, open the web app, start an intake and answer as Maya (34, vegetarian,
on the pill, restless legs, training for a half-marathon). Within 24 questions you get 7
supplements for $77.64 of an $80 budget. Iron is locked until a ferritin test. Collagen is left
out because Maya is vegetarian, and St John's wort because of the pill. Her calendar ramps up
over 12 days and keeps new items away from race day.

## How it fits together

```
           ┌──────────── web (PWA) ───────────┐     ┌──── admin console ────┐
           │ intake · review · plan · calendar│     │ releases · simulator  │
           │ pricing · account · privacy      │     │ users · catalog · rev │
           └───────────────┬──────────────────┘     └──────────┬────────────┘
                     /v1 (session, plan, user tokens)    /admin/v1 (scoped staff tokens, audited)
           ┌───────────────┴───────────────────────────────────┴────────────┐
           │ FastAPI modular monolith                                        │
           │  intake ─► rules (6 stages + exact optimiser) ─► impact          │
           │     │                 │                         └► scheduler ─► .ics │
           │     │                 └► catalog scoring ─► affiliate router     │
           │  billing (entitlements, server-side redaction, Stripe webhooks)  │
           │  profile (consent ledger, envelope encryption, crypto-shredding) │
           │  llm (words only, guardrails, fallbacks) · notify · admin        │
           └───────┬───────────────────────────┬─────────────────────────────┘
             Postgres (identity, health,    Redis (rate limits)    worker (outbox, reminders,
             billing, catalog, admin)                              consent enforcement, retention)
```

Key decisions (more in [`docs/architecture.md`](docs/architecture.md)):

- **Deterministic core.** Doses, exclusions, interactions and locks all come from a versioned
  rules engine with an audit trail per plan. The same inputs always give the same plan (a test
  checks this).
- **Data, not code, for clinical content.** The question graph and knowledge base are versioned
  JSON. Editors change them through a release workflow: automated checks, golden personas, a
  clinical reviewer who isn't the author, then publish with a rollout % or roll back.
- **Paywall on depth, never on safety.** Redaction happens server-side, by feature key.
  Exclusions, interactions, stop cards and locked items are in every tier's payload.
- **Privacy by construction.** Health rows hang off a pseudonymous subject id and are encrypted
  under a per-subject key. Withdrawing consent deletes the rows and destroys the key. Staff reads
  need a reason, and the user can see them.

## Tests

| Suite | Command | What it covers |
|---|---|---|
| Backend (124 tests) | `cd backend && .venv/bin/pytest` | Golden personas (16), property tests for the rules engine, optimiser (exact vs brute force) and scheduler (spacing, cycles, DST), graph reachability, API contracts, entitlements and redaction, Stripe webhook idempotency and ordering, consent, crypto-shredding, admin scopes, release workflow, append-only audit, worker jobs |
| Backend on Postgres | `STACKSENSE_TEST_DATABASE_URL=postgresql+psycopg://… make test-pg` | The API-level suites on Postgres |
| Migrations | `alembic upgrade head && alembic check` | Migrations match the models |
| Web / admin unit | `npm test` in `web/` and `admin/` | Helpers, answer controls, impact radar, stop cards |
| End to end | `make e2e` (servers running) | Maya (free → Full Report → calendar), Teo (under-18 stop), Sam (live interaction warning), the admin release workflow and role scoping, on phone and desktop, with an axe scan |

CI (`.github/workflows/ci.yml`) runs all of these, and also builds the Docker images.

## Configuration

Every setting is an environment variable prefixed `STACKSENSE_` (see `backend/stacksense/config.py`
and `.env.example`). Production refuses to boot with the dev secret, the dev master key or SQLite,
and always turns off the passwordless dev staff login.

## Status

Everything in the spec's MVP scope is implemented and tested. [`docs/roadmap.md`](docs/roadmap.md)
lists what to build next, the known limitations, and where to optimise.
