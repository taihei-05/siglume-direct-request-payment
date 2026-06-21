# 10-Minute Standard Checkout Integration

This guide is the supported 10-minute path for adding SDRP Hosted Checkout to
an existing product when these prerequisites are already ready:

- merchant credentials are available,
- the merchant billing mandate is active,
- Hosted Checkout access is enabled for the merchant account,
- your product already has login/session middleware,
- your product already has a real order database,
- the live path has a public HTTPS webhook URL.

The 10-minute scope is Standard Payment plumbing in sandbox, not full payment
operations or a live go-live. Start with dependencies installed and merchant
credentials ready; finish the 10-minute sandbox phase when a sandbox Standard
checkout succeeds, a signed webhook reaches your product, the DB order becomes
paid, and duplicate delivery does not update the order twice.

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

Set these environment variables in your app or `.env`:

```bash
SIGLUME_MERCHANT_AUTH_TOKEN=<merchant Siglume bearer token>
SIGLUME_DIRECT_PAYMENT_MERCHANT=<merchant key>
SHOP_PUBLIC_ORIGIN=https://www.your-product.example
SHOP_WEBHOOK_URL=https://api.your-product.example/payments/webhooks/siglume
SIGLUME_WEBHOOK_SECRET=<webhook signing secret from setupCheckout/setup_checkout>
```

Before mounting routes, you may run a preflight. It checks local config,
merchant, billing, webhook subscription metadata, and Hosted Checkout access,
by creating an unpaid expiring checkout session. It intentionally does not send
a webhook delivery because your webhook route does not exist yet.

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

## 3. Mount the routes

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

FastAPI:

<!-- siglume-example: py quickstart-fastapi -->
```py
from fastapi import FastAPI
from .auth import current_user_id
from .database import SessionLocal, user_can_pay_order
from .siglume.siglume_order_store_sqlalchemy import SQLAlchemySiglumeOrderStore
from .siglume.siglume_sdrp_routes import create_siglume_sdrp_router

app = FastAPI()

def authorize_order(order: dict, request) -> bool:
    user_id = current_user_id(request)
    return bool(user_id and user_can_pay_order(SessionLocal, str(order["id"]), user_id))

order_store = SQLAlchemySiglumeOrderStore(
    SessionLocal,
    authorize_order=authorize_order,
)

app.include_router(
    create_siglume_sdrp_router(order_store, allow_metered_payments=False),
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

## 5. Use a real database adapter

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
order_store = SQLAlchemySiglumeOrderStore(
    SessionLocal,
    authorize_order=authorize_order,
    # Optional for existing products with different order table/column names:
    # orders_table=product_orders,
    # order_id_column="order_id",
    # amount_minor_column="total_cents",
    # currency_column="iso_currency",
    # order_status_column="payment_status",
)
```

If your FastAPI app already uses SQLAlchemy `AsyncSession`, use the async
adapter instead:

```py
from sqlalchemy.ext.asyncio import async_sessionmaker
from .siglume.siglume_order_store_sqlalchemy_async import (
    AsyncSQLAlchemySiglumeOrderStore,
    create_async_sqlalchemy_engine,
    create_async_sqlalchemy_siglume_schema,
)

engine = create_async_sqlalchemy_engine(os.environ["DATABASE_URL"])
# Run this during your FastAPI startup/lifespan initialization.
await create_async_sqlalchemy_siglume_schema(engine)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)
order_store = AsyncSQLAlchemySiglumeOrderStore(SessionLocal, authorize_order=authorize_order)
```

`create_sqlalchemy_siglume_schema(engine)` creates only SDRP-owned tables by
default. Use `include_orders_table=True` only for the sample `orders` table.

The SQL, DynamoDB, MongoDB, Firestore, and SQLAlchemy adapters persist one
active checkout attempt per order, reuse an unexpired checkout URL on network
retries, create a new attempt after expiry/failure, record webhook event ids
only after the order update/review write succeeds, and keep duplicate
deliveries from double-fulfilling an order.

## 6. Start your app and run sandbox verify

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

## 7. Start checkout from your frontend

Call your own server route:

```bash
curl -X POST https://api.your-product.example/payments/checkout/siglume/start \
  -H "content-type: application/json" \
  -d "{\"order_id\":\"order_123\"}"
```

Redirect the shopper to the returned `checkout_url`.

## 8. 10-Minute Sandbox Complete

Your local Standard checkout plumbing is integrated when:

- `npx siglume-check verify --sandbox` passes against your local product,
- your product has mounted checkout and webhook routes,
- your order database uses the SQL/ORM, DynamoDB, MongoDB, Firestore, or
  SQLAlchemy adapter, or an equivalent durable store,
- the signed webhook verifies against the raw body,
- `standard_settled` marks the order paid once,
- a failed webhook handler is retried and duplicate webhook deliveries do not double-fulfill the order.

## 9. Live Go-Live Complete

Your live checkout path is ready only after the sandbox phase above and all of
these live checks pass:

- `siglume-check preflight` passes with live credentials,
- `siglume-check verify` passes against the public HTTPS webhook URL,
- Hosted Checkout access is enabled for the merchant account,
- the merchant billing mandate is active,
- your support / refund / adjustment process is documented for your account,
- production monitoring captures webhook failures, checkout-session creation
  failures, and payment investigation identifiers without exposing them in
  public issues.

For Micro / Nano revenue reconciliation, read
[Payment lifecycle](./payment-lifecycle.md) and
[Micro / Nano Statements and Notices](./metered-statements.md).
