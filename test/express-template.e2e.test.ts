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

async function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
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
    db.run(
      `INSERT INTO "orders" ("id", "amount_minor", "currency", "status") VALUES
       ('order_123', 1200, 'JPY', 'created'),
       ('order_retry', 1300, 'JPY', 'created'),
       ('order_micro', 100, 'JPY', 'created')`,
    );

    const store = createSqlSiglumeOrderStore({ executor, dialect: "sqlite" });
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
      const firstStart = await postJson(`${app.baseUrl}/payments/checkout/siglume/start`, { order_id: "order_123" });
      expect(firstStart.status).toBe(200);
      const firstBody = await firstStart.json() as { checkout_url: string; session_id: string };
      expect(firstBody.checkout_url).toBe("https://siglume.test/pay/chk_e2e_1");

      const replayStart = await postJson(`${app.baseUrl}/payments/checkout/siglume/start`, { order_id: "order_123" });
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

      const retryStart = await postJson(`${app.baseUrl}/payments/checkout/siglume/start`, { order_id: "order_retry" });
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

      const microStart = await postJson(`${app.baseUrl}/payments/checkout/siglume/start`, { order_id: "order_micro" });
      expect(microStart.status).toBe(409);
      await expect(microStart.json()).resolves.toEqual({ error: "METERED_INTEGRATION_REQUIRED" });
      expect(checkoutCalls).toHaveLength(2);
    } finally {
      await app.close();
      db.close();
    }
  });
});
