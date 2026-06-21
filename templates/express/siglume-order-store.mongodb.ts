import { createHash, randomUUID } from "node:crypto";
import type { Collection, Db, Document, MongoServerError, WithId } from "mongodb";
import type { Request } from "express";

import { OrderAuthorizationRequiredError, type SiglumeCheckoutAttempt, type SiglumeSdrpOrderStore } from "./siglume-sdrp-routes.js";

export interface MongoSiglumeOrderStoreOptions {
  db: Db;
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
  db: Db;
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

export function createMongoSiglumeOrderStore(options: MongoSiglumeOrderStoreOptions): SiglumeSdrpOrderStore {
  return new MongoSiglumeOrderStore(normalizeOptions(options));
}

export async function createMongoSiglumeIndexes(options: MongoSiglumeOrderStoreOptions): Promise<void> {
  const normalized = normalizeOptions(options);
  const attempts = normalized.db.collection(normalized.checkout_attempts_collection);
  const events = normalized.db.collection(normalized.webhook_events_collection);
  const reviews = normalized.db.collection(normalized.payment_reviews_collection);
  await attempts.createIndex({ active_key: 1 }, { unique: true, sparse: true });
  await attempts.createIndex({ challenge_hash: 1 }, { unique: true, sparse: true });
  await attempts.createIndex({ order_id: 1, attempt_number: 1 }, { unique: true });
  await events.createIndex({ event_id: 1 }, { unique: true });
  await reviews.createIndex({ order_id: 1 });
}

class MongoSiglumeOrderStore implements SiglumeSdrpOrderStore {
  constructor(private readonly options: NormalizedOptions) {}

