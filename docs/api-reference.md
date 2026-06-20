# API Reference

The TypeScript package is `@siglume/direct-request-payment`. The Python package
is `siglume-direct-request-payment` and imports as
`siglume_direct_request_payment`.

## Current Public Beta Scope

SDRP currently settles JPYC / USDC on **Polygon PoS only**. The public SDK does
not expose chain selection, cross-chain payment, multiple merchant settlement
wallets, per-payment settlement-wallet overrides, or split / multi-wallet
charging. Route each payment through the buyer's Siglume wallet and the merchant
account's configured Siglume settlement wallet.

## Two Buyer Systems

SDRP serves two kinds of buyer, and you integrate each differently. In both
cases the buyer pays from a Siglume wallet (JPYC for JPY, USDC for USD) — not a
card — and the merchant SDK never authenticates the buyer.

- **Human web shopper → Hosted Checkout (Beta; server rollout in progress).** Call
  [`createCheckoutSession`](#createcheckoutsessioninput--create_checkout_session)
  on `DirectRequestPaymentMerchantClient` and redirect the shopper to the
  returned `checkout_url`. The shopper signs into Siglume on the hosted page,
  approves, and pays from their own wallet.
- **AI agent / agent-to-agent (AtoA) → direct API / tools.** An autonomous
  buyer agent pays through `DirectRequestPaymentClient` (your app holds the
  buyer's Siglume JWT) or through the Siglume marketplace tool
  `market_confirm_direct_payment_and_execute` (MCP). Agent payment assumes the
  buyer agent is **already connected to Siglume before the payment**: an AI
  client (Claude / ChatGPT / Cursor) connects through the Siglume MCP server
  (OAuth authorization with a consent screen), or a custom app holds the buyer's
  Siglume bearer token. The merchant SDK does not log the buyer in. Unattended
  runs are bounded by Siglume's approval gates / spending budgets (per-run /
  daily / monthly auto-pay budgets, or Works approval).

In both systems the merchant handles the same signed `direct_payment.confirmed`
webhook. Hosted Checkout adds no new money movement and no new webhook. Inspect
`pricing_band`, `settlement_cadence`, `finality`, and `settlement_status`:
Standard can be marked paid only after settled per-payment finality, while Micro
/ Nano usage is accepted before the later aggregated settlement.

## Environment Variables

| Name | Used by | Purpose |
| --- | --- | --- |
| `SIGLUME_DIRECT_PAYMENT_CHALLENGE_SECRET` | merchant server | HMAC secret for order challenges |
| `SIGLUME_MERCHANT_AUTH_TOKEN` | merchant setup helper | merchant Siglume bearer token for self-service setup |
| `SIGLUME_AUTH_TOKEN` | user-authenticated helper | buyer Siglume bearer token for payment / buyer statements, or provider Siglume bearer token for provider statements |
| `SIGLUME_API_BASE` | optional | API base URL override; defaults to `https://siglume.com/v1` |
| `SIGLUME_ENV` | optional | Set to `sandbox` to default clients and readiness to the local sandbox API |
| `SIGLUME_SANDBOX_API_BASE` | optional | Sandbox API override; defaults to `http://127.0.0.1:8787/v1` when `SIGLUME_ENV=sandbox` |
| `SIGLUME_WEBHOOK_SECRET` | merchant server | webhook signing secret returned as `whsec_...` |

Do not use a Developer Portal `cli_` API key as either auth token. Merchant
setup is merchant-JWT authenticated; payment requirement creation is
buyer-JWT authenticated.

## `createDirectRequestPaymentChallenge(input)` / `create_direct_request_payment_challenge(...)`

Creates the merchant-signed challenge required by Siglume.

```ts
const challenge = await createDirectRequestPaymentChallenge({
  merchant: "example_merchant",
  amount_minor: 1200,
  currency: "JPY",
  secret: process.env.SIGLUME_DIRECT_PAYMENT_CHALLENGE_SECRET!,
  nonce: "order_123-attempt_1",
});
```

```py
import os

challenge = create_direct_request_payment_challenge(
    merchant="example_merchant",
    amount_minor=1200,
    currency="JPY",
    secret=os.environ["SIGLUME_DIRECT_PAYMENT_CHALLENGE_SECRET"],
    nonce="order_123-attempt_1",
)
```

Returns:

- `challenge`: value to pass to Siglume
- `challenge_hash`: value to store on the order
- `signature`: HMAC-SHA256 hex digest
- `nonce`

`nonce` must not contain `:` because the platform challenge string is delimited
as `scheme:nonce:signature`.

## `createDirectRequestPaymentChallengeSignature(secret, input)` / `create_direct_request_payment_challenge_signature(...)`

Returns just the HMAC-SHA256 hex digest (no `scheme:nonce:signature` wrapper),
for callers who assemble the challenge string themselves. This is the primitive
that `createDirectRequestPaymentChallenge` calls internally. The HMAC material is
`merchant:amount_minor:currency:nonce`.

```ts
const signature = await createDirectRequestPaymentChallengeSignature(secret, {
  merchant: "example_merchant",
  amount_minor: 1200,
  currency: "JPY",
  nonce: "order_123-attempt_1",
});
```

```py
signature = create_direct_request_payment_challenge_signature(
    secret=secret,
    merchant="example_merchant",
    amount_minor=1200,
    currency="JPY",
    nonce="order_123-attempt_1",
)
```

In TypeScript the secret is the first positional argument and the rest are an
object. In Python every argument is keyword-only:
`create_direct_request_payment_challenge_signature(*, secret, merchant, amount_minor, currency, nonce)`.
Returns a `string` (TS) / `str` (Py).

## `verifyDirectRequestPaymentChallenge(secret, input)` / `verify_direct_request_payment_challenge(...)`

Verifies a challenge against merchant, amount, currency, and secret. This is
useful in tests and internal checkout assertions. Returns `boolean` (TS) /
`bool` (Py) — `true` only when the challenge scheme matches and the recomputed
signature is a timing-safe match.

```ts
const ok = await verifyDirectRequestPaymentChallenge(secret, {
  merchant: "example_merchant",
  amount_minor: 1200,
  currency: "JPY",
  challenge: challengeString,
});
```

In TypeScript the secret is positional and the rest is an object
(`verifyDirectRequestPaymentChallenge(secret, { merchant, amount_minor, currency, challenge })`).
In Python every argument is keyword-only:

```py
ok = verify_direct_request_payment_challenge(
    secret=secret,
    merchant="example_merchant",
    amount_minor=1200,
    currency="JPY",
    challenge=challenge_string,
)
```

## `parseDirectRequestPaymentChallenge(challenge)` / `parse_direct_request_payment_challenge(challenge)`

Splits a `scheme:nonce:signature` challenge string into its parts. Throws
`SiglumeDirectRequestPaymentError` (TS) / `DirectRequestPaymentError` (Py) when
the string is not exactly three non-empty colon-delimited parts. The `challenge`
argument is positional in both languages.

Returns:

- `scheme`
- `nonce`
- `signature`

## `createDirectRequestPaymentRecurringChallenge(input)` / `create_direct_request_payment_recurring_challenge(...)`

Creates the merchant-signed, one-time approval challenge used when a buyer sets
up a subscription or scheduled autopay authorization.

```ts
const recurring = await createDirectRequestPaymentRecurringChallenge({
  merchant: "example_merchant",
  amount_minor: 980,
  currency: "JPY",
  cadence: "daily",
  secret: process.env.SIGLUME_DIRECT_PAYMENT_CHALLENGE_SECRET!,
  nonce: "schedule_setup_4711",
});
```

```py
recurring = create_direct_request_payment_recurring_challenge(
    merchant="example_merchant",
    amount_minor=980,
    currency="JPY",
    cadence="daily",
    secret=os.environ["SIGLUME_DIRECT_PAYMENT_CHALLENGE_SECRET"],
    nonce="schedule_setup_4711",
)
```

The recurring signature binds:

- merchant key
- amount in minor units
- currency
- cadence
- nonce

The HMAC material is:

```text
merchant:amount_minor:currency:cadence:nonce
```

`cadence` must be:

- `monthly` for subscriptions
- `daily` for scheduled autopay

For scheduled autopay, `daily` is an approval tag. It is not a one-run-per-day
limit. Occurrence execution is bounded by the buyer-approved per-run, daily, and
monthly auto-pay budget.

Returns the same fields as the one-time challenge helper, plus `cadence`.

## `createDirectRequestPaymentRecurringChallengeSignature(secret, input)` / `create_direct_request_payment_recurring_challenge_signature(...)`

Returns just the HMAC-SHA256 hex digest for a recurring approval, for callers who
assemble the challenge string themselves. This is the primitive that
`createDirectRequestPaymentRecurringChallenge` calls internally. The HMAC
material is `merchant:amount_minor:currency:cadence:nonce` and must stay
byte-identical to the server's recurring-challenge signer.

```ts
const signature = await createDirectRequestPaymentRecurringChallengeSignature(secret, {
  merchant: "example_merchant",
  amount_minor: 980,
  currency: "JPY",
  cadence: "monthly",
  nonce: "subscription_setup_4711",
});
```

```py
signature = create_direct_request_payment_recurring_challenge_signature(
    secret=secret,
    merchant="example_merchant",
    amount_minor=980,
    currency="JPY",
    cadence="monthly",
    nonce="subscription_setup_4711",
)
```

In TypeScript the secret is positional and the rest is an object. In Python every
argument is keyword-only:
`create_direct_request_payment_recurring_challenge_signature(*, secret, merchant, amount_minor, currency, cadence, nonce)`.
Returns a `string` (TS) / `str` (Py).

## `verifyDirectRequestPaymentRecurringChallenge(secret, input)` / `verify_direct_request_payment_recurring_challenge(...)`

Verifies a recurring approval challenge against merchant, amount, currency,
cadence, and secret. Returns `boolean` (TS) / `bool` (Py).

In TypeScript the secret is positional and the rest is an object
(`verifyDirectRequestPaymentRecurringChallenge(secret, { merchant, amount_minor, currency, cadence, challenge })`).
In Python every argument is keyword-only:

```py
ok = verify_direct_request_payment_recurring_challenge(
    secret=secret,
    merchant="example_merchant",
    amount_minor=980,
    currency="JPY",
    cadence="monthly",
    challenge=challenge_string,
)
```

## `directRequestPaymentChallengeHash(challenge)` / `direct_request_payment_challenge_hash(...)`

Returns the `sha256:`-prefixed hash for an existing challenge string.

## `directRequestPaymentRequestHash(input)` / `direct_request_payment_request_hash(...)`

Returns the SDK-side request hash material for merchant, amount, currency, and
challenge. This is the legacy v1 hash retained for wire compatibility and
existing idempotency assertions.

## `directRequestPaymentRequestHashV2(input)` / `direct_request_payment_request_hash_v2(...)`

Returns the v2 request hash for the same fields using canonical JSON before
hashing. New tests and server-side assertions should prefer this value when the
API response includes `request_hash_v2`; keep accepting `request_hash` for older
requirements and historical webhook payloads.

## `DirectRequestPaymentMerchantClient`

Use this client with the merchant's Siglume bearer token. It is the self-service
setup surface for an external merchant integrating Direct Request Payment.

```ts
const merchant = new DirectRequestPaymentMerchantClient({
  auth_token: merchantSiglumeBearerToken,
  base_url: "https://siglume.com/v1",
});
```

```py
merchant = DirectRequestPaymentMerchantClient(
    auth_token=merchant_siglume_bearer_token,
    base_url="https://siglume.com/v1",
)
```

### `setupCheckout(input)` / `setup_checkout(...)`

High-level setup for most integrations. It calls merchant setup, billing mandate
preparation, and webhook subscription creation.

Input:

- `merchant`: self-service merchant key, 3-64 chars using lowercase letters,
  numbers, `_`, or `-`
- `display_name`: optional public merchant name
- `billing_plan`: `launch`, `starter`, `growth`, or `pro` (default `launch`). The
  legacy key `free` is also accepted as a compatibility input and maps to the
  Launch tier; prefer `launch` in new code.
- `billing_currency`: `JPY`; `USD` requires agreed USD/USDC billing terms
- `webhook_callback_url`: HTTPS callback URL for signed payment events
- `max_amount_minor`: optional billing mandate cap
- `checkout_allowed_origins`: optional `string[]` return-URL origin allowlist for
  Hosted Checkout (open-redirect defense). A Hosted Checkout `success_url` /
  `cancel_url` must be on a registered origin; the origin of
  `webhook_callback_url` is auto-allowed in addition. Each entry must be an
  absolute origin such as `https://shop.example.com`; production origins must
  use `https`. Development `http` origins are accepted only for `localhost`,
  `127.0.0.1`, or `[::1]`. Userinfo is rejected. Entries are normalized to bare,
  lowercased origins and deduped.

In addition to the `setupMerchant` inputs above, `setupCheckout` accepts these
orchestration toggles:

- `prepare_billing_mandate`: default `true`. When `false`, the billing mandate
  step is skipped and `billing_mandate` in the result is `null`.
- `create_webhook_subscription`: optional. When omitted, a webhook subscription
  is created only if `webhook_callback_url` is set. Set `false` to skip webhook
  creation even when a callback URL is present (TS uses `?? Boolean(webhook_callback_url)`;
  Py defaults to `bool(webhook_callback_url)`).
- `webhook_event_types`: optional `string[]` of event types for the created
  subscription. When omitted the subscription defaults to
  `direct_payment.confirmed` and `direct_payment.spent`.
- `webhook_description`: optional description for the created subscription;
  defaults to `"<merchant> Direct Request Payment"`.

Returns:

- `merchant`: merchant account setup response
- `billing_mandate`: billing mandate preparation response, when requested
- `webhook_subscription`: webhook subscription response, when created
- `env`: server environment values to store, including returned secrets

`merchant.merchant_account.metadata_jsonb.metered_risk_acceptance` records the
merchant's Micro / Nano delayed-settlement risk acceptance receipt with
`terms_version`, `accepted_at`, `principal_user_id`, `receipt_id`, and fixed
market thresholds JPY 10,000 / USD 100.00 (`settlement_threshold_minor` is
`10000` for both JPY minor units and USD cents).

Secrets are returned only when created or rotated. Existing secrets are not
replayed by `getMerchant` / `get_merchant`.

### `setupMerchant(input)` / `setup_merchant(...)`

Calls:

```text
POST /v1/sdrp/direct-payments/merchants
```

Creates or updates the merchant account for the authenticated merchant user.
Accepts the optional `checkout_allowed_origins: string[]` return-URL origin
allowlist described under `setupCheckout` above; the same normalization and
webhook-origin auto-allow apply. Python annotates this direct response as
`DirectRequestPaymentMerchantResponse`; `setup_checkout(...)` returns
`DirectRequestPaymentCheckoutSetupResult`.

### `createCheckoutSession(input)` / `create_checkout_session(...)`

Beta / server rollout: Hosted Checkout is rolling out account by account. If the
server endpoint is not enabled for the merchant yet, the SDK raises
`HostedCheckoutNotAvailableError` (TS + Py) rather than leaking a raw rollout
404/409. Payment handling must still key off the signed
`direct_payment.confirmed` webhook and its settlement machine fields, not the
event name alone.
Run `siglume-check preflight` before mounting routes, then run
`siglume-check verify` after your webhook route is live; see
[Troubleshooting](./troubleshooting.md#hosted-checkout-readiness). A human web
checkout does not have a drop-in fallback if this account-level feature is not
enabled yet.

Creates a single-use, expiring Hosted Checkout session for a human web shopper
and returns the URL to redirect them to. Requires the merchant's Siglume bearer
token. The server authors the challenge from the merchant's challenge secret —
the browser never sees or supplies it.

Calls:

```text
POST /v1/sdrp/direct-payments/checkout-sessions
```

```ts
const session = await merchant.createCheckoutSession({
  merchant: "example_merchant",
  amount_minor: 1200,
  currency: "JPY",
  nonce: order.id,
  success_url: "https://www.your-shop.com/thanks",
  cancel_url: "https://www.your-shop.com/cart",
  metadata: { order_id: order.id },
});
```

```py
session = merchant.create_checkout_session(
    merchant="example_merchant",
    amount_minor=1200,
    currency="JPY",
    nonce=order["id"],
    success_url="https://www.your-shop.com/thanks",
    cancel_url="https://www.your-shop.com/cart",
    metadata={"order_id": order["id"]},
)
```

Input:

- `merchant`: Siglume merchant key
- `amount_minor`: positive integer in minor currency units (server-fixed; the
  browser cannot change it)
- `currency`: `JPY`, or `USD` when enabled for the merchant account
- `nonce`: unique per order; must not contain `:`
- `success_url`: return URL after a completed payment; must be on a registered
  `checkout_allowed_origins` origin (or the webhook origin)
- `cancel_url`: return URL after the shopper cancels; same origin rule
- `metadata`: optional JSON object

Returns:

- `checkout_url`: hosted page to redirect the shopper to
  (`https://siglume.com/pay/<session_id>`)
- `session_id`
- `challenge_hash`: store this on the order to map the later webhook back
- `status`
- `expires_at`: the session is single-use and expires (~30 minutes)

### `getCheckoutSession(session_id)` / `get_checkout_session(session_id)`

Returns the current status of a Hosted Checkout session. Useful if you want to
show progress in your own UI; the signed `direct_payment.confirmed` webhook
remains the source of truth for fulfillment. Never exposes the raw challenge or
buyer PII.

Calls:

```text
GET /v1/sdrp/direct-payments/checkout-sessions/{session_id}
```

Returns a `HostedCheckoutSession` status object with:

- `session_id`
- `merchant`
- `currency`
- `token_symbol`
- `amount_minor`
- `status`: one of `open`, `authenticated`, `paid`, `expired`, `cancelled`,
  `failed`
- `challenge_hash`
- `requirement_id` (nullable until a requirement is created)
- `pricing_band` (nullable until a requirement is created): `standard`,
  `micro`, or `nano`
- `settlement_cadence` (nullable until a requirement is created):
  `per_payment`, `weekly`, or `monthly`
- `finality` (nullable until a requirement is created), for example
  `per_payment_onchain` or `aggregated_onchain_settlement`
- `protocol_fee_minor` (nullable; decimal string for Micro / Nano)
- `settlement_status` (nullable until a requirement is created), for example
  `pending_payment`, `provisional`, `settled`, or `pending_settlement`
- `chain_receipt_id` (nullable)
- `success_url`
- `cancel_url`
- `expires_at` (nullable)
- `authenticated_at` (nullable; set when the shopper signs into Siglume)
- `paid_at` (nullable; set when Hosted Checkout has accepted the wallet
  payment flow. For Micro / Nano, this is not the same as final provider
  settlement; use `pricing_band`, `settlement_cadence`, `finality`,
  `settlement_status`, and the statement APIs.)
- `cancelled_at` (nullable; set when the shopper cancels)
- `created_at` (nullable)
- `metadata_jsonb`

The TS `HostedCheckoutSession` interface also carries an index signature, so the
server may include additional pass-through fields.

### `getMerchant(merchant)` / `get_merchant(merchant)`

Calls:

```text
GET /v1/sdrp/direct-payments/merchants/{merchant}
```

Returns setup and billing status without returning the challenge secret.

### `rotateChallengeSecret(merchant)` / `rotate_challenge_secret(merchant)`

Calls:

```text
POST /v1/sdrp/direct-payments/merchants/{merchant}/challenge-secret/rotate
```

Returns the new challenge secret once.

### `prepareBillingMandate(merchant, input)` / `prepare_billing_mandate(...)`

Calls:

```text
POST /v1/sdrp/direct-payments/merchants/{merchant}/billing-mandate
```

Creates or reuses the merchant billing mandate. If the returned mandate requires
wallet approval, complete that Siglume wallet step before accepting payments.

### `createWebhookSubscription(input)` / `create_webhook_subscription(...)`

Calls:

```text
POST /v1/market/webhooks/subscriptions
```

Defaults event types to `direct_payment.confirmed` and
`direct_payment.spent`. The returned `signing_secret` is shown only at creation
or rotation.

### `listWebhookSubscriptions()` / `list_webhook_subscriptions()`

Calls:

```text
GET /v1/market/webhooks/subscriptions
```

Returns the current user's webhook subscriptions without the full signing
secret. Use `signing_secret_hint` to confirm that the local
`SIGLUME_WEBHOOK_SECRET` is the expected secret.

### `queueWebhookTestDelivery(input)` / `queue_webhook_test_delivery(...)`

Calls:

```text
POST /v1/market/webhooks/test-deliveries
```

Queues a signed test event to one or more subscription ids. `siglume-check
verify` and the legacy `readiness` alias use this for a harmless
`direct_payment.confirmed` delivery probe.

### `listWebhookDeliveries(input)` / `list_webhook_deliveries(...)`

Calls:

```text
GET /v1/market/webhooks/deliveries
```

Supports `subscription_id`, `event_type`, `status`, and `limit`. `verify` polls
this list after queueing the test delivery and only passes when the matching
delivery status becomes `delivered`.

## `DirectRequestPaymentClient`

Thin wrapper around the current Siglume Direct Request Payment HTTP contract.
Use it with the authenticated Siglume user bearer token for the route you call:
buyer tokens for buyer payment and buyer statement routes, provider / merchant
tokens for provider statement routes. Developer Portal `cli_` API keys are not
accepted by these user-authenticated routes.

This client creates SDRP Standard Payment requirements for external merchant
checkout flows. Micro Payment and Nano Payment are applied automatically by
amount and settled on account-assigned weekly / monthly slots, or earlier when a
buyer / provider / token / pricing-band batch reaches JPY 10,000 / USD 100.00;
they are not created explicitly through this client. Use the statement APIs
below to see open-period usage, the close time, the final-notice schedule, and
settled / unsettled / past-due revenue.

Standard Payment requirements include `fee_bps` from the Siglume platform. The
SDK does not calculate merchant plan fees locally. For Micro / Nano, use the
statement API amount fields (`protocol_fee_minor`, `gross_buyer_debit_minor`,
`buyer_debit_minor`, `provider_gross_amount_minor`, and
`rounding_delta_minor`); see [Pricing](./pricing.md).
`provider_gross_amount_minor` is canonical; `provider_usage_amount_minor` and
`gross_buyer_debit_minor` are compatibility aliases of the same provider gross
amount. Micro / Nano protocol fees are seller-borne, so
`buyer_debit_minor = provider_gross_amount_minor`.

```ts
const siglume = new DirectRequestPaymentClient({
  auth_token: buyerOrProviderSiglumeBearerToken,
  base_url: "https://siglume.com/v1",
});
```

```py
siglume = DirectRequestPaymentClient(
    auth_token=buyer_or_provider_siglume_bearer_token,
    base_url="https://siglume.com/v1",
)
```

### `createPaymentRequirement(input)` / `create_payment_requirement(...)`

Calls:

```text
POST /v1/sdrp/direct-payments/requirements
```

The SDK sets the platform-required mode value for you; you do not pass it. (This
is the internal `external_402` mode value, reflecting SDRP's HTTP 402 Payment
Required lineage — see the README "Relationship to HTTP 402". It does not imply
x402 wire compatibility.)

Input:

- `merchant`: Siglume merchant key
- `amount_minor`: positive integer in minor currency units
- `currency`: `JPY` or `USD` when enabled for the merchant account
- `challenge`: merchant-signed challenge string
- `token_symbol`: optional `JPYC` or `USDC` when enabled for the merchant account
- `allowance_amount_minor`: optional positive integer
- `metadata`: optional JSON object

There is no public `idempotency_key` field on this requirement-create request.
For one-time external checkout, idempotency is the merchant-signed challenge
nonce: derive `nonce` from a durable order payment attempt, store the returned
`challenge_hash`, and use `request_hash_v2` when you need a canonical machine
hash for the same payment request. Do not retry the same order by minting a new
nonce unless you intentionally want a new payment attempt.

For Siglume Marketplace paid capability execution / MCP tools, `idempotency_key`
is a separate top-level JSON field on the execution payload or tool arguments.
Use one stable key per logical paid operation, up to 128 characters, and do not
reuse it for a different payload. A retry with the same key returns or reconciles
the first recorded outcome instead of creating another chargeable usage event.
The HTTP `Idempotency-Key` header is not the public requirement-create contract.

The returned requirement includes both compatibility and machine-readable
settlement fields:

- `request_hash`: legacy v1 request hash, retained for existing requirements
  and integrations.
- `request_hash_v2`: canonical-JSON v2 request hash when the server can compute
  one for the challenge-backed request.
- `pricing_band`: `standard`, `micro`, or `nano`.
- `settlement_cadence`: `per_payment`, `weekly`, or `monthly`.
- `finality`: machine-readable finality class such as
  `per_payment_onchain` or `aggregated_onchain_settlement`.
- `protocol_fee_minor`: Micro / Nano protocol fee when applicable; `null` for
  Standard Payment.
- `settlement_status`: `pending_payment`, `provisional`, `settled`,
  `pending_settlement`, or another explicit operational state.

### `getPaymentRequirement(requirement_id)` / `get_payment_requirement(requirement_id)`

Calls:

```text
GET /v1/sdrp/direct-payments/requirements/{requirement_id}
```

Fetches the current state of a payment requirement (status, `transaction_request`,
`approve_transaction_request`, `chain_receipt_id`, etc.) by id. The
`requirement_id` argument is positional in both languages. Returns the same
requirement object shape as `createPaymentRequirement`.

```ts
const requirement = await siglume.getPaymentRequirement(requirementId);
```

```py
requirement = siglume.get_payment_requirement(requirement_id)
```

### `executePreparedTransaction(payload)` / `execute_prepared_transaction(payload)`

Calls:

```text
POST /v1/market/web3/transactions/execute-prepared
```

The raw prepared-transaction executor. It posts a prepared-transaction payload
(`transaction_request`, `receipt_kind`, `reference_type`, `reference_id`,
`metadata`, `await_finality`) to the marketplace web3 route and returns the
execution result (`{ receipt?, finalization?, ... }`). The `payload` argument is
positional in both languages.

`executePaymentTransaction` / `execute_payment_transaction` and
`executeAllowanceTransaction` / `execute_allowance_transaction` are convenience
wrappers over this method: they build the payload from the requirement (via
[`buildPaymentExecutionPayload`](#payload-builders) /
[`buildAllowanceExecutionPayload`](#payload-builders)) and call
`executePreparedTransaction` for you. Call `executePreparedTransaction` directly
only when you build the payload yourself.

```ts
const result = await siglume.executePreparedTransaction(
  buildPaymentExecutionPayload(requirement, { await_finality: true }),
);
```

```py
result = siglume.execute_prepared_transaction(
    build_payment_execution_payload(requirement, await_finality=True),
)
```

### `executeAllowanceTransaction(requirement)` / `execute_allowance_transaction(...)`

Executes `requirement.approve_transaction_request` through:

```text
POST /v1/market/web3/transactions/execute-prepared
```

Only call this when Siglume returned an approval transaction.

### `executePaymentTransaction(requirement)` / `execute_payment_transaction(...)`

Executes `requirement.transaction_request` through the same prepared transaction
route.

### `verifyPaymentRequirement(requirement_id, input)` / `verify_payment_requirement(...)`

Calls:

```text
POST /v1/sdrp/direct-payments/requirements/{requirement_id}/verify
```

Input may include:

- `receipt_id`
- `chain_receipt_id`
- `await_finality`
- `await_required_status`
- `await_timeout_seconds`
- `await_poll_seconds`

### `request<T>(method, path, json_body?)` (TypeScript only)

Calls an authenticated Siglume JSON endpoint using the same bearer token and
base URL configured on `DirectRequestPaymentClient`.

`path` is the API path after `/v1`, for example
`/sdrp/metered/my-summary`. The helper expects a JSON response. Use raw
`fetch`, `curl`, or your HTTP client for CSV exports.

Python does not expose a public generic request helper. Use the named Python
methods documented below for Micro / Nano statements, and ordinary HTTPS
requests for endpoints that do not yet have a named Python SDK method.

## Metered Statement APIs

Micro Payment and Nano Payment require operational reconciliation after usage is
accepted. The immediate requirement response does not tell a merchant how much
is settled, when the batch can first debit, or why a buyer is past due.

See the full operating guide:
[Micro / Nano Statements and Notices](./metered-statements.md).

### Buyer summary

```text
GET /v1/sdrp/metered/my-summary
```

Common query parameters:

- `plan_type`: `micro` or `nano`
- `token_symbol`: `JPYC` or `USDC`

TypeScript:

```ts
const summary = await siglume.getBuyerMeteredSummary({
  plan_type: "micro",
  token_symbol: "JPYC",
});
```

Python:

```py
summary = siglume.get_buyer_metered_summary(plan_type="micro", token_symbol="JPYC")
```

Use `open_periods` for current-period estimated debit,
`settlement_batches` for closed / scheduled / settled periods, and
`past_due_blocks` to explain `METERED_SETTLEMENT_PAST_DUE`.

### Buyer usage and settlement lists

```text
GET /v1/sdrp/metered/my-usage-events
GET /v1/sdrp/metered/my-settlement-batches
```

SDK methods:

- TypeScript: `listBuyerUsageEvents(...)`, `listBuyerSettlementBatches(...)`
- Python: `list_buyer_usage_events(...)`, `list_buyer_settlement_batches(...)`

Each accepts `plan_type`, `token_symbol`, `status`, `limit`, and `cursor`, and
returns `{items, next_cursor}`. When `next_cursor` is non-null, pass it back as
`cursor` to fetch the next page.

Buyer-facing amount names are centered on the debit:

- `estimated_buyer_debit_minor`
- `provider_gross_amount_minor`
- `provider_usage_amount_minor`
- `gross_buyer_debit_minor`
- `buyer_debit_minor`
- `protocol_fee_minor`
- `settlement_trigger`
- `settlement_threshold_minor`
- `threshold_reached_at`
- `total_unsettled_exposure_minor`

### Provider summary

```text
GET /v1/sdrp/metered/provider/summary
```

Common query parameters:

- `plan_type`: `micro` or `nano`
- `token_symbol`: `JPYC` or `USDC`
- `listing_id`
- `capability_key`

TypeScript:

```ts
const providerSummary = await siglume.getProviderMeteredSummary({
  plan_type: "micro",
  token_symbol: "JPYC",
});
```

Python:

```py
provider_summary = siglume.get_provider_metered_summary(plan_type="micro", token_symbol="JPYC")
```

Use `open_periods` for current-period expected revenue, `periods` for closed
and historical batches, and `totals` to separate settled, unsettled, and
past-due provider amounts. Do not recognize Micro / Nano revenue until the batch
is `settled` and has an on-chain receipt.

### Provider usage and settlement detail

```text
GET /v1/sdrp/metered/provider/usage-events
GET /v1/sdrp/metered/provider/settlement-batches
GET /v1/sdrp/metered/provider/settlement-batches/{settlement_batch_id}
```

SDK methods:

- TypeScript: `listProviderUsageEvents(...)`,
  `listProviderSettlementBatches(...)`, `getProviderSettlementBatch(...)`
- Python: `list_provider_usage_events(...)`,
  `list_provider_settlement_batches(...)`, `get_provider_settlement_batch(...)`

Provider list methods accept `plan_type`, `token_symbol`, `status`,
`listing_id`, `capability_key`, `limit`, and `cursor`. Detail accepts
`settlement_batch_id`, plus optional `listing_id` and `capability_key`. List
methods return `{items, next_cursor}`. When `next_cursor` is non-null, pass it
back as `cursor` to fetch the next page.

Provider-facing amount names:

- `provider_gross_amount_minor`
- `provider_usage_amount_minor`
- `provider_receivable_minor`
- `gross_buyer_debit_minor`
- `buyer_debit_minor`
- `protocol_fee_minor`
- `settled_provider_receivable_minor`
- `unsettled_provider_receivable_minor`
- `past_due_provider_receivable_minor`
- `terminal_provider_receivable_minor`
- `uncollectible_provider_receivable_minor`
- `written_off_provider_receivable_minor`

Schedule and execution fields:

- `period_start`, `period_end`, `close_at`
- `settlement_trigger`
- `settlement_threshold_minor`
- `threshold_reached_at`
- `total_unsettled_exposure_minor`
- `expected_scheduled_debit_at`
- `scheduled_debit_at`
- `not_before_attempt_at`
- `execution_status`
- `latest_execution_attempt_status`
- `chain_receipt_id`
- `usage_event_digest`
- `attempt_count`
- `next_attempt_at`
- `terminal_status`
- `terminal_marked_at`
- `terminal_reason_code`

Failure fields are sanitized for public display:

- `failure_reason_code`
- `failure_reason_label`
- `failure_reason_help`
- `support_reference`

Provider APIs do not expose raw `buyer_user_id`, buyer email, buyer wallet
address, relayer id, nonce, gas data, raw RPC errors, or raw
`failure_message`. Use `buyer_period_ref` for provider-side reconciliation
within a period.

Terminal statuses `uncollectible` and `written_off` are operator resolutions
after past-due manual review. Their receivable fields are reported separately
from settled, unsettled, and past-due revenue.

If a Micro / Nano execution idempotency key is reused with a different input
payload, execution fails closed before provider execution with
`IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD` and HTTP status `409`.

### Provider CSV export

```text
GET /v1/sdrp/metered/provider/settlement-batches/{settlement_batch_id}/usage-events.csv
```

The CSV is not JSON. Fetch it with raw `fetch`, `curl`, or your HTTP client:

```bash
curl https://siglume.com/v1/sdrp/metered/provider/settlement-batches/<batch-id>/usage-events.csv \
  -H "Authorization: Bearer <provider-siglume-bearer-token>" \
  -o sdrp-metered.csv
```

Columns:

```text
metered_usage_id,created_at,plan_type,settlement_cadence,period_start,period_end,listing_id,capability_key,operation_key,currency,token_symbol,provider_gross_amount_minor,provider_usage_amount_minor,provider_receivable_minor,protocol_fee_minor,gross_buyer_debit_minor,rounding_delta_minor,buyer_debit_minor,status,settlement_batch_id,buyer_period_ref
```

The CSV uses `buyer_period_ref`, not raw buyer account identifiers.
The CSV keeps the `rounding_delta_minor` column for schema stability, but usage
rows report `0`. If a batch-level `rounding_delta_minor` appears in historical
or internal records, do not add it to buyer debit and do not allocate it to
provider revenue.

Micro / Nano amount fields are decimal minor-unit strings. In JavaScript, do
not aggregate them with `number`; parse them with a decimal library. In Python,
use `Decimal` for accounting and reconciliation.

## Payload Builders

These pure functions build the `execute-prepared` payload from a payment
requirement, for callers who execute the transaction themselves (rather than via
the `executePaymentTransaction` / `executeAllowanceTransaction` wrappers). They
make no network calls.

### `buildPaymentExecutionPayload(requirement, options)` / `build_payment_execution_payload(...)`

Builds the payment-transaction payload from `requirement.transaction_request`
with `receipt_kind = "sdrp_direct_payment"`.

In TypeScript `options` is an optional object `{ await_finality?, metadata? }`.
In Python the options are keyword-only:
`build_payment_execution_payload(requirement, *, await_finality=False, metadata=None)`.
Returns the prepared-transaction payload object.

### `buildAllowanceExecutionPayload(requirement, options)` / `build_allowance_execution_payload(...)`

Builds the allowance/approval-transaction payload from
`requirement.approve_transaction_request` with
`receipt_kind = "sdrp_direct_payment_allowance"`. Throws
`SiglumeDirectRequestPaymentError` (TS) / `DirectRequestPaymentError` (Py) when
the requirement carries no allowance approval transaction. Same options shape as
`buildPaymentExecutionPayload`.

### `buildPreparedTransactionExecutionPayload(requirement, transaction_request, options)` / `build_prepared_transaction_execution_payload(...)`

The lower-level builder both of the above call. It merges
`transaction_request.metadata_jsonb` with any `options.metadata`, and sets
`reference_type = "sdrp_direct_payment_requirement"` and `reference_id =
requirement.requirement_id`.

In TypeScript `options` is required and must include `receipt_kind`:
`{ receipt_kind, await_finality?, metadata? }`. In Python the third argument is
the `transaction_request` and the rest are keyword-only:
`build_prepared_transaction_execution_payload(requirement, transaction_request, *, receipt_kind, await_finality=False, metadata=None)`.
Returns the prepared-transaction payload object.

## Webhook Helpers

### `computeWebhookSignature(secret, body, options)` / `compute_webhook_signature(secret, body, *, timestamp)`

Returns the bare HMAC-SHA256 hex digest over `"<timestamp>.<body>"`. This is the
primitive `buildWebhookSignatureHeader` / `verifyWebhookSignature` use. In
TypeScript `options` is `{ timestamp: number }`; in Python `timestamp` is a
keyword-only `int`. `body` may be raw bytes, a string, or a JSON object when you
are building a test signature. Production webhook verification must use the
exact raw request body.

### `buildWebhookSignatureHeader(secret, body, options)` / `build_webhook_signature_header(secret, body, *, timestamp=None)`

Returns a `t=<timestamp>,v1=<signature>` header string. Mainly for tests /
mocking inbound webhooks. In TypeScript `options` is an optional
`{ timestamp?: number }` (defaults to now); in Python `timestamp` is a
keyword-only optional `int`. This helper accepts JSON objects for tests; the
verification helpers below do not.

### `verifyWebhookSignature(secret, body, signature_header, options)` / `verify_webhook_signature(secret, body, signature_header, *, tolerance_seconds=300, now=None)`

Verifies the `Siglume-Signature` header against the raw `body`. Throws
`SiglumeWebhookSignatureError` (TS) / `SiglumeWebhookSignatureError` (Py) when
the timestamp is outside tolerance or the signature does not match. In TypeScript
`options` is `{ tolerance_seconds?, now? }`; in Python those are keyword-only
(`tolerance_seconds` defaults to `DEFAULT_WEBHOOK_TOLERANCE_SECONDS` = 300).
Returns `{ timestamp, signature }`. Pass the exact raw request body bytes or raw
body string captured by your web framework. Passing a parsed JSON object is
rejected because re-stringifying changes the signed bytes.

### `parseDirectRequestPaymentWebhookEvent(payload)` / `parse_direct_request_payment_webhook_event(payload)`

Validates and normalizes a parsed webhook event object (requires `id`, `type`,
`api_version`, `occurred_at`, and an object `data`). This parser does not verify
the `Siglume-Signature` header; use
`verifyDirectRequestPaymentWebhook(...)` /
`verify_direct_request_payment_webhook(...)` for signature verification and
parsing together. Throws
`SiglumeWebhookPayloadError` on a malformed event. It does not reject an
unsupported `direct_payment.confirmed` mode by itself; the classifier returns
`kind: "unknown"` with `reason: "unsupported_confirmation_mode"` for that case.
The `payload` argument is positional in both languages.

For `direct_payment.confirmed`, inspect `event.data.pricing_band`,
`event.data.settlement_cadence`, `event.data.finality`,
`event.data.protocol_fee_minor`, `event.data.settlement_status`,
`event.data.settlement_batch_id`, `event.data.chain_receipt_id`,
`event.data.usage_event_digest`, and `event.data.settled_at` instead of
inferring whether the event means per-payment on-chain confirmation, Micro /
Nano accepted-but-unsettled usage, or an aggregated Micro / Nano settlement
confirmation. `event.data.request_hash_v2` is present on new challenge-backed
requirements; keep accepting `event.data.request_hash` for historical payloads.

Recommended branch: call `classifyDirectPaymentConfirmation(event)` /
`classify_direct_payment_confirmation(event)` and switch on `kind`:

- `metered_batch_settled`: no order `challenge_hash` is expected. This requires
  Micro / Nano pricing, the matching settlement cadence (`micro` -> `weekly`,
  `nano` -> `monthly`), `finality === "aggregated_onchain_settlement"`, settled
  status, and non-empty `settlement_batch_id`, `chain_receipt_id`, and
  `usage_event_digest`. Reconcile the batch with those returned identifiers.
- `standard_settled`: mark the mapped order paid once. This requires Standard
  pricing, per-payment on-chain finality, settled status, non-empty
  `requirement_id`, non-empty `challenge_hash`, and non-empty
  `chain_receipt_id`.
- `metered_usage_accepted`: treat the usage as accepted but unsettled only if
  your integration has explicitly enabled Micro / Nano delayed-settlement
  handling. This requires Micro / Nano pricing,
  `finality === "aggregated_onchain_settlement"`, the matching settlement
  cadence (`micro` -> `weekly`, `nano` -> `monthly`),
  `settlement_status === "pending_settlement"`, non-empty `requirement_id`, and
  non-empty `challenge_hash`. Standard-only integrations should route this to
  review or return `METERED_INTEGRATION_REQUIRED`; Micro / Nano integrations
  must reconcile final revenue from statement APIs / settlement batches.
- `unknown`: do not mark paid or fulfilled from the event type alone; fetch the
  requirement or route the event to manual review.

If you do not use the classifier, apply the same checks manually.

### `classifyDirectPaymentConfirmation(event)` / `classify_direct_payment_confirmation(event)`

Classifies a parsed `direct_payment.confirmed` event into:

- `standard_settled`
- `metered_usage_accepted`
- `metered_batch_settled`
- `unknown`

The classifier is fail-closed: missing finality, missing pricing band, mismatched
Micro / Nano settlement cadence, missing settlement status, empty challenge
hashes, empty requirement ids, and empty settlement batch receipt identifiers
return `kind: "unknown"` with a machine-readable `reason`.
For order and revenue state transitions, see
[Payment lifecycle](./payment-lifecycle.md).

### `verifyDirectRequestPaymentWebhook(secret, body, signature_header, options)` / `verify_direct_request_payment_webhook(secret, body, signature_header, *, tolerance_seconds=300, now=None)`

Verifies the signature and parses the event in one call. Returns
`{ event, verification }` (TS) / `{"event": ..., "verification": ...}` (Py). Same
options shape as `verifyWebhookSignature` (keyword-only in Python). The `body`
argument is raw bytes or a raw body string only; do not pass parsed JSON.

Webhook-verification trio (typical inbound webhook handler):

```ts
import { verifyDirectRequestPaymentWebhook } from "@siglume/direct-request-payment";

const { event, verification } = await verifyDirectRequestPaymentWebhook(
  process.env.SIGLUME_WEBHOOK_SECRET!,
  rawRequestBody,                       // the RAW body bytes/string, not re-stringified JSON
  request.headers["siglume-signature"],
);
// event.type === "direct_payment.confirmed"; use classifyDirectPaymentConfirmation(event)
// or equivalent fail-closed field checks before marking an order paid or fulfilled.
```

```py
from siglume_direct_request_payment import verify_direct_request_payment_webhook

verified = verify_direct_request_payment_webhook(
    os.environ["SIGLUME_WEBHOOK_SECRET"],
    raw_request_body,                     # the RAW body bytes/string
    siglume_signature_header,
)
event = verified["event"]
# event["type"] == "direct_payment.confirmed"; use classify_direct_payment_confirmation(event)
# or equivalent fail-closed field checks before marking an order paid or fulfilled.
```

Express example:

```ts
app.post("/siglume/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const { event } = await verifyDirectRequestPaymentWebhook(
    process.env.SIGLUME_WEBHOOK_SECRET!,
    req.body,
    req.header("siglume-signature") ?? "",
  );
  res.json({ received: event.id });
});
```

FastAPI example:

```py
@app.post("/siglume/webhook")
async def siglume_webhook(request: Request):
    raw_body = await request.body()
    verified = verify_direct_request_payment_webhook(
        os.environ["SIGLUME_WEBHOOK_SECRET"],
        raw_body,
        request.headers.get("siglume-signature", ""),
    )
    return {"received": verified["event"]["id"]}
```

Django example:

```py
def siglume_webhook(request):
    verified = verify_direct_request_payment_webhook(
        os.environ["SIGLUME_WEBHOOK_SECRET"],
        request.body,
        request.headers.get("Siglume-Signature", ""),
    )
    return JsonResponse({"received": verified["event"]["id"]})
```

## Python Response Types

Python responses remain plain dictionaries for runtime compatibility, but the
package exports `TypedDict` names for the high-risk response shapes:

- `HostedCheckoutSession`
- `DirectRequestPaymentBuyerMeteredSummary`
- `DirectRequestPaymentProviderMeteredSummary`
- `DirectRequestPaymentSettlementBatch`
- `DirectRequestPaymentMeteredOpenPeriod`
- `DirectRequestPaymentPastDueBlock`
- `DirectRequestPaymentProviderMeteredTotals`
- `DirectRequestPaymentListResponse`
- `DirectRequestPaymentMerchantResponse`
- `DirectRequestPaymentCheckoutSetupResult`
- `DirectRequestPaymentMerchantSetupResponse` (compatibility alias for checkout setup result)
- `DirectRequestPaymentWebhookSubscription`
- `DirectRequestPaymentWebhookDelivery`
- `DirectRequestPaymentWebhookVerification`
- `DirectRequestPaymentConfirmationClassification`

Use these names for annotations when reconciling Micro / Nano accounting fields
such as `provider_gross_amount_minor`, `protocol_fee_minor`,
`provider_receivable_minor`, `buyer_debit_minor`,
`settled_provider_receivable_minor`, `unsettled_provider_receivable_minor`, and
`past_due_provider_receivable_minor`.

## Exported Constants

Both packages export these importable constants:

| Constant | Value |
| --- | --- |
| `DEFAULT_SIGLUME_API_BASE` | `https://siglume.com/v1` |
| `DEFAULT_SIGLUME_SANDBOX_API_BASE` | `http://127.0.0.1:8787/v1` |
| `DIRECT_REQUEST_PAYMENT_CHALLENGE_SCHEME` | `siglume-external-402-v1` |
| `DIRECT_REQUEST_PAYMENT_RECURRING_CHALLENGE_SCHEME` | `siglume-external-402-recurring-v1` |
| `DIRECT_REQUEST_PAYMENT_MODE` | `external_402` |
| `DIRECT_REQUEST_PAYMENT_RECEIPT_KIND` | `sdrp_direct_payment` |
| `DIRECT_REQUEST_PAYMENT_ALLOWANCE_RECEIPT_KIND` | `sdrp_direct_payment_allowance` |
| `DIRECT_REQUEST_PAYMENT_REFERENCE_TYPE` | `sdrp_direct_payment_requirement` |
| `DEFAULT_WEBHOOK_TOLERANCE_SECONDS` | `300` |
| `DIRECT_REQUEST_PAYMENT_SDK_VERSION` | package version string |
| `DIRECT_REQUEST_PAYMENT_STANDARD_SETTLED_STATUS` | `settled` |
| `DIRECT_REQUEST_PAYMENT_METERED_ACCEPTED_STATUS` | `pending_settlement` |
| `DIRECT_REQUEST_PAYMENT_STANDARD_FINALITY` | `per_payment_onchain` |
| `DIRECT_REQUEST_PAYMENT_METERED_FINALITY` | `aggregated_onchain_settlement` |

The `external_402` / `siglume-external-402-*` values are internal identifiers
that reflect SDRP's HTTP 402 Payment Required lineage; they are not public
product names, and they do **not** imply x402 wire compatibility (SDRP uses a
different challenge/payment-payload design — see the README "Relationship to
HTTP 402"). The SDK sets and reads them for you.

## Aliases

For legacy wire-compat naming, the following exported names are aliases of the
preferred `DirectRequestPayment*` functions. They are identical functions; new
code should prefer the `DirectRequestPayment*` names.

| Alias (TS) | Alias (Py) | Preferred function |
| --- | --- | --- |
| `createExternal402Challenge` | `create_external_402_challenge` | `createDirectRequestPaymentChallenge` / `create_direct_request_payment_challenge` |
| `verifyExternal402Challenge` | `verify_external_402_challenge` | `verifyDirectRequestPaymentChallenge` / `verify_direct_request_payment_challenge` |
| `createExternal402RecurringChallenge` | `create_external_402_recurring_challenge` | `createDirectRequestPaymentRecurringChallenge` / `create_direct_request_payment_recurring_challenge` |
| `verifyExternal402RecurringChallenge` | `verify_external_402_recurring_challenge` | `verifyDirectRequestPaymentRecurringChallenge` / `verify_direct_request_payment_recurring_challenge` |

## Errors

TypeScript exports:

- `SiglumeDirectRequestPaymentError`
- `SiglumeApiError`
- `HostedCheckoutNotAvailableError`
- `SiglumeWebhookSignatureError`
- `SiglumeWebhookPayloadError`

Python exports:

- `DirectRequestPaymentError`
- `SiglumeApiError`
- `HostedCheckoutNotAvailableError`
- `SiglumeWebhookSignatureError`
- `SiglumeWebhookPayloadError`

`SiglumeApiError` includes the HTTP status, platform error code, and parsed
response data where available.
`HostedCheckoutNotAvailableError` is raised when the Hosted Checkout server
surface is not enabled for the account yet during the rollout.
