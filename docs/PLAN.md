# Phase 0 Plan

Status: **built** (all six phases). See "As built" at the end for where the build deviated from this plan. Versions checked on npm (2026-10-24): Next 16.4, React 19.3, Better Auth 1.7,
Drizzle ORM 0.45 / drizzle-kit 0.31, Zod 4.6, Tailwind 4.3, Vitest 5, Playwright 1.64, @react-pdf/renderer 4.9.

---

## 1. Folder structure

```
.
├── CLAUDE.md                     # conventions for humans and AI agents
├── README.md                     # Phase 6: 30-minute setup guide
├── .env.example                  # every variable, commented
├── Dockerfile                    # multi-stage build, Next standalone output
├── docker-compose.yml            # local Postgres 17 (dev + integration tests)
├── drizzle.config.ts
├── next.config.ts                # security headers, standalone output
├── eslint.config.mjs             # flat config, type-aware rules
├── vitest.config.ts
├── playwright.config.ts
├── components.json               # shadcn/ui
├── drizzle/                      # generated SQL migrations (committed)
├── docs/
│   ├── PLAN.md                   # this file
│   └── e-invoicing.md            # Phase 4: IRN extension stub
├── e2e/
│   └── smoke.spec.ts             # signup → buy plan → invoice emailed
├── public/
│   ├── brand/                    # logo.svg, og.png, favicon
│   └── fonts/                    # Noto Sans TTF for PDFs (Helvetica has no ₹ glyph)
├── scripts/
│   ├── bootstrap.ts              # migrate + sync plans + optional seed: the "one setup command"
│   ├── sync-plans.ts             # config/plans.ts → Razorpay Plans API
│   └── seed.ts                   # demo users, subscriptions, invoices
└── src/
    ├── app/
    │   ├── layout.tsx            # fonts, ThemeProvider, brand CSS variables
    │   ├── globals.css           # Tailwind v4 + shadcn tokens
    │   ├── error.tsx  not-found.tsx
    │   ├── (marketing)/          # public, statically rendered
    │   │   ├── page.tsx          # hero, features, code preview, pricing, FAQ, waitlist
    │   │   ├── _components/      # hero, features, code-preview, pricing, faq, waitlist-form
    │   │   ├── _content.ts       # landing copy + KIT pricing tiers (not app plans)
    │   │   ├── actions.ts        # joinWaitlist server action
    │   │   ├── legal/[slug]/     # terms, privacy, refunds, shipping (Razorpay needs these to activate)
    │   │   └── contact/
    │   ├── (auth)/
    │   │   ├── sign-in/  sign-up/  forgot-password/  reset-password/
    │   │   └── layout.tsx
    │   ├── dashboard/
    │   │   ├── layout.tsx        # authoritative server-side session check
    │   │   ├── page.tsx
    │   │   ├── settings/         # profile, phone, GSTIN, billing address, privacy (export/delete)
    │   │   └── billing/          # plan, next charge, upgrade/cancel, history, invoices
    │   ├── admin/
    │   │   ├── layout.tsx        # role check
    │   │   ├── page.tsx          # MRR, active subscriptions, churn
    │   │   └── users/  subscriptions/  invoices/  waitlist/
    │   └── api/
    │       ├── auth/[...all]/route.ts
    │       ├── webhooks/razorpay/route.ts
    │       ├── invoices/[id]/pdf/route.ts
    │       ├── account/export/route.ts
    │       ├── admin/waitlist/export/route.ts
    │       └── health/route.ts
    ├── components/
    │   ├── ui/                   # shadcn primitives (generated, lightly edited)
    │   └── *.tsx                 # shared: theme-toggle, inr, state-select, ...
    ├── config/
    │   ├── site.ts               # ★ brand + company + GST + invoice series (the ONE business config)
    │   └── plans.ts              # ★ plans, prices in paise, features
    ├── emails/                   # React Email templates
    ├── env/
    │   ├── server.ts             # zod-validated server env ("server-only")
    │   └── client.ts             # NEXT_PUBLIC_* only
    ├── lib/                      # pure, framework-free, unit-tested
    │   ├── money.ts              # Paise brand type, formatINR, conversions
    │   ├── amount-in-words.ts    # lakh / crore
    │   ├── dates.ts              # IST formatting, Indian financial year
    │   ├── phone.ts              # E.164 parse/validate, +91 default
    │   ├── gst/
    │   │   ├── states.ts         # states + GST codes + "UT without legislature" flag
    │   │   ├── gstin.ts          # format + checksum
    │   │   └── tax.ts            # CGST/SGST/UTGST/IGST, inclusive/exclusive, rounding
    │   ├── csv.ts
    │   └── result.ts             # ActionResult<T>
    ├── server/                   # server-only; every module imports "server-only"
    │   ├── db/
    │   │   ├── client.ts
    │   │   └── schema/           # auth.ts, marketing.ts, account.ts, billing.ts, invoices.ts, system.ts
    │   ├── auth/
    │   │   ├── auth.ts           # Better Auth instance, plugins, hooks
    │   │   └── session.ts        # requireUser(), requireAdmin()
    │   ├── providers/            # ★ swappable adapters
    │   │   ├── payments/         # types.ts, razorpay/, index.ts
    │   │   ├── otp/              # types.ts, msg91.ts, twilio.ts, console.ts, index.ts
    │   │   └── email/            # types.ts, resend.ts, console.ts, index.ts
    │   ├── billing/              # checkout, subscriptions, webhook handlers, entitlements
    │   ├── invoices/             # numbering, create, pdf/, e-invoicing interface
    │   ├── account/              # consent, export, delete
    │   ├── admin/                # metric queries
    │   ├── waitlist.ts
    │   ├── logger.ts
    │   └── rate-limit.ts
    ├── proxy.ts                  # Next 16 rename of middleware.ts: cookie gate for /dashboard, /admin
    └── instrumentation.ts        # validates env at server boot
```