  async beginCheckoutAttempt(orderId: string, req: Request): Promise<SiglumeCheckoutAttempt | null> {
    const cleanOrderId = requireText(orderId, "order_id");
    const waitUntil = Date.now() + CHECKOUT_CREATION_WAIT_MS;
    for (;;) {
      const order = await this.findProductOrder(cleanOrderId);
      if (!order) return null;
      if (!(await authorizeOrderOrFailClosed(this.options, order, req))) return null;

      const active = await this.attempts().findOne({ active_key: cleanOrderId });
      if (active && isReusableCheckoutAttempt(active)) return this.toCheckoutAttempt(order, active);
      if (active && isCreatingCheckoutAttempt(active) && !timestampHasPassed(active.creation_lease_expires_at)) {
        if (Date.now() >= waitUntil) return this.toCheckoutAttempt(order, active, true);
        await sleep(CHECKOUT_CREATION_POLL_MS);
        continue;
      }
      if (active) await this.releaseInactiveAttempt(active, active.status === "pending" ? "expired" : "failed");

      const attemptNumber = active ? Number(active.attempt_number || 0) + 1 : await this.nextAttemptNumber(cleanOrderId);
      const attempt = stableAttempt(cleanOrderId, attemptNumber);
      try {
        await this.attempts().insertOne({
          order_id: cleanOrderId,
          attempt_number: attemptNumber,
          attempt_id: attempt.attempt_id,
          stable_nonce: attempt.stable_nonce,
          active_key: cleanOrderId,
          status: "creating",
          creation_owner_id: `sdrp_create_${randomUUID()}`,
          creation_lease_expires_at: timestamp(Date.now() + CHECKOUT_CREATION_LEASE_MS),
          created_at: timestamp(),
          updated_at: timestamp(),
        });
        return {
          id: String(order.id),
          order_id: String(order.id),
          amount_minor: Number(order.amount_minor),
          currency: String(order.currency),
          attempt_number: attemptNumber,
          attempt_id: attempt.attempt_id,
          stable_nonce: attempt.stable_nonce,
          status: "creating",
        };
      } catch (error) {
        if (isDuplicateKey(error)) {
          if (Date.now() >= waitUntil) return this.toCheckoutAttempt(order, {
            order_id: cleanOrderId,
            attempt_number: attemptNumber,
            attempt_id: attempt.attempt_id,
            stable_nonce: attempt.stable_nonce,
            status: "creating",
          }, true);
          await sleep(CHECKOUT_CREATION_POLL_MS);
          continue;
        }
        throw error;
      }
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
    await this.attempts().updateOne(
      { order_id: input.order_id, attempt_id: input.attempt_id, status: "creating" },
      {
        $set: {
          status: "pending",
          stable_nonce: input.stable_nonce,
          challenge_hash: input.challenge_hash,
          checkout_session_id: input.checkout_session_id,
          checkout_url: input.checkout_url,
          expires_at: timestampOrNull(input.expires_at),
          updated_at: timestamp(),
        },
        $unset: {
          creation_owner_id: "",
          creation_lease_expires_at: "",
          error_message: "",
        },
      },
    );
  }

  async markCheckoutFailed(input: {
    order_id: string;
    attempt_id: string;
    error_message?: string;
  }): Promise<void> {
    await this.attempts().updateOne(
      { order_id: input.order_id, attempt_id: input.attempt_id, status: "creating" },
      {
        $set: {
          status: "failed",
          failed_at: timestamp(),
          error_message: textOrNull(input.error_message),
          updated_at: timestamp(),
        },
        $unset: {
          active_key: "",
          creation_owner_id: "",
          creation_lease_expires_at: "",
        },
      },
    );
  }

  async processWebhookEventOnce(eventId: string, handler: () => Promise<void>): Promise<"processed" | "duplicate"> {
    const cleanEventId = requireText(eventId, "event_id");
    const existing = await this.events().findOne({ event_id: cleanEventId });
    if (existing?.status === "processed") return "duplicate";
    if (existing?.status === "processing" && !webhookProcessingIsStale(existing.created_at)) return "duplicate";

    if (existing) {
      await this.events().updateOne(
        { event_id: cleanEventId },
        { $set: { status: "processing", error_message: null, processed_at: null, created_at: timestamp() } },
      );
    } else {
      try {
        await this.events().insertOne({ event_id: cleanEventId, status: "processing", created_at: timestamp(), processed_at: null });
      } catch (error) {
        if (isDuplicateKey(error)) return "duplicate";
        throw error;
      }
    }

    try {
      await handler();
      await this.events().updateOne(
        { event_id: cleanEventId },
        { $set: { status: "processed", error_message: null, processed_at: timestamp() } },
      );
      return "processed";
    } catch (error) {
      await this.events().updateOne(
        { event_id: cleanEventId },
        { $set: { status: "failed", error_message: errorMessage(error), processed_at: null } },
      );
      throw error;
    }
  }

  async findOrderByChallengeHash(challengeHash: string): Promise<{ id: string } | null> {
    const row = await this.attempts().findOne({ challenge_hash: challengeHash });
    return row?.order_id ? { id: String(row.order_id) } : null;
  }

  async markOrderPaidOnce(input: {
    order_id: string;
    requirement_id: string;
    chain_receipt_id: string;
  }): Promise<void> {
    const changed = await this.attempts().updateOne(
      { order_id: input.order_id, status: { $nin: ["paid", "expired", "cancelled", "failed"] } },
      {
        $set: {
          status: "paid",
          requirement_id: input.requirement_id,
          chain_receipt_id: input.chain_receipt_id,
          paid_at: timestamp(),
          updated_at: timestamp(),
        },
        $unset: { active_key: "" },
      },
    );
    if (this.options.order_status_field && (changed.modifiedCount > 0 || await this.hasAttemptStatus(input.order_id, "paid"))) {
      await this.updateProductOrderStatus(input.order_id, "paid");
    }
  }

  async markOrderFulfilledUnsettledOnce(input: {
    order_id: string;
    requirement_id: string;
    pricing_band: string;
  }): Promise<void> {
    const changed = await this.attempts().updateOne(
      { order_id: input.order_id, status: { $nin: ["fulfilled_unsettled", "paid", "expired", "cancelled", "failed"] } },
      {
        $set: {
          status: "fulfilled_unsettled",
          requirement_id: input.requirement_id,
          pricing_band: input.pricing_band,
          fulfilled_unsettled_at: timestamp(),
          updated_at: timestamp(),
        },
        $unset: { active_key: "" },
      },
    );
    if (this.options.order_status_field && (changed.modifiedCount > 0 || await this.hasAttemptStatus(input.order_id, "fulfilled_unsettled"))) {
      await this.updateProductOrderStatus(input.order_id, "fulfilled_unsettled");
    }
  }

  async flagPaymentReview(input: Record<string, unknown>): Promise<void> {
    await this.reviews().insertOne({
      review_id: `sdrp_review_${hash(`${Date.now()}:${JSON.stringify(input)}`).slice(0, 24)}`,
      order_id: textOrNull(input.order_id),
      reason: String(input.reason || "manual_review_required"),
      payload_json: input,
      created_at: timestamp(),
    });
  }

  private async findProductOrder(orderId: string): Promise<Record<string, unknown> | null> {
    const row = await this.orders().findOne(this.orderFilter(orderId));
    if (!row) return null;
    return {
      ...row,
      id: row[this.options.order_id_field] ?? row._id ?? orderId,
      amount_minor: row[this.options.amount_minor_field],
      currency: row[this.options.currency_field],
    };
  }

  private async nextAttemptNumber(orderId: string): Promise<number> {
    const latest = await this.attempts().find({ order_id: orderId }).sort({ attempt_number: -1 }).limit(1).next();
    const current = Number(latest?.attempt_number || 0);
    return Number.isSafeInteger(current) && current > 0 ? current + 1 : 1;
  }

  private async releaseInactiveAttempt(attempt: WithId<Document>, status: "expired" | "failed"): Promise<void> {
    const timestampField = status === "expired" ? "expires_at" : "failed_at";
    await this.attempts().updateOne(
      { _id: attempt._id },
      {
        $set: { status, [timestampField]: attempt[timestampField] ?? timestamp(), updated_at: timestamp() },
        $unset: { active_key: "", creation_owner_id: "", creation_lease_expires_at: "" },
      },
    );
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

  private orderFilter(orderId: string): Record<string, unknown> {
    return { [this.options.order_id_field]: orderId };
  }

  private async hasAttemptStatus(orderId: string, status: "paid" | "fulfilled_unsettled"): Promise<boolean> {
    return Boolean(await this.attempts().findOne({ order_id: orderId, status }));
  }

  private async updateProductOrderStatus(orderId: string, status: "paid" | "fulfilled_unsettled"): Promise<void> {
    if (!this.options.order_status_field) return;
    const update: Record<string, unknown> = { [this.options.order_status_field]: status };
    if (this.options.order_updated_at_field) update[this.options.order_updated_at_field] = timestamp();
    await this.orders().updateOne(this.orderFilter(orderId), { $set: update });
  }

  private orders(): Collection {
    return this.options.db.collection(this.options.orders_collection);
  }

  private attempts(): Collection {
    return this.options.db.collection(this.options.checkout_attempts_collection);
  }

  private events(): Collection {
    return this.options.db.collection(this.options.webhook_events_collection);
  }

  private reviews(): Collection {
    return this.options.db.collection(this.options.payment_reviews_collection);
  }
}

function normalizeOptions(options: MongoSiglumeOrderStoreOptions): NormalizedOptions {
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
  if (value instanceof Date) return value.toISOString();
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

function isDuplicateKey(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as MongoServerError).code === 11000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
