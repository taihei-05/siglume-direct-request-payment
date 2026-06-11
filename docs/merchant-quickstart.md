# Merchant Quickstart

This guide shows the minimum safe Siglume Direct Request Payment flow for an
external merchant.

## Actors

- Merchant server: owns the order, amount, currency, challenge secret, webhook
  endpoint, and order fulfillment.
- Buyer: owns the Siglume wallet that pays the DirectPaymentHub transaction.
- Siglume: creates the payment requirement, prepares the wallet transaction,
  verifies the receipt, and emits signed webhooks.

The merchant server must not create charges with a customer wallet. It signs the
order challenge; the buyer-facing Siglume payment flow pays it.

## 1. Configure the Merchant

During onboarding, Siglume assigns:

- `merchant` key, for example `example_merchant`
- challenge secret
- allowed currency and token, initially `JPY`/`JPYC`; `USD`/`USDC` requires
  separately agreed merchant billing terms
- billing plan; see [Pricing](./pricing.md)

Keep the challenge secret server-side. Create a marketplace webhook subscription
to receive the `whsec_` signing secret.

```bash
curl -X POST https://siglume.com/v1/market/webhooks/subscriptions \
  -H "Authorization: Bearer <merchant-siglume-bearer-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "callback_url": "https://merchant.example/siglume/webhook",
    "event_types": ["direct_payment.confirmed", "direct_payment.spent"],
    "description": "Direct Request Payment production webhook"
  }'
```

The `signing_secret` is returned only when the subscription is created or
rotated. Store it as `SIGLUME_WEBHOOK_SECRET`. Fulfillment should be based on a
verified `direct_payment.confirmed` event.

## 2. Create an Order and Challenge

The merchant server creates the order before asking Siglume for payment.

```ts
import { createDirectRequestPaymentChallenge } from "@siglume/direct-request-payment";

const order = {
  id: "order_123",
  amount_minor: 1200,
  currency: "JPY",
};

const challenge = await createDirectRequestPaymentChallenge({
  merchant: "example_merchant",
  amount_minor: order.amount_minor,
  currency: order.currency,
  secret: process.env.SIGLUME_DIRECT_PAYMENT_CHALLENGE_SECRET!,
  nonce: `${order.id}-attempt_1`,
});

await orders.update(order.id, {
  siglume_challenge_hash: challenge.challenge_hash,
  siglume_payment_status: "pending",
});

return {
  order_id: order.id,
  amount_minor: order.amount_minor,
  currency: order.currency,
  siglume_challenge: challenge.challenge,
};
```

Python:

```py
import os

from siglume_direct_request_payment import create_direct_request_payment_challenge

order = {
    "id": "order_123",
    "amount_minor": 1200,
    "currency": "JPY",
}

challenge = create_direct_request_payment_challenge(
    merchant="example_merchant",
    amount_minor=order["amount_minor"],
    currency=order["currency"],
    secret=os.environ["SIGLUME_DIRECT_PAYMENT_CHALLENGE_SECRET"],
    nonce=f"{order['id']}-attempt_1",
)

orders.update(
    order["id"],
    {
        "siglume_challenge_hash": challenge["challenge_hash"],
        "siglume_payment_status": "pending",
    },
)

return {
    "order_id": order["id"],
    "amount_minor": order["amount_minor"],
    "currency": order["currency"],
    "siglume_challenge": challenge["challenge"],
}
```

Never calculate `amount_minor` from browser input.
The nonce must be unique per order payment attempt and must not contain `:`.

## 3. Buyer Creates and Pays the Requirement

After the buyer authenticates with Siglume, create the payment requirement with
the buyer's Siglume bearer token. Do not use a Developer Portal `cli_` API key
or merchant API key here.

```ts
import { DirectRequestPaymentClient } from "@siglume/direct-request-payment";

const siglume = new DirectRequestPaymentClient({
  auth_token: buyerSiglumeBearerToken,
});

const requirement = await siglume.createPaymentRequirement({
  merchant: "example_merchant",
  amount_minor: order.amount_minor,
  currency: order.currency,
  challenge: order.siglume_challenge,
});
```

