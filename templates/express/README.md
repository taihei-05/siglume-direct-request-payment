# Express Integration Files

Mount the webhook before any global JSON parser. Webhook signature verification
needs the raw request body; `express.json()` cannot recreate it after parsing.

```ts
import express from "express";
import {
  createSiglumeSdrpCheckoutRouter,
  createSiglumeSdrpWebhookHandler,
  type SiglumeSdrpRouterOptions,
} from "./siglume/siglume-sdrp-routes.js";
import { createPrismaSiglumeOrderStore } from "./siglume/siglume-order-store.sql.js";
import { prisma } from "../db/prisma.js";

const siglumeOrderStore = createPrismaSiglumeOrderStore(prisma, {
  dialect: "postgres",
  orders_table: "orders",
  order_id_column: "id",
  amount_minor_column: "amount_minor",
  currency_column: "currency",
});

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

Use one of the durable database-backed adapters before opening checkout to
users:

- `siglume-order-store.sql.ts`: Prisma, TypeORM, Sequelize, Drizzle, or any
  driver that can implement the small `SiglumeSqlExecutor` interface. Run
  `createSiglumeSdrpSqlSchema({ dialect: "postgres" })` once in a migration or
  translate the returned SQL into your migration tool.
- `siglume-order-store.dynamodb.ts`: DynamoDB with conditional writes and
  `TransactWrite`.
- `siglume-order-store.mongodb.ts`: MongoDB with unique indexes for the active
  checkout attempt, challenge hash, and webhook event id.
- `siglume-order-store.firestore.ts`: Firestore transactions and single-field
  challenge lookup.

Keep `processWebhookEventOnce()` transactional: record the webhook event as
processed only after the order update or review write succeeds. The generated
route defaults to Standard-only. Enable `allow_metered_payments` only after you
implement Micro / Nano settlement reconciliation and past-due handling.
The route paths become:

- `POST /payments/checkout/siglume/start`
- `POST /payments/webhooks/siglume`
