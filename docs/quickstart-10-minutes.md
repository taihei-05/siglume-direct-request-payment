# 10-Minute Product Integration

This guide is the supported 10-minute path for adding SDRP Hosted Checkout to
an existing product. The goal is to
add two routes to your own server:

- `POST /payments/checkout/siglume/start`
- `POST /payments/webhooks/siglume`

The SDK supplies the readiness check, route files, webhook verification, payment
classification, and the order-store adapter contract. Your app supplies the
real order lookup and fulfillment writes.

## 0. Run the sandbox first

Do this before touching live Siglume credentials. The local sandbox is a tiny
Siglume-compatible API server bundled with the SDK. It creates fake checkout
sessions, signs webhooks with your sandbox secret, records delivery status, and
never charges a wallet.

In one terminal, point it at your product's local webhook route:

```bash
npx siglume-sdrp sandbox \
  --origin http://localhost:3000 \
  --webhook-url http://localhost:3000/payments/webhooks/siglume
```

Use the values it prints in your product `.env`:

```bash
SIGLUME_ENV=sandbox
SIGLUME_API_BASE=http://127.0.0.1:8787/v1
SIGLUME_MERCHANT_AUTH_TOKEN=sandbox_merchant_token
SIGLUME_DIRECT_PAYMENT_MERCHANT=sandbox_merchant
SHOP_PUBLIC_ORIGIN=http://localhost:3000
SHOP_WEBHOOK_URL=http://localhost:3000/payments/webhooks/siglume
SIGLUME_WEBHOOK_SECRET=whsec_sandbox_local
```

Then run:

```bash
npx siglume-check readiness --sandbox
```

The sandbox readiness check proves your local server can receive a signed
`direct_payment.confirmed` delivery before you use live credentials.

## 1. Live readiness

Install the SDK in your product.

Node / Express:

```bash
npm install @siglume/direct-request-payment
```

Python / FastAPI:

```bash
pip install siglume-direct-request-payment
```

Set these environment variables in your app or `.env`:

```bash
SIGLUME_MERCHANT_AUTH_TOKEN=<merchant Siglume bearer token>
SIGLUME_DIRECT_PAYMENT_MERCHANT=<merchant key>
SHOP_PUBLIC_ORIGIN=https://www.your-product.example
SHOP_WEBHOOK_URL=https://api.your-product.example/payments/webhooks/siglume
SIGLUME_WEBHOOK_SECRET=<webhook signing secret from setupCheckout/setup_checkout>
```

Then run the matching CLI:

```bash
# Node / Express
npx siglume-check readiness

# Python / FastAPI
siglume-check readiness
```

The readiness check fails before you write checkout code if any required item is
missing. It checks local config, reads the merchant account, requires active
billing, confirms the webhook subscription points to `SHOP_WEBHOOK_URL`, checks
that `direct_payment.confirmed` is subscribed, verifies the local webhook secret
against the subscription hint, creates one unpaid expiring Hosted Checkout probe
session, and queues a signed webhook test delivery. No buyer is charged.

For a CI local-config smoke test:

```bash
npx siglume-check readiness --no-api --json
```

`--no-api` does not prove Hosted Checkout or webhook delivery. Before opening a
human web checkout path, run readiness without `--no-api` and fix every FAIL
item.

## 2. Copy integration files into your product

For Express:

```bash
npx siglume-sdrp init express --target src/siglume
```

For FastAPI:

```bash
siglume-sdrp init fastapi --target app/siglume
```

These commands copy framework-specific route files into your codebase. The
generated files are intentionally small and are meant to be edited.

## 3. Mount the routes

Express:

