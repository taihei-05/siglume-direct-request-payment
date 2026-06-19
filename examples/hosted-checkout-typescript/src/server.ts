import "dotenv/config";

import express from "express";
import {
  classifyDirectPaymentConfirmation,
  DirectRequestPaymentMerchantClient,
  HostedCheckoutNotAvailableError,
  verifyDirectRequestPaymentWebhook,
} from "@siglume/direct-request-payment";

import {
  allOrders,
  findOrderByChallengeHash,
  getOrder,
  markWebhookEventProcessedOnce,
  saveOrder,
} from "./order-store.js";

const app = express();
const port = Number(process.env.PORT || 3000);
const merchantKey = process.env.SIGLUME_DIRECT_PAYMENT_MERCHANT || "example_merchant";
const shopOrigin = process.env.SHOP_PUBLIC_ORIGIN || "https://www.example.com";

const siglumeMerchant = new DirectRequestPaymentMerchantClient({
  auth_token: process.env.SIGLUME_MERCHANT_AUTH_TOKEN,
});

const asyncRoute =
  (handler: express.RequestHandler): express.RequestHandler =>
  (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };

app.get("/orders", (_req, res) => {
  res.json({ orders: allOrders() });
});

app.post(
  "/checkout/siglume/start",
  express.json(),
  asyncRoute(async (req, res) => {
    const orderId = String(req.body?.order_id || "");
    const order = getOrder(orderId);
    if (!order) {
      res.status(404).json({ error: "order_not_found" });
      return;
    }

    order.payment_attempt += 1;
    const session = await siglumeMerchant.createCheckoutSession({
      merchant: merchantKey,
      amount_minor: order.amount_minor,
      currency: order.currency,
      nonce: `${order.id}-attempt_${order.payment_attempt}`,
      success_url: `${shopOrigin}/thanks`,
      cancel_url: `${shopOrigin}/cart`,
      metadata: { order_id: order.id },
    });

    order.siglume_challenge_hash = session.challenge_hash;
    order.siglume_checkout_session_id = session.session_id;
    order.siglume_payment_status = "pending";
    saveOrder(order);

    res.json({
      order_id: order.id,
      amount_minor: order.amount_minor,
      currency: order.currency,
      checkout_url: session.checkout_url,
      session_id: session.session_id,
    });
  }),
);

app.post(
  "/siglume/webhook",
  express.raw({ type: "application/json" }),
  asyncRoute(async (req, res) => {
    const { event } = await verifyDirectRequestPaymentWebhook(
      process.env.SIGLUME_WEBHOOK_SECRET || "",
      req.body,
      req.header("siglume-signature") || "",
    );

    if (!markWebhookEventProcessedOnce(event.id)) {
      res.status(204).send();
      return;
    }

    if (event.type === "direct_payment.confirmed") {
      const confirmation = classifyDirectPaymentConfirmation(event);

      if (confirmation.kind === "standard_settled") {
        const order = findOrderByChallengeHash(confirmation.challenge_hash);
        if (order) {
          order.siglume_payment_status = "paid";
          order.siglume_requirement_id = confirmation.requirement_id;
          order.siglume_chain_receipt_id = confirmation.chain_receipt_id;
          saveOrder(order);
        }
      } else if (confirmation.kind === "metered_usage_accepted") {
        const order = findOrderByChallengeHash(confirmation.challenge_hash);
        if (order) {
          order.siglume_payment_status = "fulfilled_unsettled";
          order.siglume_requirement_id = confirmation.requirement_id;
          saveOrder(order);
        }
      } else if (confirmation.kind === "metered_batch_settled") {
        console.info("metered batch settled", {
          settlement_batch_id: confirmation.settlement_batch_id,
          chain_receipt_id: confirmation.chain_receipt_id,
        });
      } else {
        console.warn("manual payment review required", {
          event_id: event.id,
          reason: confirmation.reason,
          requirement_id: confirmation.requirement_id,
        });
      }
    }

    res.status(204).send();
  }),
);

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof HostedCheckoutNotAvailableError) {
    res.status(409).json({ error: "hosted_checkout_not_enabled" });
    return;
  }
  console.error("checkout starter error:", {
    name: error instanceof Error ? error.name : "Error",
  });
  res.status(500).json({ error: "internal_error" });
});

app.listen(port, () => {
  console.log(`Siglume Hosted Checkout starter listening on http://localhost:${port}`);
});
