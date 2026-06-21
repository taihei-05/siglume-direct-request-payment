# SDRP Sandbox

Use the SDK sandbox after your local checkout and webhook routes are mounted,
and before live Siglume credentials. It is a local
Siglume-compatible API server for product integration testing. It creates fake
checkout sessions, signs `direct_payment.confirmed` webhooks, records delivery
status, and never charges a wallet.

If you are starting from a new integration, complete the 10-minute guide through
Step 7 first. In particular, create the SDRP storage resources, seed a
Standard-band test order owned by your product test user, and configure
`authorize_order`. The checkout examples below assume an order such as
`order_sdrp_sandbox_001` exists and that your product accepts
`authorization: Bearer <product-test-user-token>` for that order owner.

Start your product locally first, then run:

```bash
npx siglume-sdrp sandbox \
  --origin http://localhost:3000 \
  --webhook-url http://localhost:3000/payments/webhooks/siglume
```

Set the printed environment variables in your product:

```bash
SIGLUME_ENV=sandbox
SIGLUME_API_BASE=http://127.0.0.1:8787/v1
SIGLUME_MERCHANT_AUTH_TOKEN=sandbox_merchant_token
SIGLUME_DIRECT_PAYMENT_MERCHANT=sandbox_merchant
SHOP_PUBLIC_ORIGIN=http://localhost:3000
SHOP_WEBHOOK_URL=http://localhost:3000/payments/webhooks/siglume
SIGLUME_WEBHOOK_SECRET=whsec_sandbox_local
```

Then verify the integration:

```bash
npx siglume-check verify --sandbox
```

Create a checkout through your own product route:

```bash
curl -X POST http://localhost:3000/payments/checkout/siglume/start \
  -H "content-type: application/json" \
  -H "authorization: Bearer <product-test-user-token>" \
  -d "{\"order_id\":\"order_sdrp_sandbox_001\"}"
```

Open the returned `checkout_url` and click the sandbox confirm button. Your
product should receive a signed webhook and mark the Standard order paid once.
If the confirm button or confirm endpoint is called again for the same sandbox
session, the sandbox returns the original confirmation result and does not send
another webhook. The sandbox checkout page follows the returned `redirect_url`
after a successful confirmation so your return page is exercised too.

To test merchant webhook idempotency, redeliver the exact same signed event ID
after the first confirmation:

```bash
curl -X POST http://127.0.0.1:8787/v1/sandbox/checkout-sessions/<session_id>/redeliver
```

The sandbox sends the original `direct_payment.confirmed` payload again with a
fresh HMAC header. Your product should keep the order paid once and keep one
processed row for that webhook event ID. A successful redelivery returns
`delivery_status: "delivered"` and the product's HTTP `response_status`.
If the product webhook is unreachable or returns non-2xx, `/redeliver` returns
HTTP 502 with `delivery_status: "failed"` so the failure is visible in scripts.

The sandbox rejects invalid checkout input early: `amount_minor` must be a
positive integer, `currency` must be `JPY` or `USD`, and return URLs must be
HTTPS or local HTTP URLs.

## What the sandbox does and does not simulate

| Area | Simulated locally | Not simulated locally |
| --- | --- | --- |
| Standard Checkout | Checkout session creation, hosted confirmation page, signed `direct_payment.confirmed` webhook, duplicate confirm idempotency | Real Siglume login, real wallet debit, Polygon transaction finality |
| Webhooks | HMAC signatures, delivery recording, `verify --sandbox` delivery probe, same-event redelivery through `/redeliver` | Public network reachability, live subscription routing, live retry schedules |
| Micro / Nano accounting | Pricing-band classification and seller-borne accounting fields in webhook and summary responses | BudgetVault enforcement, notice period workers, retrying / past_due / write-off transitions, actual payout |
| Statements | Local summary shape for provider and buyer metered views | Live settlement batches, on-chain receipts, refund or adjustment execution |
| Access control | Local merchant/origin checks | Live Hosted Checkout account enablement and Siglume support workflows |

Sandbox Micro / Nano behavior follows the same public classifications:

- JPY 501+ / USD 3.01+ returns `standard_settled`.
- JPY 50-500 / USD 0.31-3.00 returns `metered_usage_accepted` with weekly Micro settlement fields.
- JPY 1-49 / USD 0.01-0.30 returns `metered_usage_accepted` with monthly Nano settlement fields.

For Micro / Nano sandbox sessions, the signed webhook and metered summary
endpoints include seller-borne accounting fields:

- `buyer_debit_minor = provider_gross_amount_minor`
- `protocol_fee_minor` is the Micro / Nano fixed protocol fee
- `provider_receivable_minor = provider_gross_amount_minor - protocol_fee_minor`
- `settlement_threshold_minor = 10000` for JPY 10,000 or USD 100.00 fixed-market thresholds

You can inspect the sandbox statement shape through the same SDK clients or raw
API paths:

```bash
curl "http://127.0.0.1:8787/v1/sdrp/metered/provider/summary?plan_type=micro&token_symbol=JPYC"
curl "http://127.0.0.1:8787/v1/sdrp/metered/my-summary?plan_type=nano&token_symbol=USDC"
```

The generated route defaults to Standard-only, so Micro / Nano checkout returns
`METERED_INTEGRATION_REQUIRED` until you explicitly enable metered handling.

Before live launch:

- run `npx siglume-check verify --sandbox` against the local product,
- run the same checkout path, confirm a sandbox webhook, and redeliver the same
  event ID once,
- switch to live `SIGLUME_MERCHANT_AUTH_TOKEN`, `SIGLUME_DIRECT_PAYMENT_MERCHANT`, `SHOP_PUBLIC_ORIGIN`, `SHOP_WEBHOOK_URL`, and `SIGLUME_WEBHOOK_SECRET`,
- run `npx siglume-check verify` without `--sandbox`,
- confirm the live webhook subscription and signing secret are for the live product URL.
