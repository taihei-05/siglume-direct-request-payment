import type { Request } from "express";

import type { SiglumeCheckoutOrder, SiglumeSdrpOrderStore } from "./siglume-sdrp-routes.js";

type Order = SiglumeCheckoutOrder & {
  status: "created" | "pending" | "paid" | "fulfilled_unsettled" | "review_required";
  challenge_hash?: string;
  checkout_session_id?: string;
  requirement_id?: string;
  chain_receipt_id?: string;
};

const orders = new Map<string, Order>([
  ["order_123", { id: "order_123", amount_minor: 1200, currency: "JPY", status: "created" }],
]);
const processedEvents = new Set<string>();

export const siglumeOrderStore: SiglumeSdrpOrderStore = {
  async getOrderForCheckout(orderId: string, _req: Request) {
    return orders.get(orderId) || null;
  },
  async markCheckoutPending(input) {
    const order = orders.get(input.order_id);
    if (!order) return;
    order.status = "pending";
    order.challenge_hash = input.challenge_hash;
    order.checkout_session_id = input.checkout_session_id;
  },
  async recordWebhookEventOnce(eventId) {
    if (processedEvents.has(eventId)) return false;
    processedEvents.add(eventId);
    return true;
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
