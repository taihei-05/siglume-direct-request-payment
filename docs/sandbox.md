# SDRP Sandbox

Use the SDK sandbox before live Siglume credentials. It is a local
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
npx siglume-check readiness --sandbox
```

Create a checkout through your own product route:

```bash
curl -X POST http://localhost:3000/payments/checkout/siglume/start \
  -H "content-type: application/json" \
  -d "{\"order_id\":\"order_123\"}"
```

Open the returned `checkout_url` and click the sandbox confirm button. Your
product should receive a signed webhook and mark the Standard order paid once.

Sandbox Micro / Nano behavior follows the same public classifications:

- JPY 501+ / USD 3.01+ returns `standard_settled`.
- JPY 50-500 / USD 0.31-3.00 returns `metered_usage_accepted` with weekly Micro settlement fields.
- JPY 1-49 / USD 0.01-0.30 returns `metered_usage_accepted` with monthly Nano settlement fields.

The generated route defaults to Standard-only, so Micro / Nano checkout returns
`METERED_INTEGRATION_REQUIRED` until you explicitly enable metered handling.

Before live launch:

- run `npx siglume-check readiness --sandbox` against the local product,
- run the same checkout path and confirm a sandbox webhook,
- switch to live `SIGLUME_MERCHANT_AUTH_TOKEN`, `SIGLUME_DIRECT_PAYMENT_MERCHANT`, `SHOP_PUBLIC_ORIGIN`, `SHOP_WEBHOOK_URL`, and `SIGLUME_WEBHOOK_SECRET`,
- run `npx siglume-check readiness` without `--sandbox`,
- confirm the live webhook subscription and signing secret are for the live product URL.
