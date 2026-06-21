# 10-Minute Standard Checkout Integration

This guide has two paths:

- **Account-free 10-minute sandbox.** Use the local sandbox, a local product
  server, an authenticated test user, and one Standard-band test order. This
  proves the checkout route, webhook route, DB update, and duplicate-delivery
  handling without live Siglume credentials.
- **Prepared merchant live go-live.** Use the same mounted routes after live
  merchant credentials, billing mandate, public HTTPS webhook, Standard Hosted
  Checkout readiness, and monitoring are ready.

The live path requires these prerequisites:

- merchant credentials are available,
- the merchant billing mandate is active,
- Standard Hosted Checkout readiness passes for the merchant account,
- Standard Hosted Checkout terms and sandbox confirmation are recorded,
- merchant responsibility attestation and live mode are recorded,
- your product already has login/session middleware,
- your product already has a real order database,
- the live path has a public HTTPS webhook URL.

The 10-minute scope is Standard Payment plumbing in sandbox, not full payment
operations or a live go-live. Finish the 10-minute sandbox phase when a sandbox
Standard checkout succeeds, a signed webhook reaches your product, the DB order
becomes paid, and duplicate delivery does not update the order twice.

The goal is to add two routes to your own server:

- `POST /payments/checkout/siglume/start`
- `POST /payments/webhooks/siglume`

The SDK supplies the readiness check, route files, webhook verification, payment
classification, and the order-store adapter contract. Your app supplies the
real order lookup and fulfillment writes.

## 0. Install the SDK

Install the SDK in your existing product first.

Node / Express:

```bash
npm install @siglume/direct-request-payment
```

Python / FastAPI:

```bash
pip install siglume-direct-request-payment
```

For FastAPI projects, the Python package supplies `init`, `preflight`, and
`verify` commands. The local sandbox server is currently provided by the npm
CLI, so install Node.js 20.19+ or 22.12+ with npm as well when you want local
sandbox checkout verification.

## 1. Optional live preflight

Skip this step for the account-free sandbox path. For live go-live, set these
environment variables in your app or `.env`:

```bash
SIGLUME_MERCHANT_AUTH_TOKEN=<merchant Siglume bearer token>
SIGLUME_DIRECT_PAYMENT_MERCHANT=<merchant key>
SHOP_PUBLIC_ORIGIN=https://www.your-product.example
SHOP_WEBHOOK_URL=https://api.your-product.example/payments/webhooks/siglume
SIGLUME_WEBHOOK_SECRET=<webhook signing secret from setupCheckout/setup_checkout>
```

Before mounting routes, you may run a preflight. It checks local config,
merchant, billing, webhook subscription metadata, readiness, and Hosted
Checkout availability by creating an unpaid expiring checkout session. It
intentionally does not send a webhook delivery because your webhook route does
not exist yet.

```bash
# Node / Express
npx siglume-check preflight

# Python / FastAPI
siglume-check preflight
```

Use `readiness` or `verify` only after your webhook route is mounted and your
app is running. Those commands also queue a signed webhook test delivery and
require it to be delivered.

For a CI local-config smoke test:

```bash
npx siglume-check preflight --no-api --json
```

`--no-api` does not prove Hosted Checkout or webhook delivery. Before opening a
human web checkout path, run `siglume-check verify` without `--no-api` and fix
every FAIL item.

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

## 3. Run the SDRP table migration

The generated adapters need SDRP-owned tables for checkout attempts, webhook
event ids, and manual review rows. Add these tables with your normal migration
tool before starting checkout.

Express SQL / ORM adapters:

```ts
import { writeFileSync } from "node:fs";
import { createSiglumeSdrpSqlSchema } from "../src/siglume/siglume-order-store.sql.js";

writeFileSync(
  "migrations/20260621_add_siglume_sdrp.sql",
  createSiglumeSdrpSqlSchema({
    dialect: "postgres",
    include_orders_table: false,
  }).join("\n\n"),
);
```

Save that as `scripts/create-siglume-migration.ts`, then run:

```bash
npx tsx scripts/create-siglume-migration.ts
```

Use `include_orders_table: false` for an existing product. Your own order table
must already provide the mapped order id, amount, currency, and owner fields
used by `authorize_order`.

FastAPI / SQLAlchemy:

