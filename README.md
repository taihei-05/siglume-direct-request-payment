# @siglume/direct-request-payment

[![npm version](https://img.shields.io/npm/v/@siglume/direct-request-payment.svg)](https://www.npmjs.com/package/@siglume/direct-request-payment)
[![PyPI version](https://img.shields.io/pypi/v/siglume-direct-request-payment.svg)](https://pypi.org/project/siglume-direct-request-payment/)

Merchant SDK for Siglume Direct Request Payment checkout integrations.

Use this package when an external EC site, booking service, membership service,
or paid API wants to accept Siglume wallet payments without taking custody of
customer funds.

This SDK is intentionally separate from `@siglume/api-sdk`:

- `@siglume/api-sdk` is for publishing agent-facing APIs to the Siglume API Store.
- `@siglume/direct-request-payment` is for external merchants integrating
  Siglume Direct Request Payment into their own checkout.

## What This SDK Covers

- merchant self-service setup with a Siglume merchant JWT
- challenge secret creation and rotation
- merchant billing mandate preparation
- webhook subscription creation
- merchant-signed payment challenges
- buyer-authenticated payment requirement creation
- prepared wallet transaction execution payloads
- payment requirement verification
- signed webhook verification

It does not custody funds or manage customer wallets. Merchant setup runs through
Siglume APIs with the merchant's Siglume JWT; buyer payment creation runs with
the buyer's Siglume JWT.

## Install

```bash
npm install @siglume/direct-request-payment
```

```bash
pip install siglume-direct-request-payment
```

Node.js 18 or later is required for the TypeScript SDK. Python 3.11 or later is
required for the Python SDK.

## Current Platform Contract

The public product name is **Siglume Direct Request Payment**. The current
platform payload still uses the internal mode name `external_402`; this SDK sets
that value for you when creating a payment requirement.

Payment requirement creation must run in the authenticated buyer's Siglume
context. Your merchant server must not use a merchant secret or API key to
charge a customer wallet. The merchant server creates the signed challenge; the
buyer-facing Siglume payment flow creates and pays the requirement.

`DirectRequestPaymentMerchantClient` requires the merchant's Siglume bearer
token for setup. `DirectRequestPaymentClient` requires the buyer's Siglume
bearer token for payment requirements. Do not use a Developer Portal `cli_` API
key with this package.

Current HTTP endpoints live under Siglume's market/API Store route namespace for
compatibility with the existing platform contract. That does not make this SDK an
API Store publishing SDK.

## Trial Pricing

Siglume Direct Request Payment is currently offered with trial-phase merchant
pricing designed for small EC sites, booking services, membership services, paid
APIs, and agent-to-agent payment experiments.

| Plan | Monthly fee | Payment fee |
| --- | ---: | ---: |
| Launch | JPY 0 | 0% through 100 payments/month, then 1.8% |
| Starter | JPY 980 | 1.0% |
| Growth | JPY 2,980 | 0.7% |
| Pro | JPY 9,800 | 0.5% |

The minimum fee is JPY 3 for each fee-bearing payment, including Launch-plan
payments after the included monthly allowance. A merchant billing mandate is
required before accepting payments, even on the Launch plan. The API and merchant
registry may still expose the internal plan key `free` for this tier. See
[docs/pricing.md](./docs/pricing.md) for details.

Per-payment fees are deducted at payment settlement time, so the merchant
receives the net amount. Monthly base fees are collected through the merchant
billing mandate. The listed public pricing is JPY-denominated; USD/USDC merchant
billing requires separately agreed terms.

## Merchant Setup: One SDK Call

Run this once from the merchant server or an integration agent with the
merchant's Siglume JWT. It reserves the merchant key, creates the challenge
secret, prepares the billing mandate, and creates the webhook subscription.

```ts
import { DirectRequestPaymentMerchantClient } from "@siglume/direct-request-payment";

const merchant = new DirectRequestPaymentMerchantClient({
  auth_token: process.env.SIGLUME_MERCHANT_AUTH_TOKEN!,
});

const setup = await merchant.setupCheckout({
  merchant: "example_merchant",
  display_name: "Example Merchant",
  billing_plan: "launch",
  billing_currency: "JPY",
  webhook_callback_url: "https://merchant.example/siglume/webhook",
  max_amount_minor: 100000,
});

console.log(setup.env);
// {
//   SIGLUME_DIRECT_PAYMENT_MERCHANT: "example_merchant",
//   SIGLUME_DIRECT_PAYMENT_CHALLENGE_SECRET: "edrp_...",
//   SIGLUME_WEBHOOK_SECRET: "whsec_..."
// }
```

```py
import os

from siglume_direct_request_payment import DirectRequestPaymentMerchantClient

merchant = DirectRequestPaymentMerchantClient(
    auth_token=os.environ["SIGLUME_MERCHANT_AUTH_TOKEN"],
)

setup = merchant.setup_checkout(
    merchant="example_merchant",
    display_name="Example Merchant",
    billing_plan="launch",
    billing_currency="JPY",
    webhook_callback_url="https://merchant.example/siglume/webhook",
    max_amount_minor=100000,
)

print(setup["env"])
```

Store returned secrets on the merchant server. `challenge_secret` and
`signing_secret` are returned only when they are created or rotated. If a billing
mandate response requires wallet approval, complete that Siglume wallet step
before accepting production payments.

## Merchant Server: Create a Challenge

```ts
import { createDirectRequestPaymentChallenge } from "@siglume/direct-request-payment";

const challenge = await createDirectRequestPaymentChallenge({
  merchant: "example_merchant",
  amount_minor: 1200,
  currency: "JPY",
  secret: process.env.SIGLUME_DIRECT_PAYMENT_CHALLENGE_SECRET!,
  nonce: "order_123-attempt_1",
});

// Return only challenge.challenge to the buyer-facing checkout.
// Never return the challenge secret to the browser.
console.log(challenge.challenge);
```

```py
import os

from siglume_direct_request_payment import create_direct_request_payment_challenge

challenge = create_direct_request_payment_challenge(
    merchant="example_merchant",
    amount_minor=1200,
    currency="JPY",
    secret=os.environ["SIGLUME_DIRECT_PAYMENT_CHALLENGE_SECRET"],
    nonce="order_123-attempt_1",
)

print(challenge["challenge"])
```

The signed challenge binds:

- merchant key
- amount in minor units
- currency
- nonce

Changing any of those values invalidates the challenge.
The nonce must not contain `:` because the current platform challenge format is
`scheme:nonce:signature`.

## Buyer Payment Flow

Use `DirectRequestPaymentClient` only with the authenticated buyer's Siglume
bearer token. `SIGLUME_AUTH_TOKEN` may be used in server-side payment-confirmation
helpers; `SIGLUME_API_KEY` and Developer Portal `cli_` keys are not accepted.

```ts
import { DirectRequestPaymentClient } from "@siglume/direct-request-payment";

const siglume = new DirectRequestPaymentClient({
  auth_token: buyerSiglumeBearerToken,
});

const requirement = await siglume.createPaymentRequirement({
  merchant: "example_merchant",
  amount_minor: 1200,
  currency: "JPY",
  challenge: challengeFromMerchantServer,
});

if (requirement.approve_transaction_request) {
  await siglume.executeAllowanceTransaction(requirement, { await_finality: true });
}

const payment = await siglume.executePaymentTransaction(requirement, {
  await_finality: true,
});

const receiptId = String(payment.receipt?.receipt_id ?? "");
const verified = await siglume.verifyPaymentRequirement(requirement.requirement_id, {
  receipt_id: receiptId,
  await_finality: false,
});

console.log(verified.status);
```

```py
from siglume_direct_request_payment import DirectRequestPaymentClient

siglume = DirectRequestPaymentClient(auth_token=buyer_siglume_bearer_token)

requirement = siglume.create_payment_requirement(
    merchant="example_merchant",
    amount_minor=1200,
    currency="JPY",
    challenge=challenge_from_merchant_server,
)

if requirement.get("approve_transaction_request"):
    siglume.execute_allowance_transaction(requirement, await_finality=True)

payment = siglume.execute_payment_transaction(requirement, await_finality=True)
receipt_id = str((payment.get("receipt") or {}).get("receipt_id") or "")

verified = siglume.verify_payment_requirement(
    requirement["requirement_id"],
    receipt_id=receipt_id,
    await_finality=False,
)

print(verified["status"])
```

## Webhooks

Your merchant system should treat Siglume webhooks as the durable delivery
signal. Always verify the signature against the raw request body before trusting
the payload. Create a marketplace webhook subscription with
`POST /v1/market/webhooks/subscriptions`; the response returns the `whsec_`
signing secret once.

```ts
import { verifyDirectRequestPaymentWebhook } from "@siglume/direct-request-payment";

const { event } = await verifyDirectRequestPaymentWebhook(
  process.env.SIGLUME_WEBHOOK_SECRET!,
  rawRequestBody,
  request.headers["siglume-signature"],
);

if (event.type === "direct_payment.confirmed") {
  // Mark the order paid if event.data.challenge_hash/order mapping matches.
}
```

```py
import os

from siglume_direct_request_payment import verify_direct_request_payment_webhook

verified = verify_direct_request_payment_webhook(
    os.environ["SIGLUME_WEBHOOK_SECRET"],
    raw_request_body,
    siglume_signature_header,
)

if verified["event"]["type"] == "direct_payment.confirmed":
    # Mark the order paid if event.data.challenge_hash/order mapping matches.
    pass
```

## Security Rules

- Keep the challenge secret on the merchant server only.
- Keep merchant order amount and currency server-authored.
- Use one nonce per order payment attempt.
- Store `challenge_hash` with the order and reject mismatches.
- Make order fulfillment idempotent by `requirement_id` and order id.
- Verify webhook signatures against the raw body.
- Do not use a merchant token to charge a customer wallet.
- Do not treat Direct Request Payment as stored value, prepaid points, escrow, or
  a platform balance.

Read [docs/security.md](./docs/security.md) before going live.

## Go-Live Checklist

- Run `setupCheckout` with the merchant Siglume JWT.
- Complete the merchant billing mandate wallet approval if required.
- Store `SIGLUME_DIRECT_PAYMENT_CHALLENGE_SECRET` only on the merchant server.
- Store the returned `SIGLUME_WEBHOOK_SECRET` only on the merchant server.
- Persist `challenge_hash`, `requirement_id`, and fulfillment state per order.
- Fulfill orders only from verified webhook data, with idempotency.
- Treat `fee_bps` returned by Siglume as the runtime fee source of truth.

## Documentation

- [Merchant quickstart](./docs/merchant-quickstart.md)
- [API reference](./docs/api-reference.md)
- [Pricing](./docs/pricing.md)
- [Security guide](./docs/security.md)
- [Merchant setup example](./examples/setup-merchant.ts)
- [Express checkout example](./examples/express-checkout.ts)
- [Japanese launch announcement draft](./docs/announcement-ja.md)
- [Changelog](./CHANGELOG.md)

## License

MIT
