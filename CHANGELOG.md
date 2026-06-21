# Changelog

## 0.4.30 - 2026-06-21

- Completed the 10-minute sandbox walkthrough with explicit SDRP table
  migration, authenticated Standard test-order setup, Bearer/session checkout,
  DB paid-state verification, and duplicate webhook checks.
- Added production `authorize_order` guidance to generated Express and FastAPI
  README files, and expanded docs CI to cover generated template and example
  Markdown.
- Made the FastAPI async SQLAlchemy adapter accept async authorization callbacks
  and changed the FastAPI guide default to the async adapter.
- Documented `accrued_provider_gross_minor` as the active-batch threshold
  calculation over `provider_gross_amount_minor`, including threshold-crossing
  acceptance and bounded overshoot.
- Added README warning that raw Hosted Checkout snippets are API-shape examples
  and production code must persist the durable checkout-attempt mapping before
  redirect.

## 0.4.29 - 2026-06-21

- Made Micro / Nano amount-threshold close wording normative across pricing and
  statement docs: `accrued_provider_gross_minor >= settlement_threshold_minor`
  closes the active buyer / provider / token / pricing-band batch.
- Reworked the 10-minute guide as Standard Checkout sandbox completion plus a
  separate live go-live checklist, and added missing Express `prisma` import.
- Clarified that manual Hosted Checkout snippets are API-shape examples, while
  production integrations should use the generated checkout route / official
  order-store adapter or an equivalent durable checkout-attempt pattern.
- Split public issue guidance from private payment-investigation support so
  request IDs, trace IDs, support references, buyer identifiers, wallet
  addresses, tokens, and transaction-specific data are not posted publicly.
- Expanded the API Reference environment-variable table for CLI, sandbox, and
  generated template variables used by the 10-minute path.
- Added documentation CI for Markdown links, settlement wording invariants, and
  type / syntax checks for marked README and quickstart code blocks.

## 0.4.28 - 2026-06-21

- Hardened the MongoDB order-store adapter so webhook redelivery repairs the
  product order if a previous process marked the checkout attempt paid before
  the product order status update completed.
- Added a MongoDB fault-injection E2E that simulates paid-attempt / unpaid-order
  crash recovery and verifies duplicate webhook delivery does not double-run
  fulfillment.
- Split readiness probing so `preflight` still creates an unpaid expiring
  Hosted Checkout session, while only webhook delivery is deferred until
  `verify`.
- Aligned manual Hosted Checkout nonce examples across README, Merchant
  Quickstart, API Reference, and Security Guide to use logical payment-attempt
  nonces.
- Updated the 10-minute guide to start from real database adapters with
  `authorize_order` callbacks instead of unauthenticated example stores.
- Added concrete Hosted Checkout access, integration support, refund limitation,
  and sandbox limitation guidance.

## 0.4.27 - 2026-06-20

- Changed the Express SQL migration docs for existing products to use
  `include_orders_table: false` by default and list the required mapped order
  columns.
- Aligned the public Node.js requirement with the current CI/development
  toolchain and generated Express templates.
- Pinned the TypeORM matrix dependency to the Node-compatible 0.3 line instead
  of the new 1.0 engine range.
- Clarified that FastAPI sandbox verification currently uses the npm sandbox
  server.

## 0.4.26 - 2026-06-20

- Added official Express NoSQL order-store templates for DynamoDB, MongoDB, and
  Firestore.
- Added NoSQL setup helpers: DynamoDB table creation, MongoDB index creation,
  and Firestore collection wiring.
- Added a NoSQL E2E matrix for DynamoDB Local, MongoDB, and the Firestore
  emulator covering concurrent checkout starts, expired checkout retry,
  webhook retry, duplicate webhook suppression, and paid order status updates.
- Updated the 10-minute integration docs so non-SQL products can choose a
  supported adapter instead of writing the order store from scratch.

## 0.4.25 - 2026-06-20

- Added a real PostgreSQL/MySQL ORM matrix for the Express SQL order store,
  covering Prisma + PostgreSQL, TypeORM + PostgreSQL, Sequelize + MySQL,
  Drizzle + PostgreSQL, and Drizzle + MySQL.
- The matrix verifies concurrent Hosted Checkout starts create one session,
  expired checkout attempts create a new attempt, webhook handler failures stay
  retryable, duplicate webhook events stay idempotent, and paid status reaches
  the merchant order table.
- Hardened the TypeORM and Drizzle SQL executors so ORM-specific affected-row
  and row-return shapes are normalized before checkout/webhook safety decisions.
- Added PostgreSQL and MySQL service-backed CI coverage, and made npm release
  publish only after the ORM matrix passes.

