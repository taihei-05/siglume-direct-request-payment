import { createHash, randomUUID } from "node:crypto";
import {
  CreateTableCommand,
  DescribeTableCommand,
  type DynamoDBClient,
  waitUntilTableExists,
} from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type { Request } from "express";

import type { SiglumeCheckoutAttempt, SiglumeSdrpOrderStore } from "./siglume-sdrp-routes.js";

export interface DynamoDbSiglumeOrderStoreOptions {
  client: DynamoDBDocumentClient;
  orders_table?: string;
  order_id_attribute?: string;
  amount_minor_attribute?: string;
  currency_attribute?: string;
  order_status_attribute?: string | null;
  order_updated_at_attribute?: string | null;
  checkout_attempts_table?: string;
  webhook_events_table?: string;
  payment_reviews_table?: string;
  challenge_hash_index?: string;
  order_id_index?: string;
  authorize_order?: (order: Record<string, unknown>, req: Request) => boolean | Promise<boolean>;
}

export interface DynamoDbSiglumeTableOptions extends Omit<DynamoDbSiglumeOrderStoreOptions, "client" | "authorize_order"> {
  client: DynamoDBClient;
  include_orders_table?: boolean;
}

interface NormalizedOptions {
  client: DynamoDBDocumentClient;
  orders_table: string;
  order_id_attribute: string;
  amount_minor_attribute: string;
  currency_attribute: string;
  order_status_attribute: string | null;
  order_updated_at_attribute: string | null;
  checkout_attempts_table: string;
  webhook_events_table: string;
  payment_reviews_table: string;
  challenge_hash_index: string;
  order_id_index: string;
  authorize_order?: (order: Record<string, unknown>, req: Request) => boolean | Promise<boolean>;
}

const CHECKOUT_CREATION_LEASE_MS = 30_000;
const CHECKOUT_CREATION_WAIT_MS = 10_000;
const CHECKOUT_CREATION_POLL_MS = 100;
const WEBHOOK_PROCESSING_STALE_MS = 10 * 60 * 1000;

export function createDynamoDbSiglumeOrderStore(options: DynamoDbSiglumeOrderStoreOptions): SiglumeSdrpOrderStore {
  return new DynamoDbSiglumeOrderStore(normalizeOptions(options));
}

export async function createDynamoDbSiglumeTables(options: DynamoDbSiglumeTableOptions): Promise<void> {
  const normalized = normalizeTableOptions(options);
  if (options.include_orders_table !== false) {
    await createTableIfMissing(normalized.client, normalized.orders_table, normalized.order_id_attribute);
  }
  await createAttemptsTableIfMissing(
    normalized.client,
    normalized.checkout_attempts_table,
    normalized.challenge_hash_index,
    normalized.order_id_index,
  );
  await createTableIfMissing(normalized.client, normalized.webhook_events_table, "event_id");
  await createTableIfMissing(normalized.client, normalized.payment_reviews_table, "review_id");
}

class DynamoDbSiglumeOrderStore implements SiglumeSdrpOrderStore {
  constructor(private readonly options: NormalizedOptions) {}

