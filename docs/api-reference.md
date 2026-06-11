# API Reference

## `createDirectRequestPaymentChallenge(input)`

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

Returns:

- `challenge`: value to pass to Siglume
- `challenge_hash`: value to store on the order
- `signature`: HMAC-SHA256 hex digest
- `nonce`

`nonce` must not contain `:` because the platform challenge string is delimited
as `scheme:nonce:signature`.

## `verifyDirectRequestPaymentChallenge(secret, input)`

Verifies a challenge against merchant, amount, currency, and secret. This is
useful in tests and internal checkout assertions.

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

### `createPaymentRequirement(input)`

Calls:

```text
POST /v1/market/api-store/direct-payments/requirements
```

The SDK sends `mode="external_402"` internally.

### `executeAllowanceTransaction(requirement)`

Executes `requirement.approve_transaction_request` through:

```text
POST /v1/market/web3/transactions/execute-prepared
```

Only call this when Siglume returned an approval transaction.

### `executePaymentTransaction(requirement)`

Executes `requirement.transaction_request` through the same prepared transaction
route.

### `verifyPaymentRequirement(requirement_id, input)`

Calls:

```text
POST /v1/market/api-store/direct-payments/requirements/{requirement_id}/verify
```

## Webhook Helpers

- `buildWebhookSignatureHeader(secret, body)` for tests
- `verifyWebhookSignature(secret, body, header)`
- `verifyDirectRequestPaymentWebhook(secret, body, header)`
- `parseDirectRequestPaymentWebhookEvent(payload)`

`verifyDirectRequestPaymentWebhook` verifies the signature and parses the event
in one call.