<!-- siglume-example: py quickstart-fastapi-migration -->
```py
import asyncio
import os

from app.siglume.siglume_order_store_sqlalchemy_async import (
    create_async_sqlalchemy_engine,
    create_async_sqlalchemy_siglume_schema,
)

async def main() -> None:
    engine = create_async_sqlalchemy_engine(os.environ["DATABASE_URL"])
    try:
        await create_async_sqlalchemy_siglume_schema(engine)
    finally:
        await engine.dispose()

asyncio.run(main())
```

Save that as `scripts/create_siglume_schema.py`, then run:

```bash
python scripts/create_siglume_schema.py
```

Run the schema creation in your migration/startup path once. It creates only
SDRP tables by default. Use `include_orders_table=True` only for a sample app.

## 4. Mount the routes

Express:

<!-- siglume-example: ts quickstart-express -->
```ts
import express from "express";
import type { Request } from "express";
import {
  createSiglumeSdrpCheckoutRouter,
  createSiglumeSdrpWebhookHandler,
  type SiglumeSdrpRouterOptions,
} from "./siglume/siglume-sdrp-routes.js";
import { createPrismaSiglumeOrderStore } from "./siglume/siglume-order-store.sql.js";
import { prisma } from "../database/prisma.js";

const app = express();

function currentUserId(req: Request): string | null {
  return String((req as Request & { user?: { id?: string } }).user?.id || "") || null;
}

async function userCanPayOrder(orderId: string, userId: string): Promise<boolean> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { customerId: true, status: true },
  });
  return Boolean(order && order.customerId === userId && order.status === "created");
}

const order_store = createPrismaSiglumeOrderStore(prisma, {
  dialect: "postgres",
  orders_table: "orders",
  order_id_column: "id",
  amount_minor_column: "amount_minor",
  currency_column: "currency",
  authorize_order: async (order, req) => {
    const userId = currentUserId(req);
    return Boolean(userId && await userCanPayOrder(String(order.id), userId));
  },
});

const siglumeOptions: SiglumeSdrpRouterOptions = {
  merchant: process.env.SIGLUME_DIRECT_PAYMENT_MERCHANT!,
  merchant_auth_token: process.env.SIGLUME_MERCHANT_AUTH_TOKEN!,
  webhook_secret: process.env.SIGLUME_WEBHOOK_SECRET!,
  shop_public_origin: process.env.SHOP_PUBLIC_ORIGIN!,
  order_store,
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

FastAPI uses the async SQLAlchemy adapter by default in ASGI apps:

<!-- siglume-example: py quickstart-fastapi -->
```py
from contextlib import asynccontextmanager
import os
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import async_sessionmaker
from .auth import current_user_id
from .database import async_user_can_pay_order
from .siglume.siglume_order_store_sqlalchemy_async import (
    AsyncSQLAlchemySiglumeOrderStore,
    create_async_sqlalchemy_engine,
)
from .siglume.siglume_sdrp_routes import create_siglume_sdrp_router

async def authorize_order(order: dict, request) -> bool:
    user_id = current_user_id(request)
    return bool(user_id and await async_user_can_pay_order(str(order["id"]), user_id))

engine = create_async_sqlalchemy_engine(os.environ["DATABASE_URL"])
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)
order_store = AsyncSQLAlchemySiglumeOrderStore(
    SessionLocal,
    authorize_order=authorize_order,
)

@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    await engine.dispose()

app = FastAPI(lifespan=lifespan)
app.include_router(
    create_siglume_sdrp_router(order_store, allow_metered_payments=False),
    prefix="/payments",
)
```

## 5. Adapter responsibilities

Replace the example store with your product's order database. The adapter must:

- load the order by your `order_id`,
- verify the current user is allowed to pay for that order,
- return the server-authored `amount_minor` and `currency`,
- create or reuse one active checkout attempt with a stable nonce,
- persist `challenge_hash`, `checkout_session_id`, and `checkout_url` before redirecting,
- process webhook event ids durably in the same database transaction as the
  order update where supported; otherwise use an equivalent durable claim,
  stale-lease recovery, and idempotent order-repair pattern supplied by the
  official adapter,
- mark Standard orders paid exactly once,
- route unknown classifications to manual review.

Do not calculate the amount from browser input.

The generated route defaults to Standard-only. If an order amount falls into
Micro / Nano, checkout returns `METERED_INTEGRATION_REQUIRED` until you set
`allow_metered_payments: true` / `allow_metered_payments=True` and implement
fulfilled-but-unsettled state, settlement reconciliation, past-due handling, and
terminal write-off handling.

## 6. Use a real database adapter

The copied files include durable database adapters. Use these before opening
checkout to users. The `*.example.*` stores are sandbox-only interface examples;
do not leave them mounted in a product because they do not authenticate the
current user against the order owner.

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
  authorize_order: async (order, req) => {
    const userId = currentUserId(req);
    return Boolean(userId && await userCanPayOrder(String(order.id), userId));
  },
});
```

