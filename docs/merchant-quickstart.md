# Merchant Quickstart

This guide shows the manual Siglume Direct Request Payment API flow for an
external merchant.

For the shortest existing-product integration path, use
[10-Minute Standard Checkout Integration](./quickstart-10-minutes.md). That guide copies
checkout and webhook routes into an Express or FastAPI product, runs preflight
before route mounting, and verifies Hosted Checkout plus webhook delivery after
the routes are live. This merchant quickstart is broader and includes the
agent/API path plus Micro / Nano reconciliation notes.

## Actors

- Merchant server: owns the order, amount, currency, challenge secret, webhook
  endpoint, and order fulfillment.
- Buyer: owns the Siglume wallet that pays the on-chain payment transaction.
- Siglume: creates the payment requirement, prepares the wallet transaction,
  verifies the receipt, and emits signed webhooks.

The merchant server must not create charges with a customer wallet. It signs the
order challenge; the buyer-facing Siglume payment flow pays it.

**Current public beta scope.** SDRP currently settles JPYC / USDC on **Polygon
PoS only**. The public SDK does not expose chain selection, cross-chain payment,
multiple merchant settlement wallets, per-payment settlement-wallet override, or
split / multi-wallet charging. Route each payment through the buyer's Siglume
wallet and the merchant account's configured Siglume settlement wallet.