Tests are colocated: `foo.ts` → `foo.test.ts` (Vitest, pure), `foo.int.test.ts` (Vitest against real Postgres).

---

## 2. Database schema

Conventions: `snake_case` columns, `timestamptz` everywhere (UTC stored, IST displayed), money as
`bigint` paise with an `_paise` suffix, tax rates as integer basis points (`1800` = 18%) with a `_bps` suffix.
Better Auth tables use its text ids. App tables use `uuid` defaulting to `gen_random_uuid()`.

### Better Auth (generated by its CLI, then committed)

| Table          | Key columns                                                                                                                                                       |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `user`         | id, name, email (unique), email_verified, image, **phone_number** (unique, null), **phone_number_verified**, **role** (`user` \| `admin`), created_at, updated_at |
| `session`      | id, user_id → user, token, expires_at, ip_address, user_agent                                                                                                     |
| `account`      | id, user_id → user, provider_id, account_id, password (hash), OAuth tokens                                                                                        |
| `verification` | id, identifier, value, expires_at. Holds OTPs and email tokens.                                                                                                   |

### Account (Phase 2)

| Table              | Key columns                                                                                                                                                                                  |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `billing_profiles` | user_id PK → user (cascade), legal_name, gstin (null; format + checksum validated), address_line1, address_line2, city, state_code `char(2)` (GST state code), pincode `char(6)`, updated_at |
| `user_consents`    | id, user_id → user (cascade), purpose, policy_version, granted_at, ip_address, user_agent, withdrawn_at                                                                                      |

### Marketing (Phase 1)

| Table              | Key columns                                                                          |
| ------------------ | ------------------------------------------------------------------------------------ |
| `waitlist_entries` | id, name, email, email_normalized (unique), source, created_at, confirmation_sent_at |

### Billing (Phase 3)

