import { createHash, randomUUID } from "node:crypto";
import type { DocumentData, Firestore, Transaction } from "@google-cloud/firestore";
import type { Request } from "express";

import { OrderAuthorizationRequiredError, type SiglumeCheckoutAttempt, type SiglumeSdrpOrderStore } from "./siglume-sdrp-routes.js";

export interface FirestoreSiglumeOrderStoreOptions {
  db: Firestore;
  orders_collection?: string;
  order_id_field?: string;
  amount_minor_field?: string;
  currency_field?: string;
  order_status_field?: string | null;
  order_updated_at_field?: string | null;
  checkout_attempts_collection?: string;
  webhook_events_collection?: string;
  payment_reviews_collection?: string;
  authorize_order?: (order: Record<string, unknown>, req: Request) => boolean | Promise<boolean>;
  allow_unverified_order_lookup?: boolean;
}

interface NormalizedOptions {
  db: Firestore;
  orders_collection: string;
  order_id_field: string;
  amount_minor_field: string;
  currency_field: string;
  order_status_field: string | null;
  order_updated_at_field: string | null;
  checkout_attempts_collection: string;
  webhook_events_collection: string;
  payment_reviews_collection: string;
  authorize_order?: (order: Record<string, unknown>, req: Request) => boolean | Promise<boolean>;
  allow_unverified_order_lookup: boolean;
}

const CHECKOUT_CREATION_LEASE_MS = 30_000;
const CHECKOUT_CREATION_WAIT_MS = 10_000;
const CHECKOUT_CREATION_POLL_MS = 100;
const WEBHOOK_PROCESSING_STALE_MS = 10 * 60 * 1000;

export function createFirestoreSiglumeOrderStore(options: FirestoreSiglumeOrderStoreOptions): SiglumeSdrpOrderStore {
  return new FirestoreSiglumeOrderStore(normalizeOptions(options));
}

export async function createFirestoreSiglumeCollections(_options: FirestoreSiglumeOrderStoreOptions): Promise<void> {
  return;
}

class FirestoreSiglumeOrderStore implements SiglumeSdrpOrderStore {
  constructor(private readonly options: NormalizedOptions) {}

  async beginCheckoutAttempt(orderId: string, req: Request): Promise<SiglumeCheckoutAttempt | null> {
    const cleanOrderId = requireText(orderId, "order_id");
    const waitUntil = Date.now() + CHECKOUT_CREATION_WAIT_MS;
    for (;;) {
      const order = await this.findProductOrder(cleanOrderId);
      if (!order) return null;
      if (!(await authorizeOrderOrFailClosed(this.options, order, req))) return null;

      const result = await this.options.db.runTransaction(async (tx) => {
        const activeRef = this.activeRef(cleanOrderId);
        const activeSnap = await tx.get(activeRef);
        const active = activeSnap.exists ? activeSnap.data() ?? null : null;
        if (active && isReusableCheckoutAttempt(active)) {
          return { done: true, attempt: this.toCheckoutAttempt(order, active) };
        }
        if (active && isCreatingCheckoutAttempt(active) && !timestampHasPassed(active.creation_lease_expires_at)) {
          return { done: false, attempt: this.toCheckoutAttempt(order, active, true) };
        }
        if (active) this.releaseAttemptHistoryTx(tx, active, active.status === "pending" ? "expired" : "failed");

        const attemptNumber = active ? Number(active.attempt_number || 0) + 1 : await this.nextAttemptNumber(cleanOrderId);
        const attempt = stableAttempt(cleanOrderId, attemptNumber);
        const item = {
          item_type: "attempt",
          order_id: cleanOrderId,
          attempt_number: attemptNumber,
          attempt_id: attempt.attempt_id,
          stable_nonce: attempt.stable_nonce,
          status: "creating",
          creation_owner_id: `sdrp_create_${randomUUID()}`,
          creation_lease_expires_at: timestamp(Date.now() + CHECKOUT_CREATION_LEASE_MS),
          created_at: timestamp(),
          updated_at: timestamp(),
        };
        if (active) tx.set(activeRef, { ...item, item_type: "active", active_key: cleanOrderId });
        else tx.create(activeRef, { ...item, item_type: "active", active_key: cleanOrderId });
        tx.create(this.attemptRef(attempt.attempt_id), item);
        return {
          done: true,
          attempt: {
            id: String(order.id),
            order_id: String(order.id),
            amount_minor: Number(order.amount_minor),
            currency: String(order.currency),
            attempt_number: attemptNumber,
            attempt_id: attempt.attempt_id,
            stable_nonce: attempt.stable_nonce,
            status: "creating",
          } satisfies SiglumeCheckoutAttempt,
        };
      });

      if (result.done) return result.attempt;
      if (Date.now() >= waitUntil) return result.attempt;
      await sleep(CHECKOUT_CREATION_POLL_MS);
    }
  }

