# StackSense admin console

Staff console for the `/admin/v1` API (spec section 15). Next.js + Tailwind + TanStack Query,
same design tokens as the web app. Runs on its own origin (port 3001) and stores the staff
session in `sessionStorage` only.

```sh
npm install
cp .env.example .env.local      # NEXT_PUBLIC_API_URL=http://localhost:8000
npm run dev                     # http://localhost:3001/login
```

Local dev accounts (seeded by the API in dev): `admin@`, `editor@`, `pharmacist@`, `catalog@`,
`revenue@`, `support@`, `analyst@stacksense.dev`. In dev and test the TOTP code can be left
blank; everywhere else it's required.

| Section | Scope | What it does |
|---|---|---|
| Engine releases | `engine.read` / `engine.draft` / `engine.approve` / `engine.publish` | Draft rules or graph releases, edit rows (with a source citation), run the automated checks (schema, knowledge validation, graph reachability, golden personas), submit, review (never your own), publish with a rollout %, roll back |
| Simulator | `engine.simulate` | Run a golden persona or custom answers through live vs draft and diff the plans |
| Knowledge & graph | `engine.read` | Browse live tables, validation status, LLM fallback rate |
| Users | `users.*` | Search by exact email/id, masked profile, reveal with an audited reason (shown to the user), consents, entitlements, refunds, suspend, resend link, re-run preview |
| Privacy queue | `privacy.queue` | Fulfil export/delete requests that arrived outside self-service |
| Catalog | `catalog.*` | Products, activate/deactivate, pin/demote/ban overrides, link health, retailers, click performance |
| Revenue | `revenue.*` | Feature matrix by plan, prices, trials, paywall drafts and publish, promos, experiments with guardrails |
| Analytics | `dashboards.read`, `cohorts.read` | Funnel and revenue KPIs; de-identified cohorts with small-cell suppression |
| Audit log | `audit.read` / `audit.export` | Filter and export the append-only audit log, with before/after diffs |
| Staff & roles | `staff.manage` | Add staff (TOTP setup link), change roles |

The console only calls the API: there are no direct database edits, and the server enforces
every scope, so hiding a button is a convenience, not the control.

Tests: `npm run typecheck && npm test`. The end-to-end admin flows (release workflow, role
scoping) live in `../web/e2e/admin.spec.ts`.
