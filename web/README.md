# StackSense web (PWA)

Next.js App Router + TypeScript + Tailwind 4, TanStack Query for server state, Zustand for the
few things kept on the device (session/plan tokens, anonymous id, locale).

The web app only **renders** what the API returns. Doses, exclusions, interactions and paywall
redaction all happen server-side (see `../AGENTS.md`).

## Run

```sh
npm install
cp .env.example .env.local        # NEXT_PUBLIC_API_URL=http://localhost:8000
npm run dev                       # http://localhost:3000 (API must be running)
```

**Single-origin mode** (one public address per app, e.g. behind a tunnel or proxy): build and
start with `NEXT_PUBLIC_API_URL=` (empty) and `API_PROXY_TARGET=http://<api-host>:8000`. The
browser then only talks to the web app, which forwards `/v1/*` to the API. The admin console
does the same for `/admin/v1/*`.

In dev the API runs Stripe in **fake mode**: checkout goes to `/checkout/fake`, and sign-in
links come back in the API response ("Dev mode: sign in now"), so the whole purchase flow works
offline.

## Routes

| Route | What it is |
|---|---|
| `/` | Landing |
| `/start` | Creates an intake session (`?date=YYYY-MM-DD` pins "today" for demos/tests) |
| `/intake/[sessionId]` | Adaptive intake: question card, live insight rail, branch toasts, stop cards, returning-user confirm card |
| `/intake/[sessionId]/review` | "Here's what we heard": remove/restore signals, add labs, live plan preview |
| `/plan/[planId]` | Health impact map, stack cards, buy list, safety, locked items, save to account |
| `/plan/[planId]/calendar` | Day timeline (dose logging) and month grid, .ics feed, refills (`?date=` deep link) |
| `/pricing`, `/checkout/fake`, `/checkout/success` | Offers by region, checkout round-trip |
| `/account`, `/account/billing`, `/account/privacy` | Saved plans, consent, purchases, export/delete, staff-access log |
| `/auth/callback` | Magic-link landing |
| `/go/[clickId]` | Affiliate redirect for short links |

## Tests

```sh
npm run typecheck
npm test                          # Vitest: helpers and components
# End to end (API on :8000 and `npm run build && npm start` on :3000):
PW_CHROMIUM_PATH=/path/to/chromium npm run e2e
```

The Playwright suite drives the golden personas from `backend/stacksense/data/personas` through
the real UI (Maya: intake → free plan → Full Report purchase → calendar; Teo: under-18 stop;
Sam: live interaction warning) on a phone and a desktop viewport, with an axe accessibility scan.
`SHOTS_DIR=/tmp/shots npx playwright test screens` captures screenshots of key screens.

## Structure

```
src/app/            routes (all interactive pages are client components)
src/components/     intake/, plan/, calendar/, billing/, account/, ui/
src/lib/            api.ts (typed client), types.ts (API shapes), store.ts, intake.ts, format.ts, i18n.ts
public/             manifest, service worker (offline shell + push), icons
e2e/                Playwright specs and persona-driven helpers
```