## 0.4.24 - 2026-06-20

- Split CLI checks into `preflight` for pre-mount setup checks and `verify` for
  full Hosted Checkout plus signed webhook delivery verification, so the
  10-minute guide no longer asks users to verify a webhook route before it
  exists.
- Made merchant account status fail-closed in readiness checks; only `active`
  and `ready` pass.
- Reworked Express and FastAPI checkout attempts to support attempt generations,
  expiry/failure recovery, and one active checkout attempt per order enforced by
  a database unique key.
- Added Express E2E coverage for 50 concurrent checkout starts creating exactly
  one Hosted Checkout session, new attempt creation after expiry, and stale
  non-transactional webhook `processing` recovery.
- Added FastAPI SQLAlchemy expiry retry coverage and made the adapter configurable
  for existing product order table/column names.
- Added a FastAPI `AsyncSession` SQLAlchemy adapter and E2E coverage for async
  checkout concurrency, webhook idempotency, and expired-session retry.
- Marked readiness probe webhooks so generated routes ignore them instead of
  writing manual-review records.
- Updated sandbox checkout to follow the returned success redirect after
  confirmation and expose metered summary responses with seller-borne Micro /
  Nano accounting fields.

## 0.4.23 - 2026-06-20

- Made the local SDRP sandbox reject invalid checkout input early, including
  non-positive `amount_minor`, unsupported currencies, and unsafe return URLs.
- Made sandbox checkout confirmation idempotent so repeated confirmation calls
  return the original event and do not send duplicate webhooks.
- Made the Express SQL order-store adapter recoverable for custom SQL executors
  without a transaction hook by marking failed webhook handling as retryable
  instead of permanently treating it as a duplicate.
- Added E2E coverage for sandbox idempotency, invalid sandbox input, and
  non-transactional webhook retry recovery.

## 0.4.22 - 2026-06-20

- Fixed clean-checkout TypeScript resolution for template imports so CI and npm
  release typechecks do not depend on a prebuilt `dist/` directory.

## 0.4.21 - 2026-06-20

Complete the 10-minute integration path with durable adapters, sandbox, and E2E.

- Added a local `siglume-sdrp sandbox` server that creates fake Hosted Checkout
  sessions, sends signed `direct_payment.confirmed` webhooks, records delivery
  status, and never charges a wallet.
- Added `SIGLUME_ENV=sandbox`, `SIGLUME_SANDBOX_API_BASE`, and
  `siglume-check readiness --sandbox` so sandbox and live checks are explicit.
- Added durable Express SQL/ORM order-store adapters for Prisma, TypeORM,
  Sequelize, Drizzle, and generic SQL executors.
- Added a durable FastAPI SQLAlchemy order-store adapter and packaged it in the
  Python templates.
- Added Express and FastAPI E2E tests covering checkout start, checkout URL
  reuse, signed webhook success, duplicate webhook suppression, retry after
  handler failure, and Standard-only Micro/Nano blocking.
- Updated the 10-minute guide, sandbox guide, template READMEs, API reference,
  troubleshooting, and README so implementers can test locally before live
  credentials.

## 0.4.20 - 2026-06-20

Close the v0.4.19 public onboarding safety review.

- Fixed generated Express/FastAPI webhook handling so webhook event ids are
  recorded as processed only after the order update or durable review write
  succeeds. A retry after a mid-handler failure is no longer discarded as a
  duplicate.
- Added stable checkout attempts/nonces to generated routes and starters so a
  retry or double click reuses the active attempt instead of creating a fresh
  timestamp nonce.
- Split Express checkout and webhook mounting helpers so production apps can
  mount the raw-body webhook before global `express.json()`.
- Strengthened `siglume-check readiness` to require `SIGLUME_WEBHOOK_SECRET`,
  active billing, matching active webhook subscription, subscribed
  `direct_payment.confirmed`, matching signing-secret hint, Hosted Checkout
  probe, and signed webhook delivery probe.
- Added webhook subscription/test-delivery/delivery-list client helpers in
  TypeScript and Python.
- Made generated 10-minute routes Standard-only by default; Micro / Nano now
  require explicit delayed-settlement reconciliation before fulfillment.
- Clarified Micro / Nano unsettled-exposure scope and terminal states across
  pricing, announcement, lifecycle, troubleshooting, and API reference docs.
- Added readiness negative tests and webhook API client tests.

## 0.4.19 - 2026-06-20

Make the 10-minute integration path a real product-integration path instead of
a separate demo.