  async beginCheckoutAttempt(orderId: string, req: Request): Promise<SiglumeCheckoutAttempt | null> {
    const cleanOrderId = requireText(orderId, "order_id");
    const waitUntil = Date.now() + CHECKOUT_CREATION_WAIT_MS;
    for (;;) {
      const order = await this.findProductOrder(cleanOrderId);
      if (!order) return null;
      if (this.options.authorize_order && !(await this.options.authorize_order(order, req))) return null;

      const active = await this.getActiveAttempt(cleanOrderId);
      if (active && isReusableCheckoutAttempt(active)) return this.toCheckoutAttempt(order, active);
      if (active && isCreatingCheckoutAttempt(active) && !timestampHasPassed(active.creation_lease_expires_at)) {
        if (Date.now() >= waitUntil) return this.toCheckoutAttempt(order, active, true);
        await sleep(CHECKOUT_CREATION_POLL_MS);
        continue;
      }
      if (active) await this.releaseInactiveAttempt(active, active.status === "pending" ? "expired" : "failed");

      const attemptNumber = active ? Number(active.attempt_number || 0) + 1 : await this.nextAttemptNumber(cleanOrderId);
      const attempt = stableAttempt(cleanOrderId, attemptNumber);
      const item = {
        pk: attemptPk(attempt.attempt_id),
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
      const activeItem = { ...item, pk: activePk(cleanOrderId), item_type: "active" };
      try {
        await this.options.client.send(new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: this.options.checkout_attempts_table,
                Item: activeItem,
                ConditionExpression: "attribute_not_exists(pk)",
              },
            },
            {
              Put: {
                TableName: this.options.checkout_attempts_table,
                Item: item,
                ConditionExpression: "attribute_not_exists(pk)",
              },
            },
          ],
        }));
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
        if (isConditionalFailure(error)) {
          if (Date.now() >= waitUntil) return this.toCheckoutAttempt(order, activeItem, true);
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
    const values = {
      ":pending": "pending",
      ":creating": "creating",
      ":stable_nonce": input.stable_nonce,
      ":challenge_hash": input.challenge_hash,
      ":checkout_session_id": input.checkout_session_id,
      ":checkout_url": input.checkout_url,
      ":expires_at": timestampOrNull(input.expires_at),
      ":updated_at": timestamp(),
    };
    const activeValues = {
      ...values,
      ":attempt_id": input.attempt_id,
    };
    await this.options.client.send(new TransactWriteCommand({
      TransactItems: [
        {
          Update: {
            TableName: this.options.checkout_attempts_table,
            Key: { pk: activePk(input.order_id) },
            UpdateExpression: "SET #status = :pending, stable_nonce = :stable_nonce, challenge_hash = :challenge_hash, checkout_session_id = :checkout_session_id, checkout_url = :checkout_url, expires_at = :expires_at, updated_at = :updated_at REMOVE creation_owner_id, creation_lease_expires_at, error_message",
            ConditionExpression: "attempt_id = :attempt_id AND #status = :creating",
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: activeValues,
          },
        },
        {
          Update: {
            TableName: this.options.checkout_attempts_table,
            Key: { pk: attemptPk(input.attempt_id) },
            UpdateExpression: "SET #status = :pending, stable_nonce = :stable_nonce, challenge_hash = :challenge_hash, checkout_session_id = :checkout_session_id, checkout_url = :checkout_url, expires_at = :expires_at, updated_at = :updated_at REMOVE creation_owner_id, creation_lease_expires_at, error_message",
            ConditionExpression: "attempt_id = :attempt_id AND #status = :creating",
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: activeValues,
          },
        },
      ],
    }));
  }

  async markCheckoutFailed(input: {
    order_id: string;
    attempt_id: string;
    error_message?: string;
  }): Promise<void> {
    await this.options.client.send(new TransactWriteCommand({
      TransactItems: [
        {
          Delete: {
            TableName: this.options.checkout_attempts_table,
            Key: { pk: activePk(input.order_id) },
            ConditionExpression: "attempt_id = :attempt_id",
            ExpressionAttributeValues: { ":attempt_id": input.attempt_id },
          },
        },
        {
          Update: {
            TableName: this.options.checkout_attempts_table,
            Key: { pk: attemptPk(input.attempt_id) },
            UpdateExpression: "SET #status = :failed, failed_at = :failed_at, error_message = :error_message, updated_at = :updated_at REMOVE creation_owner_id, creation_lease_expires_at",
            ConditionExpression: "#status = :creating",
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: {
              ":failed": "failed",
              ":failed_at": timestamp(),
              ":error_message": textOrNull(input.error_message),
              ":updated_at": timestamp(),
            },
          },
        },
      ],
    }));
  }

  async processWebhookEventOnce(eventId: string, handler: () => Promise<void>): Promise<"processed" | "duplicate"> {
    const cleanEventId = requireText(eventId, "event_id");
    const existing = await this.options.client.send(new GetCommand({
      TableName: this.options.webhook_events_table,
      Key: { event_id: cleanEventId },
    }));
    if (existing.Item?.status === "processed") return "duplicate";
    if (existing.Item?.status === "processing" && !webhookProcessingIsStale(existing.Item.created_at)) return "duplicate";

    if (existing.Item) {
      await this.options.client.send(new UpdateCommand({
        TableName: this.options.webhook_events_table,
        Key: { event_id: cleanEventId },
        UpdateExpression: "SET #status = :processing, error_message = :null_value, processed_at = :null_value, created_at = :created_at",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: { ":processing": "processing", ":null_value": null, ":created_at": timestamp() },
      }));
    } else {
      try {
        await this.options.client.send(new PutCommand({
          TableName: this.options.webhook_events_table,
          Item: { event_id: cleanEventId, status: "processing", created_at: timestamp(), processed_at: null },
          ConditionExpression: "attribute_not_exists(event_id)",
        }));
      } catch (error) {
        if (isConditionalFailure(error)) return "duplicate";
        throw error;
      }
    }

    try {
      await handler();
      await this.options.client.send(new UpdateCommand({
        TableName: this.options.webhook_events_table,
        Key: { event_id: cleanEventId },
        UpdateExpression: "SET #status = :processed, error_message = :null_value, processed_at = :processed_at",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: { ":processed": "processed", ":null_value": null, ":processed_at": timestamp() },
      }));
      return "processed";
    } catch (error) {
      await this.options.client.send(new UpdateCommand({
        TableName: this.options.webhook_events_table,
        Key: { event_id: cleanEventId },
        UpdateExpression: "SET #status = :failed, error_message = :error_message, processed_at = :null_value",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: { ":failed": "failed", ":error_message": errorMessage(error), ":null_value": null },
      }));
      throw error;
    }
  }

  async findOrderByChallengeHash(challengeHash: string): Promise<{ id: string } | null> {
    const result = await this.options.client.send(new QueryCommand({
      TableName: this.options.checkout_attempts_table,
      IndexName: this.options.challenge_hash_index,
      KeyConditionExpression: "challenge_hash = :challenge_hash",
      ExpressionAttributeValues: { ":challenge_hash": challengeHash },
      Limit: 1,
    }));
    const item = result.Items?.[0];
    return item?.order_id ? { id: String(item.order_id) } : null;
  }

  async markOrderPaidOnce(input: {
    order_id: string;
    requirement_id: string;
    chain_receipt_id: string;
  }): Promise<void> {
    const active = await this.getActiveAttempt(input.order_id);
    if (!active) return;
    try {
      await this.options.client.send(new TransactWriteCommand({
        TransactItems: [
          {
            Delete: {
              TableName: this.options.checkout_attempts_table,
              Key: { pk: activePk(input.order_id) },
              ConditionExpression: "attempt_id = :attempt_id",
              ExpressionAttributeValues: { ":attempt_id": active.attempt_id },
            },
          },
          {
            Update: {
              TableName: this.options.checkout_attempts_table,
              Key: { pk: attemptPk(String(active.attempt_id)) },
              UpdateExpression: "SET #status = :paid, requirement_id = :requirement_id, chain_receipt_id = :chain_receipt_id, paid_at = :paid_at, updated_at = :updated_at",
              ConditionExpression: "NOT (#status IN (:paid, :expired, :cancelled, :failed))",
              ExpressionAttributeNames: { "#status": "status" },
              ExpressionAttributeValues: {
                ":paid": "paid",
                ":expired": "expired",
                ":cancelled": "cancelled",
                ":failed": "failed",
                ":requirement_id": input.requirement_id,
                ":chain_receipt_id": input.chain_receipt_id,
                ":paid_at": timestamp(),
                ":updated_at": timestamp(),
              },
            },
          },
          this.orderStatusUpdate(input.order_id, "paid"),
        ],
      }));
    } catch (error) {
      if (!isConditionalFailure(error)) throw error;
    }
  }

  async markOrderFulfilledUnsettledOnce(input: {
    order_id: string;
    requirement_id: string;
    pricing_band: string;
  }): Promise<void> {
    const active = await this.getActiveAttempt(input.order_id);
    if (!active) return;
    try {
      await this.options.client.send(new TransactWriteCommand({
        TransactItems: [
          {
            Delete: {
              TableName: this.options.checkout_attempts_table,
              Key: { pk: activePk(input.order_id) },
              ConditionExpression: "attempt_id = :attempt_id",
              ExpressionAttributeValues: { ":attempt_id": active.attempt_id },
            },
          },
          {
            Update: {
              TableName: this.options.checkout_attempts_table,
              Key: { pk: attemptPk(String(active.attempt_id)) },
              UpdateExpression: "SET #status = :fulfilled, requirement_id = :requirement_id, pricing_band = :pricing_band, fulfilled_unsettled_at = :fulfilled_at, updated_at = :updated_at",
              ConditionExpression: "NOT (#status IN (:fulfilled, :paid, :expired, :cancelled, :failed))",
              ExpressionAttributeNames: { "#status": "status" },
              ExpressionAttributeValues: {
                ":fulfilled": "fulfilled_unsettled",
                ":paid": "paid",
                ":expired": "expired",
                ":cancelled": "cancelled",
                ":failed": "failed",
                ":requirement_id": input.requirement_id,
                ":pricing_band": input.pricing_band,
                ":fulfilled_at": timestamp(),
                ":updated_at": timestamp(),
              },
            },
          },
          this.orderStatusUpdate(input.order_id, "fulfilled_unsettled"),
        ],
      }));
    } catch (error) {
      if (!isConditionalFailure(error)) throw error;
    }
  }

  async flagPaymentReview(input: Record<string, unknown>): Promise<void> {
    await this.options.client.send(new PutCommand({
      TableName: this.options.payment_reviews_table,
      Item: {
        review_id: `sdrp_review_${hash(`${Date.now()}:${JSON.stringify(input)}`).slice(0, 24)}`,
        order_id: textOrNull(input.order_id),
        reason: String(input.reason || "manual_review_required"),
        payload_json: input,
        created_at: timestamp(),
      },
    }));
  }

  private async findProductOrder(orderId: string): Promise<Record<string, unknown> | null> {
    const result = await this.options.client.send(new GetCommand({
      TableName: this.options.orders_table,
      Key: { [this.options.order_id_attribute]: orderId },
    }));
    const row = result.Item;
    if (!row) return null;
    return {
      ...row,
      id: row[this.options.order_id_attribute] ?? orderId,
      amount_minor: row[this.options.amount_minor_attribute],
      currency: row[this.options.currency_attribute],
    };
  }

  private async getActiveAttempt(orderId: string): Promise<Record<string, unknown> | null> {
    const result = await this.options.client.send(new GetCommand({
      TableName: this.options.checkout_attempts_table,
      Key: { pk: activePk(orderId) },
      ConsistentRead: true,
    }));
    return result.Item ?? null;
  }

  private async nextAttemptNumber(orderId: string): Promise<number> {
    const result = await this.options.client.send(new QueryCommand({
      TableName: this.options.checkout_attempts_table,
      IndexName: this.options.order_id_index,
      KeyConditionExpression: "order_id = :order_id",
      ExpressionAttributeValues: { ":order_id": orderId },
      ScanIndexForward: false,
      Limit: 1,
    }));
    const current = Number(result.Items?.[0]?.attempt_number || 0);
    return Number.isSafeInteger(current) && current > 0 ? current + 1 : 1;
  }

  private async releaseInactiveAttempt(active: Record<string, unknown>, status: "expired" | "failed"): Promise<void> {
    const timestampField = status === "expired" ? "expires_at" : "failed_at";
    await this.options.client.send(new TransactWriteCommand({
      TransactItems: [
        {
          Delete: {
            TableName: this.options.checkout_attempts_table,
            Key: { pk: activePk(String(active.order_id)) },
            ConditionExpression: "attempt_id = :attempt_id",
            ExpressionAttributeValues: { ":attempt_id": active.attempt_id },
          },
        },
        {
          Update: {
            TableName: this.options.checkout_attempts_table,
            Key: { pk: attemptPk(String(active.attempt_id)) },
            UpdateExpression: `SET #status = :status, ${timestampField} = if_not_exists(${timestampField}, :now_value), updated_at = :now_value REMOVE creation_owner_id, creation_lease_expires_at`,
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: { ":status": status, ":now_value": timestamp() },
          },
        },
      ],
    }));
  }

  private orderStatusUpdate(orderId: string, status: string) {
    const expressionNames: Record<string, string> = {};
    const expressionValues: Record<string, unknown> = {};
    const setParts: string[] = [];
    if (this.options.order_status_attribute) {
      expressionNames["#order_status"] = this.options.order_status_attribute;
      expressionValues[":order_status"] = status;
      setParts.push("#order_status = :order_status");
    }
    if (this.options.order_updated_at_attribute) {
      expressionNames["#order_updated_at"] = this.options.order_updated_at_attribute;
      expressionValues[":order_updated_at"] = timestamp();
      setParts.push("#order_updated_at = :order_updated_at");
    }
    return {
      Update: {
        TableName: this.options.orders_table,
        Key: { [this.options.order_id_attribute]: orderId },
        UpdateExpression: `SET ${setParts.join(", ") || "#sdrp_touched = :sdrp_touched"}`,
        ExpressionAttributeNames: setParts.length ? expressionNames : { "#sdrp_touched": "sdrp_touched_at" },
        ExpressionAttributeValues: setParts.length ? expressionValues : { ":sdrp_touched": timestamp() },
      },
    };
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
}

