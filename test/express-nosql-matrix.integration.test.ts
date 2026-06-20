import { createHash, randomUUID } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { Firestore } from "@google-cloud/firestore";
import express from "express";
import { MongoClient, type Db } from "mongodb";
import { describe, expect, it } from "vitest";

import {
  createDynamoDbSiglumeOrderStore,
  createDynamoDbSiglumeTables,
} from "../templates/express/siglume-order-store.dynamodb";
import {
  createFirestoreSiglumeCollections,
  createFirestoreSiglumeOrderStore,
} from "../templates/express/siglume-order-store.firestore";
import {
  createMongoSiglumeIndexes,
  createMongoSiglumeOrderStore,
} from "../templates/express/siglume-order-store.mongodb";
import {
  createSiglumeSdrpCheckoutRouter,
  type SiglumeSdrpOrderStore,
  type SiglumeSdrpRouterOptions,
} from "../templates/express/siglume-sdrp-routes";

interface StoreContext {
  readonly store: SiglumeSdrpOrderStore;
  seedOrder(orderId: string): Promise<void>;
  expirePending(orderId: string): Promise<void>;
  attemptRows(orderId: string): Promise<Array<{ attempt_number: number; status: string }>>;
  orderStatus(orderId: string): Promise<string | undefined>;
  eventRows(eventId: string): Promise<Array<{ event_id: string; status: string }>>;
  close(): Promise<void>;
}

interface AdapterCase {
  readonly id: string;
  readonly label: string;
  create(): Promise<StoreContext>;
}

const runNoSqlMatrix = process.env.SIGLUME_SDRP_NOSQL_MATRIX === "1";
const describeNoSqlMatrix = runNoSqlMatrix ? describe : describe.skip;

function envelope(data: unknown) {
  return { data, meta: { request_id: "req_nosql_matrix", trace_id: "trc_nosql_matrix" } };
}

async function createApp(options: SiglumeSdrpRouterOptions) {
  const app = express();
  app.use(express.json());
  app.use("/payments", createSiglumeSdrpCheckoutRouter(options));
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: error instanceof Error ? error.message : "internal_error" });
  });
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listening = app.listen(0, () => resolve(listening));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server did not bind a TCP port");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

async function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for SIGLUME_SDRP_NOSQL_MATRIX=1.`);
  return value;
}

function suffix(id: string): string {
  return `${id}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

async function createDynamoContext(): Promise<StoreContext> {
  const id = suffix("ddb");
  const rawClient = new DynamoDBClient({
    endpoint: requireEnv("SIGLUME_SDRP_DYNAMODB_ENDPOINT"),
    region: process.env.AWS_REGION || "us-east-1",
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || "test",
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "test",
    },
  });
  const client = DynamoDBDocumentClient.from(rawClient, {
    marshallOptions: { removeUndefinedValues: true, convertEmptyValues: true },
  });
  const options = {
    orders_table: `orders_${id}`,
    checkout_attempts_table: `attempts_${id}`,
    webhook_events_table: `events_${id}`,
    payment_reviews_table: `reviews_${id}`,
  };
  await createDynamoDbSiglumeTables({ client: rawClient, ...options });
  return {
    store: createDynamoDbSiglumeOrderStore({ client, ...options }),
    async seedOrder(orderId) {
      await client.send(new PutCommand({
        TableName: options.orders_table,
        Item: { id: orderId, amount_minor: 1200, currency: "JPY", status: "created", updated_at: new Date().toISOString() },
      }));
    },
    async expirePending(orderId) {
      const active = await client.send(new GetCommand({
        TableName: options.checkout_attempts_table,
        Key: { pk: `active#${sha256(orderId)}` },
      }));
      const attemptId = String(active.Item?.attempt_id || "");
      await client.send(new UpdateCommand({
        TableName: options.checkout_attempts_table,
        Key: { pk: `active#${sha256(orderId)}` },
        UpdateExpression: "SET expires_at = :expires_at",
        ExpressionAttributeValues: { ":expires_at": "2000-01-01T00:00:00.000Z" },
      }));
      await client.send(new UpdateCommand({
        TableName: options.checkout_attempts_table,
        Key: { pk: `attempt#${attemptId}` },
        UpdateExpression: "SET expires_at = :expires_at",
        ExpressionAttributeValues: { ":expires_at": "2000-01-01T00:00:00.000Z" },
      }));
    },
    async attemptRows(orderId) {
      const rows = await client.send(new QueryCommand({
        TableName: options.checkout_attempts_table,
        IndexName: "order_id_index",
        KeyConditionExpression: "order_id = :order_id",
        ExpressionAttributeValues: { ":order_id": orderId },
      }));
      return (rows.Items || [])
        .filter((row) => row.item_type === "attempt")
        .sort((a, b) => Number(a.attempt_number) - Number(b.attempt_number))
        .map((row) => ({ attempt_number: Number(row.attempt_number), status: String(row.status) }));
    },
    async orderStatus(orderId) {
      const row = await client.send(new GetCommand({ TableName: options.orders_table, Key: { id: orderId } }));
      return row.Item?.status === undefined ? undefined : String(row.Item.status);
    },
    async eventRows(eventId) {
      const row = await client.send(new GetCommand({ TableName: options.webhook_events_table, Key: { event_id: eventId } }));
      return row.Item ? [{ event_id: String(row.Item.event_id), status: String(row.Item.status) }] : [];
    },
    async close() {
      rawClient.destroy();
    },
  };
}