| Table            | Key columns                                                                                                                                                                                                                                                                                                                                                |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `provider_plans` | id, plan_key, interval (`monthly` \| `yearly`), amount_paise, provider, mode (`test` \| `live`), provider_plan_id (unique), active, created_at. Unique (provider, mode, plan_key, interval, amount_paise). Razorpay plans are immutable, so a price change creates a new row. Test and live ids differ, so they live in the DB, not in config.             |
| `subscriptions`  | id, user_id → user (set null), plan_key, interval, amount_paise, provider, provider_subscription_id (unique), provider_plan_id, status (enum, below), current_period_start, current_period_end (next charge), cancel_at_period_end, cancelled_at, ended_at, paid_count, total_count, last_event_at (ignores out-of-order webhooks), created_at, updated_at |
| `orders`         | id, user_id → user (set null), product_key, amount_paise, provider_order_id (unique), receipt, status (`created` \| `paid` \| `failed`), created_at, paid_at                                                                                                                                                                                               |
| `payments`       | id, user_id → user (set null), provider_payment_id (unique), order_id → orders (null), subscription_id → subscriptions (null), amount_paise, currency, status (`authorized` \| `captured` \| `failed` \| `refunded`), method (upi/card/netbanking/wallet), error_code, error_description, captured_at, created_at                                          |

`subscription_status` enum: `created, authenticated, active, pending, halted, cancelled, completed, paused, expired`.

### Invoices (Phase 4)

| Table               | Key columns                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `invoice_sequences` | PK (series, financial_year), last_value int. One row per series per FY. The counter increments with `INSERT … ON CONFLICT DO UPDATE … RETURNING` inside the invoice transaction: a row lock with no gaps, because a rollback undoes the increment.                                                                                                                                                                                                                                                                                                                                                                                                          |
| `invoices`          | id, invoice_number `varchar(16)` (unique), series, financial_year (e.g. `2026-27`), sequence_value, invoice_date (IST calendar date), user_id → user (**set null**), payment_id → payments (**unique**, so there is one invoice per charge), subscription_id, order_id, seller (jsonb snapshot), buyer_name, buyer_email, buyer_address (jsonb), buyer_gstin, buyer_state_code, place_of_supply_state_code, sac_code, pricing_mode (`inclusive` \| `exclusive`), line_items (jsonb), taxable_value_paise, cgst_rate_bps, cgst_paise, sgst_rate_bps, sgst_paise, utgst_rate_bps, utgst_paise, igst_rate_bps, igst_paise, total_paise, emailed_at, created_at |
| `invoice_pdfs`      | invoice_id PK → invoices, content `bytea`, sha256, byte_size, created_at. The PDF is rendered once and stored, so later template edits never change an issued invoice.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

Invoices and payments **outlive account deletion** (user_id set to null, buyer details snapshotted). The
CGST Act requires keeping records for about 6 years, and DPDP allows retention that the law requires.
The privacy page says so.

### System

| Table              | Key columns                                                                                                                                                                                               |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `processed_events` | event_id PK (`x-razorpay-event-id`), provider, event_type, received_at. Inserted in the **same transaction** as the handler's writes, so a failed handler rolls back and Razorpay's retry gets processed. |
| `rate_limits`      | key PK (e.g. `otp:phone:+9198…`, `otp:ip:1.2.3.4`), count, window_start, expires_at. Atomic upsert, fixed window. Also plugged into Better Auth as its `customStorage`, so there is one limiter.          |

### Relations

```
user 1─1 billing_profiles          user 1─n user_consents        user 1─n session / account
user 1─n subscriptions 1─n payments 0..1─1 invoices 1─1 invoice_pdfs
user 1─n orders        1─n payments
invoice_sequences (series, fy) ──issues──> invoices.invoice_number
standalone: waitlist_entries, provider_plans, processed_events, rate_limits
```

---

## 3. Routes

