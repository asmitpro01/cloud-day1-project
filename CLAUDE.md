# CLAUDE.md

India-first Next.js SaaS boilerplate: Razorpay subscriptions, GST-compliant invoices, Indian OTP login.
The code is the product that buyers pay for: keep it clean, typed, documented and tested.
The full plan is in `docs/PLAN.md`.

## Stack

Next.js 16 (App Router, Server Actions, Turbopack, Cache Components) · React 19 · TypeScript strict · Tailwind CSS v4 ·
shadcn/ui · PostgreSQL + Drizzle ORM (postgres.js driver) · Better Auth · Resend + React Email 6 (`react-email`) ·
Razorpay · @react-pdf/renderer · Zod 4 · Vitest · Playwright · pnpm

## Commands (available from Phase 1)

```bash
pnpm dev               # dev server
pnpm build             # production build
pnpm typecheck         # tsc --noEmit
pnpm lint              # eslint . (Next 16 has no `next lint`)
pnpm format            # prettier --write .
pnpm test              # vitest run (unit)
pnpm test:int          # vitest run integration tests (needs TEST_DATABASE_URL)
pnpm test:e2e          # playwright
pnpm db:generate       # drizzle-kit generate (after schema edits)
pnpm db:migrate        # apply migrations
pnpm bootstrap         # migrate + sync plans to Razorpay + optional seed
pnpm email:dev         # React Email preview
docker compose up -d   # local Postgres 17
```

## Phase workflow

1. Work on one phase at a time (see `docs/PLAN.md`).
2. Before committing, run `pnpm typecheck && pnpm lint && pnpm test` (plus `test:int` when DB code changed), and fix everything.
3. Commit with a Conventional Commit message (`feat(billing): …`, `fix(gst): …`).
4. Report a 5-line summary plus manual test steps. Wait for "next" before starting the next phase.

## Non-negotiables

- **No `any`**, no type assertions to silence errors (`as const` and `satisfies` are fine), and no `@ts-ignore`. Use `unknown` + zod at every boundary
  (env, request bodies, webhook payloads, provider API responses, form input).
- **Money is integer paise**, in a `Paise` branded number with an `_paise` / `Paise` suffix on every column and variable.
  Never use floats for money, and never divide money without an explicit rounding rule. Tax rates are integer basis points (`1800` = 18%).
- **Secrets are server-only.** Every module under `src/server/` and `src/env/server.ts` starts with
  `import "server-only"`. The only browser-visible env vars are `NEXT_PUBLIC_*`, read via `src/env/client.ts`.
- **Never read `process.env` directly** outside `src/env/*` (tooling configs, `instrumentation.ts`, `scripts/` and `e2e/`
  excepted; ESLint enforces this). Call `serverEnv()` on the server or import `clientEnv`.
- **External providers sit behind adapters** (`src/server/providers/{payments,otp,email}`). App code depends only on
  the interface in `types.ts`, never on `razorpay/`, `msg91.ts` and so on directly.
- **Business config lives in one place:** `src/config/site.ts` (brand, company, GSTIN, tax rate, SAC, invoice
  series) and `src/config/plans.ts`. Never hardcode a rate, SAC code, GSTIN, company name or price anywhere else.
- **Never trust the client for payment state.** Only a server-verified Razorpay signature (followed by fetching the
  payment from Razorpay) or a signature-verified webhook may change payment, subscription or invoice records.
- **Test-mode keys only in development.** Env validation rejects `rzp_live_` keys outside production.
  Never commit keys, not even test ones.
- **Ask before adding any dependency** not already in `package.json`.

## Architecture

```
src/app/         routes. Thin: parse input → call a service → render. Server actions in colocated actions.ts.
src/server/      server-only services, DB, auth, providers. Business logic lives here.
src/lib/         pure, framework-free, isomorphic helpers (money, GST, dates, phone). Fully unit-tested.
src/config/      buyer-editable config (site.ts, plans.ts), zod-validated on import.
src/components/  UI. components/ui is shadcn-generated.
src/emails/      React Email templates.
scripts/         bootstrap, sync-plans, seed (run with tsx, validate env like the app does).
```

- Dependency direction: `app → server → lib` and `app → components → lib`. `lib` imports nothing from the app.
- Default to React Server Components. Add `"use client"` only for interactivity, at the smallest leaf.
- Server actions return `ActionResult<T>` (`{ ok: true, data } | { ok: false, error: { code, message, fieldErrors? } }`)
  and never throw to the client. Each one starts by authenticating, then validates with zod.
