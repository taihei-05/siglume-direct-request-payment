import { randomUUID } from "node:crypto";
import express from "express";
import { describe, expect, it } from "vitest";

import {
  createDrizzleSiglumeOrderStore,
  createDrizzleSiglumeSqlExecutor,
  createPrismaSiglumeOrderStore,
  createPrismaSiglumeSqlExecutor,
  createSequelizeSiglumeOrderStore,
  createSequelizeSiglumeSqlExecutor,
  createSiglumeSdrpSqlSchema,
  createTypeOrmSiglumeOrderStore,
  createTypeOrmSiglumeSqlExecutor,
  type SiglumeSqlDialect,
  type SiglumeSqlExecutor,
  type SiglumeSqlParamStyle,
} from "../templates/express/siglume-order-store.sql";
import {
  createSiglumeSdrpCheckoutRouter,
  type SiglumeSdrpOrderStore,
  type SiglumeSdrpRouterOptions,
} from "../templates/express/siglume-sdrp-routes";

interface TableNames {
  orders_table: string;
  checkout_attempts_table: string;
  webhook_events_table: string;
  payment_reviews_table: string;
}

interface StoreContext {
  readonly store: SiglumeSdrpOrderStore;
  readonly executor: SiglumeSqlExecutor;
  readonly dialect: SiglumeSqlDialect;
  readonly paramStyle: SiglumeSqlParamStyle;
  close(): Promise<void>;
}

interface AdapterCase {
  readonly id: string;
  readonly label: string;
  create(tables: TableNames): Promise<StoreContext>;
}

const runOrmMatrix = process.env.SIGLUME_SDRP_ORM_MATRIX === "1";
const describeOrmMatrix = runOrmMatrix ? describe : describe.skip;

function envelope(data: unknown) {
  return { data, meta: { request_id: "req_orm_matrix", trace_id: "trc_orm_matrix" } };
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
  if (!value) throw new Error(`${name} is required for SIGLUME_SDRP_ORM_MATRIX=1.`);
  return value;
}

function tableNames(adapterId: string): TableNames {
  const suffix = `${adapterId}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  return {
    orders_table: `orders_${suffix}`,
    checkout_attempts_table: `attempts_${suffix}`,
    webhook_events_table: `events_${suffix}`,
    payment_reviews_table: `reviews_${suffix}`,
  };
}

function quote(identifier: string, dialect: SiglumeSqlDialect): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`unsafe test identifier: ${identifier}`);
  }
  return dialect === "mysql" ? `\`${identifier}\`` : `"${identifier}"`;
}

function placeholder(index: number, paramStyle: SiglumeSqlParamStyle): string {
  return paramStyle === "numbered" ? `$${index}` : "?";
}

function timestampPlaceholder(index: number, context: StoreContext): string {
  const value = placeholder(index, context.paramStyle);
  return context.dialect === "postgres" ? `CAST(${value} AS TIMESTAMPTZ)` : value;
}

async function resetSchema(context: StoreContext, tables: TableNames): Promise<void> {
  for (const table of [
    tables.payment_reviews_table,
    tables.webhook_events_table,
    tables.checkout_attempts_table,
    tables.orders_table,
  ]) {
    await context.executor.execute(`DROP TABLE IF EXISTS ${quote(table, context.dialect)}`);
  }
  for (const statement of createSiglumeSdrpSqlSchema({
    dialect: context.dialect,
    ...tables,
  })) {
    await context.executor.execute(statement);
  }
}

async function seedOrder(context: StoreContext, tables: TableNames, orderId: string): Promise<void> {
  await context.executor.execute(
    `INSERT INTO ${quote(tables.orders_table, context.dialect)}
       (${quote("id", context.dialect)}, ${quote("amount_minor", context.dialect)}, ${quote("currency", context.dialect)}, ${quote("status", context.dialect)})
     VALUES (${placeholder(1, context.paramStyle)}, ${placeholder(2, context.paramStyle)}, ${placeholder(3, context.paramStyle)}, ${placeholder(4, context.paramStyle)})`,
    [orderId, 1200, "JPY", "created"],
  );
}

async function orderStatus(context: StoreContext, tables: TableNames, orderId: string): Promise<string | undefined> {
  const rows = await context.executor.query<{ status?: unknown }>(
    `SELECT ${quote("status", context.dialect)} AS status
       FROM ${quote(tables.orders_table, context.dialect)}
      WHERE ${quote("id", context.dialect)} = ${placeholder(1, context.paramStyle)}`,
    [orderId],
  );
  return rows[0]?.status === undefined ? undefined : String(rows[0].status);
}