```ts
import express from "express";
import {
  createSiglumeSdrpCheckoutRouter,
  createSiglumeSdrpWebhookHandler,
  type SiglumeSdrpRouterOptions,
} from "./siglume/siglume-sdrp-routes.js";
import { siglumeOrderStore } from "./siglume/siglume-order-store.example.js";

const siglumeOptions: SiglumeSdrpRouterOptions = {
  merchant: process.env.SIGLUME_DIRECT_PAYMENT_MERCHANT!,
  merchant_auth_token: process.env.SIGLUME_MERCHANT_AUTH_TOKEN!,
  webhook_secret: process.env.SIGLUME_WEBHOOK_SECRET!,
  shop_public_origin: process.env.SHOP_PUBLIC_ORIGIN!,
  order_store: siglumeOrderStore,
  allow_metered_payments: false,
};

app.post(
  "/payments/webhooks/siglume",
  express.raw({ type: "application/json" }),
  createSiglumeSdrpWebhookHandler(siglumeOptions),
);

app.use(express.json());
app.use("/payments", createSiglumeSdrpCheckoutRouter(siglumeOptions));
```

FastAPI:

```py
from .siglume.siglume_order_store_example import ExampleSiglumeOrderStore
from .siglume.siglume_sdrp_routes import create_siglume_sdrp_router

app.include_router(
    create_siglume_sdrp_router(ExampleSiglumeOrderStore(), allow_metered_payments=False),
    prefix="/payments",
)
```

## 4. Adapter responsibilities

Replace the example store with your product's order database. The adapter must:

- load the order by your `order_id`,
- verify the current user is allowed to pay for that order,
- return the server-authored `amount_minor` and `currency`,
- create or reuse one active checkout attempt with a stable nonce,
- persist `challenge_hash`, `checkout_session_id`, and `checkout_url` before redirecting,
- process webhook event ids durably in the same transaction as the order update,
- mark Standard orders paid exactly once,
- route unknown classifications to manual review.

Do not calculate the amount from browser input.

The generated route defaults to Standard-only. If an order amount falls into
Micro / Nano, checkout returns `METERED_INTEGRATION_REQUIRED` until you set
`allow_metered_payments: true` / `allow_metered_payments=True` and implement
fulfilled-but-unsettled state, settlement reconciliation, past-due handling, and
terminal write-off handling.

## 5. Use a real database adapter

The copied files include durable database adapters. Use these before opening
checkout to users; the `*.example.*` stores are only for reading the interface.

Express:

```ts
import {
  createPrismaSiglumeOrderStore,
  createTypeOrmSiglumeOrderStore,
  createSequelizeSiglumeOrderStore,
  createDrizzleSiglumeOrderStore,
} from "./siglume/siglume-order-store.sql.js";

const order_store = createPrismaSiglumeOrderStore(prisma, {
  dialect: "postgres",
  orders_table: "orders",
  order_id_column: "id",
  amount_minor_column: "amount_minor",
  currency_column: "currency",
});
```

FastAPI:

```py
from sqlalchemy.orm import sessionmaker
from .siglume.siglume_order_store_sqlalchemy import (
    SQLAlchemySiglumeOrderStore,
    create_sqlalchemy_engine,
    create_sqlalchemy_siglume_schema,
)

engine = create_sqlalchemy_engine(os.environ["DATABASE_URL"])
create_sqlalchemy_siglume_schema(engine)
SessionLocal = sessionmaker(engine, future=True)
order_store = SQLAlchemySiglumeOrderStore(SessionLocal)
```

The adapters persist one checkout attempt per order, reuse the checkout URL on
retries, record webhook event ids only after the order update/review write
succeeds, and keep duplicate deliveries from double-fulfilling an order.

## 6. Start checkout from your frontend

Call your own server route:

```bash
curl -X POST https://api.your-product.example/payments/checkout/siglume/start \
  -H "content-type: application/json" \
  -d "{\"order_id\":\"order_123\"}"
```

Redirect the shopper to the returned `checkout_url`.

## 7. Done means

Your product is integrated when:

- `npx siglume-check readiness --sandbox` passes against your local product,
- `npx siglume-check readiness` passes against live Siglume credentials,
- your product has mounted checkout and webhook routes,
- your order database uses the SQL/ORM adapter or an equivalent transactional store,
- the signed webhook verifies against the raw body,
- `standard_settled` marks the order paid once,
- a failed webhook handler is retried and duplicate webhook deliveries do not double-fulfill the order.

For Micro / Nano revenue reconciliation, read
[Payment lifecycle](./payment-lifecycle.md) and
[Micro / Nano Statements and Notices](./metered-statements.md).