For NoSQL products, install the driver you already use and choose the matching
adapter:

```bash
# DynamoDB
npm install @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb

# MongoDB
npm install mongodb

# Firestore
npm install @google-cloud/firestore
```

```ts
// DynamoDB
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import {
  createDynamoDbSiglumeOrderStore,
  createDynamoDbSiglumeTables,
} from "./siglume/siglume-order-store.dynamodb.js";

const dynamo = new DynamoDBClient({ region: "ap-northeast-1" });
const dynamoDoc = DynamoDBDocumentClient.from(dynamo, {
  marshallOptions: { removeUndefinedValues: true, convertEmptyValues: true },
});
await createDynamoDbSiglumeTables({ client: dynamo, include_orders_table: false });
const order_store = createDynamoDbSiglumeOrderStore({
  client: dynamoDoc,
  authorize_order: async (order, req) => {
    const userId = currentUserId(req);
    return Boolean(userId && String(order.customer_id) === userId);
  },
});
```

```ts
// MongoDB
import { MongoClient } from "mongodb";
import {
  createMongoSiglumeIndexes,
  createMongoSiglumeOrderStore,
} from "./siglume/siglume-order-store.mongodb.js";

const mongo = new MongoClient(process.env.MONGODB_URI!);
await mongo.connect();
const db = mongo.db("shop");
await createMongoSiglumeIndexes({ db });
const order_store = createMongoSiglumeOrderStore({
  db,
  authorize_order: async (order, req) => {
    const userId = currentUserId(req);
    return Boolean(userId && String(order.customer_id) === userId);
  },
});
```

```ts
// Firestore
import { Firestore } from "@google-cloud/firestore";
import { createFirestoreSiglumeOrderStore } from "./siglume/siglume-order-store.firestore.js";

const db = new Firestore({ projectId: process.env.GOOGLE_CLOUD_PROJECT });
const order_store = createFirestoreSiglumeOrderStore({
  db,
  authorize_order: async (order, req) => {
    const userId = currentUserId(req);
    return Boolean(userId && String(order.customer_id) === userId);
  },
});
```

FastAPI production recommendation:

```py
from sqlalchemy.ext.asyncio import async_sessionmaker
from .siglume.siglume_order_store_sqlalchemy_async import (
    AsyncSQLAlchemySiglumeOrderStore,
    create_async_sqlalchemy_engine,
    create_async_sqlalchemy_siglume_schema,
)

engine = create_async_sqlalchemy_engine(os.environ["DATABASE_URL"])
# Run create_async_sqlalchemy_siglume_schema(engine) during migration/startup.
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)
order_store = AsyncSQLAlchemySiglumeOrderStore(SessionLocal, authorize_order=authorize_order)
```

The sync `SQLAlchemySiglumeOrderStore` remains available for existing sync
SQLAlchemy code, but it performs synchronous database work and is not the
default recommendation for an async FastAPI request path.

Sync SQLAlchemy compatibility:

```py
from sqlalchemy.orm import sessionmaker
from .auth import current_user_id
from .database import user_can_pay_order
from .siglume.siglume_order_store_sqlalchemy import (
    SQLAlchemySiglumeOrderStore,
    create_sqlalchemy_engine,
    create_sqlalchemy_siglume_schema,
)

def authorize_order_sync(order: dict, request) -> bool:
    user_id = current_user_id(request)
    return bool(user_id and user_can_pay_order(str(order["id"]), user_id))

engine = create_sqlalchemy_engine(os.environ["DATABASE_URL"])
create_sqlalchemy_siglume_schema(engine)
SessionLocal = sessionmaker(engine, future=True)
order_store = SQLAlchemySiglumeOrderStore(
    SessionLocal,
    authorize_order=authorize_order_sync,
    # Optional for existing products with different order table/column names:
    # orders_table=product_orders,
    # order_id_column="order_id",
    # amount_minor_column="total_cents",
    # currency_column="iso_currency",
    # order_status_column="payment_status",
)
```

`create_sqlalchemy_siglume_schema(engine)` creates only SDRP-owned tables by
default. Use `include_orders_table=True` only for the sample `orders` table.

