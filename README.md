# Desi SaaS Kit

**The India-first Next.js SaaS boilerplate.** Razorpay subscriptions, GST-compliant invoices and Indian
OTP login, wired together and tested. Clone it, fill `.env`, run three commands, and you have a working
paid SaaS for Indian customers.

> **Disclaimer:** this kit is a software tool, not tax or legal advice. The GST defaults (18%, SAC
> 998314, invoice series, place-of-supply rules) and the legal page templates are starting points.
> **Have your CA verify your GST configuration and a lawyer review your policies before you go live.**

---

## Contents

1. [What you get](#what-you-get)
2. [30-minute setup](#30-minute-setup)
3. [Razorpay test mode, step by step](#razorpay-test-mode-step-by-step)
4. [MSG91 setup (SMS OTP)](#msg91-setup-sms-otp)
5. [Deploy to Vercel + Neon](#deploy-to-vercel--neon)
6. [Add or change a plan](#add-or-change-a-plan)
7. [Customise branding](#customise-branding)
8. [How it works](#how-it-works)
9. [Scripts](#scripts)
10. [Testing](#testing)
11. [Security](#security)
12. [FAQ](#faq)

---

## What you get

| Area             | India-specific details                                                                                                                                                                                                                                                              |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Auth**         | Phone OTP (+91 default, E.164 validation, 6 digits, 5-minute expiry, 5 attempts, 30-second resend cooldown, limits per phone **and** per IP), email + password, Google. MSG91 or Twilio behind one adapter.                                                                         |
| **Payments**     | Razorpay Subscriptions (UPI AutoPay, cards, e-mandates) and Orders for one-time purchases. Signature-verified checkout, HMAC-verified idempotent webhooks for all 11 lifecycle events, out-of-order protection.                                                                     |
| **GST invoices** | CGST + SGST, **CGST + UTGST** for UTs without a legislature, IGST across states. Inclusive or exclusive pricing. Gap-free `INV/2627/000042` numbering per financial year (resets 1 April IST, ≤ 16 characters). PDF with ₹, amount in words (lakh/crore), emailed and downloadable. |
| **Money**        | Integer paise everywhere, `₹1,23,456.00` formatting, IST dates, financial-year helpers.                                                                                                                                                                                             |
| **DPDP basics**  | Consent checkbox on every sign-up path, stored with timestamp, policy version and IP; JSON data export; account deletion that keeps tax records as the law requires.                                                                                                                |
| **Admin**        | Users, subscriptions, invoices, MRR in ₹ (excluding GST), active subscriptions, churn this month, waitlist CSV export.                                                                                                                                                              |
| **Sales page**   | Landing page with features, code preview, INR pricing, FAQ, waitlist and a Razorpay Payment Page pre-order button. Lighthouse 98/100/100/100 (mobile).                                                                                                                              |
| **Quality**      | Strict TypeScript (no `any`, no type assertions), zod at every boundary, 119 unit tests, 27 Postgres integration tests (concurrent invoice numbering, webhook idempotency), Playwright smoke test, CI workflow, Dockerfile.                                                         |

**Stack:** Next.js 16 (App Router, Server Actions, Cache Components) · React 19 · TypeScript · Tailwind CSS v4 ·
shadcn/ui · PostgreSQL + Drizzle ORM · Better Auth · Resend + React Email · Razorpay · @react-pdf/renderer ·
Zod · Vitest · Playwright.

---

## 30-minute setup

**You need:** Node.js 22.9+, pnpm (`corepack enable`), and a Postgres database: [Neon](https://neon.tech)
(free tier), [Supabase](https://supabase.com), or local Postgres via `docker compose up -d`.

```bash
git clone <your-repo> my-saas && cd my-saas
cp .env.example .env
```

Edit `.env`:

| Variable                            | What to put                                                                                                                |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                      | Your Postgres URL. Local Docker: `postgres://postgres:postgres@localhost:5432/app`                                         |
| `BETTER_AUTH_SECRET`                | Output of `openssl rand -base64 32`                                                                                        |
| `OTP_PROVIDER`                      | `console` for now: OTPs print in the terminal. Switch to `msg91` later.                                                    |
| `EMAIL_PROVIDER` / `RESEND_API_KEY` | `console` writes emails to `.outbox/`. For real inboxes set `resend` and an API key from [resend.com](https://resend.com). |
| `PAYMENTS_PROVIDER`                 | `fake` works offline right away. Set `razorpay` with test keys (next section) to use real Razorpay test mode.              |

Then the three commands:

```bash
pnpm install
pnpm bootstrap      # validates .env, migrates the database, syncs plans to Razorpay
pnpm dev            # http://localhost:3000
```

Add `--seed` to bootstrap (`pnpm bootstrap --seed`) for demo users, subscriptions and invoices
(`admin@example.com` / `demo-password-123`).

**Check it works:**

1. Open `/sign-up`, tick the consent box and sign up with a mobile number. The OTP appears in the terminal.
2. In **Settings**, add your email and a billing address (pick your state).
3. In **Billing**, subscribe to Pro. With Razorpay test keys, pay with a [test card or UPI ID](https://razorpay.com/docs/payments/payments/test-card-details/) (e.g. UPI `success@razorpay`).
4. The plan turns **Active**, the payment shows an `INV/…` invoice link, and the invoice PDF arrives in your inbox (or `.outbox/emails/`).

To make yourself an admin: `pnpm admin:grant you@example.com`, or list your email in `ADMIN_EMAILS` (applies once it's verified). Then open `/admin`.

---

## Razorpay test mode, step by step

1. **Create an account** at [dashboard.razorpay.com](https://dashboard.razorpay.com/signup). You can use test mode before KYC is complete.
2. **Switch to Test Mode** with the toggle at the top of the dashboard.
3. **API keys:** _Account & Settings → API Keys → Generate Test Key_. Copy the Key ID (`rzp_test_…`) and the Key Secret (shown once).
4. **Webhook:** _Account & Settings → Webhooks → Add New Webhook_
   - URL: `https://<your-domain>/api/webhooks/razorpay`. For local development, expose port 3000 with a tunnel such as `cloudflared tunnel --url http://localhost:3000` or `ngrok http 3000`, and use that URL.
   - Secret: any long random string (`openssl rand -hex 32`). This is **not** your key secret.
   - Active events: `payment.captured`, `payment.failed`, `subscription.authenticated`, `subscription.activated`, `subscription.charged`, `subscription.pending`, `subscription.halted`, `subscription.cancelled`, `subscription.completed`, `subscription.paused`, `subscription.resumed`.
5. **`.env`:**
   ```bash
   PAYMENTS_PROVIDER=razorpay
   RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxxxx
   RAZORPAY_KEY_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx
   RAZORPAY_WEBHOOK_SECRET=<the webhook secret from step 4>
   ```
   Outside production, the app refuses `rzp_live_` keys, so you can't charge real money by accident.
6. **Create the plans:** `pnpm plans:sync` (also part of `pnpm bootstrap`) creates a Razorpay plan for every paid plan in `src/config/plans.ts`.
7. **Pay** using [Razorpay's test cards and UPI IDs](https://razorpay.com/docs/payments/payments/test-card-details/).

**No tunnel? It still works.** After Checkout succeeds, the server verifies the signature and fetches the
payment from Razorpay itself, so the first purchase activates and the invoice is issued without webhooks.
Renewals, failures and cancellations do need webhooks.

**Pre-orders for your landing page:** create a [Payment Page](https://dashboard.razorpay.com/app/paymentpages)
and put its URL in `NEXT_PUBLIC_PREORDER_URL`. Those payments are acknowledged by the webhook and ignored.

**Going live:** complete KYC. Razorpay asks for Terms, Privacy, Refund, Shipping and Contact pages, which ship
in `src/app/(marketing)/legal/*` and `/contact`. Generate live keys, add the webhook again in live mode,
and run `pnpm plans:sync` against production (live plans get their own ids).

---

## MSG91 setup (SMS OTP)

Commercial SMS in India must use a sender ID and template registered on a **DLT** platform (TRAI rules).
Approval can take a few days, so start early and use `OTP_PROVIDER=console` meanwhile.

1. **DLT registration:** register your business as a Principal Entity on a DLT portal (for example Jio TrueConnect, Vodafone Idea Vilpower or Airtel DLT), then register:
   - a **Header** (sender ID), e.g. `DESKIT`;
   - an **OTP content template**, category _Service Implicit_, for example
     `{#var#} is your OTP for Desi SaaS Kit. It is valid for 5 minutes. Do not share it with anyone.`
2. **MSG91 account** at [msg91.com](https://msg91.com), complete KYC, and add your DLT Entity ID and header.
3. **OTP template in MSG91:** create an OTP template with your DLT Template ID and the same text, using `##OTP##` where the DLT template has `{#var#}`. Copy MSG91's **Template ID**.
4. **Auth key:** _Authkey → Create_.
5. **`.env`:**
   ```bash
   OTP_PROVIDER=msg91
   MSG91_AUTH_KEY=xxxxxxxx
   MSG91_TEMPLATE_ID=xxxxxxxx
   ```

The app generates and verifies OTPs itself (expiry, attempts, cooldown); MSG91 only delivers them.
**Twilio** works the same way (`OTP_PROVIDER=twilio`, `TWILIO_*`), but Indian numbers still need DLT
registration through Twilio.

---

## Deploy to Vercel + Neon

1. **Push** the repo to GitHub.
2. **Neon:** create a project in the region closest to your users (Singapore works well for India).
3. **Vercel:** _Add New → Project_, import the repo.
   - Add the **Neon integration** (_Storage → Neon_). It sets `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED`.
   - Set _Settings → Functions → Region_ to **Mumbai (bom1)**.
   - Environment variables: everything from `.env.example`. Set `NEXT_PUBLIC_APP_URL` to your production URL and use production providers (`resend`, `msg91`, `razorpay`); `console` and `fake` are rejected in production.
   - Build command: `pnpm db:migrate && pnpm plans:sync && pnpm build`. Migrations and plan sync are idempotent, so they're safe on every deploy.
4. **Deploy**, then point the Razorpay webhook to `https://<your-domain>/api/webhooks/razorpay`.
5. **Resend:** verify your sending domain and set `EMAIL_FROM` to an address on it.
6. **Google OAuth (optional):** in Google Cloud Console create an OAuth client (Web), add the redirect URI `https://<your-domain>/api/auth/callback/google`, and set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.

**Supabase** instead of Neon: use the _transaction pooler_ URL (port 6543) for `DATABASE_URL` and the direct URL for `DATABASE_URL_UNPOOLED`.

**Docker / VPS / Railway / Fly.io:**

```bash
docker build --build-arg NEXT_PUBLIC_APP_URL=https://app.example.com -t my-saas .
docker run --env-file .env.production -p 3000:3000 my-saas
```

The image has a health check at `/api/health`. Run `pnpm db:migrate` against the database before starting.

---

## Add or change a plan

Plans live in **`src/config/plans.ts`**:

```ts
{
  key: "team",
  name: "Team",
  description: "For growing teams.",
  features: ["projects.create", "projects.unlimited", "team.invite"],
  prices: { monthly: rupees(2499), yearly: rupees(24990) },
},
```

1. Add the plan (and any new feature keys to `FEATURES`).
2. Run `pnpm plans:sync`.
3. Gate features on the server with `hasAccess(user.id, "team.invite")`.

**Changing a price:** Razorpay plans can't be edited, so `plans:sync` creates a new Razorpay plan for the
new price. New subscribers pay the new price; existing subscribers keep theirs until they switch plans.

**One-time products** (Razorpay Orders) live in `PRODUCTS` in the same file.

**Pricing mode:** prices include GST by default (`site.gst.pricingMode = "inclusive"`, normal for B2C).
Set `"exclusive"` to add GST on top at checkout.

---

## Customise branding

Everything business-specific is in **`src/config/site.ts`**, validated when the app starts:

- `brand`: name, tagline, description, logo path, primary colours for light and dark mode, support email.
- `company`: legal name, **GSTIN** (checksum-validated), address and state. This prints on every invoice.
- `gst`: rate in basis points (`1800` = 18%), **SAC code**, pricing mode, line-item text.
- `invoice`: number prefix and counter digits. The app refuses settings that would exceed 16 characters.
- `legal`: jurisdiction, **Grievance Officer** (IT Rules / DPDP), privacy policy version.

Also replace:

- `public/brand/logo.svg` and `src/app/icon.svg` (favicon).
- Landing copy and kit pricing: `src/app/(marketing)/_content.ts`.
- Legal templates: `src/app/(marketing)/legal/*`.
- Email templates: `src/emails/*` (preview with `pnpm email:dev`).
- Theme tokens: `src/app/globals.css`.

---

## How it works

```
src/
  app/            routes: (marketing), (auth), dashboard, admin, api/*
  config/         site.ts (brand, company, GST) · plans.ts (plans, prices, features)
  env/            zod-validated env (server + client)
  lib/            pure helpers: money, GST tax, GSTIN, states, dates, phone, CSV
  server/
    providers/    adapters: payments (razorpay, fake) · otp (msg91, twilio, console) · email (resend, console)
    auth/         Better Auth config, session helpers
    billing/      checkout, webhooks, subscriptions, entitlements
    invoices/     numbering, creation, PDF, email, e-invoicing interface
    account/      billing profile, consent, export, deletion
    admin/        metrics and list queries
  emails/         React Email templates
scripts/          bootstrap, migrate, seed, plans:sync, admin:grant, bundle check
e2e/              Playwright smoke test
```

**Swapping providers.** Payments, OTP and email each have a small interface in `src/server/providers/*/types.ts`.
To add Cashfree, implement `PaymentProvider` in `providers/payments/cashfree/` and select it in
`providers/payments/index.ts`. Nothing else changes.

**Payment truth.** The browser's checkout result is never trusted. The server checks the HMAC signature,
fetches the payment from Razorpay, and records that. Webhooks are verified over the raw body and processed
once per `x-razorpay-event-id`, in the same transaction as their effects.

**Invoices.** Each captured payment gets exactly one invoice. The number comes from a per-financial-year
counter incremented inside the invoice transaction, so there are no gaps or duplicates even under
concurrency. Tax is computed from the amount actually charged, so the invoice always equals the payment.
Issued invoices are immutable: buyer details are snapshotted and the PDF is stored. E-invoicing (IRN) is
documented as a future extension in [`docs/e-invoicing.md`](docs/e-invoicing.md).

---

## Scripts

| Command                                                     | What it does                                                          |
| ----------------------------------------------------------- | --------------------------------------------------------------------- |
| `pnpm dev` / `build` / `start`                              | Next.js                                                               |
| `pnpm bootstrap [--seed]`                                   | Validate env, migrate, sync plans (and seed demo data)                |
| `pnpm db:generate` / `db:migrate` / `db:studio` / `db:seed` | Drizzle migrations, Studio, demo data                                 |
| `pnpm plans:sync`                                           | Create Razorpay plans for `src/config/plans.ts`                       |
| `pnpm admin:grant <email>`                                  | Give a user the admin role                                            |
| `pnpm typecheck` / `lint` / `format`                        | Code quality                                                          |
| `pnpm test`                                                 | Unit tests (Vitest)                                                   |
| `pnpm test:int`                                             | Integration tests against `TEST_DATABASE_URL` (the database is reset) |
| `pnpm test:e2e`                                             | Playwright smoke test                                                 |
| `pnpm check:bundle`                                         | Fails if a secret appears in the browser bundle (run after `build`)   |
| `pnpm email:dev`                                            | Preview emails at http://localhost:3001                               |

---

## Testing

- **Unit** (`pnpm test`): GST place of supply (CGST/SGST, UTGST, IGST), inclusive/exclusive back-calculation, paise rounding (property test across rates and amounts), GSTIN checksum, amount in words, IST financial-year rollover, invoice number limits, phone parsing, env validation, Razorpay signatures and payload parsing, CSV injection escaping.
- **Integration** (`pnpm test:int`, real Postgres): 40 concurrent invoices with no gaps or duplicates, rollback returns the number, FY reset on 1 April IST, checkout verification, webhook idempotency (including simultaneous duplicate deliveries), out-of-order events, entitlements, rate limits under races, admin metrics.
- **End-to-end** (`pnpm test:e2e`): sign up with OTP → add billing details → subscribe → invoice PDF downloaded and emailed → signed renewal webhook issues the next invoice; a replay is ignored and a forged signature is rejected.

CI (`.github/workflows/ci.yml`) runs all of it on every push.

---

## Security

- Secrets are server-only (`server-only` imports, env validation, `pnpm check:bundle`).
- Security headers and CSP in `next.config.ts` (Razorpay Checkout allowed explicitly).
- Postgres-backed rate limits on sign-in, sign-up, OTP (per phone, per IP, 30-second cooldown), email links, waitlist and checkout.
- Webhook signatures verified over the raw body with constant-time comparison.
- Server actions re-check the session; admin pages and downloads check roles and ownership.
- CSV exports neutralise spreadsheet formulas.

---

## FAQ

**Does the first payment really work without webhooks?**
Yes. Checkout verification fetches the payment from Razorpay directly. Webhooks keep later state (renewals, failures, cancellations) in sync.

**What happens when a renewal fails?**
Razorpay retries and marks the subscription `pending`; the customer keeps access and sees a warning. If retries run out it becomes `halted` and access is revoked until they pay.

**Can customers pay with UPI AutoPay?**
Yes, Razorpay Subscriptions offers UPI AutoPay, cards and e-mandates. Note that NPCI limits UPI AutoPay mandates per transaction.

**I'm not GST-registered yet. Can I use this?**
The kit issues GST tax invoices and assumes you're registered. Unregistered businesses shouldn't charge GST; talk to your CA about issuing a bill of supply instead.

**Do I need e-invoicing (IRN)?**
Only for B2B invoices once your turnover crosses the government threshold. See [`docs/e-invoicing.md`](docs/e-invoicing.md).

**Can I sell to customers outside India?**
Not out of the box. Exports of services are zero-rated under an LUT and need different invoice handling; the kit treats every buyer as Indian.

**Where do OTPs and emails go in development?**
With `console` providers: the terminal, plus `.outbox/sms` and `.outbox/emails` (with attachments).

**How do I test renewals locally?**
Use a tunnel for real Razorpay webhooks, or look at `e2e/helpers.ts` for how the smoke test signs a `subscription.charged` webhook with the fake provider.

**Can I use Cashfree, PayU or Stripe?**
Implement `PaymentProvider` (`src/server/providers/payments/types.ts`). Checkout, webhooks and invoices work through that interface.

**Why does deleting an account keep invoices?**
The CGST Act requires keeping tax records for about six years, and the DPDP Act allows retention required by law. Invoices keep a snapshot of the buyer's billing details with the user link removed.

---

## License

The source is licensed under the terms in [LICENSE](LICENSE). Noto Sans (`assets/fonts`) is licensed under the
SIL Open Font License 1.1 (`assets/fonts/OFL.txt`).

**Again: not tax or legal advice.** Verify your GST configuration with a Chartered Accountant.