function normalizeOptions(options: DynamoDbSiglumeOrderStoreOptions): NormalizedOptions {
  return {
    client: options.client,
    orders_table: options.orders_table ?? "orders",
    order_id_attribute: options.order_id_attribute ?? "id",
    amount_minor_attribute: options.amount_minor_attribute ?? "amount_minor",
    currency_attribute: options.currency_attribute ?? "currency",
    order_status_attribute: options.order_status_attribute === undefined ? "status" : options.order_status_attribute,
    order_updated_at_attribute: options.order_updated_at_attribute === undefined ? "updated_at" : options.order_updated_at_attribute,
    checkout_attempts_table: options.checkout_attempts_table ?? "siglume_checkout_attempts",
    webhook_events_table: options.webhook_events_table ?? "siglume_webhook_events",
    payment_reviews_table: options.payment_reviews_table ?? "siglume_payment_reviews",
    challenge_hash_index: options.challenge_hash_index ?? "challenge_hash_index",
    order_id_index: options.order_id_index ?? "order_id_index",
    authorize_order: options.authorize_order,
  };
}

function normalizeTableOptions(options: DynamoDbSiglumeTableOptions): Omit<NormalizedOptions, "client" | "authorize_order"> & { client: DynamoDBClient } {
  return {
    client: options.client,
    orders_table: options.orders_table ?? "orders",
    order_id_attribute: options.order_id_attribute ?? "id",
    amount_minor_attribute: options.amount_minor_attribute ?? "amount_minor",
    currency_attribute: options.currency_attribute ?? "currency",
    order_status_attribute: options.order_status_attribute === undefined ? "status" : options.order_status_attribute,
    order_updated_at_attribute: options.order_updated_at_attribute === undefined ? "updated_at" : options.order_updated_at_attribute,
    checkout_attempts_table: options.checkout_attempts_table ?? "siglume_checkout_attempts",
    webhook_events_table: options.webhook_events_table ?? "siglume_webhook_events",
    payment_reviews_table: options.payment_reviews_table ?? "siglume_payment_reviews",
    challenge_hash_index: options.challenge_hash_index ?? "challenge_hash_index",
    order_id_index: options.order_id_index ?? "order_id_index",
  };
}

