# Architecture notes

How the code maps to the spec, and what happens inside each main flow. Section numbers (§)
refer to `StackSense-Technical-Architecture-Build-Spec.pdf`.

## Spec → code

| Spec | Where |
|---|---|
| §2 System architecture | `backend/stacksense/main.py` (app, middleware, errors), `db.py` (schemas), `worker.py` |
| §3.1 Question node schema | `modules/intake/graph.py` (pydantic `Node`, `Graph.check`), `data/graph/*.json` |
| §3.2 Signal model | `modules/intake/signals.py` (log-odds, likelihood ratios, priors from facts and season) |
| §3.3 Next question | `modules/intake/selector.py` (expected information gain, burden and sensitivity penalties, lookahead for gateway nodes), `engine.py` (phases, stop cards, confidence) |
| §3.4 LLM follow-ups | `modules/llm/gateway.py` `follow_up`, `map_free_text` (whitelisted templates and signal ids only) |
| §3.5 Session state | `modules/intake/state.py`, `service.py` (encrypted state per session) |
| §4 Rules engine | `modules/rules/engine.py`: candidates → eligibility → lab locks → dose → interactions/timing → optimiser; audit records per stage |
| §4.1 Optimisation | `modules/rules/optimiser.py`: exact branch and bound over budget, busiest-day pills, item cap, substitute groups |
| §4.2 Knowledge base | `knowledge/models.py`, `knowledge/base.py` (validation), `data/knowledge/*.json` |
| §4.3 Safety in code | eligibility stage, restricted libraries (pregnancy etc.), unknown-medicine caution, UL summation incl. existing supplements |
| §5 Impact model | `modules/impact/model.py` (need, contribution c = 10·b·g·f·r, saturation, synergy, coverage, onset) |
| §6 Scheduler | `modules/scheduler/solver.py` (slot assignment), `calendar.py` (ramp-up, cycles, tasks, refills, feed state), `ics.py` (RFC 5545, VTIMEZONE, stable UIDs, SEQUENCE, CANCELLED) |
| §7 Catalog | `modules/catalog/scoring.py` (hard filters, 0.30/0.25/0.15/0.15/0.10/0.05 score), `service.py` (snapshot, out-of-stock swap, overrides) |
| §7.3 Affiliate router | `modules/affiliate/router.py` (availability → price → commission tie-break; storefront tags) |
| §9 Data model / API | `modules/*/models.py`, `api/v1/*`, `migrations/` |
| §10 LLM layer | `modules/llm/` (providers, guardrails: number and name faithfulness, claims filter, reading level, cost cap, one retry, template fallback) |
| §11 Privacy & security | `modules/profile/keys.py` (envelope encryption, per-subject keys, shredding), `consent.py`, `identity/` (magic links), `core/tokens.py`, `core/ratelimit.py` |
| §12.1 Testing | `backend/tests/`, `web/e2e/`, `web/src/**/*.test.tsx`, `admin/src/**/*.test.tsx` |
| §13 Revenue & paywall | `modules/billing/` (feature keys, plans, redaction, Stripe gateway, webhooks, experiments, promos) |
| §14 Consent & personalisation | `modules/profile/` (ledger, events, features, prefill), `modules/rules/personal.py` |
| §15 Admin panel | `modules/admin/` + `api/admin/routes.py`; UI in `admin/` |

## Flows

### Answering a card (`POST /v1/intake/sessions/{id}/answers`)

1. The session token (an HMAC-signed, purpose-bound token) authorises access to this session only.
2. `answers.normalize` validates the raw value for the node's answer type and derives fields
   (e.g. `drug_classes` from medicine ids).
3. The engine re-evaluates facts and signals. A red flag can raise a stop card: `stop` ends the
   intake, while `restrict` lets the user continue with some ingredients ruled out (e.g. no sleep
   aids when snoring suggests apnea).
4. The rules engine's first two stages run on the answers so far, so the client can show newly
   excluded ingredients right away (`exclusions_added`).
5. The selector picks the next node by expected information gain per unit of burden, within the
   card budget. The response follows §9.2: `next`, `toast`, `signals_delta`, `confidence` and
   `exclusions_added`.

### Building a plan (`POST /v1/plans`)

`plan_input_from_state` → `RulesEngine.build` → impact map → catalog match (snapshot id stored)
→ schedule. The plan stores its inputs, the rules, graph and impact versions, the catalog snapshot
and the per-stage audit, so `PlanService.reproduce` can rebuild it exactly. Then
`billing/redaction.py` shapes the payload for the caller's feature keys: free users get dose
ranges, the top 3 impact areas, the best product per item and 7 calendar days, plus every safety
field.

### Paying (`POST /v1/billing/checkout` → webhooks)

Checkout creates a `CheckoutSession` row with the plan and price. In fake mode the web app shows
`/checkout/fake`, and completing it emits a signed synthetic `checkout.session.completed`.
Webhooks are verified, stored by event id (so replays are no-ops) and ordered by `created` (so a
stale event can't overwrite a newer state). They grant or expire entitlements by source. A refund
revokes the purchase's entitlements, and a second refund flags the account in the audit log.

### Consent and deletion

`profile_storage` must be granted before anything is linked to an account. Personalisation needs
storage. Withdrawing storage deletes every health row for the subject and nulls its wrapped data
key (crypto-shredding: backups can no longer be decrypted). The nightly
`consent_enforcement` job is a safety net that guarantees this within 24 hours. Account deletion
keeps only billing records, tied to an anonymous user row.

### Clinical release (`/admin/v1/engine/releases`)

Draft (a copy of live) → row edits (every knowledge row needs a `source`) → automated checks
(schema, `KnowledgeBase.validate`, `Graph.check`, golden persona suite) → submit → review by
a `clinical_reviewer` who isn't the author (approval stamps `reviewed_by` on every row) →
publish with a rollout % (subjects are bucketed by hash, so each person stays on one version)
→ roll back. Every step writes to the append-only audit log (database triggers reject UPDATE
and DELETE on it).

## Storage

One Postgres database with five schemas: `identity` (users, magic links, push subscriptions),
`health` (subjects, sessions, answers, labs, plans, dose logs, check-ins, consents), `billing`,
`catalog` and `admin`. Health tables key on `subject_id`, never `user_id`. Only
`identity.users.subject_id` joins the two worlds, and it's nulled on withdrawal. SQLite is used in
dev and tests, with the schema names translated away.

## Extending

- **New answer type:** add a handler in `modules/intake/answers.py`, a control in
  `web/src/components/intake/AnswerControls.tsx`, and a persona that exercises it.
- **New ingredient or rule:** use a draft release in the admin console (or edit
  `data/knowledge/*.json` with `reviewed_by: "pending-clinical-review"`). Then add or extend a
  golden persona that covers it.
- **New gated feature:** add a key to `data/billing/plans.json` `feature_keys`, redact in
  `modules/billing/redaction.py`, and test both tiers in `tests/test_entitlements_billing.py`.
- **New background job:** add a function to `JOBS` in `worker.py` with its interval, and a test.
