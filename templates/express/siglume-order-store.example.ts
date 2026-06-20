import type { Request } from "express";

import type { SiglumeCheckoutAttempt, SiglumeCheckoutOrder, SiglumeSdrpOrderStore } from "./siglume-sdrp-routes.js";

type Order = SiglumeCheckoutOrder & {
  status: "created" | "pending" | "paid" | "fulfilled_unsettled" | "review_required";
  attempt_id?: string;
  stable_nonce?: string;
  challenge_hash?: string;
  checkout_url?: string;
  checkout_session_id?: string;
  requirement_id?: string;
  chain_receipt_id?: string;
};

const orders = new Map<string, Order>([
  ["order_123", { id: "order_123", amount_minor: 1200, currency: "JPY", status: "created" }],
]);
const processedEvents = new Set<string>();

export const siglumeOrderStore: SiglumeSdrpOrderStore = {
  async beginCheckoutAttempt(orderId: string, _req: Request): Promise<SiglumeCheckoutAttempt | null> {
    const order = orders.get(orderId);
    if (!order) return null;
    order.attempt_id ||= `${order.id}_attempt_1`;
    order.stable_nonce ||= `${order.id}-attempt_1`;
    return {
      ...order,
      order_id: order.id,
      attempt_id: order.attempt_id,
      stable_nonce: order.stable_nonce,
    };
  },
  async markCheckoutPending(input) {
    const order = orders.get(input.order_id);
    if (!order) return;
    order.status = "pending";
    order.attempt_id = input.attempt_id;
    order.stable_nonce = input.stable_nonce;
    order.challenge_hash = input.challenge_hash;
    order.checkout_session_id = input.checkout_session_id;
    order.checkout_url = input.checkout_url;
  },
  async processWebhookEventOnce(eventId, handler) {
    if (processedEvents.has(eventId)) return "duplicate";
    await handler();
    processedEvents.add(eventId);
    return "processed";
  },
  async findOrderByChallengeHash(challengeHash) {
    return [...orders.values()].find((order) => order.challenge_hash === challengeHash) || null;
  },
  async markOrderPaidOnce(input) {
    const order = orders.get(input.order_id);
    if (!order || order.status === "paid") return;
    order.status = "paid";
    order.requirement_id = input.requirement_id;
    order.chain_receipt_id = input.chain_receipt_id;
  },
  async markOrderFulfilledUnsettledOnce(input) {
    const order = orders.get(input.order_id);
    if (!order || order.status === "fulfilled_unsettled") return;
    order.status = "fulfilled_unsettled";
    order.requirement_id = input.requirement_id;
  },
  async flagPaymentReview(input) {
    console.warn("payment review required", input);
  },
};