- Added npm and PyPI CLI bins `siglume-sdrp` and `siglume-check`.
- Added `siglume-check readiness` to validate merchant token, merchant key,
  HTTPS origin/webhook configuration, Standard-band probe amount, merchant
  account/billing readiness, and Hosted Checkout availability through an unpaid
  checkout-session probe.
- Added `siglume-sdrp init express` for npm and `siglume-sdrp init fastapi` for
  npm/PyPI to copy framework-specific checkout/webhook route files into an
  existing product.
- Added Express and FastAPI integration templates with order-store adapter
  interfaces so teams can wire SDRP into their real order database instead of
  starting from an isolated sample app.
- Reframed the 10-minute guide around existing-product integration and moved
  the readiness check before any coding.

## 0.4.18 - 2026-06-19

Developer-onboarding cleanup for the v0.4.17 public review.

- Added a scoped 10-minute first-test guide for one Standard Payment Hosted
  Checkout flow, with explicit prerequisites and non-goals.
- Added payment lifecycle and troubleshooting docs covering Hosted Checkout
  readiness, webhook failure handling, retries, support references, and refund
  escalation boundaries.
- Added README glossary and use-case fit tables so merchant / provider /
  publisher / payee wording and 10-minute claims are less ambiguous.
- Added minimal Hosted Checkout TypeScript and Python starter directories with
  `.env.example`, seeded test order, checkout start route, and webhook handler.
- Replaced "Stripe Checkout equivalent" wording with Siglume wallet hosted
  checkout wording in public docs and SDK comments.
- Exported Python `TypedDict` response names for Hosted Checkout, Micro / Nano
  summaries, settlement batches, webhook verification, and confirmation
  classification.
- Marked the existing Express checkout example as demo-only and not
  production-safe.

## 0.4.17 - 2026-06-19

Public-surface cleanup for the v0.4.15 external review.

- Classified signed `direct_payment.confirmed` webhooks with unsupported
  `data.mode` as `unknown` with `unsupported_confirmation_mode`, instead of
  failing raw webhook parsing.
- Added stricter TypeScript settlement/open-period summary types and public
  webhook amount/threshold fields.
- Rejected unsafe API base URLs and webhook callback URLs in both TypeScript
  and Python helpers.
- Added release workflow checks that tag names match package versions before
  publishing.
- Aligned README and docs wording around the buyer / provider / token / pricing
  band exposure scope and fixed JPY / USD threshold wording.

## 0.4.16 - 2026-06-19

SDRP Micro / Nano terminal-risk and idempotency hardening release.

- Added public settlement batch fields for terminal provider accounting:
  `terminal_provider_receivable_minor`,
  `uncollectible_provider_receivable_minor`,
  `written_off_provider_receivable_minor`, `terminal_status`,
  `terminal_marked_at`, and `terminal_reason_code`.
- Documented operator terminal states `uncollectible` and `written_off` after
  past-due manual review. These amounts are not settled, unsettled, or past-due
  receivable.
- Documented merchant setup risk acceptance receipt
  `merchant_account.metadata_jsonb.metered_risk_acceptance`.
- Documented fail-closed idempotency behavior:
  `IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD` for reused keys with a
  different metered input payload.

## 0.4.15 - 2026-06-19

Corrective SDRP Micro / Nano public-surface release.

- Fixed the TypeScript runtime SDK version constant to match package metadata.
- Replaced old buyer-rounding formulas with the seller-borne invariant:
  `buyer_debit_minor = provider_gross_amount_minor` and
  `provider_receivable_minor = provider_gross_amount_minor - protocol_fee_minor`.
- Documented `provider_gross_amount_minor` as canonical and
  `provider_usage_amount_minor` / `gross_buyer_debit_minor` as compatibility
  aliases.
- Restricted webhook verification helpers to raw bytes or raw body strings;
  JSON object body support remains only on signature-building helpers for tests.

## 0.4.14 - 2026-06-19

SDRP Micro / Nano threshold and fixed-JPY fee correction.

- Made JPY Micro / Nano protocol fees market-fixed at JPY 2 / JPY 0.2 per SDRP
  Tx, matching the seller-borne examples.
- Added public batch fields for `settlement_trigger`, `settlement_threshold_minor`,
  `threshold_reached_at`, and `total_unsettled_exposure_minor`.
- Documented that JPY 10,000 and USD 100.00 are fixed market thresholds, not FX
  conversions, and that new usage pauses while unsettled exposure is at or above
  the threshold.

## 0.4.13 - 2026-06-19

Seller-borne Micro / Nano protocol fee correction.

- Added `provider_usage_amount_minor` to provider usage events so provider usage
  amount and provider receivable can be reconciled separately.
