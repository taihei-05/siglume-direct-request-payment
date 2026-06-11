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

## Idempotency

Fulfill exactly once per order. Store at least:

- order id
- challenge hash
- Siglume requirement id
- on-chain receipt id or transaction hash if present
- fulfillment state

Duplicate webhook deliveries and manual redelivery can occur. A duplicate
webhook with the same requirement id must not ship the order twice.

## What Direct Request Payment Is Not

Direct Request Payment is not:

- stored value
- prepaid points
- escrow
- a platform balance
- a card payment fallback

It is a one-request wallet payment gate backed by an on-chain receipt.