| Route                                                         | Type                | Phase | Access                      |
| ------------------------------------------------------------- | ------------------- | ----- | --------------------------- |
| `/`                                                           | page (static)       | 1     | public                      |
| `/legal/{terms,privacy,refunds,shipping}`, `/contact`         | page (static)       | 1     | public                      |
| `/sign-in`, `/sign-up`, `/forgot-password`, `/reset-password` | page                | 2     | guests                      |
| `/dashboard`                                                  | page                | 2     | user                        |
| `/dashboard/settings`                                         | page + actions      | 2     | user                        |
| `/dashboard/billing`                                          | page + actions      | 3     | user                        |
| `/admin`, `/admin/{users,subscriptions,invoices,waitlist}`    | page                | 5     | admin                       |
| `/api/auth/[...all]`                                          | Better Auth handler | 2     | —                           |
| `/api/account/export`                                         | GET, JSON download  | 2     | user                        |
| `/api/webhooks/razorpay`                                      | POST, raw body      | 3     | Razorpay signature          |
| `/api/invoices/[id]/pdf`                                      | GET                 | 4     | owner or admin              |
| `/api/admin/waitlist/export`                                  | GET, CSV            | 5     | admin                       |
| `/api/health`                                                 | GET                 | 1     | public (Docker healthcheck) |

Server actions (colocated `actions.ts`, each one does zod parse → service call → `ActionResult`):
`joinWaitlist`, `updateProfile`, `updateBillingProfile`, `exportData`, `deleteAccount`, `startCheckout`,
`verifyCheckout`, `changePlan`, `cancelSubscription`.

Two-layer protection: `proxy.ts` does a fast cookie-presence redirect. The `dashboard/` and `admin/`
layouts plus every action do the authoritative `auth.api.getSession()` check. The proxy is never trusted
on its own.

---

## 4. Environment variables

Validated with zod in `src/env/server.ts` at boot (`instrumentation.ts`) and in every script.
Provider-specific keys are required only when that provider is selected (discriminated union).

| Variable                                                 | Required    | Notes                                                                                                                             |
| -------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_APP_URL`                                    | yes         | Base URL for auth callbacks, email links and Razorpay redirects. Baked in at build.                                               |
| `DATABASE_URL`                                           | yes         | Pooled URL (Neon pooled / Supabase transaction pooler).                                                                           |
| `DATABASE_URL_UNPOOLED`                                  | no          | Direct URL for migrations. Falls back to `DATABASE_URL`. The name matches Neon's Vercel integration.                              |
| `BETTER_AUTH_SECRET`                                     | yes         | ≥ 32 chars (`openssl rand -base64 32`).                                                                                           |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`               | no (pair)   | The Google button is hidden when unset.                                                                                           |
| `ADMIN_EMAILS`                                           | no          | Comma-separated. These users get the `admin` role.                                                                                |
| `OTP_PROVIDER`                                           | yes         | `msg91` \| `twilio` \| `console`. `console` is rejected in production.                                                            |
| `MSG91_AUTH_KEY`, `MSG91_TEMPLATE_ID`                    | if msg91    | Template must be DLT-approved.                                                                                                    |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | if twilio   | `TWILIO_FROM` is an E.164 number or a Messaging Service SID.                                                                      |
| `EMAIL_PROVIDER`                                         | yes         | `resend` \| `console`. `console` is rejected in production.                                                                       |
| `RESEND_API_KEY`                                         | if resend   |                                                                                                                                   |
| `EMAIL_FROM`                                             | yes         | `"Acme <billing@acme.in>"`                                                                                                        |
| `EMAIL_REPLY_TO`                                         | no          |                                                                                                                                   |
| `PAYMENTS_PROVIDER`                                      | yes         | `razorpay` (plus `fake` for e2e only, rejected in production).                                                                    |
| `RAZORPAY_KEY_ID`                                        | if razorpay | Must start with `rzp_test_` outside production. Sent to the browser via the checkout action, so no `NEXT_PUBLIC_` copy is needed. |
| `RAZORPAY_KEY_SECRET`                                    | if razorpay |                                                                                                                                   |
| `RAZORPAY_WEBHOOK_SECRET`                                | if razorpay | Separate from the key secret. Set in the Razorpay dashboard.                                                                      |
| `NEXT_PUBLIC_PREORDER_URL`                               | no          | Razorpay Payment Page URL for the landing "Pre-order" button. Falls back to the waitlist when unset.                              |
| `TRUSTED_IP_HEADER`                                      | no          | Default `x-forwarded-for`. Used by per-IP rate limits.                                                                            |
| `TEST_DATABASE_URL`                                      | tests       | Integration tests (concurrent invoice numbering). docker-compose provides it.                                                     |