- Use route handlers only where an action can't work: auth handler, webhooks (raw body), file downloads, health.
- Auth is checked in two layers. `src/proxy.ts` (Next 16's rename of `middleware.ts`) only does an optimistic cookie
  redirect. Layouts, pages, actions and route handlers each call `requireUser()` / `requireAdmin()`.

## Domain rules

- **Dates**: store `timestamptz` (UTC). Display with `Intl` in `Asia/Kolkata` via `src/lib/dates.ts`.
  The Indian financial year (1 April – 31 March) and invoice dates are computed in **IST**, never UTC.
- **Formatting**: `formatINR` uses en-IN grouping (`₹1,23,456.00`), and `amountInWords` uses lakh/crore.
- **Phone**: store E.164 (`+919876543210`). Default country is +91. Indian mobiles are 10 digits starting 6–9.
- **GST**: same state → CGST + SGST (UTGST instead of SGST for UTs without a legislature); different states → IGST.
  Components are rounded half-up to the paise and must sum exactly to the charged total.
- **Invoices**: numbers are ≤ 16 chars from `A-Z 0-9 / -` and unique per FY. They are allocated inside the same DB
  transaction as the invoice insert, with no gaps or duplicates. Issued invoices are immutable (snapshotted data + stored PDF).
- **Webhooks**: verify HMAC-SHA256 over the raw `req.text()` body with `timingSafeEqual` _before_ parsing. Record
  `x-razorpay-event-id` in `processed_events` in the same transaction as the handler's writes. Ignore stale
  (out-of-order) subscription events using `last_event_at`.
- **Idempotency**: every payment side effect is keyed on the provider payment id (unique constraints, not app checks).
- **Account deletion** cascades personal data but keeps invoices and payments (user_id → null), because tax law requires retention.

## Database

- Drizzle schema in `src/server/db/schema/*.ts`, one file per domain. `snake_case` in SQL, camelCase in TS.
- After editing the schema, run `pnpm db:generate` and commit the SQL in `drizzle/`. Never edit a migration that has been applied.
- Constraints belong in the DB (unique, FK, check). Don't rely only on app-level checks.
- Use `db.transaction()` for any multi-row write. Avoid N+1 queries: use joins or `inArray`.
- Better Auth tables (`user`, `session`, `account`, `verification`) are generated by its CLI. Extend them via
  Better Auth `additionalFields` or plugins, not by hand.

## Code style

- Strict TS (`strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`). Prefer `type` over `interface`
  except for adapter contracts.
- Files are `kebab-case.ts`, components `PascalCase`, functions and variables `camelCase`, constants `SCREAMING_SNAKE`.
- Named exports only, except where Next.js requires a default (pages, layouts, route files).
- Keep comments sparse. Explain _why_ (especially tax or legal reasoning, with the rule cited), never _what_.
  Public helpers in `src/lib` and adapter interfaces get TSDoc.
- Use typed domain errors (`class PaymentVerificationError extends AppError`) instead of string throws.
- No `console.log` in committed code except in the `console` dev adapters. Use `src/server/logger.ts`.

## Testing

- Unit-test every pure function in `src/lib` (GST, rounding, GSTIN checksum, amount in words, FY rollover, phone).
- Integration tests (`*.int.test.ts`) run against real Postgres: invoice numbering concurrency, webhook
  idempotency, rate limits.
- The Playwright smoke test covers signup → buy plan (test mode) → invoice generated and emailed.
- Write tests that pin India-specific edge cases: IST midnight on 31 March, odd-paise CGST/SGST splits,
  UT states, inclusive-price back-calculation, ₹ rendering.

## Security

- Security headers and CSP live in `next.config.ts`. Allow `checkout.razorpay.com` / `api.razorpay.com` only where needed.
- Rate-limit auth, OTP (per phone **and** per IP, 30 s resend cooldown) and the waitlist form via `src/server/rate-limit.ts`.
- Escape everything that goes into CSV exports (formula injection: leading `= + - @`).
- Every PDF or export route checks ownership (owner or admin), not just authentication.

## Gotchas

- Next 16 uses `src/proxy.ts`, not `middleware.ts`. There is no `next lint`. `cookies()`, `headers()` and `params` are async.
- Next 16 ships its own docs in `node_modules/next/dist/docs/`. Read them before using an unfamiliar API (see AGENTS.md).
- Cache Components is on: anything that reads cookies, headers, the session or uncached data must sit inside
  `<Suspense>` (or use `"use cache"`); otherwise the build fails. Static marketing pages stay fully prerendered.
- `server-only` throws outside Next.js. Vitest aliases it to `test/server-only-stub.ts`, and scripts run with
  `tsx --tsconfig scripts/tsconfig.json`, which maps it to the same stub.
- shadcn/ui components were vendored from the shadcn GitHub registry (new-york-v4); `ui.shadcn.com` is not needed.
- Tailwind v4 is configured in CSS (`@theme` in `globals.css`). There is no `tailwind.config.js`.
- Zod 4 uses top-level formats (`z.email()`, `z.url()`) and `error` instead of `message`/`errorMap`.
- @react-pdf's built-in Helvetica has no ₹ glyph. Register the bundled Noto Sans font.
- Indian SMS needs DLT-registered templates. Use `OTP_PROVIDER=console` locally.
- Razorpay plans are immutable: a price change means a new plan (handled by `sync-plans`).
- The kit's own landing-page pricing (`(marketing)/_content.ts`) is separate from the demo SaaS plans (`config/plans.ts`).

## Disclaimer

This kit is a tool, not tax or legal advice. GST defaults (rate, SAC code, place-of-supply rules) must be verified by the buyer's CA.