  async markCheckoutPending(input: {
    order_id: string;
    attempt_id: string;
    stable_nonce: string;
    challenge_hash: string;
    checkout_session_id: string;
    checkout_url: string;
    expires_at?: string | null;
  }): Promise<void> {
    await this.options.db.runTransaction(async (tx) => {
      const patch = {
        status: "pending",
        stable_nonce: input.stable_nonce,
        challenge_hash: input.challenge_hash,
        checkout_session_id: input.checkout_session_id,
        checkout_url: input.checkout_url,
        expires_at: timestampOrNull(input.expires_at),
        creation_owner_id: null,
        creation_lease_expires_at: null,
        error_message: null,
        updated_at: timestamp(),
      };
      tx.update(this.activeRef(input.order_id), patch);
      tx.update(this.attemptRef(input.attempt_id), patch);
    });
  }

  async markCheckoutFailed(input: {
    order_id: string;
    attempt_id: string;
    error_message?: string;
  }): Promise<void> {
    await this.options.db.runTransaction(async (tx) => {
      tx.delete(this.activeRef(input.order_id));
      tx.update(this.attemptRef(input.attempt_id), {
        status: "failed",
        failed_at: timestamp(),
        error_message: textOrNull(input.error_message),
        creation_owner_id: null,
        creation_lease_expires_at: null,
        updated_at: timestamp(),
      });
    });
  }

  async processWebhookEventOnce(eventId: string, handler: () => Promise<void>): Promise<"processed" | "duplicate"> {
    const cleanEventId = requireText(eventId, "event_id");
    const eventRef = this.eventRef(cleanEventId);
    const claimed = await this.options.db.runTransaction(async (tx) => {
      const snap = await tx.get(eventRef);
      const existing = snap.exists ? snap.data() ?? null : null;
      if (existing?.status === "processed") return false;
      if (existing?.status === "processing" && !webhookProcessingIsStale(existing.created_at)) return false;
      tx.set(eventRef, {
        event_id: cleanEventId,
        status: "processing",
        error_message: null,
        processed_at: null,
        created_at: timestamp(),
      }, { merge: true });
      return true;
    });
    if (!claimed) return "duplicate";

    try {
      await handler();
      await eventRef.set({ status: "processed", error_message: null, processed_at: timestamp() }, { merge: true });
      return "processed";
    } catch (error) {
      await eventRef.set({ status: "failed", error_message: errorMessage(error), processed_at: null }, { merge: true });
      throw error;
    }
  }

  async findOrderByChallengeHash(challengeHash: string): Promise<{ id: string } | null> {
    const snap = await this.attempts().where("challenge_hash", "==", challengeHash).limit(1).get();
    const doc = snap.docs[0];
    const row = doc?.data();
    return row?.order_id ? { id: String(row.order_id) } : null;
  }