- Clarified that all SDRP payment fees are seller-borne: Micro / Nano protocol
  fees are deducted from provider receivable and are not added to buyer debit.
- Updated metered statement formulas, CSV documentation, and API reference amount
  names to match the seller-borne settlement model.

## 0.4.12 - 2026-06-19

Documentation-only fee-unit correction.

- Unified Micro and Nano protocol fee units as `/ SDRP Tx`.
- Clarified that `Tx` means one accepted SDRP payment, not the later on-chain
  settlement transaction.

## 0.4.11 - 2026-06-19

Documentation-only pricing correction.

- Clarified that the public one-time payment table uses positive minor-unit
  amounts: Standard is JPY 501+ / USD 3.01+, Micro is JPY 50-500 / USD
  0.31-3.00, and Nano is JPY 1-49 / USD 0.01-0.30.
- Removed ambiguous "under JPY 50 / up to USD 0.30" wording from public pricing
  tables.

## 0.4.10 - 2026-06-19

Public beta scope and metered usage hardening patch.

- Required Micro / Nano usage-accepted confirmations to carry the expected
  weekly or monthly settlement cadence before returning
  `metered_usage_accepted`.
- Clarified that the current public beta supports JPYC / USDC settlement on
  Polygon PoS only and does not support multi-chain, cross-chain, or
  multi-wallet settlement routing through the public SDK.
- Clarified Standard Payment fee deduction and Micro / Nano fee reporting. The
  Micro / Nano fee-burden wording from that release was superseded by the
  seller-borne correction in 0.4.13.

## 0.4.9 - 2026-06-19

Classifier consistency patch release.

- Required Micro / Nano settlement batch confirmations to carry aggregated
  on-chain finality, a valid Micro/Nano pricing band, and the expected weekly or
  monthly settlement cadence before returning `metered_batch_settled`.
- Added TypeScript and Python tests for missing finality, wrong finality,
  missing pricing band, and Micro/Nano cadence mismatches.

## 0.4.8 - 2026-06-19

Webhook sample hardening release.

- Added TypeScript and Python confirmation classifiers for Standard settled
  payments, Micro / Nano accepted usage, and Micro / Nano settled batches.
- Updated public webhook samples to require finality, settlement status, and
  non-empty settlement identifiers before fulfilling or reconciling.
- Routed unknown Micro / Nano challenge hashes and malformed settlement batch
  confirmations to manual review in copy-paste samples.

## 0.4.7 - 2026-06-19

Documentation-only patch release.

- Clarified that SDRP merchant setup and billing mandate terms assume acceptance
  of automatic Micro / Nano delayed aggregated settlement for low-price bands.
- Replaced merchant-specific override wording with the operational rule that
  products requiring immediate settlement should be priced in the Standard band.

## 0.4.6 - 2026-06-19

Patch release for the external webhook-state re-review.

- Changed webhook examples to branch Standard settled payments, Micro / Nano
  accepted-but-unsettled usage, and metered settlement batches separately.
- Added Hosted Checkout settlement machine fields and metered settlement batch
  webhook fields to TypeScript types and API docs.
- Clarified public Nano one-time amount limits, Micro / Nano idempotency key
  placement, and per-batch rounding adjustment behavior.
- Added `pytest python_tests` to the PyPI Trusted Publishing release workflow.

## 0.4.5 - 2026-06-19

Patch release for the public beta re-review.

- Added `cursor` support to TypeScript and Python metered statement list
  helpers, with tests that fetch a second page.
- Added missing TypeScript settlement batch retry fields
  (`attempt_count`, `next_attempt_at`) and narrowed metered minor amount fields
  to decimal strings.
- Clarified the public idempotency contract: one-time requirement creation uses
  the challenge nonce / `challenge_hash` / `request_hash_v2`; the SDK does not
  expose an unsupported requirement `idempotency_key`.
- Clarified Micro / Nano rounding, usage CSV `rounding_delta_minor`, provider
  statement auth roles, and Standard vs aggregated on-chain receipt wording.

## 0.4.4 - 2026-06-19

Correctness and security hardening release for the SDRP Direct Request Payment
SDK manual and public helpers.

- Clarified that Standard / Micro / Nano are selected by amount, removed the
  unsupported "force Standard for immediate finality" implication, and changed
  Hosted Checkout Standard examples to Standard-band amounts.
- Removed the Express sample route that accepted a buyer `Authorization` header
  on the merchant server; human web checkout now redirects through Hosted
  Checkout, while agent payment remains buyer-side direct API/tool work.
- Documented Micro / Nano decimal fee rounding, `rounding_delta_minor`, budget
  reservation versus token locking, no guaranteed `past_due` collection, HTTP
  result accounting, and operational status handling.
