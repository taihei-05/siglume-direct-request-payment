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

export interface SiglumeSdrpOrderStore {
  getOrderForCheckout(orderId: string, req: express.Request): Promise<SiglumeCheckoutOrder | null>;
  markCheckoutPending(input: {
    order_id: string;
    challenge_hash: string;
    checkout_session_id: string;
  }): Promise<void>;
  recordWebhookEventOnce(eventId: string): Promise<boolean>;
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
}

export function createSiglumeSdrpRouter(options: SiglumeSdrpRouterOptions): express.Router {
  const router = express.Router();
  const merchant = new DirectRequestPaymentMerchantClient({
    auth_token: options.merchant_auth_token,
  });

  router.post("/checkout/siglume/start", express.json(), async (req, res, next) => {
    try {
      const orderId = String(req.body?.order_id || "");
      const order = await options.order_store.getOrderForCheckout(orderId, req);
      if (!order) {
        res.status(404).json({ error: "order_not_found" });
        return;
      }

      const session = await merchant.createCheckoutSession({
        merchant: options.merchant,
        amount_minor: order.amount_minor,
        currency: order.currency,
        nonce: `${order.id}-attempt_${Date.now()}`,
        success_url: `${options.shop_public_origin}/checkout/siglume/success`,
        cancel_url: `${options.shop_public_origin}/checkout/siglume/cancel`,
        metadata: { order_id: order.id },
      });

      await options.order_store.markCheckoutPending({
        order_id: order.id,
        challenge_hash: session.challenge_hash,
        checkout_session_id: session.session_id,
      });

      res.json({ checkout_url: session.checkout_url, session_id: session.session_id });
    } catch (error) {
      next(error);
    }
  });

  router.post("/webhooks/siglume", express.raw({ type: "application/json" }), async (req, res, next) => {
    try {
      const { event } = await verifyDirectRequestPaymentWebhook(
        options.webhook_secret,
        req.body,
        req.header("siglume-signature") || "",
      );

      if (!(await options.order_store.recordWebhookEventOnce(event.id))) {
        res.status(204).send();
        return;
      }

      if (event.type === "direct_payment.confirmed") {
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
        } else if (confirmation.kind === "metered_usage_accepted") {
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
        } else if (confirmation.kind === "metered_batch_settled") {
          await options.order_store.flagPaymentReview({
            reason: "metered_batch_settled_reconcile_statement_api",
            settlement_batch_id: confirmation.settlement_batch_id,
            chain_receipt_id: confirmation.chain_receipt_id,
          });
        } else {
          await options.order_store.flagPaymentReview({
            reason: confirmation.reason,
            requirement_id: confirmation.requirement_id,
            settlement_batch_id: confirmation.settlement_batch_id,
          });
        }
      }

      res.status(204).send();
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
