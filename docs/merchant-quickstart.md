# Merchant Quickstart

This guide shows the minimum safe Siglume Direct Request Payment flow for an
external merchant.

## Actors

- Merchant server: owns the order, amount, currency, challenge secret, webhook
  endpoint, and order fulfillment.
- Buyer: owns the Siglume wallet that pays the on-chain payment transaction.
- Siglume: creates the payment requirement, prepares the wallet transaction,
  verifies the receipt, and emits signed webhooks.

The merchant server must not create charges with a customer wallet. It signs the
order challenge; the buyer-facing Siglume payment flow pays it.

This quickstart is for SDRP Standard Payment in an external merchant product.
Micro Payment and Nano Payment are applied automatically by amount and settled on
a weekly / monthly cadence (see [Pricing](./pricing.md#settlement-schedule)); they
are not browser checkout requirements you create with this SDK. Their provider
revenue remains unsettled until the later on-chain settlement succeeds.

## Two Buyer Systems

There are two ways a buyer reaches you, and you integrate each differently:

- **Human web shopper → Hosted Checkout.** Create a checkout session and
  redirect the shopper to the Siglume-hosted page (the
  [section below](#hosted-checkout-human-web-shoppers)). This is the path that
  resembles a Stripe-style hosted checkout.
- **AI agent / agent-to-agent (AtoA) → direct API / tools.** An autonomous
  buyer pays through `DirectRequestPaymentClient` or the marketplace tool
  `market_confirm_direct_payment_and_execute`, as in sections 2-4 below.

In both cases the buyer pays from a Siglume wallet (JPYC / USDC, not a card),
the merchant SDK never authenticates the buyer, and you fulfill on the same
`direct_payment.confirmed` webhook.

## Hosted Checkout (Human Web Shoppers)

When a person clicks "Pay with Siglume" on your site, create a session and
redirect them to the returned `checkout_url`. They sign into Siglume on the
hosted page, approve, and pay from their own wallet, then return to your
`success_url`. Siglume fixes the amount, currency, challenge, and return URLs
server-side, so the browser cannot tamper with the price or the redirect target.

Register your return-URL origins once (open-redirect defense). The origin of
your `webhook_callback_url` is auto-allowed in addition to these.

TypeScript:

```ts
import { DirectRequestPaymentMerchantClient } from "@siglume/direct-request-payment";

const merchant = new DirectRequestPaymentMerchantClient({
  auth_token: process.env.SIGLUME_MERCHANT_AUTH_TOKEN!,
});

// Once, at setup: register the return-URL origin allowlist.
await merchant.setupCheckout({
  merchant: "example_merchant",
  display_name: "Example Merchant",
  billing_plan: "launch",
  billing_currency: "JPY",
  webhook_callback_url: "https://merchant.example/siglume/webhook",
  checkout_allowed_origins: ["https://www.example.com"],
});

// Per order: create a session and redirect the shopper to checkout_url.
const session = await merchant.createCheckoutSession({
  merchant: "example_merchant",
  amount_minor: 500,            // server-fixed; the browser cannot change it
  currency: "JPY",
  nonce: order.id,              // unique per order
  success_url: "https://www.example.com/thanks",
  cancel_url: "https://www.example.com/cart",
  metadata: { order_id: order.id },
});

await orders.update(order.id, {
  siglume_challenge_hash: session.challenge_hash,
  siglume_payment_status: "pending",
});

redirect(session.checkout_url); // -> https://siglume.com/pay/<session_id>
```

Python:

```py
import os

from siglume_direct_request_payment import DirectRequestPaymentMerchantClient

merchant = DirectRequestPaymentMerchantClient(
    auth_token=os.environ["SIGLUME_MERCHANT_AUTH_TOKEN"],
)

# Once, at setup: register the return-URL origin allowlist.
merchant.setup_checkout(
    merchant="example_merchant",
    display_name="Example Merchant",
    billing_plan="launch",
    billing_currency="JPY",
    webhook_callback_url="https://merchant.example/siglume/webhook",
    checkout_allowed_origins=["https://www.example.com"],
)

# Per order: create a session and redirect the shopper to checkout_url.
session = merchant.create_checkout_session(
    merchant="example_merchant",
    amount_minor=500,            # server-fixed; the browser cannot change it
    currency="JPY",
    nonce=order["id"],           # unique per order
    success_url="https://www.example.com/thanks",
    cancel_url="https://www.example.com/cart",
    metadata={"order_id": order["id"]},
)

orders.update(
    order["id"],
    {
        "siglume_challenge_hash": session["challenge_hash"],
        "siglume_payment_status": "pending",
    },
)

# Redirect the shopper to session["checkout_url"]
# -> https://siglume.com/pay/<session_id>
```

Fulfill exactly as in [section 4](#4-fulfill-from-webhook): on the signed
`direct_payment.confirmed` webhook, look up the order by `challenge_hash` and
mark it paid once. The session is single-use and expires (~30 minutes); you can
poll `getCheckoutSession` / `get_checkout_session` if you also want to show
status in your own UI, but the webhook is the source of truth. Honest framing:
the merchant plumbing integrates quickly, but human web payment still requires
the shopper to have — or create — a Siglume wallet and pay from it; it is not a
card-style "instant" checkout for first-time buyers.

## 1. Run Merchant Setup

Run setup from the merchant server, CI, or an integration agent with the
merchant's Siglume JWT. Do not use a Developer Portal `cli_` key here.

TypeScript:

```ts
import { DirectRequestPaymentMerchantClient } from "@siglume/direct-request-payment";

const merchantClient = new DirectRequestPaymentMerchantClient({
  auth_token: process.env.SIGLUME_MERCHANT_AUTH_TOKEN!,
});

const setup = await merchantClient.setupCheckout({
  merchant: "example_merchant",
  display_name: "Example Merchant",
  billing_plan: "launch",
  billing_currency: "JPY",
  webhook_callback_url: "https://merchant.example/siglume/webhook",
  max_amount_minor: 100000,
});

// setup.env holds the merchant key plus the challenge and webhook secrets.
// Store them in your server-side secret manager; do not log the secret values.
console.log(`Configured merchant: ${setup.env.SIGLUME_DIRECT_PAYMENT_MERCHANT}`);
```

Python:

```py
import os

from siglume_direct_request_payment import DirectRequestPaymentMerchantClient

merchant_client = DirectRequestPaymentMerchantClient(
    auth_token=os.environ["SIGLUME_MERCHANT_AUTH_TOKEN"],
)

setup = merchant_client.setup_checkout(
    merchant="example_merchant",
    display_name="Example Merchant",
    billing_plan="launch",
    billing_currency="JPY",
    webhook_callback_url="https://merchant.example/siglume/webhook",
    max_amount_minor=100000,
)

# setup["env"] holds the merchant key plus the challenge and webhook secrets.
# Persist them to your server-side secret store; do not log the secret values.
print("Configured merchant:", setup["env"]["SIGLUME_DIRECT_PAYMENT_MERCHANT"])
```

`setupCheckout` / `setup_checkout` performs:

- merchant key claim
- challenge secret creation
- billing mandate preparation
- webhook subscription creation for `direct_payment.confirmed` and
  `direct_payment.spent`

Store `SIGLUME_DIRECT_PAYMENT_CHALLENGE_SECRET` and `SIGLUME_WEBHOOK_SECRET`
server-side only. Secrets are returned only when they are created or rotated.
If the returned billing mandate requires wallet approval, complete that Siglume
wallet step before accepting production payments.

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

This is the AI agent / AtoA path: the buyer pays directly through
`DirectRequestPaymentClient` (or the marketplace tool
`market_confirm_direct_payment_and_execute`), rather than through Hosted
Checkout. It assumes the buyer agent is **already connected to Siglume before
the payment**: an AI client (Claude / ChatGPT / Cursor) connects through the
Siglume MCP server (OAuth authorization with a consent screen), or a custom app
holds the buyer's Siglume bearer token (JWT). Either way a Siglume
authentication context is established first — the merchant SDK does not log the
buyer in. Unattended runs are bounded by Siglume's approval gates / spending
budgets (per-run / daily / monthly auto-pay budgets, or Works approval), not by
the merchant.

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
- `EXTERNAL_402_MERCHANT_NOT_FOUND`: run merchant setup with the merchant's
  Siglume JWT.
- `EXTERNAL_402_MERCHANT_BILLING_SETUP_REQUIRED`: the merchant billing mandate
  is not active yet.
- `EXTERNAL_402_MERCHANT_BILLING_PAST_DUE` or
  `EXTERNAL_402_MERCHANT_BILLING_SUSPENDED`: merchant billing must be fixed
  before new payments can be accepted.

## Go-Live Checklist

- `setupCheckout` / `setup_checkout` has claimed the merchant key.
- Merchant billing mandate is active.
- Challenge secret is only in server-side environment variables.
- Webhook endpoint receives raw body and verifies `Siglume-Signature`.
- Orders store `challenge_hash`, `requirement_id`, and fulfillment status.
- Fulfillment is idempotent.
- Browser input cannot change the amount or currency.
- Nonces cannot be reused for separate order attempts.
- The order is fulfilled only after a verified webhook maps back to the stored
  `challenge_hash`.