- Added typed TypeScript and named Python helpers for Micro / Nano statement
  APIs.
- Added `request_hash_v2` helpers/docs and documented the new
  requirement/webhook machine fields for pricing band, settlement cadence,
  finality, protocol fee, and settlement status.
- Hardened TS/Python integer and `checkout_allowed_origins` validation.

## 0.4.3 - 2026-06-19

Documentation-only release for SDRP Micro / Nano operations.

- Added the Micro / Nano Statements and Notices manual, covering buyer and
  provider statement APIs, CSV export, final debit notices, the close-plus-3-day
  debit site, past-due blocks, sanitized failure fields, and support references.
- Expanded API reference, merchant quickstart, security, pricing, and Japanese
  announcement docs so integrators can reconcile settled, unsettled, retrying,
  and past-due Micro / Nano revenue without relying on private platform fields.
- No wire-format or runtime behavior changes.

## 0.4.2 - 2026-06-19

Documentation completeness release. No wire-format or API changes; 0.4.x clients
interoperate unchanged. The SDK is the only manual integrators have, so every
public capability is now documented and every signature verified against code.

- Documented previously-undocumented public methods/functions: buyer-client
  `getPaymentRequirement` and `executePreparedTransaction`; the module helpers
  `parseDirectRequestPaymentChallenge`, `createDirectRequestPaymentChallengeSignature`,
  `createDirectRequestPaymentRecurringChallengeSignature`,
  `buildPaymentExecutionPayload` / `buildAllowanceExecutionPayload` /
  `buildPreparedTransactionExecutionPayload`, and `computeWebhookSignature` (plus
  full per-function webhook-verification entries with examples).
- Added an **Exported Constants** table (all 8 importable constants with values)
  and an **Aliases** table (the `external_402*` legacy aliases ↁEpreferred
  `DirectRequestPayment*` names).
- Replaced the "Python uses snake_case" hand-wave with the **actual Python
  keyword-only signatures** for the challenge / webhook / signature verifiers.
- Documented the `setupCheckout` toggles (`prepare_billing_mandate`,
  `create_webhook_subscription`, `webhook_event_types`, `webhook_description`)
  and completed the `getCheckoutSession` / `HostedCheckoutSession` return fields
  (`authenticated_at`, `cancelled_at`, `created_at`, …).
- Clarified that `billing_plan` also accepts the legacy `free` (Launch) key, that
  subscription creation (`POST /v1/sdrp/direct-payments/subscriptions`) has no SDK
  method and must be called over raw HTTP, and added `METERED_SETTLEMENT_PAST_DUE`
  to the merchant-quickstart failure-handling list.
- README: added the missing **Python** Hosted Checkout example and a
  `getCheckoutSession` status-poll example.

## 0.4.1 - 2026-06-18

Hosted Checkout rollout correction release.

- Marked Hosted Checkout as Beta / server rollout in the README and API docs so
  merchants do not treat the 0.4.0 surface as universally GA while accounts are
  still being enabled.
- Added `HostedCheckoutNotAvailableError` (TS + Py). `createCheckoutSession` /
  `create_checkout_session` and `getCheckoutSession` / `get_checkout_session`
  now map rollout 404/409 responses to this explicit error instead of exposing a
  raw missing-route response.
- Bumped default SDK user agents to 0.4.1.

## 0.4.0 - 2026-06-18

Hosted Checkout for human web shoppers ("Pay with Siglume"). The two buyer
systems are now both first-class: AI agents pay through the API/tools (unchanged)
and humans pay through a Siglume-hosted checkout page.

- **`DirectRequestPaymentMerchantClient.createCheckoutSession(...)`** (TS + Py):
  create a single-use, expiring Hosted Checkout session. Siglume authors the
  challenge server-side and returns a `checkout_url`; redirect the shopper there.
  The shopper logs into Siglume, approves, and pays from their own Siglume wallet
  (JPYC / USDC), then returns to your `success_url`. Fulfill on the existing
  `direct_payment.confirmed` webhook  Ethe source of truth  Eexactly as with the
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
  buyer's Siglume JWT), and the merchant / Siglume / buyer **boundaries**  E
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
  timezone, and settlement lag are marked platform-managed  Ethe platform
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

- Docs: clarified the SDRP pricing structure  Ea Standard plan is selected, and
  Micro / Nano are applied automatically by amount  Eacross the README and
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
  expiry. No code or wire-format changes  Echallenges signed by 0.3.0 verify
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
  payments is retired  ELaunch is now a flat 1.8% payment fee; the per-payment
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
