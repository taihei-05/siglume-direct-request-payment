# API Reference

The TypeScript package is `@siglume/direct-request-payment`. The Python package
is `siglume-direct-request-payment` and imports as
`siglume_direct_request_payment`.

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

## `verifyDirectRequestPaymentChallenge(secret, input)` / `verify_direct_request_payment_challenge(...)`

Verifies a challenge against merchant, amount, currency, and secret. This is
useful in tests and internal checkout assertions.

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

## `verifyDirectRequestPaymentRecurringChallenge(secret, input)` / `verify_direct_request_payment_recurring_challenge(...)`

Verifies a recurring approval challenge against merchant, amount, currency,
cadence, and secret.

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
- `billing_plan`: `launch`, `starter`, `growth`, or `pro`
- `billing_currency`: `JPY`; `USD` requires agreed USD/USDC billing terms
- `webhook_callback_url`: HTTPS callback URL for signed payment events
- `max_amount_minor`: optional billing mandate cap

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
POST /v1/market/api-store/direct-payments/merchants
```

Creates or updates the merchant account for the authenticated merchant user.

### `getMerchant(merchant)` / `get_merchant(merchant)`

Calls:

```text
GET /v1/market/api-store/direct-payments/merchants/{merchant}
```

Returns setup and billing status without returning the challenge secret.

### `rotateChallengeSecret(merchant)` / `rotate_challenge_secret(merchant)`

Calls:

```text
POST /v1/market/api-store/direct-payments/merchants/{merchant}/challenge-secret/rotate
```

Returns the new challenge secret once.

### `prepareBillingMandate(merchant, input)` / `prepare_billing_mandate(...)`

Calls:

```text
POST /v1/market/api-store/direct-payments/merchants/{merchant}/billing-mandate
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
POST /v1/market/api-store/direct-payments/requirements
```

The SDK sends `mode="external_402"` internally.

Input:

- `merchant`: Siglume merchant key
- `amount_minor`: positive integer in minor currency units
- `currency`: `JPY` or `USD` when enabled for the merchant account
- `challenge`: merchant-signed challenge string
- `token_symbol`: optional `JPYC` or `USDC` when enabled for the merchant account
- `allowance_amount_minor`: optional positive integer
- `metadata`: optional JSON object

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
POST /v1/market/api-store/direct-payments/requirements/{requirement_id}/verify
```

Input may include:

- `receipt_id`
- `chain_receipt_id`
- `await_finality`
- `await_required_status`
- `await_timeout_seconds`
- `await_poll_seconds`

## Webhook Helpers

- `buildWebhookSignatureHeader(secret, body)` for tests
- `verifyWebhookSignature(secret, body, header)`
- `verifyDirectRequestPaymentWebhook(secret, body, header)`
- `parseDirectRequestPaymentWebhookEvent(payload)`
- Python equivalents use snake_case:
  `build_webhook_signature_header`, `verify_webhook_signature`,
  `verify_direct_request_payment_webhook`, and
  `parse_direct_request_payment_webhook_event`.

`verifyDirectRequestPaymentWebhook` verifies the signature and parses the event
in one call.

## Errors

TypeScript exports:

- `SiglumeDirectRequestPaymentError`
- `SiglumeApiError`
- `SiglumeWebhookSignatureError`
- `SiglumeWebhookPayloadError`

Python exports:

- `DirectRequestPaymentError`
- `SiglumeApiError`
- `SiglumeWebhookSignatureError`
- `SiglumeWebhookPayloadError`

`SiglumeApiError` includes the HTTP status, platform error code, and parsed
response data where available.
