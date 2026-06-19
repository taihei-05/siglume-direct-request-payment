export type OrderStatus = "created" | "pending" | "paid" | "fulfilled_unsettled" | "review_required";

export interface Order {
  id: string;
  amount_minor: number;
  currency: "JPY" | "USD";
  payment_attempt: number;
  siglume_challenge_hash?: string;
  siglume_checkout_session_id?: string;
  siglume_requirement_id?: string;
  siglume_chain_receipt_id?: string;
  siglume_payment_status: OrderStatus;
}

const orders = new Map<string, Order>([
  [
    "order_123",
    {
      id: "order_123",
      amount_minor: 1200,
      currency: "JPY",
      payment_attempt: 0,
      siglume_payment_status: "created",
    },
  ],
]);

const processedWebhookEvents = new Set<string>();

export function getOrder(orderId: string): Order | undefined {
  return orders.get(orderId);
}

export function allOrders(): Order[] {
  return [...orders.values()];
}

export function saveOrder(order: Order): void {
  orders.set(order.id, order);
}

export function findOrderByChallengeHash(challengeHash: string): Order | undefined {
  return [...orders.values()].find((order) => order.siglume_challenge_hash === challengeHash);
}

export function markWebhookEventProcessedOnce(eventId: string): boolean {
  if (processedWebhookEvents.has(eventId)) {
    return false;
  }
  processedWebhookEvents.add(eventId);
  return true;
}