---

## 5. Cross-cutting design decisions

- **Adapters**: `PaymentProvider`, `OtpSender`, `EmailSender` interfaces in `server/providers/*/types.ts`.
  `index.ts` picks the implementation from env. App code imports only the interface, so adding Cashfree means
  adding a folder and changing nothing else.
- **OTP ownership**: Better Auth's phone-number plugin generates and verifies codes (6 digits, 300 s
  expiry, 5 attempts). Adapters only _deliver_ the code. Cooldown (30 s) and per-phone/per-IP limits run in a
  Better Auth `hooks.before` on the send/verify endpoints.
- **Payment truth**: the checkout success callback only triggers `verifyCheckout`, which checks the HMAC
  signature, then **fetches the payment from Razorpay** and records it. Webhooks call the same idempotent
  `recordCapturedPayment(paymentId)`. So local dev completes the first purchase and invoice without a
  webhook tunnel, while renewals arrive by webhook. Invoice creation is keyed on `payment_id`, so
  `payment.captured` and `subscription.charged` for the same charge produce one invoice.
- **Webhook**: `await req.text()`, then HMAC-SHA256 with the webhook secret, compared with `timingSafeEqual`, then
  `JSON.parse`, then zod-parse per event. Events not in the handled list are acknowledged and ignored.
- **GST**: place of supply = buyer's billing state, which is required before checkout. Same state gives CGST + SGST,
  or **CGST + UTGST** for UTs without a legislature (Chandigarh, Ladakh, Lakshadweep, A&N, DNH&DD). Different
  states give IGST. Integer math, round half-up to the paise, and components always sum to the charged total. When a
  GSTIN is given, its state prefix must match the billing state.
- **Financial year is computed in IST**: a payment at 23:30 UTC on 31 March falls on 1 April IST, which is the next FY.
- **Invoice number**: `{PREFIX}/{FY}/{COUNTER}`, e.g. `INV/2627/000042` (15 chars). Config is zod-checked at
  boot so the longest possible number is ≤ 16 chars and uses only `A-Z 0-9 / -` (CGST Rule 46).
- **Entitlements**: `hasAccess(userId, feature)` is derived from the active subscription status + `plans.ts` features
  (+ paid one-time products). `pending` keeps access (Razorpay is retrying). `halted` revokes it. A
  `cancelled` subscription keeps access until `current_period_end`. Memoised per request with React `cache()`.
- **Prices**: Indian B2C defaults to tax-inclusive pricing (`site.gst.pricingMode = "inclusive"`). With the same rate
  intra- and inter-state, the charged total never depends on the buyer's state.

---

## 6. Dependencies beyond the Stack list (need your approval)

