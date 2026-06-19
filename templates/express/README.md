# Express Integration Files

Mount the router in your existing app:

```ts
import { createSiglumeSdrpRouter } from "./siglume/siglume-sdrp-routes.js";
import { siglumeOrderStore } from "./siglume/siglume-order-store.example.js";

app.use("/payments", createSiglumeSdrpRouter({
  merchant: process.env.SIGLUME_DIRECT_PAYMENT_MERCHANT!,
  merchant_auth_token: process.env.SIGLUME_MERCHANT_AUTH_TOKEN!,
  webhook_secret: process.env.SIGLUME_WEBHOOK_SECRET!,
  shop_public_origin: process.env.SHOP_PUBLIC_ORIGIN!,
  order_store: siglumeOrderStore,
}));
```

Replace `siglume-order-store.example.ts` with your real order database adapter.
The route paths become:

- `POST /payments/checkout/siglume/start`
- `POST /payments/webhooks/siglume`
