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

Replace `siglume-order-store.example.ts` with your real order database adapter.
Keep `processWebhookEventOnce()` transactional: record the webhook event as
processed only after the order update or review write succeeds. The generated
route defaults to Standard-only. Enable `allow_metered_payments` only after you
implement Micro / Nano settlement reconciliation and past-due handling.
The route paths become:

- `POST /payments/checkout/siglume/start`
- `POST /payments/webhooks/siglume`
