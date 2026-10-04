# Roadmap: what to build and improve next

The MVP scope of the spec is implemented and tested end to end (API, PWA, admin, worker,
Docker, CI). The list below covers what's next, in rough priority order, followed by known
limitations and where to optimise.

## Before closed beta (spec §12.3, weeks 17–19)

1. **Clinical content.** The question graph has 28 nodes and 4 stop cards, and the knowledge base
   covers 19 ingredients. The spec targets about 120 nodes and 40 ingredients. All seed rows carry
   `reviewed_by: "pending-clinical-review"` until a pharmacist or RD signs them off through the
   release workflow; the admin "checks" panel counts these rows.
2. **French (fr-CA) content.** The UI chrome is translated and the graph supports localised
   prompts (`Graph.localized`), but the node text is English only.
3. **Clinician review of 100 generated plans.** Use the simulator's custom-answers mode and
   export the diffs.
4. **Security hardening.** Add a KMS-backed `KeyProvider` (the `LocalKeyProvider` interface is
   ready), admin SSO (OIDC; `AdminUser.sso_subject` exists), a pen test, and a review of the CSP
   and security headers.
5. **Load test.** The intake answer path re-runs the selector and two rules stages per answer.
   Measure at the target concurrency (k6 against `/v1/intake/.../answers`).

## Product

- **Web Push end to end.** The service worker handles push and notification clicks, and the
  worker queues reminders. To finish: expose the VAPID public key through `/v1/meta`, add the
  `pywebpush` dependency, and add the subscribe button in the calendar.
- **Price feeds and real link checking.** Catalog prices are seed data with `price_as_of`. Wire
  Amazon Creators API / PA-API, the iHerb and brand feeds into `catalog_admin.upsert_product`,
  and make `run_link_health` do real HTTP checks.
- **Check-ins and reported vs projected UI.** The API exists (`/checkins`, `/progress`). Add a
  Plus screen with a weekly 0–10 slider per area and the projected line.
- **Personal response rules in the UI.** `modules/rules/personal.py` already uses the nightly
  features (adherence from dose logs, reported side effects). Surface "we changed X because you told us Y" on re-plans.
- **Doctor note localisation** and a lab-requisition variant per province or state.
- **Promo codes at checkout.** The admin can create them and the checkout API accepts `promo`.
  Add the field to the paywall sheet.

## Engineering

- **Observability (§12.2).** OpenTelemetry traces around the rules stages and LLM calls, Sentry,
  and PostHog behind the `research` consent. The audit log and `LLMCallLog` already record the
  domain events.
- **LLM eval harness (§10).** Golden transcripts per job with faithfulness and claims checks in CI,
  and prompt caching for the static system prompts.
- **Typed client generation.** Generate `web/src/lib/types.ts` from `/openapi.json` in CI, so API
  changes break the build instead of the UI.
- **More E2E personas.** The spec asks for Maya on every tier plus 10 more personas per PR. The
  helpers in `web/e2e/helpers.ts` already drive any persona file through the UI.
- **Visual regression.** `web/e2e/screens.spec.ts` captures key screens; add snapshot comparison.

## Known limitations (today)

- Email is delivered over SMTP only when `STACKSENSE_SMTP_URL` is set; otherwise it goes to the
  log. There are no transactional templates beyond plain text yet.
- Product editing in the admin is a JSON editor. Fine for a curator, but not a form.
- Free-text mapping without an Anthropic key uses a small lexicon and always asks for
  confirmation.
- The schedule assumes one time zone per user, with no travel mode.
- Experiments assign by `anon_id` or user id. Cross-device stickiness before sign-in isn't
  possible by design.

## Optimisation notes

- **Rules engine.** `RulesEngine.build` is pure. Cache it per (input hash, rules version), since
  re-plans and review previews often repeat inputs. The optimiser is exact with a node cap. Its
  typical search is a few hundred nodes (Maya: 581).
- **Intake.** `preview_exclusions` runs two stages per answer. Skipping it when the answer can't
  touch eligibility facts (diet, meds, conditions, allergies, pregnancy) would save time.
- **Catalog.** `current_catalog` rebuilds the `CatalogSnapshot` from rows on every plan build.
  Snapshot it on write (the version hash already exists) and keep it in Redis.
- **Frontend.** All pages are client components, for privacy (nothing personal is
  server-rendered). The landing and pricing pages could become static server components for a
  faster first paint.