  async markOrderPaidOnce(input: {
    order_id: string;
    requirement_id: string;
    chain_receipt_id: string;
  }): Promise<void> {
    await this.options.db.runTransaction(async (tx) => {
      const activeSnap = await tx.get(this.activeRef(input.order_id));
      if (!activeSnap.exists) return;
      const active = activeSnap.data() ?? {};
      if (isTerminal(active.status, "paid")) return;
      tx.delete(this.activeRef(input.order_id));
      tx.update(this.attemptRef(String(active.attempt_id)), {
        status: "paid",
        requirement_id: input.requirement_id,
        chain_receipt_id: input.chain_receipt_id,
        paid_at: timestamp(),
        updated_at: timestamp(),
      });
      this.updateOrderStatusTx(tx, input.order_id, "paid");
    });
  }

  async markOrderFulfilledUnsettledOnce(input: {
    order_id: string;
    requirement_id: string;
    pricing_band: string;
  }): Promise<void> {
    await this.options.db.runTransaction(async (tx) => {
      const activeSnap = await tx.get(this.activeRef(input.order_id));
      if (!activeSnap.exists) return;
      const active = activeSnap.data() ?? {};
      if (isTerminal(active.status, "fulfilled_unsettled")) return;
      tx.delete(this.activeRef(input.order_id));
      tx.update(this.attemptRef(String(active.attempt_id)), {
        status: "fulfilled_unsettled",
        requirement_id: input.requirement_id,
        pricing_band: input.pricing_band,
        fulfilled_unsettled_at: timestamp(),
        updated_at: timestamp(),
      });
      this.updateOrderStatusTx(tx, input.order_id, "fulfilled_unsettled");
    });
  }

  async flagPaymentReview(input: Record<string, unknown>): Promise<void> {
    await this.reviews().doc(`sdrp_review_${hash(`${Date.now()}:${JSON.stringify(input)}`).slice(0, 24)}`).set({
      order_id: textOrNull(input.order_id),
      reason: String(input.reason || "manual_review_required"),
      payload_json: input,
      created_at: timestamp(),
    });
  }

  private async findProductOrder(orderId: string): Promise<Record<string, unknown> | null> {
    const snap = await this.orders().doc(orderId).get();
    if (!snap.exists) return null;
    const row = snap.data() ?? {};
    return {
      ...row,
      id: row[this.options.order_id_field] ?? snap.id,
      amount_minor: row[this.options.amount_minor_field],
      currency: row[this.options.currency_field],
    };
  }

  private async nextAttemptNumber(orderId: string): Promise<number> {
    const snap = await this.attempts().where("order_id", "==", orderId).get();
    let current = 0;
    for (const doc of snap.docs) {
      const attemptNumber = Number(doc.data().attempt_number || 0);
      if (Number.isSafeInteger(attemptNumber) && attemptNumber > current) current = attemptNumber;
    }
    return current > 0 ? current + 1 : 1;
  }

  private releaseAttemptHistoryTx(tx: Transaction, active: DocumentData, status: "expired" | "failed"): void {
    const timestampField = status === "expired" ? "expires_at" : "failed_at";
    tx.update(this.attemptRef(String(active.attempt_id)), {
      status,
      [timestampField]: active[timestampField] ?? timestamp(),
      creation_owner_id: null,
      creation_lease_expires_at: null,
      updated_at: timestamp(),
    });
  }

  private updateOrderStatusTx(tx: Transaction, orderId: string, status: string): void {
    const patch: Record<string, unknown> = {};
    if (this.options.order_status_field) patch[this.options.order_status_field] = status;
    if (this.options.order_updated_at_field) patch[this.options.order_updated_at_field] = timestamp();
    if (Object.keys(patch).length) tx.update(this.orders().doc(orderId), patch);
  }

  private toCheckoutAttempt(order: Record<string, unknown>, state: Record<string, unknown>, pending = false): SiglumeCheckoutAttempt {
    return {
      id: String(order.id),
      order_id: String(order.id),
      amount_minor: Number(order.amount_minor),
      currency: String(order.currency),
      attempt_number: Number(state.attempt_number || 1),
      attempt_id: String(state.attempt_id),
      stable_nonce: String(state.stable_nonce),
      status: String(state.status || ""),
      checkout_session_id: textOrUndefined(state.checkout_session_id),
      checkout_url: textOrUndefined(state.checkout_url),
      expires_at: timestampTextOrNull(state.expires_at),
      checkout_creation_pending: pending,
    };
  }

