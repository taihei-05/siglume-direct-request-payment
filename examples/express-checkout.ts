import express from "express";
import {
  createDirectRequestPaymentChallenge,
  DirectRequestPaymentClient,
  verifyDirectRequestPaymentWebhook,
} from "@siglume/direct-request-payment";

const app = express();
const port = Number(process.env.PORT || 3000);

// Use JSON for normal routes. Use raw body only on the webhook route.
app.use((req, res, next) => {
  if (req.path === "/siglume/webhook") {
    next();
    return;
  }
  express.json()(req, res, next);
});

const orders = new Map<string, any>();

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
  const challenge = await createDirectRequestPaymentChallenge({
    merchant: "example_merchant",
    amount_minor: order.amount_minor,
    currency: order.currency,
    secret: process.env.SIGLUME_DIRECT_PAYMENT_CHALLENGE_SECRET!,
    nonce: `${order.id}-attempt_${order.payment_attempt}`,
  });

  order.siglume_challenge_hash = challenge.challenge_hash;
  order.siglume_payment_status = "pending";

  res.json({
    order_id: order.id,
    amount_minor: order.amount_minor,
    currency: order.currency,
    siglume_challenge: challenge.challenge,
  });
}));

app.post("/checkout/siglume/pay", asyncRoute(async (req, res) => {
  const order = orders.get(String(req.body.order_id || ""));
  if (!order) {
    res.status(404).json({ error: "order_not_found" });
    return;
  }

  // In production, obtain this from the authenticated buyer's Siglume session
  // or a hosted Siglume payment confirmation flow. Do not use a merchant secret
  // to charge a customer wallet.
  const siglume = new DirectRequestPaymentClient({
    auth_token: String(req.headers.authorization || "").replace(/^Bearer\s+/i, ""),
  });

  const requirement = await siglume.createPaymentRequirement({
    merchant: "example_merchant",
    amount_minor: order.amount_minor,
    currency: order.currency,
    challenge: String(req.body.siglume_challenge || ""),
  });

  res.json({ requirement });
}));

app.post("/siglume/webhook", express.raw({ type: "application/json" }), asyncRoute(async (req, res) => {
  const header = String(req.headers["siglume-signature"] || "");
  const { event } = await verifyDirectRequestPaymentWebhook(
    process.env.SIGLUME_WEBHOOK_SECRET!,
    req.body,
    header,
  );

  if (event.type === "direct_payment.confirmed") {
    const challengeHash = String(event.data.challenge_hash || "");
    const order = [...orders.values()].find((item) => item.siglume_challenge_hash === challengeHash);
    if (order) {
      order.siglume_payment_status = "paid";
      order.siglume_requirement_id = event.data.requirement_id || event.data.direct_payment_requirement_id;
    }
  }

  res.status(204).send();
}));

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : "internal_error";
  res.status(500).json({ error: message });
});

app.listen(port);
