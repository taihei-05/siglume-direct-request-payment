# API Reference

The TypeScript package is `@siglume/direct-request-payment`. The Python package
is `siglume-direct-request-payment` and imports as
`siglume_direct_request_payment`.

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

In both systems the merchant fulfills on the same signed
`direct_payment.confirmed` webhook. Hosted Checkout adds no new money movement
and no new webhook.

## Environment Variables

| Name | Used by | Purpose |
| --- | --- | --- |
| `SIGLUME_DIRECT_PAYMENT_CHALLENGE_SECRET` | merchant server | HMAC secret for order challenges |
| `SIGLUME_MERCHANT_AUTH_TOKEN` | merchant setup helper | merchant Siglume bearer token for self-service setup |
| `SIGLUME_AUTH_TOKEN` | buyer payment helper | buyer Siglume bearer token for API calls |
| `SIGLUME_API_BASE` | optional | API base URL override; defaults to `https://siglume.com/v1` |
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
challenge. This is mostly useful for tests and internal assertions.

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
  absolute origin such as `https://shop.example.com`; entries are normalized to
  bare, lowercased origins and deduped.

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
webhook-origin auto-allow apply.

### `createCheckoutSession(input)` / `create_checkout_session(...)`

Beta / server rollout: Hosted Checkout is rolling out account by account. If the
server endpoint is not enabled for the merchant yet, the SDK raises
`HostedCheckoutNotAvailableError` (TS + Py) rather than leaking a raw rollout
404/409. Fulfillment must still key off the signed `direct_payment.confirmed`
webhook.

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
  amount_minor: 500,
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
    amount_minor=500,
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
- `success_url`
- `cancel_url`
- `expires_at` (nullable)
- `authenticated_at` (nullable; set when the shopper signs into Siglume)
- `paid_at` (nullable; set when the payment confirms)
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

## `DirectRequestPaymentClient`

Thin wrapper around the current Siglume Direct Request Payment HTTP contract.
Use it with the authenticated buyer's Siglume bearer token. Developer Portal
`cli_` API keys are not accepted by these buyer-authenticated routes.

This client creates SDRP Standard Payment requirements for external merchant
checkout flows. Micro Payment and Nano Payment are applied automatically by
amount and settled on a weekly / monthly cadence; they are not created explicitly
through this client.

Payment requirements include `fee_bps` from the Siglume platform. The SDK does
not calculate merchant plan fees locally; see [Pricing](./pricing.md).

```ts
const siglume = new DirectRequestPaymentClient({
  auth_token: buyerSiglumeBearerToken,
  base_url: "https://siglume.com/v1",
});
```

```py
siglume = DirectRequestPaymentClient(
    auth_token=buyer_siglume_bearer_token,
    base_url="https://siglume.com/v1",
)
```

### `createPaymentRequirement(input)` / `create_payment_requirement(...)`

Calls:

```text
POST /v1/sdrp/direct-payments/requirements
```

The SDK sets the platform-required mode value for you; you do not pass it. (For
wire compatibility this is still the legacy `external_402` value — see the
README "Compatibility Notes".)

Input:

- `merchant`: Siglume merchant key
- `amount_minor`: positive integer in minor currency units
- `currency`: `JPY` or `USD` when enabled for the merchant account
- `challenge`: merchant-signed challenge string
- `token_symbol`: optional `JPYC` or `USDC` when enabled for the merchant account
- `allowance_amount_minor`: optional positive integer
- `metadata`: optional JSON object

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
keyword-only `int`. `body` may be raw bytes, a string, or a JSON object.

### `buildWebhookSignatureHeader(secret, body, options)` / `build_webhook_signature_header(secret, body, *, timestamp=None)`

Returns a `t=<timestamp>,v1=<signature>` header string. Mainly for tests /
mocking inbound webhooks. In TypeScript `options` is an optional
`{ timestamp?: number }` (defaults to now); in Python `timestamp` is a
keyword-only optional `int`.

### `verifyWebhookSignature(secret, body, signature_header, options)` / `verify_webhook_signature(secret, body, signature_header, *, tolerance_seconds=300, now=None)`

Verifies the `Siglume-Signature` header against the raw `body`. Throws
`SiglumeWebhookSignatureError` (TS) / `SiglumeWebhookSignatureError` (Py) when
the timestamp is outside tolerance or the signature does not match. In TypeScript
`options` is `{ tolerance_seconds?, now? }`; in Python those are keyword-only
(`tolerance_seconds` defaults to `DEFAULT_WEBHOOK_TOLERANCE_SECONDS` = 300).
Returns `{ timestamp, signature }`.

### `parseDirectRequestPaymentWebhookEvent(payload)` / `parse_direct_request_payment_webhook_event(payload)`

Validates and normalizes a parsed webhook event object (requires `id`, `type`,
`api_version`, `occurred_at`, and an object `data`). Throws
`SiglumeWebhookPayloadError` on a malformed event, or when a
`direct_payment.confirmed` event does not carry `data.mode = "external_402"`. The
`payload` argument is positional in both languages.

### `verifyDirectRequestPaymentWebhook(secret, body, signature_header, options)` / `verify_direct_request_payment_webhook(secret, body, signature_header, *, tolerance_seconds=300, now=None)`

Verifies the signature and parses the event in one call. Returns
`{ event, verification }` (TS) / `{"event": ..., "verification": ...}` (Py). Same
options shape as `verifyWebhookSignature` (keyword-only in Python).

Webhook-verification trio (typical inbound webhook handler):

```ts
import { verifyDirectRequestPaymentWebhook } from "@siglume/direct-request-payment";

const { event, verification } = await verifyDirectRequestPaymentWebhook(
  process.env.SIGLUME_WEBHOOK_SECRET!,
  rawRequestBody,                       // the RAW body bytes/string, not re-stringified JSON
  request.headers["siglume-signature"],
);
// event.type === "direct_payment.confirmed" -> fulfill once; verification.timestamp is the signed time
```

```py
from siglume_direct_request_payment import verify_direct_request_payment_webhook

verified = verify_direct_request_payment_webhook(
    os.environ["SIGLUME_WEBHOOK_SECRET"],
    raw_request_body,                     # the RAW body bytes/string
    siglume_signature_header,
)
event = verified["event"]
# event["type"] == "direct_payment.confirmed" -> fulfill once
```

## Exported Constants

Both packages export these importable constants:

| Constant | Value |
| --- | --- |
| `DEFAULT_SIGLUME_API_BASE` | `https://siglume.com/v1` |
| `DIRECT_REQUEST_PAYMENT_CHALLENGE_SCHEME` | `siglume-external-402-v1` |
| `DIRECT_REQUEST_PAYMENT_RECURRING_CHALLENGE_SCHEME` | `siglume-external-402-recurring-v1` |
| `DIRECT_REQUEST_PAYMENT_MODE` | `external_402` |
| `DIRECT_REQUEST_PAYMENT_RECEIPT_KIND` | `sdrp_direct_payment` |
| `DIRECT_REQUEST_PAYMENT_ALLOWANCE_RECEIPT_KIND` | `sdrp_direct_payment_allowance` |
| `DIRECT_REQUEST_PAYMENT_REFERENCE_TYPE` | `sdrp_direct_payment_requirement` |
| `DEFAULT_WEBHOOK_TOLERANCE_SECONDS` | `300` |

The `external_402` / `siglume-external-402-*` values are legacy wire-compat
identifiers, not public product names (see the README "Compatibility Notes").

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