async function createMongoContext(): Promise<StoreContext> {
  const id = suffix("mongo");
  const client = new MongoClient(requireEnv("SIGLUME_SDRP_MONGODB_URL"));
  await client.connect();
  const db: Db = client.db(`siglume_sdrp_${id}`);
  const options = {
    db,
    orders_collection: "orders",
    checkout_attempts_collection: "attempts",
    webhook_events_collection: "events",
    payment_reviews_collection: "reviews",
  };
  await createMongoSiglumeIndexes(options);
  return {
    store: createMongoSiglumeOrderStore(options),
    async seedOrder(orderId) {
      await db.collection("orders").insertOne({ id: orderId, amount_minor: 1200, currency: "JPY", status: "created" });
    },
    async expirePending(orderId) {
      await db.collection("attempts").updateOne(
        { order_id: orderId, status: "pending" },
        { $set: { expires_at: "2000-01-01T00:00:00.000Z" } },
      );
    },
    async attemptRows(orderId) {
      const rows = await db.collection("attempts").find({ order_id: orderId }).sort({ attempt_number: 1 }).toArray();
      return rows.map((row) => ({ attempt_number: Number(row.attempt_number), status: String(row.status) }));
    },
    async orderStatus(orderId) {
      const row = await db.collection("orders").findOne({ id: orderId });
      return row?.status === undefined ? undefined : String(row.status);
    },
    async eventRows(eventId) {
      const row = await db.collection("events").findOne({ event_id: eventId });
      return row ? [{ event_id: String(row.event_id), status: String(row.status) }] : [];
    },
    async close() {
      await db.dropDatabase();
      await client.close();
    },
  };
}

async function createFirestoreContext(): Promise<StoreContext> {
  requireEnv("FIRESTORE_EMULATOR_HOST");
  const id = suffix("fs");
  const db = new Firestore({ projectId: process.env.GOOGLE_CLOUD_PROJECT || "siglume-sdrp-test" });
  const options = {
    db,
    orders_collection: `orders_${id}`,
    checkout_attempts_collection: `attempts_${id}`,
    webhook_events_collection: `events_${id}`,
    payment_reviews_collection: `reviews_${id}`,
  };
  await createFirestoreSiglumeCollections(options);
  return {
    store: createFirestoreSiglumeOrderStore(options),
    async seedOrder(orderId) {
      await db.collection(options.orders_collection).doc(orderId).set({ id: orderId, amount_minor: 1200, currency: "JPY", status: "created" });
    },
    async expirePending(orderId) {
      const snap = await db.collection(options.checkout_attempts_collection).where("order_id", "==", orderId).where("status", "==", "pending").get();
      await Promise.all(snap.docs.map((doc) => doc.ref.update({ expires_at: "2000-01-01T00:00:00.000Z" })));
    },
    async attemptRows(orderId) {
      const snap = await db.collection(options.checkout_attempts_collection).where("order_id", "==", orderId).get();
      return snap.docs
        .map((doc) => doc.data())
        .filter((row) => row.item_type === "attempt")
        .sort((a, b) => Number(a.attempt_number) - Number(b.attempt_number))
        .map((row) => ({ attempt_number: Number(row.attempt_number), status: String(row.status) }));
    },
    async orderStatus(orderId) {
      const row = await db.collection(options.orders_collection).doc(orderId).get();
      return row.data()?.status === undefined ? undefined : String(row.data()?.status);
    },
    async eventRows(eventId) {
      const snap = await db.collection(options.webhook_events_collection).where("event_id", "==", eventId).get();
      return snap.docs.map((doc) => ({ event_id: String(doc.data().event_id), status: String(doc.data().status) }));
    },
    async close() {
      await db.terminate();
    },
  };
}

