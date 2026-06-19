import express from "express";
import {
  DirectRequestPaymentMerchantClient,
  verifyDirectRequestPaymentWebhook,
} from "@siglume/direct-request-payment";

const app = express();
const port = Number(process.env.PORT || 3000);
const merchantKey = process.env.SIGLUME_DIRECT_PAYMENT_MERCHANT || "example_merchant";
const siglumeMerchant = new DirectRequestPaymentMerchantClient({
  auth_token: process.env.SIGLUME_MERCHANT_AUTH_TOKEN,
});

// Use JSON for normal routes. Use raw body only on the webhook route.
app.use((req, res, next) => {
  if (req.path === "/siglume/webhook") {
    next();
    return;
  }
  express.json()(req, res, next);
});

const orders = new Map<string, any>();

async function handleDirectPaymentConfirmed(data: Record<string, any>): Promise<void> {
  if (data.mode === "metered_settlement_batch") {
    // Aggregated Micro/Nano settlement events do not carry an order challenge.
    // Reconcile them against statement / settlement batch data instead.
    if (data.settlement_status === "settled") {
      console.log("settled metered batch", data.settlement_batch_id || data.usage_event_digest);
    }
    return;
  }

  if (
    data.pricing_band === "standard" &&
    data.finality === "per_payment_onchain" &&
    data.settlement_status === "settled"
  ) {
    const challengeHash = String(data.challenge_hash || "");
    const order = [...orders.values()].find((item) => item.siglume_challenge_hash === challengeHash);
    if (order) {
      order.siglume_payment_status = "paid";
      order.siglume_requirement_id = data.requirement_id || data.direct_payment_requirement_id;
      order.siglume_chain_receipt_id = data.chain_receipt_id || null;
    }
    return;
  }

  if (data.pricing_band === "micro" || data.pricing_band === "nano") {
    const challengeHash = String(data.challenge_hash || "");
    const order = [...orders.values()].find((item) => item.siglume_challenge_hash === challengeHash);
    if (order) {
      order.siglume_payment_status = "fulfilled_unsettled";
      order.siglume_requirement_id = data.requirement_id || data.direct_payment_requirement_id;
    }
    return;
  }

  // Unknown or older payload shape: do not mark paid from the event name alone.
  console.warn("direct_payment.confirmed missing settlement machine fields", {
    id: data.id,
    requirement_id: data.requirement_id || data.direct_payment_requirement_id,
  });
}

const asyncRoute =
  (handler: express.RequestHandler): express.RequestHandler =>
  (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };

app.post("/checkout/siglume/start", asyncRoute(async (req, res) => {
  const orderId = String(req.body.order_id || "");
  const order = orders.get(orderId);
  if (!order) {
    res.status(404).json({ error: "order_not_found" });
    return;
  }

  order.payment_attempt = Number(order.payment_attempt || 0) + 1;
  const session = await siglumeMerchant.createCheckoutSession({
    merchant: merchantKey,
    amount_minor: order.amount_minor,
    currency: order.currency,
    nonce: `${order.id}-attempt_${order.payment_attempt}`,
    success_url: `${process.env.SHOP_PUBLIC_ORIGIN || "https://shop.example.com"}/thanks`,
    cancel_url: `${process.env.SHOP_PUBLIC_ORIGIN || "https://shop.example.com"}/cart`,
    metadata: { order_id: order.id },
  });

  order.siglume_challenge_hash = session.challenge_hash;
  order.siglume_checkout_session_id = session.session_id;
  order.siglume_payment_status = "pending";

  res.json({
    order_id: order.id,
    amount_minor: order.amount_minor,
    currency: order.currency,
    checkout_url: session.checkout_url,
    session_id: session.session_id,
  });
}));

app.post("/siglume/webhook", express.raw({ type: "application/json" }), asyncRoute(async (req, res) => {
  const header = String(req.headers["siglume-signature"] || "");
  const { event } = await verifyDirectRequestPaymentWebhook(
    process.env.SIGLUME_WEBHOOK_SECRET!,
    req.body,
    header,
  );

  if (event.type === "direct_payment.confirmed") {
    await handleDirectPaymentConfirmed(event.data);
  }

  res.status(204).send();
}));

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // Log the detail server-side; never return raw error messages to the client —
  // a payment error can otherwise leak internal API details or configuration.
  console.error("checkout error:", error);
  res.status(500).json({ error: "internal_error" });
});

app.listen(port);
