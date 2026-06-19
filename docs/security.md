# Security Guide

Direct Request Payment is a wallet payment rail. Treat it like payment
infrastructure, not like a generic API call.

## Do Not Expose Secrets

These values must stay server-side:

- `SIGLUME_DIRECT_PAYMENT_CHALLENGE_SECRET`
- `SIGLUME_WEBHOOK_SECRET`
- any merchant administrative credentials

The buyer-facing browser may receive the signed `challenge` string, but never
the secret that produced it.

## Keep JWT Roles Separate

Use the merchant's Siglume JWT only for setup actions such as `setupCheckout`,
challenge secret rotation, billing mandate preparation, and webhook subscription
creation.

Use the buyer's Siglume JWT only when creating and paying a payment requirement.
A merchant JWT or Developer Portal `cli_` key must not be used to charge a
customer wallet.

## Bind the Order Server-Side

The HMAC challenge covers:

```text
merchant:amount_minor:currency:nonce
```

Use a nonce derived from a durable order payment attempt, for example
`order_123-attempt_1`. The nonce must not contain `:` because the platform
challenge is encoded as `scheme:nonce:signature`. Store the returned
`challenge_hash` on the order. When a
webhook arrives, look up the order by `challenge_hash`.

Recurring approvals use a different challenge scheme and HMAC material:

```text
merchant:amount_minor:currency:cadence:nonce
```

`cadence="monthly"` is for subscriptions. `cadence="daily"` is the scheduled
autopay approval tag; it does not itself limit occurrences to once per day.
Scheduled autopay execution is bounded by the buyer-approved per-run, daily, and
monthly auto-pay budget.

## Hosted Checkout Return URLs

Hosted Checkout adds a return-URL origin allowlist as open-redirect defense.
Register your allowed origins once via `checkout_allowed_origins` on
`setupCheckout` / `setupMerchant`. A checkout session's `success_url` and
`cancel_url` must be on a registered origin; the origin of your
`webhook_callback_url` is auto-allowed in addition. Each entry must be an
absolute origin such as `https://shop.example.com`; entries are normalized to
bare, lowercased origins and deduped. A return URL that is not on an allowed
origin is rejected, so an attacker cannot point a session at an arbitrary
redirect target.

Production allowlist entries must use `https`. Development `http` entries are
accepted only for `http://localhost`, `http://127.0.0.1`, or `http://[::1]`
(with optional ports). Userinfo such as `https://user@shop.example.com` is
rejected so an attacker cannot rely on origin-spoofing URL forms.

For a Hosted Checkout session, Siglume authors the amount, currency, challenge,
and return URLs server-side at session creation. The browser cannot tamper with
the price or the redirect target, and the raw challenge is never exposed to the
browser or returned by `getCheckoutSession`.

## Do Not Trust Browser Amounts

The merchant server owns:

- SKU or plan
- amount in minor units
- currency
- nonce

If a browser says the order total is 1200 JPY, treat that as display state only.
Re-read the order server-side before generating the challenge.

## Webhook Verification

Verify the `Siglume-Signature` header using the raw request body. Do not parse
and re-stringify JSON before verification.

The SDK expects the Siglume signature format:

```text
t=<unix timestamp>,v1=<hex hmac sha256>
```

The signed payload is:

```text
<timestamp>.<raw body>
```

The default tolerance is 300 seconds.

Use verified webhook data as the durable completion signal. Browser redirects,
client-side callbacks, or local transaction responses can improve UX, but they
should not be the only source used to fulfill an order.

## Idempotency

Fulfill exactly once per order. Store at least:

- order id
- challenge hash
- Siglume requirement id
- on-chain receipt id or transaction hash if present
- fulfillment state

Duplicate webhook deliveries and manual redelivery can occur. A duplicate
webhook with the same requirement id must not ship the order twice.

## Micro / Nano Statement Privacy

Micro Payment and Nano Payment introduce operational statement APIs and CSV
exports because revenue is settled later in aggregated on-chain batches.

Provider-facing statement APIs intentionally do not expose raw `buyer_user_id`,
buyer email, buyer wallet address, relayer id, nonce, gas data, raw RPC errors,
or raw platform failure messages. Use `buyer_period_ref` for provider-side
reconciliation within a statement period, and show only the sanitized public
failure fields:

- `failure_reason_code`
- `failure_reason_label`
- `failure_reason_help`
- `support_reference`

Buyer-facing APIs may include past-due block reasons and balance / allowance /
BudgetVault sufficiency indicators for the buyer's own account. Do not forward
those buyer-account details to providers.

Webhooks remain required for fulfillment, but webhooks alone are not a complete
Micro / Nano revenue ledger. Use the statement APIs or CSV in
[Micro / Nano Statements and Notices](./metered-statements.md) to separate
settled, unsettled, and past-due provider amounts.

## What Direct Request Payment Is Not

Direct Request Payment is not:

- stored value
- prepaid points
- escrow
- a platform balance
- a card payment fallback

Each payment is an individual wallet payment backed by an on-chain receipt. Small
payments in the Micro and Nano amount bands are aggregated and settled on
account-assigned weekly / monthly slots instead of one transaction at a time
(see the [pricing guide](./pricing.md#settlement-schedule)), but they are still
wallet payments, not a stored balance. Before a small payment is fulfilled,
Siglume checks the buyer's wallet budget and fails closed when it is invalid, so
a rejected request is never charged. Provider revenue for Micro and Nano remains
unsettled until the aggregated on-chain settlement succeeds; Siglume does not
advance or guarantee revenue when a buyer's balance, allowance, BudgetVault
authorization, cap, or on-chain transaction fails.

A Micro / Nano budget reservation is not a token lock, escrow, or payment
guarantee. It reserves room against Siglume spending limits only. A later
settlement can still fail if the buyer no longer has sufficient balance,
allowance, BudgetVault authorization, or cap room; `past_due` records the issue
but does not guarantee eventual collection or provider payment.
