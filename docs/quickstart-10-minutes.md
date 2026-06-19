# 10-Minute First Test Payment

This guide is the shortest supported path to one **Standard Payment** test
through Siglume wallet Hosted Checkout. It is not a full production launch.

## What the 10 minutes cover

You can count the 10 minutes only after the prerequisites below are already
ready. The target outcome is:

- one Standard-band order,
- one Hosted Checkout session,
- one signed `direct_payment.confirmed` webhook,
- one idempotent local fulfillment decision.

This guide does **not** cover production monitoring, refunds, subscriptions,
scheduled autopay, game entitlement recovery, or Micro / Nano accounting.

## Prerequisites

Before starting, confirm:

- You have a Siglume merchant account and merchant Siglume bearer token.
- Hosted Checkout is enabled for that merchant account.
- The merchant billing mandate is active, including any required wallet
  approval.
- You have a public HTTPS webhook URL that can receive the raw request body.
- Your checkout return URL origin is known and can be registered.
- The buyer has a Siglume wallet funded in the settlement token for the test
  market: JPYC for JPY, USDC for USD.
- Your order amount is in the Standard band: JPY 501+ or USD 3.01+.

If Hosted Checkout is not enabled, stop here. The SDK raises
`HostedCheckoutNotAvailableError` for rollout 404/409 responses; contact
Siglume support or your Siglume account contact to enable the account before
continuing with a human web checkout.

## 1. Install

Runnable starter directories are available if you want a small server to edit:

- [TypeScript Express starter](../examples/hosted-checkout-typescript)
- [Python Flask starter](../examples/hosted-checkout-python)

For an existing app, install the SDK directly:

```bash
npm install @siglume/direct-request-payment
```

or:

```bash
pip install siglume-direct-request-payment
```

## 2. Set environment variables

```bash
SIGLUME_MERCHANT_AUTH_TOKEN=<merchant Siglume bearer token>
SIGLUME_DIRECT_PAYMENT_MERCHANT=example_merchant
SHOP_PUBLIC_ORIGIN=https://www.example.com
SHOP_WEBHOOK_URL=https://api.example.com/siglume/webhook
```

Do not use a Developer Portal `cli_` API key. Merchant setup requires the
merchant's Siglume bearer token.

## 3. Register merchant settings

Run setup once from your server, CI, or integration machine:

```ts
import { DirectRequestPaymentMerchantClient } from "@siglume/direct-request-payment";

const merchant = new DirectRequestPaymentMerchantClient({
  auth_token: process.env.SIGLUME_MERCHANT_AUTH_TOKEN!,
});

const setup = await merchant.setupCheckout({
  merchant: process.env.SIGLUME_DIRECT_PAYMENT_MERCHANT!,
  display_name: "Example Merchant",
  billing_plan: "launch",
  billing_currency: "JPY",
  webhook_callback_url: process.env.SHOP_WEBHOOK_URL!,
  checkout_allowed_origins: [process.env.SHOP_PUBLIC_ORIGIN!],
});

console.log(setup.env.SIGLUME_DIRECT_PAYMENT_MERCHANT);
```

Store the returned `SIGLUME_DIRECT_PAYMENT_CHALLENGE_SECRET` and
`SIGLUME_WEBHOOK_SECRET` in a server-side secret store. Secret values are
returned only when created or rotated.

## 4. Create a Standard checkout session

For each order, create the order on your server first. Then create a Hosted
Checkout session:

```ts
const session = await merchant.createCheckoutSession({
  merchant: process.env.SIGLUME_DIRECT_PAYMENT_MERCHANT!,
  amount_minor: 1200,
  currency: "JPY",
  nonce: "order_123-attempt_1",
  success_url: `${process.env.SHOP_PUBLIC_ORIGIN}/thanks`,
  cancel_url: `${process.env.SHOP_PUBLIC_ORIGIN}/cart`,
  metadata: { order_id: "order_123" },
});

await orders.update("order_123", {
  siglume_challenge_hash: session.challenge_hash,
  siglume_checkout_session_id: session.session_id,
  siglume_payment_status: "pending",
});

redirect(session.checkout_url);
```

The browser must never choose the amount, currency, nonce, or return URL. The
session is single-use and expires.

## 5. Fulfill from the signed webhook

The browser return path is not the source of truth. Use the signed webhook and
classify the confirmation:

```ts
import {
  classifyDirectPaymentConfirmation,
  verifyDirectRequestPaymentWebhook,
} from "@siglume/direct-request-payment";

const { event } = await verifyDirectRequestPaymentWebhook(
  process.env.SIGLUME_WEBHOOK_SECRET!,
  rawRequestBody,
  siglumeSignatureHeader,
);

if (event.type === "direct_payment.confirmed") {
  const confirmation = classifyDirectPaymentConfirmation(event);

  if (confirmation.kind === "standard_settled") {
    await orders.markPaidOnceByChallengeHash(confirmation.challenge_hash, {
      requirement_id: confirmation.requirement_id,
      chain_receipt_id: confirmation.chain_receipt_id,
    });
  } else if (confirmation.kind === "metered_usage_accepted") {
    await orders.markFulfilledButUnsettledOnceByChallengeHash(
      confirmation.challenge_hash,
      { requirement_id: confirmation.requirement_id },
    );
  } else {
    await orders.flagForPaymentStateReview(confirmation);
  }
}
```

For this 10-minute guide, keep the test order in the Standard band so the
expected successful branch is `standard_settled`.

## Done means

You are done with the quickstart when:

- the checkout session is created,
- the buyer reaches the Siglume wallet hosted checkout page,
- the signed webhook verifies against the raw body,
- `classifyDirectPaymentConfirmation(event)` returns `standard_settled`,
- your order is marked paid once, keyed by the stored `challenge_hash`.

Before production, complete the full checklist in
[Merchant Quickstart](./merchant-quickstart.md#go-live-checklist), read
[Payment lifecycle](./payment-lifecycle.md), and prepare the failure handling in
[Troubleshooting](./troubleshooting.md).
