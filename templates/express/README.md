# Express Integration Files

Mount the webhook before any global JSON parser. Webhook signature verification
needs the raw request body; `express.json()` cannot recreate it after parsing.

```ts
import express from "express";
import type { Request } from "express";
import {
  createSiglumeSdrpCheckoutRouter,
  createSiglumeSdrpWebhookHandler,
  type SiglumeSdrpRouterOptions,
} from "./siglume/siglume-sdrp-routes.js";
import { createPrismaSiglumeOrderStore } from "./siglume/siglume-order-store.sql.js";
import { prisma } from "../db/prisma.js";

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

const siglumeOrderStore = createPrismaSiglumeOrderStore(prisma, {
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
  driver that can implement the small `SiglumeSqlExecutor` interface. For an
  existing product database, run
  `createSiglumeSdrpSqlSchema({ dialect: "postgres", include_orders_table: false })`
  once in a migration or translate the returned SQL into your migration tool.
  Your own order table must expose the mapped `id`, `amount_minor`, and
  `currency` columns. `status` and `updated_at` are optional but recommended
  when you want the adapter to write paid/fulfilled state back to your table.
  Use `include_orders_table: true` only for the sample `orders` table.
- `siglume-order-store.dynamodb.ts`: DynamoDB with conditional writes and
  `TransactWrite`.
- `siglume-order-store.mongodb.ts`: MongoDB with unique indexes for the active
  checkout attempt, challenge hash, and webhook event id.
- `siglume-order-store.firestore.ts`: Firestore transactions and single-field
  challenge lookup.

Keep `processWebhookEventOnce()` durable: use one database transaction where
your database supports it, and otherwise use the official adapter's equivalent
durable claim, stale-lease recovery, and idempotent order-repair pattern. Record
the webhook event as processed only after the order update or review write
succeeds.

Do not run a production checkout route without `authorize_order`. It must
fail-closed unless the authenticated product user owns the order and the order is
still payable. Without this check, anyone who can guess an order id could start
checkout for someone else's order.

The generated route defaults to Standard-only. Enable
`allow_metered_payments` only after you implement Micro / Nano settlement
reconciliation and past-due handling.
The route paths become:

- `POST /payments/checkout/siglume/start`
- `POST /payments/webhooks/siglume`