Python:

```py
from siglume_direct_request_payment import DirectRequestPaymentClient

siglume = DirectRequestPaymentClient(auth_token=buyer_siglume_bearer_token)

requirement = siglume.create_payment_requirement(
    merchant="example_merchant",
    amount_minor=order["amount_minor"],
    currency=order["currency"],
    challenge=order["siglume_challenge"],
)
```

If Siglume returns `approve_transaction_request`, execute it first. Then execute
the payment transaction and verify the receipt.

```ts
if (requirement.approve_transaction_request) {
  await siglume.executeAllowanceTransaction(requirement, { await_finality: true });
}

const payment = await siglume.executePaymentTransaction(requirement, {
  await_finality: true,
});

await siglume.verifyPaymentRequirement(requirement.requirement_id, {
  receipt_id: String(payment.receipt?.receipt_id ?? ""),
});
```

Python:

```py
if requirement.get("approve_transaction_request"):
    siglume.execute_allowance_transaction(requirement, await_finality=True)

payment = siglume.execute_payment_transaction(requirement, await_finality=True)

siglume.verify_payment_requirement(
    requirement["requirement_id"],
    receipt_id=str((payment.get("receipt") or {}).get("receipt_id") or ""),
)
```

## 4. Fulfill from Webhook

Use the webhook as the durable signal, not just the browser return path.

```ts
import { verifyDirectRequestPaymentWebhook } from "@siglume/direct-request-payment";

const { event } = await verifyDirectRequestPaymentWebhook(
  process.env.SIGLUME_WEBHOOK_SECRET!,
  rawRequestBody,
  siglumeSignatureHeader,
);

if (event.type === "direct_payment.confirmed") {
  const data = event.data;
  const order = await orders.findByChallengeHash(String(data.challenge_hash ?? ""));
  if (!order) {
    throw new Error("Unknown Siglume challenge hash");
  }
  await orders.markPaidOnce(order.id, {
    siglume_requirement_id: String(data.requirement_id ?? data.direct_payment_requirement_id ?? ""),
  });
}
```

Python:

```py
import os

from siglume_direct_request_payment import verify_direct_request_payment_webhook

verified = verify_direct_request_payment_webhook(
    os.environ["SIGLUME_WEBHOOK_SECRET"],
    raw_request_body,
    siglume_signature_header,
)

if verified["event"]["type"] == "direct_payment.confirmed":
    data = verified["event"]["data"]
    order = orders.find_by_challenge_hash(str(data.get("challenge_hash") or ""))
    if not order:
        raise RuntimeError("Unknown Siglume challenge hash")
    orders.mark_paid_once(
        order["id"],
        siglume_requirement_id=str(data.get("requirement_id") or data.get("direct_payment_requirement_id") or ""),
    )
```

## Failure Handling

- `EXTERNAL_402_CHALLENGE_REQUIRED`: the merchant server did not provide a
  challenge.
- `INVALID_EXTERNAL_402_CHALLENGE`: the amount, currency, merchant, nonce, or
  signature does not match.
- `EXTERNAL_402_CHALLENGE_ALREADY_USED`: the challenge is already bound to a
  different buyer.
- `EXTERNAL_402_MERCHANT_BILLING_SETUP_REQUIRED`: merchant onboarding is not
  complete.
- `EXTERNAL_402_MERCHANT_BILLING_PAST_DUE` or
  `EXTERNAL_402_MERCHANT_BILLING_SUSPENDED`: merchant billing must be fixed
  before new payments can be accepted.

## Go-Live Checklist

- Merchant onboarding and billing mandate are complete.
- Challenge secret is only in server-side environment variables.
- Webhook endpoint receives raw body and verifies `Siglume-Signature`.
- Orders store `challenge_hash`, `requirement_id`, and fulfillment status.
- Fulfillment is idempotent.
- Browser input cannot change the amount or currency.
- Nonces cannot be reused for separate order attempts.
- The order is fulfilled only after a verified webhook maps back to the stored
  `challenge_hash`.
