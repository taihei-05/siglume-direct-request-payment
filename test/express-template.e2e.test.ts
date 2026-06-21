import express from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import initSqlJs, { type Database } from "sql.js";
import type { SqlValue } from "sql.js";

import { buildWebhookSignatureHeader } from "../src/index";
import {
  createSiglumeSdrpCheckoutRouter,
  createSiglumeSdrpWebhookHandler,
  type SiglumeSdrpRouterOptions,
} from "../templates/express/siglume-sdrp-routes";
import {
  createSiglumeSdrpSqlSchema,
  createSqlSiglumeOrderStore,
  type SiglumeSqlExecutor,
} from "../templates/express/siglume-order-store.sql";

function envelope(data: unknown) {
  return { data, meta: { request_id: "req_e2e", trace_id: "trc_e2e" } };
}

function sqliteExecutor(db: Database): SiglumeSqlExecutor {
  const executor: SiglumeSqlExecutor = {
    async query<T extends Record<string, unknown> = Record<string, unknown>>(statement: string, params: readonly unknown[] = []): Promise<T[]> {
      const prepared = db.prepare(statement);
      try {
        prepared.bind([...params] as SqlValue[]);
        const rows: Record<string, unknown>[] = [];
        while (prepared.step()) {
          rows.push(prepared.getAsObject());
        }
        return rows as T[];
      } finally {
        prepared.free();
      }
    },
    async execute(statement, params = []) {
      db.run(statement, [...params] as SqlValue[]);
      return { changes: db.getRowsModified() };
    },
    async transaction(handler) {
      db.run("BEGIN");
      try {
        const result = await handler(executor);
        db.run("COMMIT");
        return result;
      } catch (error) {
        db.run("ROLLBACK");
        throw error;
      }
    },
  };
  return executor;
}

async function createApp(options: SiglumeSdrpRouterOptions) {
  const app = express();
  app.use((req, _res, next) => {
    const auth = req.header("authorization") || "";
    if (auth.startsWith("Bearer ")) {
      (req as express.Request & { user?: { id: string } }).user = { id: auth.slice("Bearer ".length) };
    }
    next();
  });
  app.post(
    "/payments/webhooks/siglume",
    express.raw({ type: "application/json" }),
    createSiglumeSdrpWebhookHandler(options),
  );
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

async function postJson(url: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

async function postWebhook(url: string, event: Record<string, unknown>): Promise<Response> {
  const rawBody = JSON.stringify(event);
  const signature = await buildWebhookSignatureHeader("whsec_test", rawBody);
  return fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "siglume-signature": signature,
    },
    body: rawBody,
  });
}

function standardEvent(eventId: string, challengeHash: string) {
  return {
    id: eventId,
    type: "direct_payment.confirmed",
    api_version: "2026-06-20",
    occurred_at: "2026-06-20T00:00:00Z",
    data: {
      mode: "external_402",
      merchant: "sandbox_merchant",
      pricing_band: "standard",
      settlement_cadence: "per_payment",
      finality: "per_payment_onchain",
      settlement_status: "settled",
      requirement_id: `dpr_${eventId}`,
      challenge_hash: challengeHash,
      chain_receipt_id: `chain_${eventId}`,
    },
  };
}