The SQL, DynamoDB, MongoDB, Firestore, and SQLAlchemy adapters persist one
active checkout attempt per order, reuse an unexpired checkout URL on network
retries, create a new attempt after expiry/failure, record webhook event ids
only after the order update/review write succeeds, and keep duplicate
deliveries from double-fulfilling an order.

## 7. Seed one authenticated Standard test order

Create a Standard-band test order owned by a product test user. Use your own
schema and auth system; the important point is that the same authenticated user
must be allowed by `authorize_order`.

Example shape:

```sql
INSERT INTO orders (id, customer_id, amount_minor, currency, status)
VALUES ('order_sdrp_sandbox_001', 'user_sdrp_sandbox', 1200, 'JPY', 'created');
```

If your product stores camelCase columns or a separate ownership table, create
the equivalent row there and keep `userCanPayOrder(...)` / `authorize_order`
checking that ownership.

## 8. Start your app and run sandbox verify

Start your product locally with the mounted checkout and webhook routes. Then,
in another terminal, start the sandbox and point it at your local webhook route:

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

Restart your product with those values, keep the sandbox running, then verify
the local webhook delivery:

```bash
npx siglume-check verify --sandbox
```

`verify --sandbox` must pass before you switch to live credentials.

## 9. Start checkout from your frontend

Call your own server route as the product test user. Use either the same session
cookie your browser would send, or a product-side Bearer token that your auth
middleware turns into `req.user` / `current_user_id`.

```bash
curl -X POST http://localhost:3000/payments/checkout/siglume/start \
  -H "content-type: application/json" \
  -H "authorization: Bearer <product-test-user-token>" \
  -d "{\"order_id\":\"order_sdrp_sandbox_001\"}"
```

Redirect the shopper to the returned `checkout_url`.

Open the sandbox `checkout_url` and confirm the payment. Then verify the product
DB changed exactly once:

```sql
SELECT status FROM orders WHERE id = 'order_sdrp_sandbox_001';
SELECT event_id, status FROM siglume_webhook_events ORDER BY created_at DESC LIMIT 3;
```

Expected result: the order is `paid`, one webhook event is `processed`, and
clicking sandbox confirm again for the same checkout session does not create a
second confirmation event.

Then redeliver the exact same signed webhook event to prove your merchant
webhook endpoint is idempotent on duplicate event IDs:

```bash
curl -X POST http://127.0.0.1:8787/v1/sandbox/checkout-sessions/<session_id>/redeliver
```

Expected result: the same `event.id` is delivered again, the order remains
`paid`, and `siglume_webhook_events` still has one processed row for that event.

For the reference Express app path, this is also machine-tested in
`test/express-template.e2e.test.ts`: it creates the SDRP tables, seeds an
authenticated Standard test order, rejects an unauthenticated checkout, starts
checkout with a Bearer token, marks the DB order paid from a signed webhook, and
replays the same webhook idempotently.

## 10. 10-Minute Sandbox Complete

Your local Standard checkout plumbing is integrated when:

- `npx siglume-check verify --sandbox` passes against your local product,
- your product has mounted checkout and webhook routes,
- your order database uses the SQL/ORM, DynamoDB, MongoDB, Firestore, or
  SQLAlchemy adapter, or an equivalent durable store,
- required SDRP storage resources exist: the SQL tables
  `siglume_checkout_attempts`, `siglume_webhook_events`, and
  `siglume_payment_reviews`, or the equivalent DynamoDB tables, MongoDB
  collections, or Firestore collections configured by the selected adapter,
- your authenticated product test user can start checkout for their own
  Standard-band test order and cannot start checkout without that authentication,
- the signed webhook verifies against the raw body,
- `standard_settled` marks the order paid once,
- a failed webhook handler is retried and duplicate webhook deliveries do not double-fulfill the order.

## 11. Live Go-Live Complete

Your live checkout path is ready only after the sandbox phase above and all of
these live checks pass:

- `siglume-check preflight` passes with live credentials,
- `siglume-check verify` passes against the public HTTPS webhook URL,
- Standard Hosted Checkout readiness passes for the merchant account,
- the merchant billing mandate is active,
- your support / refund / adjustment process is documented for your account,
- production monitoring captures webhook failures, checkout-session creation
  failures, and payment investigation identifiers without exposing them in
  public issues.

For Micro / Nano revenue reconciliation, read
[Payment lifecycle](./payment-lifecycle.md) and
[Micro / Nano Statements and Notices](./metered-statements.md).
