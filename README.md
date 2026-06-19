# @siglume/direct-request-payment

[![npm version](https://img.shields.io/npm/v/@siglume/direct-request-payment.svg)](https://www.npmjs.com/package/@siglume/direct-request-payment)
[![PyPI version](https://img.shields.io/pypi/v/siglume-direct-request-payment.svg)](https://pypi.org/project/siglume-direct-request-payment/)

## Protocol Overview

Siglume Direct Request Payment (SDRP) is a wallet payment protocol for products
that want to accept Siglume wallet payments. The merchant fixes the order,
amount, and currency on its server; the buyer pays with a Siglume wallet;
Siglume applies the correct pricing and settlement path from the payment amount.

Use this package when an external EC site, booking service, membership service,
or paid API wants to accept Siglume wallet payments without taking custody of
customer funds. The SDK creates and verifies one-time and recurring wallet
payments; it does not hold customer funds or wallets.

Payment requirement creation must run in the authenticated buyer's Siglume
context. Your merchant server must not use a merchant secret or API key to
charge a customer wallet. The merchant server creates the signed challenge; the
buyer-facing Siglume payment flow creates and pays the requirement.

`DirectRequestPaymentMerchantClient` requires the merchant's Siglume bearer
token for setup. `DirectRequestPaymentClient` requires the buyer's Siglume
bearer token for payment requirements. Do not use a Developer Portal `cli_` API
key with this package.

## Two Kinds of Buyer

SDRP serves two kinds of buyer, and you integrate each differently. In both
cases the buyer pays from a **Siglume wallet** (JPYC for JPY, USDC for USD) — it
is **not** a card payment — and your **merchant SDK never authenticates the
buyer**.

1. **Human web shopper → Hosted Checkout (Beta; server rollout in progress).** When a person clicks "Pay with
   Siglume" on your site, call
   [`createCheckoutSession(...)`](#hosted-checkout-human-web-shoppers) and
   redirect them to the returned `checkout_url`. They sign into Siglume (passkey
   or email code — the login *is* the wallet), review the amount, approve once,
   and pay from their own wallet, then return to your `success_url`. This is the
   Stripe-Checkout-equivalent path.

2. **AI agent / agent-to-agent (AtoA) → direct API / tools.** An autonomous
   buyer agent pays through `DirectRequestPaymentClient` (your app holds the
   buyer's Siglume JWT) or through the Siglume marketplace tool
   `market_confirm_direct_payment_and_execute` (MCP).

   **Prerequisite (important):** agent payment assumes the buyer agent is
   **already connected to Siglume before the payment**. An AI client
   (Claude / ChatGPT / Cursor, …) connects through the **Siglume MCP server
   (OAuth authorization, with a consent screen)**; a custom app holds the
   buyer's **Siglume bearer token (JWT)**. Either way a Siglume authentication
   context must be established before paying — the merchant SDK does not log the
   buyer in. Unattended runs are bounded by Siglume's **approval gates / spending
   budgets** (per-run / daily / monthly auto-pay budgets, or Works approval), not
   by the merchant.

Honest framing: the part that integrates quickly is the **merchant plumbing**
(challenge or checkout session + webhook). Human web payment still requires the
shopper to have — or create — a Siglume wallet and pay from it; it is not a
card-style "instant" checkout for first-time buyers.

## Hosted Checkout (Human Web Shoppers)

**Beta / server rollout:** Hosted Checkout is rolling out account by account.
Some merchant accounts may not have the server endpoint enabled yet. In that
case `createCheckoutSession(...)` / `getCheckoutSession(...)` raises
`HostedCheckoutNotAvailableError` instead of exposing the raw rollout 404/409.
Keep fulfilling only from the signed `direct_payment.confirmed` webhook.

Hosted Checkout is a Siglume-hosted page that turns a "Pay with Siglume" button
into a completed wallet payment, then returns the shopper to your store. It
orchestrates the same rails as the agent flow — there is no new money movement
and the merchant fulfills on the same `direct_payment.confirmed` webhook.

```ts
import { DirectRequestPaymentMerchantClient } from "@siglume/direct-request-payment";

const merchant = new DirectRequestPaymentMerchantClient({ auth_token: process.env.SIGLUME_MERCHANT_AUTH_TOKEN });

// 1. Register the return-URL origins once (open-redirect defense). The origin of
//    your webhook_callback_url is auto-allowed in addition to these.
await merchant.setupMerchant({
  merchant: "your_merchant_key",
  webhook_callback_url: "https://api.your-shop.com/webhooks/siglume",
  checkout_allowed_origins: ["https://www.your-shop.com"],
});

// 2. Per order: create a session and redirect the shopper to checkout_url.
const session = await merchant.createCheckoutSession({
  merchant: "your_merchant_key",
  amount_minor: 1200,           // server-fixed; the browser cannot change it
  currency: "JPY",
  nonce: order.id,              // unique per order
  success_url: "https://www.your-shop.com/thanks",
  cancel_url: "https://www.your-shop.com/cart",
  metadata: { order_id: order.id },
});
redirect(session.checkout_url); // -> https://siglume.com/pay/<session_id>

// 3. Fulfill when the signed direct_payment.confirmed webhook arrives (the
//    source of truth). Poll merchant.getCheckoutSession(session.session_id) if
//    you also want to show status in your own UI.
```

```py
import os

from siglume_direct_request_payment import DirectRequestPaymentMerchantClient

merchant = DirectRequestPaymentMerchantClient(auth_token=os.environ["SIGLUME_MERCHANT_AUTH_TOKEN"])

# 1. Register the return-URL origins once (open-redirect defense). The origin of
#    your webhook_callback_url is auto-allowed in addition to these.
merchant.setup_merchant(
    merchant="your_merchant_key",
    webhook_callback_url="https://api.your-shop.com/webhooks/siglume",
    checkout_allowed_origins=["https://www.your-shop.com"],
)

# 2. Per order: create a session and redirect the shopper to checkout_url.
session = merchant.create_checkout_session(
    merchant="your_merchant_key",
    amount_minor=1200,           # server-fixed; the browser cannot change it
    currency="JPY",
    nonce=order["id"],           # unique per order
    success_url="https://www.your-shop.com/thanks",
    cancel_url="https://www.your-shop.com/cart",
    metadata={"order_id": order["id"]},
)
redirect(session["checkout_url"])  # -> https://siglume.com/pay/<session_id>

# 3. Fulfill when the signed direct_payment.confirmed webhook arrives (the
#    source of truth). Poll merchant.get_checkout_session(session["session_id"])
#    if you also want to show status in your own UI.
```

Siglume fixes the amount, currency, challenge, and return URLs **server-side** at
session creation, so the browser cannot tamper with the price or the redirect
target. The shopper's Siglume credentials are never shared with your store.

**Who does what.**

- **Merchant** — confirms the order; signs the challenge (agent flow) or creates
  a checkout session (web flow); verifies the webhook signature; fulfills
  idempotently. Never sees the buyer's Siglume credentials.
- **Siglume** — provides the wallet and login, executes the wallet payment,
  applies the fee, settles on-chain, and routes Micro / Nano automatically by
  amount band.
- **Buyer** — needs a Siglume wallet funded in **JPYC / USDC**. **Not a card
  payment.**

**Optional status poll.** The webhook is the source of truth for fulfillment, but
you can read a session's status (`open` / `authenticated` / `paid` / `expired` /
`cancelled` / `failed`) to drive your own UI:

```ts
const status = (await merchant.getCheckoutSession(session.session_id)).status;
```

```py
status = merchant.get_checkout_session(session["session_id"])["status"]
```

## Amount-Based Pricing and Settlement

Pricing has one structure: you choose a **Standard Payment** plan once during
setup, and after that the applied fee and the settlement timing follow the
**payment amount** automatically. There is nothing else to choose.

- **Standard Payment** — most payments. Your selected plan's percentage fee,
  settled on-chain immediately after each payment confirms.
- **Micro Payment** — small payments, applied automatically by amount. A flat
  per-transaction protocol fee, **settled weekly**.
- **Nano Payment** — very small payments, applied automatically by amount. A
  flat per-usage protocol fee, **settled monthly**.

Micro Payment and Nano Payment are not separate products you opt into; they are
amount bands Siglume applies on your behalf. Your integration code is the same
regardless of which band a payment falls into. The full fee table and the exact
weekly / monthly settlement schedule are in [docs/pricing.md](./docs/pricing.md).
Provider revenue in the Micro and Nano bands is not settled revenue until the
weekly or monthly on-chain settlement succeeds. Siglume keeps outstanding failed
settlements for retry under the published policy, but does not advance or
guarantee provider revenue before settlement succeeds.
Micro / Nano budget checks reserve spending capacity only; they do not lock,
escrow, or guarantee the buyer's wallet balance, allowance, or settlement funds.
Sub-minor-unit Nano fees are accumulated with decimal precision and rounded only
when a settlement batch is created; see [Pricing](./docs/pricing.md) for the
rounding formula and `rounding_delta_minor` semantics.
For operational reconciliation, expected revenue, settled revenue, retry state,
and CSV exports, see
[docs/metered-statements.md](./docs/metered-statements.md).

## What This SDK Covers

- merchant self-service setup with a Siglume merchant JWT
- challenge secret creation and rotation
- merchant billing mandate preparation
- webhook subscription creation
- merchant-signed payment challenges
- buyer-authenticated payment requirement creation
- prepared wallet transaction execution payloads
- payment requirement verification
- authenticated TypeScript JSON requests to Micro / Nano statement APIs
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

## Pricing

Pricing has one structure: choose a Standard Payment plan, then Siglume applies
the fee for each payment by amount. Micro / Nano are automatic amount bands, not
extra setup choices.

Both launch settlement currencies are first-class: JPY settled in JPYC, and USD
settled in USDC. A merchant settles in one currency, chosen at onboarding. The
settlement fee percentage is identical in both currencies; only the flat
amounts differ.

| Payment amount | Applied automatically | What you select | Fee | Settlement |
| --- | --- | --- | --- | --- |
| Over JPY 500 / over USD 3.00 | Standard Payment | Select one Standard plan: Launch, Starter, Growth, or Pro | Launch: JPY 0 / USD 0 monthly, 1.8%; Starter: JPY 980 / USD 6 monthly, 1.0%; Growth: JPY 2,980 / USD 18 monthly, 0.7%; Pro: JPY 9,800 / USD 60 monthly, 0.5%. Minimum JPY 30 / USD 0.20 per payment. | Settled on-chain immediately after the payment confirms |
| JPY 50-500 / over USD 0.30 and up to USD 3.00 | Micro Payment | Applied automatically by amount | USD 0.01 / Tx, about JPY 2 | Weekly settlement - see [Settlement schedule](./docs/pricing.md#settlement-schedule) |
| Under JPY 50 / up to USD 0.30 | Nano Payment | Applied automatically by amount | USD 0.001 / usage, about JPY 0.2 | Monthly settlement - see [Settlement schedule](./docs/pricing.md#settlement-schedule) |

A merchant billing mandate is required before accepting payments, even on the
Launch plan. The current public API does not expose a flag that forces a
JPY 500-and-under / USD 3-and-under payment into Standard immediate settlement.
If immediate on-chain settlement is a hard requirement, price the item in the
Standard band or confirm a merchant-specific contract with Siglume before
launch. For Standard Payment, `fee_bps` returned on a payment requirement is the
authoritative fee rate for that payment in the merchant's settlement currency.
For Micro / Nano, the statement APIs expose `protocol_fee_minor`,
`gross_buyer_debit_minor`, `buyer_debit_minor`, and `rounding_delta_minor`.
The full fee table and the weekly / monthly settlement schedule live in
[docs/pricing.md](./docs/pricing.md). Statement APIs for "how much was used,
when will it close, when can it debit, and what is settled" are documented in
[docs/metered-statements.md](./docs/metered-statements.md).

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

// setup.env holds the merchant key plus the challenge and webhook secrets:
//   SIGLUME_DIRECT_PAYMENT_MERCHANT       (not secret)
//   SIGLUME_DIRECT_PAYMENT_CHALLENGE_SECRET  (secret)
//   SIGLUME_WEBHOOK_SECRET                   (secret)
// Write these to your server-side secret store. Do NOT log the secret values.
console.log(`Configured merchant: ${setup.env.SIGLUME_DIRECT_PAYMENT_MERCHANT}`);
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

# setup["env"] holds the merchant key plus the challenge and webhook secrets.
# Persist them to your server-side secret store; do not log the secret values.
print("Configured merchant:", setup["env"]["SIGLUME_DIRECT_PAYMENT_MERCHANT"])
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

## Recurring Payments: Subscription and Scheduled Autopay

Beyond one-time checkout, a buyer can authorize recurring payments. The merchant
approves the price and recurring product tag ONCE by signing a recurring
challenge (a distinct scheme, so one-time challenges and recurring approvals can
never be replayed as each other); after that, recurring charges are
challenge-free by design. Subscriptions are bounded by the buyer's mandate;
scheduled autopay is bounded by the buyer's per-run, daily, and monthly
auto-pay budget.

- **Subscription** (`cadence: "monthly"`): Siglume charges the buyer's wallet
  monthly and pays your merchant wallet automatically. First month is charged at
  setup. The buyer can cancel from their Siglume wallet at any time.
- **Scheduled autopay** (`cadence: "daily"`): `daily` is the approval tag for
  merchant-triggered scheduled autopay, not a run-count limiter. The
  buyer authorizes the per-run amount and budget envelope, then hands you a
  `schedule_token`; YOUR scheduler triggers each occurrence with that token.

```ts
import { createDirectRequestPaymentRecurringChallenge } from "@siglume/direct-request-payment";

// Merchant server: approve a JPY 980 monthly subscription once.
const recurring = await createDirectRequestPaymentRecurringChallenge({
  merchant: "example_merchant",
  amount_minor: 980,
  currency: "JPY",
  cadence: "monthly",
  secret: process.env.SIGLUME_DIRECT_PAYMENT_CHALLENGE_SECRET!,
  nonce: "subscription_setup_4711",
});

// Hand recurring.challenge to the buyer-facing page. The buyer creates the
// subscription with their Siglume token:
//   POST /v1/sdrp/direct-payments/subscriptions
//   { merchant, amount_minor, currency, cadence: "monthly", challenge }
// For scheduled autopay, the buyer instead creates a scheduled auto-pay
// authorization and hands you the schedule_token; your scheduler triggers
// each occurrence with that token.
```

```py
import os

from siglume_direct_request_payment import create_direct_request_payment_recurring_challenge

# Merchant server: approve a JPY 980 monthly subscription once.
recurring = create_direct_request_payment_recurring_challenge(
    merchant="example_merchant",
    amount_minor=980,
    currency="JPY",
    cadence="monthly",
    secret=os.environ["SIGLUME_DIRECT_PAYMENT_CHALLENGE_SECRET"],
    nonce="subscription_setup_4711",
)

# Hand recurring["challenge"] to the buyer-facing page, as in the TS example.
print(recurring["challenge"])
```

Each recurring challenge is single-use: it authorizes exactly one subscription
or schedule, bound to the first buyer who redeems it. Issue a fresh challenge
per setup. The platform fee on recurring charges is your plan's payment fee
(with the per-payment minimum), frozen at setup.

Merchant-facing webhook events: `subscription.created`, `subscription.renewed`
(each monthly charge), `payment.failed` (renewal failure, with `will_retry` /
`final_failure` flags), `subscription.cancelled`, and — for each scheduled
autopay occurrence — the usual `direct_payment.confirmed`.

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

New `direct_payment.confirmed` payloads include `pricing_band`,
`settlement_cadence`, `finality`, `protocol_fee_minor`, `settlement_status`, and
when available `request_hash_v2`. Use these machine fields instead of inferring
settlement semantics from the event name alone.

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
- Treat `fee_bps` returned by Siglume as the Standard Payment runtime fee source
  of truth; use statement API amount fields for Micro / Nano.

## Compatibility Notes

- The Direct Request Payment HTTP endpoints live under
  `/v1/sdrp/direct-payments/...`; the SDK targets them for you.
- For wire compatibility the platform still tags these payments with the legacy
  mode value `external_402`, and the merchant registry may still expose the
  legacy billing-plan key `free` for the Launch tier. The SDK sets and reads
  these values for you — treat them as compatibility identifiers, not public
  product names.

## Documentation

- [Merchant quickstart](./docs/merchant-quickstart.md)
- [API reference](./docs/api-reference.md)
- [Pricing](./docs/pricing.md)
- [Micro / Nano statements and notices](./docs/metered-statements.md)
- [Security guide](./docs/security.md)
- [Merchant setup example](./examples/setup-merchant.ts)
- [Express checkout example](./examples/express-checkout.ts)
- [Japanese launch announcement draft](./docs/announcement-ja.md)
- [Changelog](./CHANGELOG.md)

## License

MIT