async function createTableIfMissing(client: DynamoDBClient, tableName: string, keyName: string): Promise<void> {
  if (await tableExists(client, tableName)) return;
  await client.send(new CreateTableCommand({
    TableName: tableName,
    BillingMode: "PAY_PER_REQUEST",
    AttributeDefinitions: [{ AttributeName: keyName, AttributeType: "S" }],
    KeySchema: [{ AttributeName: keyName, KeyType: "HASH" }],
  }));
  await waitUntilTableExists({ client: client as DynamoDBClient, maxWaitTime: 30 }, { TableName: tableName });
}

async function createAttemptsTableIfMissing(
  client: DynamoDBClient,
  tableName: string,
  challengeHashIndex: string,
  orderIdIndex: string,
): Promise<void> {
  if (await tableExists(client, tableName)) return;
  await client.send(new CreateTableCommand({
    TableName: tableName,
    BillingMode: "PAY_PER_REQUEST",
    AttributeDefinitions: [
      { AttributeName: "pk", AttributeType: "S" },
      { AttributeName: "challenge_hash", AttributeType: "S" },
      { AttributeName: "order_id", AttributeType: "S" },
      { AttributeName: "attempt_number", AttributeType: "N" },
    ],
    KeySchema: [{ AttributeName: "pk", KeyType: "HASH" }],
    GlobalSecondaryIndexes: [
      {
        IndexName: challengeHashIndex,
        KeySchema: [{ AttributeName: "challenge_hash", KeyType: "HASH" }],
        Projection: { ProjectionType: "ALL" },
      },
      {
        IndexName: orderIdIndex,
        KeySchema: [
          { AttributeName: "order_id", KeyType: "HASH" },
          { AttributeName: "attempt_number", KeyType: "RANGE" },
        ],
        Projection: { ProjectionType: "ALL" },
      },
    ],
  }));
  await waitUntilTableExists({ client: client as DynamoDBClient, maxWaitTime: 30 }, { TableName: tableName });
}

async function tableExists(client: DynamoDBClient, tableName: string): Promise<boolean> {
  try {
    await client.send(new DescribeTableCommand({ TableName: tableName }));
    return true;
  } catch (error) {
    if (String((error as { name?: string }).name || "") === "ResourceNotFoundException") return false;
    throw error;
  }
}

function activePk(orderId: string): string {
  return `active#${hash(orderId).slice(0, 32)}`;
}

function attemptPk(attemptId: string): string {
  return `attempt#${attemptId}`;
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

function isConditionalFailure(error: unknown): boolean {
  const name = String((error as { name?: string }).name || "");
  return name === "ConditionalCheckFailedException" || name === "TransactionCanceledException";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
