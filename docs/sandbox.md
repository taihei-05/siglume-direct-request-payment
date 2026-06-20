# SDRP Sandbox

Use the SDK sandbox after your local checkout and webhook routes are mounted,
and before live Siglume credentials. It is a local
Siglume-compatible API server for product integration testing. It creates fake
checkout sessions, signs `direct_payment.confirmed` webhooks, records delivery
status, and never charges a wallet.

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
  -d "{\"order_id\":\"order_123\"}"
```

Open the returned `checkout_url` and click the sandbox confirm button. Your
product should receive a signed webhook and mark the Standard order paid once.
If the confirm button or confirm endpoint is called again for the same sandbox
session, the sandbox returns the original confirmation result and does not send
another webhook. The sandbox checkout page follows the returned `redirect_url`
after a successful confirmation so your return page is exercised too.

The sandbox rejects invalid checkout input early: `amount_minor` must be a
positive integer, `currency` must be `JPY` or `USD`, and return URLs must be
HTTPS or local HTTP URLs.

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
- run the same checkout path and confirm a sandbox webhook,
- switch to live `SIGLUME_MERCHANT_AUTH_TOKEN`, `SIGLUME_DIRECT_PAYMENT_MERCHANT`, `SHOP_PUBLIC_ORIGIN`, `SHOP_WEBHOOK_URL`, and `SIGLUME_WEBHOOK_SECRET`,
- run `npx siglume-check verify` without `--sandbox`,
- confirm the live webhook subscription and signing secret are for the live product URL.
