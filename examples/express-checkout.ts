/**
 * DEMO ONLY.
 *
 * This file shows the minimum Hosted Checkout webhook shape, but it is not
 * production-safe:
 * - in-memory order storage
 * - no buyer authentication or order ownership checks
 * - no database transaction around fulfillment
 * - no durable webhook event deduplication
 * - no production refund or support workflow
 *
 * For production, persist orders and processed webhook ids in a database,
 * authorize every checkout start request, and make fulfillment idempotent.
 */
import express from "express";
import {
  classifyDirectPaymentConfirmation,
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
const processedWebhookEvents = new Set<string>();

async function flagForPaymentStateReview(payload: Record<string, any>): Promise<void> {
  console.warn("payment state review required", payload);
}

async function processWebhookEventOnce(eventId: string, handler: () => Promise<void>): Promise<"processed" | "duplicate"> {
  if (processedWebhookEvents.has(eventId)) {
    return "duplicate";
  }
  await handler();
  processedWebhookEvents.add(eventId);
  return "processed";
}

async function handleDirectPaymentConfirmed(event: any): Promise<void> {
  const classification = classifyDirectPaymentConfirmation(event);

  if (classification.kind === "metered_batch_settled") {
    // Aggregated Micro/Nano settlement events do not carry an order challenge.
    // Reconcile them against statement / settlement batch data instead.
    console.log("settled metered batch", classification.settlement_batch_id, classification.chain_receipt_id);
    return;
  }

  if (classification.kind === "standard_settled") {
    const order = [...orders.values()].find((item) => item.siglume_challenge_hash === classification.challenge_hash);
    if (order) {
      order.siglume_payment_status = "paid";
      order.siglume_requirement_id = classification.requirement_id;
      order.siglume_chain_receipt_id = classification.chain_receipt_id;
    } else {
      await flagForPaymentStateReview({
        reason: "unknown_challenge_hash",
        requirement_id: classification.requirement_id,
      });
    }
    return;
  }

  if (classification.kind === "metered_usage_accepted") {
    await flagForPaymentStateReview({
      reason: "metered_integration_required",
      requirement_id: classification.requirement_id,
      pricing_band: classification.pricing_band,
    });
    return;
  }

  // Unknown or older payload shape: do not mark paid from the event name alone.
  await flagForPaymentStateReview({
    reason: classification.reason,
    requirement_id: classification.requirement_id,
    settlement_batch_id: classification.settlement_batch_id,
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

  if (!Number(order.payment_attempt || 0)) {
    order.payment_attempt = 1;
  }
  if (order.siglume_checkout_url && order.siglume_checkout_session_id) {
    res.json({
      order_id: order.id,
      amount_minor: order.amount_minor,
      currency: order.currency,
      checkout_url: order.siglume_checkout_url,
      session_id: order.siglume_checkout_session_id,
    });
    return;
  }
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
  order.siglume_checkout_url = session.checkout_url;
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

  const result = await processWebhookEventOnce(event.id, async () => {
    if (event.type === "direct_payment.confirmed") {
      await handleDirectPaymentConfirmed(event);
    }
  });
  if (result === "duplicate") {
    res.status(204).send();
    return;
  }

  res.status(204).send();
}));

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // Log the detail server-side; never return raw error messages to the client —
  // a payment error can otherwise leak internal API details or configuration.
  console.error("checkout error:", {
    name: error instanceof Error ? error.name : "Error",
  });
  res.status(500).json({ error: "internal_error" });
});

app.listen(port);
