# Changelog

## 0.4.0 - 2026-06-18

Hosted Checkout for human web shoppers ("Pay with Siglume"). The two buyer
systems are now both first-class: AI agents pay through the API/tools (unchanged)
and humans pay through a Siglume-hosted checkout page.

- **`DirectRequestPaymentMerchantClient.createCheckoutSession(...)`** (TS + Py):
  create a single-use, expiring Hosted Checkout session. Siglume authors the
  challenge server-side and returns a `checkout_url`; redirect the shopper there.
  The shopper logs into Siglume, approves, and pays from their own Siglume wallet
  (JPYC / USDC), then returns to your `success_url`. Fulfill on the existing
  `direct_payment.confirmed` webhook — the source of truth — exactly as with the
  agent flow. The merchant SDK still does not authenticate the buyer.
- **`getCheckoutSession(session_id)`** (TS + Py): read a session's status
  (`open` / `authenticated` / `paid` / `expired` / `cancelled` / `failed`).
- **`checkout_allowed_origins`** added to `setupMerchant` / `setupCheckout`: a
  return-URL origin allowlist (open-redirect defense). `success_url` /
  `cancel_url` must be on a registered origin; the `webhook_callback_url` origin
  is auto-allowed.
- Docs: documented the **two buyer systems** (human Web = Hosted Checkout; AI
  agent / AtoA = direct API / tools), the AtoA **prerequisite** that the buyer
  agent is pre-connected to Siglume (MCP/OAuth, or a custom app holding the
  buyer's Siglume JWT), and the merchant / Siglume / buyer **boundaries** —
  including that the buyer needs a Siglume wallet and this is **not** a card
  payment.

No wire-format changes to existing challenges, requirements, or webhooks; 0.3.x
clients interoperate unchanged. Hosted Checkout is gated server-side and is a
purely additive surface.

## 0.3.6 - 2026-06-18

Documentation and public-surface cleanup release. No wire-format or API changes;
challenges and clients from 0.3.x interoperate unchanged.

- Documented the Micro / Nano **settlement schedule** in the README and the
  pricing guide: Micro settles weekly, Nano settles monthly, with the closing
  period, timezone, revenue-recognition point, retry / carry-over, and
  rejected / no-charge behavior spelled out. The exact close time, default
  timezone, and settlement lag are marked platform-managed — the platform
  response is the source of truth.
- Clarified that Micro / Nano provider revenue stays unsettled until the weekly /
  monthly on-chain settlement succeeds, that failed settlements are retried and
  may go past due, and that Siglume does not advance, guarantee, or insure unpaid
  amounts.
- Reframed the docs as a standalone SDRP payment SDK. Internal implementation
  language was removed from the public surface: the legacy `external_402` mode
  value and the `free` Launch-tier key are now isolated in a single
  "Compatibility Notes" section, and internal batch / ledger terms were dropped.
- Hardened the examples: they no longer print returned secrets (`setup.env`) and
  no longer return raw `error.message` to the client.
- Removed `external-402` from the npm / PyPI keywords; added `sdrp`,
  `direct-request-payment`, `micropayments`, `metered-billing`, `jpyc`, `usdc`.
- Hardened `.gitignore` (`.env`, `.env.*`, `.npmrc`, `.pypirc`, `.venv/`,
  `coverage/`) and removed a developer-specific path from `RELEASING.md`.

## 0.3.5 - 2026-06-18

- Docs: protocol-first README framing for the SDRP Direct Request Payment SDK.

## 0.3.4 - 2026-06-18

- Docs: clarified the SDRP pricing structure — a Standard plan is selected, and
  Micro / Nano are applied automatically by amount — across the README and
  pricing guide.

## 0.3.3 - 2026-06-18

- Docs: SDRP direct-payment framing across the README, API reference, merchant
  quickstart, pricing, and security guides.

## 0.3.2 - 2026-06-18

- Docs: documented the SDRP Micro / Nano amount-band boundaries.

## 0.3.1 - 2026-06-12

- Docs: scheduled autopay (`cadence: "daily"`) is documented as an approval
  tag, not a once-per-day run limit. Siglume no longer caps scheduled autopay
  at one charge per day; occurrences are bounded by the buyer's per-run,
  daily, and monthly auto-pay budget plus the authorization's `max_runs` /
  expiry. No code or wire-format changes — challenges signed by 0.3.0 verify
  unchanged.
- Release automation now uses npm and PyPI Trusted Publishing from GitHub
  Actions, so normal releases do not require local npm OTP or PyPI credentials.

## 0.3.0 - 2026-06-12

Recurring payment approval release.

- Added recurring (subscription / scheduled autopay) merchant approval helpers
  in TypeScript (`createDirectRequestPaymentRecurringChallenge`,
  `createDirectRequestPaymentRecurringChallengeSignature`,
  `verifyDirectRequestPaymentRecurringChallenge`) and Python
  (`create_direct_request_payment_recurring_challenge`,
  `create_direct_request_payment_recurring_challenge_signature`,
  `verify_direct_request_payment_recurring_challenge`).
- Recurring approvals use a new single-use challenge scheme
  (`siglume-external-402-recurring-v1`) with the cadence (`monthly` for
  subscriptions, `daily` for scheduled autopay) bound into the HMAC, so
  one-time checkout challenges and recurring approvals can never be replayed
  as each other.
- Documented the recurring payment flow (subscription and scheduled autopay)
  in the README.
- Updated pricing docs: the Launch plan's free monthly allowance of 100
  payments is retired — Launch is now a flat 1.8% payment fee; the per-payment
  minimum fee is JPY 30 (USD merchants: USD 0.20); JPY/JPYC and USD/USDC
  settlement are both documented as first-class.

## 0.2.0 - 2026-06-12

Merchant self-service setup release.

- Added TypeScript `DirectRequestPaymentMerchantClient` and Python
  `DirectRequestPaymentMerchantClient`.
- Added `setupCheckout` / `setup_checkout` to claim a merchant key, prepare a
  billing mandate, and create a webhook subscription from the SDK.
- Added challenge secret rotation, merchant status lookup, billing mandate
  preparation, and webhook subscription helpers.
- Updated docs to remove manual onboarding assumptions and clarify merchant JWT
  vs buyer JWT responsibilities.

## 0.1.0 - 2026-06-11

Initial public release.

- Published TypeScript/JavaScript SDK as `@siglume/direct-request-payment`.
- Published Python SDK as `siglume-direct-request-payment`.
- Added merchant challenge helpers, buyer-authenticated Direct Request Payment
  client methods, prepared transaction payload helpers, and webhook signature
  verification helpers.
- Documented Launch, Starter, Growth, and Pro trial pricing.
- Documented the distinction from `@siglume/api-sdk` and Developer Portal
  `cli_` API keys.