  private orders() {
    return this.options.db.collection(this.options.orders_collection);
  }

  private attempts() {
    return this.options.db.collection(this.options.checkout_attempts_collection);
  }

  private reviews() {
    return this.options.db.collection(this.options.payment_reviews_collection);
  }

  private activeRef(orderId: string) {
    return this.attempts().doc(`active_${hash(orderId).slice(0, 32)}`);
  }

  private attemptRef(attemptId: string) {
    return this.attempts().doc(`attempt_${attemptId}`);
  }

  private eventRef(eventId: string) {
    return this.options.db.collection(this.options.webhook_events_collection).doc(`event_${hash(eventId).slice(0, 32)}`);
  }
}

function normalizeOptions(options: FirestoreSiglumeOrderStoreOptions): NormalizedOptions {
  return {
    db: options.db,
    orders_collection: options.orders_collection ?? "orders",
    order_id_field: options.order_id_field ?? "id",
    amount_minor_field: options.amount_minor_field ?? "amount_minor",
    currency_field: options.currency_field ?? "currency",
    order_status_field: options.order_status_field === undefined ? "status" : options.order_status_field,
    order_updated_at_field: options.order_updated_at_field === undefined ? "updated_at" : options.order_updated_at_field,
    checkout_attempts_collection: options.checkout_attempts_collection ?? "siglume_checkout_attempts",
    webhook_events_collection: options.webhook_events_collection ?? "siglume_webhook_events",
    payment_reviews_collection: options.payment_reviews_collection ?? "siglume_payment_reviews",
    authorize_order: options.authorize_order,
    allow_unverified_order_lookup: options.allow_unverified_order_lookup === true,
  };
}

async function authorizeOrderOrFailClosed(
  options: Pick<NormalizedOptions, "authorize_order" | "allow_unverified_order_lookup">,
  order: Record<string, unknown>,
  req: Request,
): Promise<boolean> {
  if (options.authorize_order) return Boolean(await options.authorize_order(order, req));
  if (options.allow_unverified_order_lookup) return true;
  throw new OrderAuthorizationRequiredError();
}

function stableAttempt(orderId: string, attemptNumber: number): { attempt_id: string; stable_nonce: string } {
  const digest = hash(`${orderId}:${attemptNumber}`).slice(0, 32);
  return {
    attempt_id: `sdrp_attempt_${digest}`,
    stable_nonce: `sdrp-${digest}`,
  };
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function requireText(value: string, name: string): string {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${name} is required.`);
  return text;
}

function timestamp(value: number | string | Date = Date.now()): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString();
}

function timestampOrNull(value: unknown): string | null {
  if (!value) return null;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? timestamp(parsed) : null;
}

function timestampTextOrNull(value: unknown): string | null {
  if (!value) return null;
  return String(value);
}

function timestampHasPassed(value: unknown): boolean {
  if (!value) return false;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) && parsed <= Date.now();
}

function webhookProcessingIsStale(value: unknown): boolean {
  if (!value) return false;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) && Date.now() - parsed > WEBHOOK_PROCESSING_STALE_MS;
}

function isReusableCheckoutAttempt(state: Record<string, unknown>): boolean {
  return String(state.status || "") === "pending"
    && Boolean(textOrUndefined(state.checkout_session_id))
    && Boolean(textOrUndefined(state.checkout_url))
    && !timestampHasPassed(state.expires_at);
}

function isCreatingCheckoutAttempt(state: Record<string, unknown>): boolean {
  return String(state.status || "") === "creating";
}

function isTerminal(value: unknown, currentTerminal: string): boolean {
  const status = String(value || "");
  return ["paid", "expired", "cancelled", "failed", currentTerminal].includes(status);
}

function textOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 1000);
  return String(error || "webhook handler failed").slice(0, 1000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