This quickstart uses Standard-band example amounts. Micro Payment and Nano
Payment are applied automatically by amount through the same Hosted Checkout or
agent/API flow; you do not create a separate Micro/Nano object or manually
select the amount band. Micro/Nano are settled on account-assigned weekly /
monthly slots, or earlier when the same buyer / provider / token / pricing band
reaches the fixed market threshold, after the final notice and
close-plus-3-day window (see [Pricing](./pricing.md#settlement-schedule)), and
provider revenue remains unsettled until the later on-chain settlement succeeds.
Completing merchant
setup and the billing mandate means accepting this Micro/Nano delayed aggregated
settlement model for low-price items. If your product requires immediate
on-chain settlement, keep its price above the Micro/Nano thresholds instead of
offering JPY 500-and-under or USD 3-and-under amounts.
The setup response records this acceptance at
`merchant.merchant_account.metadata_jsonb.metered_risk_acceptance` with a
`terms_version`, `accepted_at`, `principal_user_id`, `receipt_id`, and fixed
market thresholds `JPY: 10000` / `USD: 10000`.

## Two Buyer Systems

There are two ways a buyer reaches you, and you integrate each differently:

- **Human web shopper → Hosted Checkout (Beta; server rollout in progress).** Create a checkout session and
  redirect the shopper to the Siglume-hosted page (the
  [section below](#hosted-checkout-human-web-shoppers)). This is the Siglume
  wallet hosted checkout path for human web shoppers.
- **AI agent / agent-to-agent (AtoA) → direct API / tools.** An autonomous
  buyer pays through `DirectRequestPaymentClient` or the marketplace tool
  `market_confirm_direct_payment_and_execute`, as in sections 2-4 below.

In both cases the buyer pays from a Siglume wallet (JPYC / USDC, not a card),
the merchant SDK never authenticates the buyer, and you fulfill on the same
`direct_payment.confirmed` webhook.

## Hosted Checkout (Human Web Shoppers)

**Beta / server rollout:** Hosted Checkout is rolling out account by account.
Some merchant accounts may not have the server endpoint enabled yet. The SDK
raises `HostedCheckoutNotAvailableError` for rollout 404/409 responses.
Run `siglume-check preflight` before mounting routes, then run
`siglume-check verify` after the webhook route is live; see
[Hosted Checkout readiness](./troubleshooting.md#hosted-checkout-readiness).
If the account is not enabled, do not continue with a human web checkout until
Siglume enables it for that merchant account.

When a person clicks "Pay with Siglume" on your site, create a session and
redirect them to the returned `checkout_url`. They sign into Siglume on the
hosted page, approve, and pay from their own wallet, then return to your
`success_url`. Siglume fixes the amount, currency, challenge, and return URLs
server-side, so the browser cannot tamper with the price or the redirect target.

Register your return-URL origins once (open-redirect defense). The origin of
your `webhook_callback_url` is auto-allowed in addition to these.

The code below demonstrates the Hosted Checkout API shape. It is not the
minimum production-safe order-store flow by itself, because a process crash
after session creation but before your database write can lose the
session/challenge mapping. Production products should use the generated
checkout route and official database adapter from
[10-Minute Standard Checkout Integration](./quickstart-10-minutes.md), or
implement the same durable checkout-attempt pattern: claim one active attempt,
reuse a stable nonce for retries, create the Hosted Checkout session, then
persist `challenge_hash`, `checkout_session_id`, and `checkout_url` before
redirecting.

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
  amount_minor: 1200,           // server-fixed; the browser cannot change it
  currency: "JPY",
  nonce: `${order.id}-attempt_${paymentAttempt.number}`,
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
    amount_minor=1200,           # server-fixed; the browser cannot change it
    currency="JPY",
    nonce=f"{order['id']}-attempt_{payment_attempt['number']}",
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
Reuse the same nonce for network retries of the same logical attempt. Create a
new attempt nonce only after the prior checkout or direct payment attempt
expired, was cancelled, or failed.

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

### Subscriptions and scheduled autopay (no SDK method)

The SDK signs the merchant-side recurring approval challenge
(`createDirectRequestPaymentRecurringChallenge` /
`create_direct_request_payment_recurring_challenge`), but there is **no SDK
method for subscription creation**. After you hand the buyer the recurring
challenge, the subscription itself is created over **raw HTTP** with the buyer's
Siglume bearer token:

```text
POST /v1/sdrp/direct-payments/subscriptions
{ merchant, amount_minor, currency, cadence: "monthly", challenge }
```

For scheduled autopay (`cadence: "daily"`), the buyer instead creates a scheduled
auto-pay authorization and hands you a `schedule_token`; your scheduler triggers
each occurrence with that token. Neither of these calls is wrapped by
`DirectRequestPaymentClient` today — the SDK's recurring surface is the challenge
signer and verifier only.

## 4. Fulfill from Webhook

Use the webhook as the durable signal, not just the browser return path.

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

if (event.type !== "direct_payment.confirmed") {
  return new Response(null, { status: 204 });
}

const confirmation = classifyDirectPaymentConfirmation(event);

if (confirmation.kind === "metered_batch_settled") {
  // Aggregated Micro/Nano settlement events do not carry an order challenge.
  await orders.reconcileMeteredSettlementOnce({
    settlement_batch_id: confirmation.settlement_batch_id,
    chain_receipt_id: confirmation.chain_receipt_id,
    usage_event_digest: confirmation.usage_event_digest,
    settled_at: confirmation.settled_at ?? null,
  });
  return new Response(null, { status: 204 });
}

if (confirmation.kind === "standard_settled") {
  const order = await orders.findByChallengeHash(confirmation.challenge_hash);
  if (!order) {
    await orders.flagForPaymentStateReview({
      reason: "unknown_challenge_hash",
      requirement_id: confirmation.requirement_id,
    });
    return new Response(null, { status: 204 });
  }
  await orders.markPaidOnce(order.id, {
    siglume_requirement_id: confirmation.requirement_id,
    chain_receipt_id: confirmation.chain_receipt_id,
  });
  return new Response(null, { status: 204 });
}

if (confirmation.kind === "metered_usage_accepted") {
  await orders.flagForPaymentStateReview({
    reason: "metered_integration_required",
    requirement_id: confirmation.requirement_id,
    pricing_band: confirmation.pricing_band,
  });
  return new Response(null, { status: 204 });
}

// Missing or unknown machine fields: do not mark the order paid from the event
// name alone. Fetch the requirement or route it to manual review.
await orders.flagForPaymentStateReview({
  reason: confirmation.reason,
  requirement_id: confirmation.requirement_id ?? "",
  settlement_batch_id: confirmation.settlement_batch_id ?? null,
});
return new Response(null, { status: 204 });
```

Python:

```py
import os

from siglume_direct_request_payment import (
    classify_direct_payment_confirmation,
    verify_direct_request_payment_webhook,
)

verified = verify_direct_request_payment_webhook(
    os.environ["SIGLUME_WEBHOOK_SECRET"],
    raw_request_body,
    siglume_signature_header,
)

if verified["event"]["type"] != "direct_payment.confirmed":
    return "", 204

confirmation = classify_direct_payment_confirmation(verified["event"])

if confirmation["kind"] == "metered_batch_settled":
    # Aggregated Micro/Nano settlement events do not carry an order challenge.
    orders.reconcile_metered_settlement_once(
        settlement_batch_id=confirmation["settlement_batch_id"],
        chain_receipt_id=confirmation["chain_receipt_id"],
        usage_event_digest=confirmation["usage_event_digest"],
        settled_at=confirmation.get("settled_at"),
    )
    return "", 204

if confirmation["kind"] == "standard_settled":
    order = orders.find_by_challenge_hash(confirmation["challenge_hash"])
    if not order:
        orders.flag_for_payment_state_review(
            reason="unknown_challenge_hash",
            requirement_id=confirmation["requirement_id"],
        )
        return "", 204
    orders.mark_paid_once(
        order["id"],
        siglume_requirement_id=confirmation["requirement_id"],
        chain_receipt_id=confirmation["chain_receipt_id"],
    )
    return "", 204

if confirmation["kind"] == "metered_usage_accepted":
    orders.flag_for_payment_state_review(
        reason="metered_integration_required",
        requirement_id=confirmation["requirement_id"],
        pricing_band=confirmation["pricing_band"],
    )
    return "", 204

# Missing or unknown machine fields: do not mark the order paid from the event
# name alone. Fetch the requirement or route it to manual review.
orders.flag_for_payment_state_review(
    reason=confirmation["reason"],
    requirement_id=confirmation.get("requirement_id") or "",
    settlement_batch_id=confirmation.get("settlement_batch_id"),
)
return "", 204
```

## Reconcile Micro / Nano Statements

Standard Payment can be marked paid from the verified `direct_payment.confirmed`
webhook only when `classifyDirectPaymentConfirmation(event)` returns
`standard_settled`, which requires Standard pricing, per-payment on-chain
finality, settled status, a challenge hash, a requirement id, and a chain
receipt id. Micro Payment and Nano Payment are different: they are automatic
amount bands and are settled later in aggregated on-chain batches. Use the
statement APIs to answer:

- how much Micro / Nano usage is open this week or month,
- when the buyer's assigned period closes,
- when Siglume may first attempt the debit (`not_before_attempt_at`),
- how much provider revenue is settled, unsettled, retrying, or past due.

Provider summary:

```ts
import { DirectRequestPaymentClient } from "@siglume/direct-request-payment";

const siglume = new DirectRequestPaymentClient({
  auth_token: providerSiglumeBearerToken,
});

const summary = await siglume.getProviderMeteredSummary({
  plan_type: "micro",
  token_symbol: "JPYC",
});

console.log(summary.totals.settled_provider_receivable_minor);
console.log(summary.totals.unsettled_provider_receivable_minor);
console.log(summary.totals.past_due_provider_receivable_minor);
```

Line-level CSV export:

```bash
curl https://siglume.com/v1/sdrp/metered/provider/settlement-batches/<batch-id>/usage-events.csv \
  -H "Authorization: Bearer <provider-siglume-bearer-token>" \
  -o sdrp-metered.csv
```

Python exposes the same named helper:

```py
from siglume_direct_request_payment import DirectRequestPaymentClient

siglume = DirectRequestPaymentClient(auth_token=provider_siglume_bearer_token)
summary = siglume.get_provider_metered_summary(plan_type="micro", token_symbol="JPYC")
```

Do not book Micro / Nano provider revenue as settled revenue until the batch is
`settled` and `chain_receipt_id` is present. See
[Micro / Nano Statements and Notices](./metered-statements.md) for the full
manual, including buyer past-due blocks and public failure fields.
For a compact state-machine view across Standard, Micro, and Nano, see
[Payment lifecycle](./payment-lifecycle.md).

## Failure Handling

For retry policy, buyer-safe copy, webhook signature failures, Hosted Checkout
readiness, and support escalation, see
[Troubleshooting](./troubleshooting.md). The short list below is only the common
payment-domain errors.

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
- `METERED_SETTLEMENT_PAST_DUE` (Micro / Nano only): a previous Micro / Nano
  metered settlement for this buyer is unresolved, so new Micro / Nano usage in
  the same buyer / provider / token / pricing band is paused until it settles.
  Siglume retries settlement
  automatically every 6 hours, up to 28 attempts, before it requires manual
  resolution. The provider's Micro / Nano revenue stays unsettled until the
  settlement succeeds. This is a settlement-side state, not a per-request
  challenge error.

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
- Micro / Nano accounting reads statement APIs or CSV and keeps settled,
  unsettled, and past-due revenue separate.
- Micro / Nano provider revenue is not recognized before on-chain settlement.
