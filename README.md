# @siglume/direct-request-payment

Merchant SDK for Siglume Direct Request Payment checkout integrations.

Use this package when an external EC site, booking service, membership service,
or paid API wants to accept Siglume wallet payments without taking custody of
customer funds.

This SDK is intentionally separate from `@siglume/api-sdk`:

- `@siglume/api-sdk` is for publishing agent-facing APIs to the Siglume API Store.
- `@siglume/direct-request-payment` is for external merchants integrating
  Siglume Direct Request Payment into their own checkout.

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

`DirectRequestPaymentClient` requires the buyer's Siglume bearer token. Do not
use a Developer Portal `cli_` API key with this package.

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

## Documentation

- [Merchant quickstart](./docs/merchant-quickstart.md)
- [API reference](./docs/api-reference.md)
- [Pricing](./docs/pricing.md)
- [Security guide](./docs/security.md)
- [Express checkout example](./examples/express-checkout.ts)

## License

MIT