| Package                                                                                                               | Why                                                                                                                                                            | Phase |
| --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| `postgres` (postgres.js)                                                                                              | Drizzle needs a driver. Works with Neon and Supabase over TCP and supports the interactive transactions invoice numbering needs (Neon's HTTP driver does not). | 1     |
| `drizzle-kit` (dev)                                                                                                   | Migrations. Drizzle's own CLI.                                                                                                                                 | 1     |
| `next-themes`                                                                                                         | Dark mode, as shadcn/ui documents it.                                                                                                                          | 1     |
| shadcn transitive: `radix-ui`, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`, `tw-animate-css` | Installed by the shadcn CLI.                                                                                                                                   | 1     |
| `server-only`                                                                                                         | Build fails if server code (secrets) is imported from a client component.                                                                                      | 1     |
| `shiki`                                                                                                               | Syntax highlighting for the landing code preview. Rendered on the server, so zero client JS.                                                                   | 1     |
| `tsx` (dev)                                                                                                           | Run `scripts/*.ts` with path aliases.                                                                                                                          | 1     |
| `prettier`, `prettier-plugin-tailwindcss` (dev)                                                                       | Formatting and class sorting.                                                                                                                                  | 1     |
| `react-email` (dev)                                                                                                   | Email preview server. `@react-email/components` counts as Stack.                                                                                               | 1     |

Deliberately **not** added: Razorpay, MSG91 and Twilio SDKs (thin typed `fetch` clients with zod-parsed
responses instead: no SDK lock-in and full types), `libphonenumber-js` (E.164 + Indian mobile rules written
by hand), t3-env, Upstash, MDX. One-off `npx @better-auth/cli generate` is used for the auth schema, not installed.

---

## 7. Open decisions (defaults apply if you just reply "next")

1. **Product name**: `[PRODUCT_NAME]` is unfilled. Default: placeholder `"Desi SaaS Kit"` in `src/config/site.ts` (a one-line change).
2. **Kit pricing tiers on the landing page**: default placeholders Solo ₹4,999 / Pro ₹9,999 / Agency ₹19,999 (one-time).
3. **One business config file**: `src/config/site.ts` holds brand + company + GST + invoice series. This satisfies
   both "tax/SAC/company in ONE file" and Phase 6's "one branding file (incl. company details)". Plans stay in `plans.ts`.
4. **Approve the dependency table in §6.**
5. **Razorpay client**: default is a thin typed `fetch` client (vs. the official `razorpay` SDK).
6. **E2E payment strategy**: default is `PAYMENTS_PROVIDER=fake` for the Playwright smoke test (offline,
   deterministic, sends correctly signed webhooks to the real webhook route), plus an opt-in tagged test that drives
   real Razorpay test-mode Checkout when keys are present.
7. **Package manager**: default `pnpm`. The setup is 3 commands: `pnpm install`, `pnpm bootstrap`, `pnpm dev`.
8. **Invoice PDFs**: default is stored in Postgres (`invoice_pdfs`), not re-rendered on demand.

## 8. Known India-specific gotchas (these go into the README)

- **DLT**: commercial SMS in India needs a TRAI DLT-registered sender ID and template, and approval can take days.
  The `console` OTP adapter keeps local dev unblocked, and the README explains DLT for go-live.
- **Razorpay account activation** requires Terms, Privacy, Refund, Shipping/Delivery and Contact pages, which ship in Phase 1.
- **Webhooks can't reach localhost**: covered by verify-on-checkout (§5). The README shows a tunnel for renewals.

---

## As built: changes from this plan

- **React Email 6**: `@react-email/components` is deprecated; components and `render` come from `react-email`.
- **Better Auth schema**: written by hand in `src/server/db/schema/auth.ts` and checked against `getAuthTables()`
  (the CLI can't load a config that imports `server-only`).
- **Rate limiting**: Better Auth's in-memory limiter is off; one Postgres-backed limiter (`rate_limits`) runs in auth hooks.
- **Optional providers**: `OTP_PROVIDER=none` hides phone login and `PAYMENTS_PROVIDER=none` hides billing, so the
  landing page can go live before MSG91/Razorpay are ready. `PAYMENTS_PROVIDER=fake` is an offline Razorpay simulator.
- **Invoices table**: one `tax_rate_bps` plus `supply_type` instead of per-component rate columns (handles odd
  rates such as 0.25%). A CHECK constraint enforces `total = taxable + cgst + sgst + utgst + igst`.
- **Invoice maths** always starts from the amount actually charged, so invoice totals equal payments. Exclusive
  pricing adds GST when computing the charge (`chargeAmountFor`).
- **PDFs** render after the invoice transaction commits (short numbering lock) and are stored once in `invoice_pdfs`.
- **Next.js 16.4 Cache Components** is on: session-dependent UI sits in `<Suspense>`; dashboard and admin routes are
  partially prerendered.
- **Stale webhooks**: provider event time is compared with `last_event_at`; same-second events apply unless they would
  move a subscription back to `created`/`authenticated`.
- **Seed** invoices use a separate `DEMO` series so they never consume real invoice numbers.