describe("Express 10-minute template E2E", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("runs checkout, retries failed webhook delivery, deduplicates success, and blocks Micro/Nano by default", async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    const executor = sqliteExecutor(db);
    for (const statement of createSiglumeSdrpSqlSchema({ dialect: "sqlite" })) {
      db.run(statement);
    }
    db.run(`ALTER TABLE "orders" ADD COLUMN "customer_id" TEXT`);
    db.run(
      `INSERT INTO "orders" ("id", "customer_id", "amount_minor", "currency", "status") VALUES
       ('order_123', 'user_123', 1200, 'JPY', 'created'),
       ('order_retry', 'user_123', 1300, 'JPY', 'created'),
       ('order_micro', 'user_123', 100, 'JPY', 'created'),
       ('order_other_user', 'user_456', 1200, 'JPY', 'created')`,
    );

    const store = createSqlSiglumeOrderStore({
      executor,
      dialect: "sqlite",
      authorize_order: async (order, req) => {
        const userId = (req as express.Request & { user?: { id?: string } }).user?.id;
        const rows = await executor.query<{ customer_id?: unknown }>(
          `SELECT "customer_id" FROM "orders" WHERE "id" = ?`,
          [String(order.id)],
        );
        return Boolean(userId && rows[0]?.customer_id === userId);
      },
    });
    const options: SiglumeSdrpRouterOptions = {
      merchant: "sandbox_merchant",
      merchant_auth_token: "merchant_jwt",
      webhook_secret: "whsec_test",
      shop_public_origin: "https://shop.example.com",
      order_store: store,
      allow_metered_payments: false,
    };

    const challengeByOrder = new Map<string, string>();
    const checkoutCalls: unknown[] = [];
    globalThis.fetch = (async (input, init = {}) => {
      const url = String(input);
      if (url === "https://siglume.com/v1/sdrp/direct-payments/checkout-sessions") {
        const body = JSON.parse(String(init.body || "{}")) as { nonce: string; metadata?: { order_id?: string } };
        const sessionId = `chk_e2e_${checkoutCalls.length + 1}`;
        const challengeHash = `sha256:${body.nonce}`;
        checkoutCalls.push(body);
        if (body.metadata?.order_id) challengeByOrder.set(body.metadata.order_id, challengeHash);
        return new Response(JSON.stringify(envelope({
          checkout_url: `https://siglume.test/pay/${sessionId}`,
          session_id: sessionId,
          challenge_hash: challengeHash,
          status: "open",
        })), { status: 201, headers: { "content-type": "application/json" } });
      }
      return originalFetch(input, init);
    }) as typeof fetch;

    const app = await createApp(options);
    try {
      const unauthenticated = await postJson(`${app.baseUrl}/payments/checkout/siglume/start`, { order_id: "order_123" });
      expect(unauthenticated.status).toBe(404);
      const wrongOwner = await postJson(
        `${app.baseUrl}/payments/checkout/siglume/start`,
        { order_id: "order_other_user" },
        { authorization: "Bearer user_123" },
      );
      expect(wrongOwner.status).toBe(404);

      const firstStart = await postJson(
        `${app.baseUrl}/payments/checkout/siglume/start`,
        { order_id: "order_123" },
        { authorization: "Bearer user_123" },
      );
      expect(firstStart.status).toBe(200);
      const firstBody = await firstStart.json() as { checkout_url: string; session_id: string };
      expect(firstBody.checkout_url).toBe("https://siglume.test/pay/chk_e2e_1");

      const replayStart = await postJson(
        `${app.baseUrl}/payments/checkout/siglume/start`,
        { order_id: "order_123" },
        { authorization: "Bearer user_123" },
      );
      expect(replayStart.status).toBe(200);
      await expect(replayStart.json()).resolves.toMatchObject(firstBody);
      expect(checkoutCalls).toHaveLength(1);

      const paid = await postWebhook(
        `${app.baseUrl}/payments/webhooks/siglume`,
        standardEvent("evt_paid", challengeByOrder.get("order_123")!),
      );
      expect(paid.status).toBe(204);
      expect((await executor.query(`SELECT status FROM "orders" WHERE "id" = ?`, ["order_123"]))[0]?.status).toBe("paid");

      const duplicate = await postWebhook(
        `${app.baseUrl}/payments/webhooks/siglume`,
        standardEvent("evt_paid", challengeByOrder.get("order_123")!),
      );
      expect(duplicate.status).toBe(204);
      expect(await executor.query(`SELECT event_id FROM "siglume_webhook_events" WHERE event_id = ?`, ["evt_paid"])).toHaveLength(1);

      const retryStart = await postJson(
        `${app.baseUrl}/payments/checkout/siglume/start`,
        { order_id: "order_retry" },
        { authorization: "Bearer user_123" },
      );
      expect(retryStart.status).toBe(200);
      let failOnce = true;
      const realMarkPaid = store.markOrderPaidOnce.bind(store);
      store.markOrderPaidOnce = async (input) => {
        if (input.order_id === "order_retry" && failOnce) {
          failOnce = false;
          throw new Error("simulated database outage");
        }
        await realMarkPaid(input);
      };
      const retryEvent = standardEvent("evt_retry", challengeByOrder.get("order_retry")!);
      const failedDelivery = await postWebhook(`${app.baseUrl}/payments/webhooks/siglume`, retryEvent);
      expect(failedDelivery.status).toBe(500);
      expect(await executor.query(`SELECT event_id FROM "siglume_webhook_events" WHERE event_id = ?`, ["evt_retry"])).toHaveLength(0);

      const retriedDelivery = await postWebhook(`${app.baseUrl}/payments/webhooks/siglume`, retryEvent);
      expect(retriedDelivery.status).toBe(204);
      expect((await executor.query(`SELECT status FROM "orders" WHERE "id" = ?`, ["order_retry"]))[0]?.status).toBe("paid");
      expect(await executor.query(`SELECT event_id FROM "siglume_webhook_events" WHERE event_id = ?`, ["evt_retry"])).toHaveLength(1);

      const microStart = await postJson(
        `${app.baseUrl}/payments/checkout/siglume/start`,
        { order_id: "order_micro" },
        { authorization: "Bearer user_123" },
      );
      expect(microStart.status).toBe(409);
      await expect(microStart.json()).resolves.toEqual({ error: "METERED_INTEGRATION_REQUIRED" });
      expect(checkoutCalls).toHaveLength(2);
    } finally {
      await app.close();
      db.close();
    }
  });

  it("keeps webhook retries recoverable when a custom SQL executor has no transaction hook", async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    const transactionalExecutor = sqliteExecutor(db);
    const executor: SiglumeSqlExecutor = {
      query: transactionalExecutor.query,
      execute: transactionalExecutor.execute,
    };
    for (const statement of createSiglumeSdrpSqlSchema({ dialect: "sqlite" })) {
      db.run(statement);
    }

    const store = createSqlSiglumeOrderStore({
      executor,
      dialect: "sqlite",
      allow_unverified_order_lookup: true,
    });
    let attempts = 0;
    await expect(store.processWebhookEventOnce("evt_no_tx_retry", async () => {
      attempts += 1;
      throw new Error("simulated handler failure");
    })).rejects.toThrow("simulated handler failure");
    expect(attempts).toBe(1);
    expect((await executor.query(`SELECT status, error_message FROM "siglume_webhook_events" WHERE event_id = ?`, ["evt_no_tx_retry"]))[0]).toMatchObject({
      status: "failed",
      error_message: "simulated handler failure",
    });

    const retried = await store.processWebhookEventOnce("evt_no_tx_retry", async () => {
      attempts += 1;
    });
    expect(retried).toBe("processed");
    expect(attempts).toBe(2);
    expect((await executor.query(`SELECT status, error_message FROM "siglume_webhook_events" WHERE event_id = ?`, ["evt_no_tx_retry"]))[0]).toMatchObject({
      status: "processed",
      error_message: null,
    });

    const duplicate = await store.processWebhookEventOnce("evt_no_tx_retry", async () => {
      attempts += 1;
    });
    expect(duplicate).toBe("duplicate");
    expect(attempts).toBe(2);

    await executor.execute(
      `INSERT INTO "siglume_webhook_events" (event_id, status, created_at) VALUES (?, ?, ?)`,
      ["evt_stale_processing", "processing", "2000-01-01 00:00:00"],
    );
    const recovered = await store.processWebhookEventOnce("evt_stale_processing", async () => {
      attempts += 1;
    });
    expect(recovered).toBe("processed");
    expect(attempts).toBe(3);
    expect((await executor.query(`SELECT status FROM "siglume_webhook_events" WHERE event_id = ?`, ["evt_stale_processing"]))[0]).toMatchObject({
      status: "processed",
    });
    db.close();
  });

  it("fails closed when a checkout adapter has no authorize_order callback", async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    const executor = sqliteExecutor(db);
    for (const statement of createSiglumeSdrpSqlSchema({ dialect: "sqlite" })) {
      db.run(statement);
    }
    db.run(`INSERT INTO "orders" ("id", "amount_minor", "currency", "status") VALUES ('order_auth_required', 1200, 'JPY', 'created')`);

    const store = createSqlSiglumeOrderStore({ executor, dialect: "sqlite" });
    const app = await createApp({
      merchant: "sandbox_merchant",
      merchant_auth_token: "merchant_jwt",
      webhook_secret: "whsec_test",
      shop_public_origin: "https://shop.example.com",
      order_store: store,
    });
    try {
      const response = await postJson(`${app.baseUrl}/payments/checkout/siglume/start`, { order_id: "order_auth_required" });
      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toMatchObject({ error: "ORDER_AUTHORIZATION_REQUIRED" });
      expect(await executor.query(`SELECT attempt_id FROM "siglume_checkout_attempts" WHERE order_id = ?`, ["order_auth_required"])).toHaveLength(0);
    } finally {
      await app.close();
      db.close();
    }
  });

  it("creates one Hosted Checkout session for concurrent starts and creates a new attempt after expiry", async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    const executor = sqliteExecutor(db);
    for (const statement of createSiglumeSdrpSqlSchema({ dialect: "sqlite" })) {
      db.run(statement);
    }
    db.run(`INSERT INTO "orders" ("id", "amount_minor", "currency", "status") VALUES ('order_concurrent', 1200, 'JPY', 'created')`);

    const store = createSqlSiglumeOrderStore({
      executor,
      dialect: "sqlite",
      allow_unverified_order_lookup: true,
    });
    const options: SiglumeSdrpRouterOptions = {
      merchant: "sandbox_merchant",
      merchant_auth_token: "merchant_jwt",
      webhook_secret: "whsec_test",
      shop_public_origin: "https://shop.example.com",
      order_store: store,
      allow_metered_payments: false,
    };

    const checkoutCalls: unknown[] = [];
    globalThis.fetch = (async (input, init = {}) => {
      const url = String(input);
      if (url === "https://siglume.com/v1/sdrp/direct-payments/checkout-sessions") {
        await new Promise((resolve) => setTimeout(resolve, 200));
        const body = JSON.parse(String(init.body || "{}"));
        const sessionId = `chk_parallel_${checkoutCalls.length + 1}`;
        checkoutCalls.push(body);
        return new Response(JSON.stringify(envelope({
          checkout_url: `https://siglume.test/pay/${sessionId}`,
          session_id: sessionId,
          challenge_hash: `sha256:${body.nonce}`,
          status: "open",
          expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        })), { status: 201, headers: { "content-type": "application/json" } });
      }
      return originalFetch(input, init);
    }) as typeof fetch;

    const app = await createApp(options);
    try {
      const responses = await Promise.all(Array.from({ length: 50 }, () => (
        postJson(`${app.baseUrl}/payments/checkout/siglume/start`, { order_id: "order_concurrent" })
      )));
      expect(responses.every((response) => response.status === 200)).toBe(true);
      const bodies = await Promise.all(responses.map((response) => response.json() as Promise<{ checkout_url: string; session_id: string }>));
      expect(new Set(bodies.map((body) => body.session_id))).toEqual(new Set(["chk_parallel_1"]));
      expect(checkoutCalls).toHaveLength(1);
      expect(await executor.query(`SELECT attempt_id FROM "siglume_checkout_attempts" WHERE active_key = ?`, ["order_concurrent"])).toHaveLength(1);

      await executor.execute(
        `UPDATE "siglume_checkout_attempts" SET expires_at = ?, updated_at = CURRENT_TIMESTAMP WHERE order_id = ? AND status = ?`,
        ["2000-01-01 00:00:00", "order_concurrent", "pending"],
      );
      const retryAfterExpiry = await postJson(`${app.baseUrl}/payments/checkout/siglume/start`, { order_id: "order_concurrent" });
      expect(retryAfterExpiry.status).toBe(200);
      await expect(retryAfterExpiry.json()).resolves.toMatchObject({ session_id: "chk_parallel_2" });
      expect(checkoutCalls).toHaveLength(2);
      expect(await executor.query(`SELECT attempt_number, status FROM "siglume_checkout_attempts" WHERE order_id = ? ORDER BY attempt_number`, ["order_concurrent"])).toEqual([
        expect.objectContaining({ attempt_number: 1, status: "expired" }),
        expect.objectContaining({ attempt_number: 2, status: "pending" }),
      ]);
    } finally {
      await app.close();
      db.close();
    }
  }, 20000);
});