async function attemptRows(context: StoreContext, tables: TableNames, orderId: string) {
  const rows = await context.executor.query<{ attempt_number?: unknown; status?: unknown }>(
    `SELECT ${quote("attempt_number", context.dialect)} AS attempt_number, ${quote("status", context.dialect)} AS status
       FROM ${quote(tables.checkout_attempts_table, context.dialect)}
      WHERE ${quote("order_id", context.dialect)} = ${placeholder(1, context.paramStyle)}
      ORDER BY ${quote("attempt_number", context.dialect)}`,
    [orderId],
  );
  return rows.map((row) => ({
    attempt_number: Number(row.attempt_number),
    status: String(row.status),
  }));
}

async function eventRows(context: StoreContext, tables: TableNames, eventId: string) {
  return context.executor.query<{ event_id?: unknown; status?: unknown }>(
    `SELECT ${quote("event_id", context.dialect)} AS event_id, ${quote("status", context.dialect)} AS status
       FROM ${quote(tables.webhook_events_table, context.dialect)}
      WHERE ${quote("event_id", context.dialect)} = ${placeholder(1, context.paramStyle)}`,
    [eventId],
  );
}

async function createPrismaPostgresStore(tables: TableNames): Promise<StoreContext> {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({
    datasources: { db: { url: requireEnv("SIGLUME_SDRP_POSTGRES_URL") } },
  });
  const executor = createPrismaSiglumeSqlExecutor(prisma);
  return {
    store: createPrismaSiglumeOrderStore(prisma, { dialect: "postgres", ...tables, allow_unverified_order_lookup: true }),
    executor,
    dialect: "postgres",
    paramStyle: "numbered",
    close: () => prisma.$disconnect(),
  };
}

async function createTypeOrmPostgresStore(tables: TableNames): Promise<StoreContext> {
  await import("reflect-metadata");
  const { DataSource } = await import("typeorm");
  const source = new DataSource({
    type: "postgres",
    url: requireEnv("SIGLUME_SDRP_POSTGRES_URL"),
    entities: [],
    synchronize: false,
    logging: false,
  });
  await source.initialize();
  const executor = createTypeOrmSiglumeSqlExecutor(source);
  return {
    store: createTypeOrmSiglumeOrderStore(source, { dialect: "postgres", ...tables, allow_unverified_order_lookup: true }),
    executor,
    dialect: "postgres",
    paramStyle: "numbered",
    close: () => source.destroy(),
  };
}

async function createSequelizeMysqlStore(tables: TableNames): Promise<StoreContext> {
  const { Sequelize } = await import("sequelize");
  const sequelize = new Sequelize(requireEnv("SIGLUME_SDRP_MYSQL_URL"), { logging: false });
  await sequelize.authenticate();
  const executor = createSequelizeSiglumeSqlExecutor(sequelize);
  return {
    store: createSequelizeSiglumeOrderStore(sequelize, { dialect: "mysql", ...tables, allow_unverified_order_lookup: true }),
    executor,
    dialect: "mysql",
    paramStyle: "question",
    close: () => sequelize.close(),
  };
}

async function createDrizzlePostgresStore(tables: TableNames): Promise<StoreContext> {
  const { Pool } = await import("pg");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { sql } = await import("drizzle-orm");
  const pool = new Pool({ connectionString: requireEnv("SIGLUME_SDRP_POSTGRES_URL") });
  const db = drizzle(pool);
  const executor = createDrizzleSiglumeSqlExecutor(db, sql);
  return {
    store: createDrizzleSiglumeOrderStore(db, sql, { dialect: "postgres", ...tables, allow_unverified_order_lookup: true }),
    executor,
    dialect: "postgres",
    paramStyle: "question",
    close: () => pool.end(),
  };
}

async function createDrizzleMysqlStore(tables: TableNames): Promise<StoreContext> {
  const mysql = await import("mysql2/promise");
  const { drizzle } = await import("drizzle-orm/mysql2");
  const { sql } = await import("drizzle-orm");
  const connection = await mysql.createConnection(requireEnv("SIGLUME_SDRP_MYSQL_URL"));
  const db = drizzle(connection);
  const executor = createDrizzleSiglumeSqlExecutor(db, sql);
  return {
    store: createDrizzleSiglumeOrderStore(db, sql, { dialect: "mysql", ...tables, allow_unverified_order_lookup: true }),
    executor,
    dialect: "mysql",
    paramStyle: "question",
    close: () => connection.end(),
  };
}

