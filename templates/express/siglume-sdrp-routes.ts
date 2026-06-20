import express from "express";
import {
  classifyDirectPaymentConfirmation,
  DirectRequestPaymentMerchantClient,
  HostedCheckoutNotAvailableError,
  verifyDirectRequestPaymentWebhook,
  type DirectRequestPaymentCurrency,
} from "@siglume/direct-request-payment";

export interface SiglumeCheckoutOrder {
  id: string;
  amount_minor: number;
  currency: DirectRequestPaymentCurrency | string;
}

export interface SiglumeCheckoutAttempt extends SiglumeCheckoutOrder {
  order_id: string;
  attempt_id: string;
  stable_nonce: string;
  checkout_url?: string;
  checkout_session_id?: string;
}

export interface SiglumeSdrpOrderStore {
  beginCheckoutAttempt(orderId: string, req: express.Request): Promise<SiglumeCheckoutAttempt | null>;
  markCheckoutPending(input: {
    order_id: string;
    attempt_id: string;
    stable_nonce: string;
    challenge_hash: string;
    checkout_session_id: string;
    checkout_url: string;
  }): Promise<void>;
  processWebhookEventOnce(
    eventId: string,
    handler: () => Promise<void>,
  ): Promise<"processed" | "duplicate">;
  findOrderByChallengeHash(challengeHash: string): Promise<{ id: string } | null>;
  markOrderPaidOnce(input: {
    order_id: string;
    requirement_id: string;
    chain_receipt_id: string;
  }): Promise<void>;
  markOrderFulfilledUnsettledOnce(input: {
    order_id: string;
    requirement_id: string;
    pricing_band: string;
  }): Promise<void>;
  flagPaymentReview(input: Record<string, unknown>): Promise<void>;
}

export interface SiglumeSdrpRouterOptions {
  merchant: string;
  merchant_auth_token: string;
  webhook_secret: string;
  shop_public_origin: string;
  order_store: SiglumeSdrpOrderStore;
  allow_metered_payments?: boolean;
}

export function createSiglumeSdrpCheckoutRouter(options: SiglumeSdrpRouterOptions): express.Router {
  const router = express.Router();
  const merchant = new DirectRequestPaymentMerchantClient({
    auth_token: options.merchant_auth_token,
  });

  router.post("/checkout/siglume/start", express.json(), async (req, res, next) => {
    try {
      const orderId = String(req.body?.order_id || "");
      const attempt = await options.order_store.beginCheckoutAttempt(orderId, req);
      if (!attempt) {
        res.status(404).json({ error: "order_not_found" });
        return;
      }

      if (!options.allow_metered_payments && !isStandardCheckoutAmount(attempt.currency, attempt.amount_minor)) {
        res.status(409).json({ error: "METERED_INTEGRATION_REQUIRED" });
        return;
      }

      if (attempt.checkout_url && attempt.checkout_session_id) {
        res.json({ checkout_url: attempt.checkout_url, session_id: attempt.checkout_session_id });
        return;
      }

      const session = await merchant.createCheckoutSession({
        merchant: options.merchant,
        amount_minor: attempt.amount_minor,
        currency: attempt.currency,
        nonce: attempt.stable_nonce,
        success_url: `${options.shop_public_origin}/checkout/siglume/success`,
        cancel_url: `${options.shop_public_origin}/checkout/siglume/cancel`,
        metadata: { order_id: attempt.order_id, attempt_id: attempt.attempt_id },
      });

      await options.order_store.markCheckoutPending({
        order_id: attempt.order_id,
        attempt_id: attempt.attempt_id,
        stable_nonce: attempt.stable_nonce,
        challenge_hash: session.challenge_hash,
        checkout_session_id: session.session_id,
        checkout_url: session.checkout_url,
      });

      res.json({ checkout_url: session.checkout_url, session_id: session.session_id });
    } catch (error) {
      next(error);
    }
  });

  router.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (error instanceof HostedCheckoutNotAvailableError) {
      res.status(409).json({ error: "hosted_checkout_not_enabled" });
      return;
    }
    next(error);
  });

  return router;
}

export function createSiglumeSdrpWebhookHandler(options: SiglumeSdrpRouterOptions): express.RequestHandler {
  return async (req, res, next) => {
    try {
      const { event } = await verifyDirectRequestPaymentWebhook(
        options.webhook_secret,
        req.body,
        req.header("siglume-signature") || "",
      );

      const result = await options.order_store.processWebhookEventOnce(event.id, async () => {
        await processSiglumeWebhookEvent(options, event);
      });

      if (result === "duplicate") {
        res.status(204).send();
        return;
      }

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  };
}

export function createSiglumeSdrpRouter(options: SiglumeSdrpRouterOptions): express.Router {
  const router = createSiglumeSdrpCheckoutRouter(options);
  router.post(
    "/webhooks/siglume",
    express.raw({ type: "application/json" }),
    createSiglumeSdrpWebhookHandler(options),
  );
  return router;
}

async function processSiglumeWebhookEvent(
  options: SiglumeSdrpRouterOptions,
  event: Awaited<ReturnType<typeof verifyDirectRequestPaymentWebhook>>["event"],
): Promise<void> {
  if (event.type !== "direct_payment.confirmed") {
    return;
  }

  const confirmation = classifyDirectPaymentConfirmation(event);

  if (confirmation.kind === "standard_settled") {
    const order = await options.order_store.findOrderByChallengeHash(confirmation.challenge_hash);
    if (order) {
      await options.order_store.markOrderPaidOnce({
        order_id: order.id,
        requirement_id: confirmation.requirement_id,
        chain_receipt_id: confirmation.chain_receipt_id,
      });
    } else {
      await options.order_store.flagPaymentReview({
        reason: "unknown_challenge_hash",
        requirement_id: confirmation.requirement_id,
      });
    }
    return;
  }

  if (confirmation.kind === "metered_usage_accepted") {
    if (!options.allow_metered_payments) {
      await options.order_store.flagPaymentReview({
        reason: "metered_integration_required",
        requirement_id: confirmation.requirement_id,
        pricing_band: confirmation.pricing_band,
      });
      return;
    }
    const order = await options.order_store.findOrderByChallengeHash(confirmation.challenge_hash);
    if (order) {
      await options.order_store.markOrderFulfilledUnsettledOnce({
        order_id: order.id,
        requirement_id: confirmation.requirement_id,
        pricing_band: confirmation.pricing_band,
      });
    } else {
      await options.order_store.flagPaymentReview({
        reason: "unknown_metered_challenge_hash",
        requirement_id: confirmation.requirement_id,
      });
    }
    return;
  }

  if (confirmation.kind === "metered_batch_settled") {
    await options.order_store.flagPaymentReview({
      reason: "metered_batch_settled_reconcile_statement_api",
      settlement_batch_id: confirmation.settlement_batch_id,
      chain_receipt_id: confirmation.chain_receipt_id,
    });
    return;
  }

  await options.order_store.flagPaymentReview({
    reason: confirmation.reason,
    requirement_id: confirmation.requirement_id,
    settlement_batch_id: confirmation.settlement_batch_id,
  });
}

function isStandardCheckoutAmount(currency: string, amountMinor: number): boolean {
  if (!Number.isSafeInteger(amountMinor)) return false;
  const normalizedCurrency = String(currency || "").toUpperCase();
  if (normalizedCurrency === "JPY") return amountMinor >= 501;
  if (normalizedCurrency === "USD") return amountMinor >= 301;
  return false;
}