const adapterCases: AdapterCase[] = [
  { id: "dynamodb", label: "DynamoDB Local", create: createDynamoContext },
  { id: "mongodb", label: "MongoDB", create: createMongoContext },
  { id: "firestore", label: "Firestore emulator", create: createFirestoreContext },
];

describeNoSqlMatrix("Express NoSQL order store matrix", () => {
  for (const adapter of adapterCases) {
    it(`${adapter.label} prevents duplicate checkout batches and keeps webhook retries recoverable`, async () => {
      const context = await adapter.create();
      const originalFetch = globalThis.fetch;
      let app: Awaited<ReturnType<typeof createApp>> | null = null;
      try {
        await context.seedOrder("order_concurrent");

        const checkoutCalls: unknown[] = [];
        globalThis.fetch = (async (input, init = {}) => {
          if (String(input) === "https://siglume.com/v1/sdrp/direct-payments/checkout-sessions") {
            await new Promise((resolve) => setTimeout(resolve, 200));
            const body = JSON.parse(String(init.body || "{}"));
            const sessionNumber = checkoutCalls.length + 1;
            checkoutCalls.push(body);
            return new Response(JSON.stringify(envelope({
              checkout_url: `https://siglume.test/pay/chk_nosql_${sessionNumber}`,
              session_id: `chk_nosql_${sessionNumber}`,
              challenge_hash: `sha256:${body.nonce}`,
              status: "open",
              expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
            })), { status: 201, headers: { "content-type": "application/json" } });
          }
          return originalFetch(input, init);
        }) as typeof fetch;

        app = await createApp({
          merchant: "sandbox_merchant",
          merchant_auth_token: "merchant_jwt",
          webhook_secret: "whsec_test",
          shop_public_origin: "https://shop.example.com",
          order_store: context.store,
          allow_metered_payments: false,
        });

        const responses = await Promise.all(Array.from({ length: 24 }, () => (
          postJson(`${app!.baseUrl}/payments/checkout/siglume/start`, { order_id: "order_concurrent" })
        )));
        expect(responses.every((response) => response.status === 200)).toBe(true);
        const bodies = await Promise.all(responses.map((response) => response.json() as Promise<{ session_id: string }>));
        expect(new Set(bodies.map((body) => body.session_id))).toEqual(new Set(["chk_nosql_1"]));
        expect(checkoutCalls).toHaveLength(1);

        await context.expirePending("order_concurrent");
        const retryAfterExpiry = await postJson(`${app.baseUrl}/payments/checkout/siglume/start`, { order_id: "order_concurrent" });
        expect(retryAfterExpiry.status).toBe(200);
        await expect(retryAfterExpiry.json()).resolves.toMatchObject({ session_id: "chk_nosql_2" });
        expect(checkoutCalls).toHaveLength(2);
        expect(await context.attemptRows("order_concurrent")).toEqual([
          { attempt_number: 1, status: "expired" },
          { attempt_number: 2, status: "pending" },
        ]);

        await context.store.markOrderPaidOnce({
          order_id: "order_concurrent",
          requirement_id: "dpr_nosql_matrix",
          chain_receipt_id: "chain_nosql_matrix",
        });
        expect(await context.orderStatus("order_concurrent")).toBe("paid");

        let webhookInvocations = 0;
        await expect(context.store.processWebhookEventOnce("evt_retry_nosql", async () => {
          webhookInvocations += 1;
          throw new Error("simulated webhook failure");
        })).rejects.toThrow("simulated webhook failure");
        expect(webhookInvocations).toBe(1);
        await expect(context.eventRows("evt_retry_nosql")).resolves.toEqual([
          expect.objectContaining({ event_id: "evt_retry_nosql", status: "failed" }),
        ]);

        const processed = await context.store.processWebhookEventOnce("evt_retry_nosql", async () => {
          webhookInvocations += 1;
        });
        expect(processed).toBe("processed");
        expect(webhookInvocations).toBe(2);
        await expect(context.eventRows("evt_retry_nosql")).resolves.toEqual([
          expect.objectContaining({ event_id: "evt_retry_nosql", status: "processed" }),
        ]);

        const duplicate = await context.store.processWebhookEventOnce("evt_retry_nosql", async () => {
          webhookInvocations += 1;
        });
        expect(duplicate).toBe("duplicate");
        expect(webhookInvocations).toBe(2);
      } finally {
        globalThis.fetch = originalFetch;
        await app?.close();
        await context.close();
      }
    }, 120000);
  }
});

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}