const adapterCases: AdapterCase[] = [
  { id: "prisma_pg", label: "Prisma + PostgreSQL", create: createPrismaPostgresStore },
  { id: "typeorm_pg", label: "TypeORM + PostgreSQL", create: createTypeOrmPostgresStore },
  { id: "sequelize_mysql", label: "Sequelize + MySQL", create: createSequelizeMysqlStore },
  { id: "drizzle_pg", label: "Drizzle + PostgreSQL", create: createDrizzlePostgresStore },
  { id: "drizzle_mysql", label: "Drizzle + MySQL", create: createDrizzleMysqlStore },
];

describeOrmMatrix("Express SQL store real database ORM matrix", () => {
  for (const adapter of adapterCases) {
    it(`${adapter.label} prevents duplicate checkout batches and keeps webhook retries recoverable`, async () => {
      const tables = tableNames(adapter.id);
      const context = await adapter.create(tables);
      const originalFetch = globalThis.fetch;
      let app: Awaited<ReturnType<typeof createApp>> | null = null;
      try {
        await resetSchema(context, tables);
        await seedOrder(context, tables, "order_concurrent");

        const checkoutCalls: unknown[] = [];
        globalThis.fetch = (async (input, init = {}) => {
          if (String(input) === "https://siglume.com/v1/sdrp/direct-payments/checkout-sessions") {
            await new Promise((resolve) => setTimeout(resolve, 200));
            const body = JSON.parse(String(init.body || "{}"));
            const sessionNumber = checkoutCalls.length + 1;
            checkoutCalls.push(body);
            return new Response(JSON.stringify(envelope({
              checkout_url: `https://siglume.test/pay/chk_orm_${sessionNumber}`,
              session_id: `chk_orm_${sessionNumber}`,
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
        expect(new Set(bodies.map((body) => body.session_id))).toEqual(new Set(["chk_orm_1"]));
        expect(checkoutCalls).toHaveLength(1);

        await context.executor.execute(
          `UPDATE ${quote(tables.checkout_attempts_table, context.dialect)}
              SET ${quote("expires_at", context.dialect)} = ${timestampPlaceholder(1, context)}
            WHERE ${quote("order_id", context.dialect)} = ${placeholder(2, context.paramStyle)}
              AND ${quote("status", context.dialect)} = ${placeholder(3, context.paramStyle)}`,
          ["2000-01-01 00:00:00", "order_concurrent", "pending"],
        );
        const retryAfterExpiry = await postJson(`${app.baseUrl}/payments/checkout/siglume/start`, { order_id: "order_concurrent" });
        expect(retryAfterExpiry.status).toBe(200);
        await expect(retryAfterExpiry.json()).resolves.toMatchObject({ session_id: "chk_orm_2" });
        expect(checkoutCalls).toHaveLength(2);
        expect(await attemptRows(context, tables, "order_concurrent")).toEqual([
          { attempt_number: 1, status: "expired" },
          { attempt_number: 2, status: "pending" },
        ]);

        await context.store.markOrderPaidOnce({
          order_id: "order_concurrent",
          requirement_id: "dpr_orm_matrix",
          chain_receipt_id: "chain_orm_matrix",
        });
        expect(await orderStatus(context, tables, "order_concurrent")).toBe("paid");

        let webhookInvocations = 0;
        await expect(context.store.processWebhookEventOnce("evt_retry_matrix", async () => {
          webhookInvocations += 1;
          throw new Error("simulated webhook failure");
        })).rejects.toThrow("simulated webhook failure");
        expect(webhookInvocations).toBe(1);
        expect(await eventRows(context, tables, "evt_retry_matrix")).toHaveLength(0);

        const processed = await context.store.processWebhookEventOnce("evt_retry_matrix", async () => {
          webhookInvocations += 1;
        });
        expect(processed).toBe("processed");
        expect(webhookInvocations).toBe(2);
        await expect(eventRows(context, tables, "evt_retry_matrix")).resolves.toEqual([
          expect.objectContaining({ event_id: "evt_retry_matrix", status: "processed" }),
        ]);

        const duplicate = await context.store.processWebhookEventOnce("evt_retry_matrix", async () => {
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
