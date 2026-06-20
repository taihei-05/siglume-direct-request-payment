import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import type { Request } from "express";

import type { SiglumeCheckoutAttempt, SiglumeSdrpOrderStore } from "./siglume-sdrp-routes.js";

export type SiglumeSqlDialect = "postgres" | "mysql" | "sqlite";
export type SiglumeSqlParamStyle = "numbered" | "question";

export interface SiglumeSqlExecutor {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    statement: string,
    params?: readonly unknown[],
  ): Promise<T[]>;
  execute(statement: string, params?: readonly unknown[]): Promise<unknown>;
  transaction?<T>(handler: (executor: SiglumeSqlExecutor) => Promise<T>): Promise<T>;
}

export interface SiglumeSqlOrderStoreOptions {
  executor: SiglumeSqlExecutor;
  dialect?: SiglumeSqlDialect;
  param_style?: SiglumeSqlParamStyle;
  orders_table?: string;
  order_id_column?: string;
  amount_minor_column?: string;
  currency_column?: string;
  order_status_column?: string | null;
  order_updated_at_column?: string | null;
  checkout_attempts_table?: string;
  webhook_events_table?: string;
  payment_reviews_table?: string;
  authorize_order?: (order: Record<string, unknown>, req: Request) => boolean | Promise<boolean>;
}

interface NormalizedOptions {
  executor: SiglumeSqlExecutor;
  dialect: SiglumeSqlDialect;
  param_style: SiglumeSqlParamStyle;
  orders_table: string;
  order_id_column: string;
  amount_minor_column: string;
  currency_column: string;
  order_status_column: string | null;
  order_updated_at_column: string | null;
  checkout_attempts_table: string;
  webhook_events_table: string;
  payment_reviews_table: string;
  authorize_order?: (order: Record<string, unknown>, req: Request) => boolean | Promise<boolean>;
}

interface SqlParts {
  readonly qOrders: string;
  readonly qOrderId: string;
  readonly qAmountMinor: string;
  readonly qCurrency: string;
  readonly qOrderStatus: string | null;
  readonly qOrderUpdatedAt: string | null;
  readonly qAttempts: string;
  readonly qEvents: string;
  readonly qReviews: string;
}

export function createSqlSiglumeOrderStore(options: SiglumeSqlOrderStoreOptions): SiglumeSdrpOrderStore {
  return new SqlSiglumeOrderStore(normalizeOptions(options));
}

export function createPrismaSiglumeOrderStore(prisma: unknown, options: Omit<SiglumeSqlOrderStoreOptions, "executor"> = {}): SiglumeSdrpOrderStore {
  return createSqlSiglumeOrderStore({
    ...options,
    executor: createPrismaSiglumeSqlExecutor(prisma),
  });
}

export function createTypeOrmSiglumeOrderStore(dataSource: unknown, options: Omit<SiglumeSqlOrderStoreOptions, "executor"> = {}): SiglumeSdrpOrderStore {
  return createSqlSiglumeOrderStore({
    ...options,
    executor: createTypeOrmSiglumeSqlExecutor(dataSource),
  });
}

export function createSequelizeSiglumeOrderStore(sequelize: unknown, options: Omit<SiglumeSqlOrderStoreOptions, "executor" | "param_style"> = {}): SiglumeSdrpOrderStore {
  return createSqlSiglumeOrderStore({
    ...options,
    param_style: "question",
    executor: createSequelizeSiglumeSqlExecutor(sequelize),
  });
}

export function createDrizzleSiglumeOrderStore(
  db: unknown,
  drizzleSql: unknown,
  options: Omit<SiglumeSqlOrderStoreOptions, "executor" | "param_style"> = {},
): SiglumeSdrpOrderStore {
  return createSqlSiglumeOrderStore({
    ...options,
    param_style: "question",
    executor: createDrizzleSiglumeSqlExecutor(db, drizzleSql),
  });
}

export function createSiglumeSdrpSqlSchema(options: {
  dialect?: SiglumeSqlDialect;
  orders_table?: string;
  order_id_column?: string;
  amount_minor_column?: string;
  currency_column?: string;
  order_status_column?: string | null;
  order_updated_at_column?: string | null;
  checkout_attempts_table?: string;
  webhook_events_table?: string;
  payment_reviews_table?: string;
  include_orders_table?: boolean;
} = {}): string[] {
  const normalized = normalizeOptions({ executor: noopExecutor, ...options });
  const parts = sqlParts(normalized);
  const text = normalized.dialect === "mysql" ? "VARCHAR(255)" : "TEXT";
  const bigInt = normalized.dialect === "sqlite" ? "INTEGER" : "BIGINT";
  const timestamp = normalized.dialect === "postgres" ? "TIMESTAMPTZ" : "TIMESTAMP";
  const now = normalized.dialect === "postgres" ? "CURRENT_TIMESTAMP" : "CURRENT_TIMESTAMP";
  const json = normalized.dialect === "postgres" ? "JSONB" : normalized.dialect === "mysql" ? "JSON" : "TEXT";
  const statements: string[] = [];

  if (options.include_orders_table !== false) {
    statements.push(`
CREATE TABLE IF NOT EXISTS ${parts.qOrders} (
  ${parts.qOrderId} ${text} PRIMARY KEY,
  ${parts.qAmountMinor} ${bigInt} NOT NULL,
  ${parts.qCurrency} ${text} NOT NULL,
  ${parts.qOrderStatus ?? quoteIdentifier("status", normalized.dialect)} ${text} NOT NULL DEFAULT 'created',
  created_at ${timestamp} NOT NULL DEFAULT ${now},
  updated_at ${timestamp} NOT NULL DEFAULT ${now}
)`.trim());
  }

  statements.push(`
CREATE TABLE IF NOT EXISTS ${parts.qAttempts} (
  order_id ${text} PRIMARY KEY,
  attempt_id ${text} NOT NULL UNIQUE,
  stable_nonce ${text} NOT NULL UNIQUE,
  status ${text} NOT NULL DEFAULT 'created',
  challenge_hash ${text} UNIQUE,
  checkout_session_id ${text},
  checkout_url ${text},
  requirement_id ${text},
  chain_receipt_id ${text},
  pricing_band ${text},
  paid_at ${timestamp},
  fulfilled_unsettled_at ${timestamp},
  created_at ${timestamp} NOT NULL DEFAULT ${now},
  updated_at ${timestamp} NOT NULL DEFAULT ${now}
)`.trim());
  if (normalized.dialect !== "mysql") {
    statements.push(`CREATE INDEX IF NOT EXISTS ${quoteIdentifier("idx_siglume_checkout_attempts_challenge", normalized.dialect)} ON ${parts.qAttempts} (challenge_hash)`);
  }

  statements.push(`
CREATE TABLE IF NOT EXISTS ${parts.qEvents} (
  event_id ${text} PRIMARY KEY,
  status ${text} NOT NULL,
  error_message ${text},
  created_at ${timestamp} NOT NULL DEFAULT ${now},
  processed_at ${timestamp}
)`.trim());

  statements.push(`
CREATE TABLE IF NOT EXISTS ${parts.qReviews} (
  review_id ${text} PRIMARY KEY,
  order_id ${text},
  reason ${text} NOT NULL,
  payload_json ${json} NOT NULL,
  created_at ${timestamp} NOT NULL DEFAULT ${now}
)`.trim());
  if (normalized.dialect !== "mysql") {
    statements.push(`CREATE INDEX IF NOT EXISTS ${quoteIdentifier("idx_siglume_payment_reviews_order", normalized.dialect)} ON ${parts.qReviews} (order_id)`);
  }

  return statements;
}

export function createPrismaSiglumeSqlExecutor(prisma: unknown): SiglumeSqlExecutor {
  const client = prisma as {
    $queryRawUnsafe?: (statement: string, ...params: unknown[]) => Promise<unknown>;
    $executeRawUnsafe?: (statement: string, ...params: unknown[]) => Promise<unknown>;
    $transaction?: <T>(handler: (tx: unknown) => Promise<T>) => Promise<T>;
  };
  return {
    async query<T extends Record<string, unknown> = Record<string, unknown>>(statement: string, params: readonly unknown[] = []): Promise<T[]> {
      const rows = await client.$queryRawUnsafe?.(statement, ...params);
      return normalizeRows(rows) as T[];
    },
    async execute(statement, params = []) {
      return client.$executeRawUnsafe?.(statement, ...params);
    },
    async transaction(handler) {
      if (!client.$transaction) return handler(createPrismaSiglumeSqlExecutor(client));
      return client.$transaction((tx) => handler(createPrismaSiglumeSqlExecutor(tx)));
    },
  };
}

export function createTypeOrmSiglumeSqlExecutor(dataSource: unknown): SiglumeSqlExecutor {
  const source = dataSource as {
    query?: (statement: string, params?: readonly unknown[]) => Promise<unknown>;
    transaction?: <T>(handler: (manager: { query: (statement: string, params?: readonly unknown[]) => Promise<unknown> }) => Promise<T>) => Promise<T>;
  };
  return {
    async query<T extends Record<string, unknown> = Record<string, unknown>>(statement: string, params: readonly unknown[] = []): Promise<T[]> {
      return normalizeRows(await source.query?.(statement, params)) as T[];
    },
    async execute(statement, params = []) {
      return source.query?.(statement, params);
    },
    async transaction(handler) {
      if (!source.transaction) return handler(createTypeOrmSiglumeSqlExecutor(source));
      return source.transaction((manager) => handler(createTypeOrmSiglumeSqlExecutor(manager)));
    },
  };
}

export function createSequelizeSiglumeSqlExecutor(sequelize: unknown): SiglumeSqlExecutor {
  const source = sequelize as {
    query?: (statement: string, options?: Record<string, unknown>) => Promise<unknown>;
    transaction?: <T>(handler: (transaction: unknown) => Promise<T>) => Promise<T>;
  };
  return {
    async query<T extends Record<string, unknown> = Record<string, unknown>>(statement: string, params: readonly unknown[] = []): Promise<T[]> {
      const result = await source.query?.(statement, { replacements: [...params] });
      return normalizeRows(Array.isArray(result) ? result[0] : result) as T[];
    },
    async execute(statement, params = []) {
      const result = await source.query?.(statement, { replacements: [...params] });
      return Array.isArray(result) ? result[1] : result;
    },
    async transaction(handler) {
      if (!source.transaction) return handler(createSequelizeSiglumeSqlExecutor(source));
      return source.transaction((transaction) => handler({
        query: async <T extends Record<string, unknown> = Record<string, unknown>>(statement: string, params: readonly unknown[] = []): Promise<T[]> => {
          const result = await source.query?.(statement, { replacements: [...params], transaction });
          return normalizeRows(Array.isArray(result) ? result[0] : result) as T[];
        },
        execute: async (statement, params = []) => {
          const result = await source.query?.(statement, { replacements: [...params], transaction });
          return Array.isArray(result) ? result[1] : result;
        },
      }));
    },
  };
}

export function createDrizzleSiglumeSqlExecutor(db: unknown, drizzleSql: unknown): SiglumeSqlExecutor {
  const database = db as {
    execute?: (statement: unknown) => Promise<unknown>;
    transaction?: <T>(handler: (tx: unknown) => Promise<T>) => Promise<T>;
  };
  const sqlTag = drizzleSql as {
    (strings: TemplateStringsArray, ...params: unknown[]): unknown;
    raw?: (value: string) => unknown;
    join?: (items: unknown[], separator: unknown) => unknown;
  };
  return {
    async query<T extends Record<string, unknown> = Record<string, unknown>>(statement: string, params: readonly unknown[] = []): Promise<T[]> {
      return normalizeRows(await database.execute?.(toDrizzleStatement(sqlTag, statement, params))) as T[];
    },
    async execute(statement, params = []) {
      return database.execute?.(toDrizzleStatement(sqlTag, statement, params));
    },
    async transaction(handler) {
      if (!database.transaction) return handler(createDrizzleSiglumeSqlExecutor(database, sqlTag));
      return database.transaction((tx) => handler(createDrizzleSiglumeSqlExecutor(tx, sqlTag)));
    },
  };
}

class SqlSiglumeOrderStore implements SiglumeSdrpOrderStore {
  private readonly tx = new AsyncLocalStorage<SiglumeSqlExecutor>();

  constructor(private readonly options: NormalizedOptions) {}

  async beginCheckoutAttempt(orderId: string, req: Request): Promise<SiglumeCheckoutAttempt | null> {
    const cleanOrderId = requireText(orderId, "order_id");
    return this.withTransaction(async () => {
      const order = await this.findProductOrder(cleanOrderId);
      if (!order) return null;
      if (this.options.authorize_order && !(await this.options.authorize_order(order, req))) return null;

      const parts = sqlParts(this.options);
      const attempt = stableAttempt(cleanOrderId);
      await this.insertAttemptIfMissing(cleanOrderId, attempt.attempt_id, attempt.stable_nonce);
      const rows = await this.executor().query<Record<string, unknown>>(
        `SELECT attempt_id, stable_nonce, checkout_session_id, checkout_url FROM ${parts.qAttempts} WHERE order_id = ${this.p(1)} LIMIT 1`,
        [cleanOrderId],
      );
      const state = rows[0] ?? {};
      return {
        id: String(order.id),
        order_id: String(order.id),
        amount_minor: Number(order.amount_minor),
        currency: String(order.currency),
        attempt_id: String(state.attempt_id || attempt.attempt_id),
        stable_nonce: String(state.stable_nonce || attempt.stable_nonce),
        checkout_session_id: textOrUndefined(state.checkout_session_id),
        checkout_url: textOrUndefined(state.checkout_url),
      };
    });
  }

  async markCheckoutPending(input: {
    order_id: string;
    attempt_id: string;
    stable_nonce: string;
    challenge_hash: string;
    checkout_session_id: string;
    checkout_url: string;
  }): Promise<void> {
    const parts = sqlParts(this.options);
    await this.executor().execute(
      `UPDATE ${parts.qAttempts}
       SET status = ${this.p(1)}, attempt_id = ${this.p(2)}, stable_nonce = ${this.p(3)}, challenge_hash = ${this.p(4)},
           checkout_session_id = ${this.p(5)}, checkout_url = ${this.p(6)}, updated_at = CURRENT_TIMESTAMP
       WHERE order_id = ${this.p(7)}`,
      ["pending", input.attempt_id, input.stable_nonce, input.challenge_hash, input.checkout_session_id, input.checkout_url, input.order_id],
    );
  }

  async processWebhookEventOnce(eventId: string, handler: () => Promise<void>): Promise<"processed" | "duplicate"> {
    const cleanEventId = requireText(eventId, "event_id");
    if (!this.options.executor.transaction && !this.tx.getStore()) {
      return this.processWebhookEventOnceWithoutTransaction(cleanEventId, handler);
    }
    return this.withTransaction(async (executor) => {
      const parts = sqlParts(this.options);
      const existing = await executor.query<{ status?: unknown }>(
        `SELECT status FROM ${parts.qEvents} WHERE event_id = ${this.p(1)} LIMIT 1`,
        [cleanEventId],
      );
      const existingStatus = existing.length ? String(existing[0]?.status || "") : "";
      if (existingStatus === "processed" || existingStatus === "processing") return "duplicate";
      if (existingStatus === "failed") {
        await executor.execute(
          `UPDATE ${parts.qEvents} SET status = ${this.p(1)}, error_message = NULL, processed_at = NULL WHERE event_id = ${this.p(2)}`,
          ["processing", cleanEventId],
        );
      } else {
        const inserted = affectedRows(await executor.execute(insertWebhookEventSql(this.options, cleanEventId), [cleanEventId, "processing"]));
        if (inserted === 0) return "duplicate";
      }
      await this.tx.run(executor, handler);
      await executor.execute(
        `UPDATE ${parts.qEvents} SET status = ${this.p(1)}, processed_at = CURRENT_TIMESTAMP WHERE event_id = ${this.p(2)}`,
        ["processed", cleanEventId],
      );
      return "processed";
    });
  }

  async findOrderByChallengeHash(challengeHash: string): Promise<{ id: string } | null> {
    const parts = sqlParts(this.options);
    const rows = await this.executor().query<{ id: string }>(
      `SELECT order_id AS id FROM ${parts.qAttempts} WHERE challenge_hash = ${this.p(1)} LIMIT 1`,
      [challengeHash],
    );
    return rows[0] ?? null;
  }

  private async processWebhookEventOnceWithoutTransaction(
    cleanEventId: string,
    handler: () => Promise<void>,
  ): Promise<"processed" | "duplicate"> {
    const parts = sqlParts(this.options);
    const existing = await this.options.executor.query<{ status?: unknown }>(
      `SELECT status FROM ${parts.qEvents} WHERE event_id = ${this.p(1)} LIMIT 1`,
      [cleanEventId],
    );
    const existingStatus = existing.length ? String(existing[0]?.status || "") : "";
    if (existingStatus === "processed" || existingStatus === "processing") return "duplicate";
    if (existingStatus === "failed") {
      await this.options.executor.execute(
        `UPDATE ${parts.qEvents} SET status = ${this.p(1)}, error_message = NULL, processed_at = NULL WHERE event_id = ${this.p(2)}`,
        ["processing", cleanEventId],
      );
    } else {
      const inserted = await this.executeChanged(insertWebhookEventSql(this.options, cleanEventId), [cleanEventId, "processing"]);
      if (inserted === 0) return "duplicate";
    }

    try {
      await handler();
      await this.options.executor.execute(
        `UPDATE ${parts.qEvents} SET status = ${this.p(1)}, error_message = NULL, processed_at = CURRENT_TIMESTAMP WHERE event_id = ${this.p(2)}`,
        ["processed", cleanEventId],
      );
      return "processed";
    } catch (error) {
      await this.options.executor.execute(
        `UPDATE ${parts.qEvents} SET status = ${this.p(1)}, error_message = ${this.p(2)}, processed_at = NULL WHERE event_id = ${this.p(3)}`,
        ["failed", errorMessage(error), cleanEventId],
      );
      throw error;
    }
  }

  async markOrderPaidOnce(input: {
    order_id: string;
    requirement_id: string;
    chain_receipt_id: string;
  }): Promise<void> {
    const parts = sqlParts(this.options);
    const changed = await this.executeChanged(
      `UPDATE ${parts.qAttempts}
       SET status = ${this.p(1)}, requirement_id = ${this.p(2)}, chain_receipt_id = ${this.p(3)}, paid_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE order_id = ${this.p(4)} AND status <> ${this.p(5)}`,
      ["paid", input.requirement_id, input.chain_receipt_id, input.order_id, "paid"],
    );
    if (changed && parts.qOrderStatus) {
      const updatedAt = parts.qOrderUpdatedAt ? `, ${parts.qOrderUpdatedAt} = CURRENT_TIMESTAMP` : "";
      await this.executor().execute(
        `UPDATE ${parts.qOrders} SET ${parts.qOrderStatus} = ${this.p(1)}${updatedAt} WHERE ${parts.qOrderId} = ${this.p(2)}`,
        ["paid", input.order_id],
      );
    }
  }

  async markOrderFulfilledUnsettledOnce(input: {
    order_id: string;
    requirement_id: string;
    pricing_band: string;
  }): Promise<void> {
    const parts = sqlParts(this.options);
    const changed = await this.executeChanged(
      `UPDATE ${parts.qAttempts}
       SET status = ${this.p(1)}, requirement_id = ${this.p(2)}, pricing_band = ${this.p(3)}, fulfilled_unsettled_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE order_id = ${this.p(4)} AND status NOT IN (${this.p(5)}, ${this.p(6)})`,
      ["fulfilled_unsettled", input.requirement_id, input.pricing_band, input.order_id, "fulfilled_unsettled", "paid"],
    );
    if (changed && parts.qOrderStatus) {
      const updatedAt = parts.qOrderUpdatedAt ? `, ${parts.qOrderUpdatedAt} = CURRENT_TIMESTAMP` : "";
      await this.executor().execute(
        `UPDATE ${parts.qOrders} SET ${parts.qOrderStatus} = ${this.p(1)}${updatedAt} WHERE ${parts.qOrderId} = ${this.p(2)}`,
        ["fulfilled_unsettled", input.order_id],
      );
    }
  }

  async flagPaymentReview(input: Record<string, unknown>): Promise<void> {
    const parts = sqlParts(this.options);
    await this.executor().execute(
      `INSERT INTO ${parts.qReviews} (review_id, order_id, reason, payload_json, created_at)
       VALUES (${this.p(1)}, ${this.p(2)}, ${this.p(3)}, ${this.p(4)}, CURRENT_TIMESTAMP)`,
      [
        `sdrp_review_${hash(`${Date.now()}:${JSON.stringify(input)}`).slice(0, 24)}`,
        textOrNull(input.order_id),
        String(input.reason || "manual_review_required"),
        JSON.stringify(input),
      ],
    );
  }

  private async findProductOrder(orderId: string): Promise<Record<string, unknown> | null> {
    const parts = sqlParts(this.options);
    const rows = await this.executor().query<Record<string, unknown>>(
      `SELECT ${parts.qOrderId} AS id, ${parts.qAmountMinor} AS amount_minor, ${parts.qCurrency} AS currency
       FROM ${parts.qOrders}
       WHERE ${parts.qOrderId} = ${this.p(1)}
       LIMIT 1`,
      [orderId],
    );
    return rows[0] ?? null;
  }

  private async insertAttemptIfMissing(orderId: string, attemptId: string, stableNonce: string): Promise<void> {
    await this.executor().execute(insertAttemptSql(this.options), [orderId, attemptId, stableNonce, "created"]);
  }

  private async executeChanged(statement: string, params: readonly unknown[]): Promise<number | null> {
    const result = await this.executor().execute(statement, params);
    return affectedRows(result);
  }

  private async withTransaction<T>(handler: (executor: SiglumeSqlExecutor) => Promise<T>): Promise<T> {
    const current = this.tx.getStore();
    if (current) return handler(current);
    if (!this.options.executor.transaction) return handler(this.options.executor);
    return this.options.executor.transaction((executor) => this.tx.run(executor, () => handler(executor)));
  }

  private executor(): SiglumeSqlExecutor {
    return this.tx.getStore() ?? this.options.executor;
  }

  private p(index: number): string {
    return placeholder(index, this.options);
  }
}

function normalizeOptions(options: SiglumeSqlOrderStoreOptions): NormalizedOptions {
  const dialect = options.dialect ?? "postgres";
  return {
    executor: options.executor,
    dialect,
    param_style: options.param_style ?? (dialect === "postgres" ? "numbered" : "question"),
    orders_table: options.orders_table ?? "orders",
    order_id_column: options.order_id_column ?? "id",
    amount_minor_column: options.amount_minor_column ?? "amount_minor",
    currency_column: options.currency_column ?? "currency",
    order_status_column: options.order_status_column === undefined ? "status" : options.order_status_column,
    order_updated_at_column: options.order_updated_at_column === undefined ? "updated_at" : options.order_updated_at_column,
    checkout_attempts_table: options.checkout_attempts_table ?? "siglume_checkout_attempts",
    webhook_events_table: options.webhook_events_table ?? "siglume_webhook_events",
    payment_reviews_table: options.payment_reviews_table ?? "siglume_payment_reviews",
    authorize_order: options.authorize_order,
  };
}

function sqlParts(options: NormalizedOptions): SqlParts {
  return {
    qOrders: quoteIdentifier(options.orders_table, options.dialect),
    qOrderId: quoteIdentifier(options.order_id_column, options.dialect),
    qAmountMinor: quoteIdentifier(options.amount_minor_column, options.dialect),
    qCurrency: quoteIdentifier(options.currency_column, options.dialect),
    qOrderStatus: options.order_status_column ? quoteIdentifier(options.order_status_column, options.dialect) : null,
    qOrderUpdatedAt: options.order_updated_at_column ? quoteIdentifier(options.order_updated_at_column, options.dialect) : null,
    qAttempts: quoteIdentifier(options.checkout_attempts_table, options.dialect),
    qEvents: quoteIdentifier(options.webhook_events_table, options.dialect),
    qReviews: quoteIdentifier(options.payment_reviews_table, options.dialect),
  };
}

function insertAttemptSql(options: NormalizedOptions): string {
  const parts = sqlParts(options);
  if (options.dialect === "mysql") {
    return `INSERT IGNORE INTO ${parts.qAttempts} (order_id, attempt_id, stable_nonce, status) VALUES (${placeholder(1, options)}, ${placeholder(2, options)}, ${placeholder(3, options)}, ${placeholder(4, options)})`;
  }
  return `INSERT INTO ${parts.qAttempts} (order_id, attempt_id, stable_nonce, status) VALUES (${placeholder(1, options)}, ${placeholder(2, options)}, ${placeholder(3, options)}, ${placeholder(4, options)}) ON CONFLICT (order_id) DO NOTHING`;
}

function insertWebhookEventSql(options: NormalizedOptions, _eventId: string): string {
  const parts = sqlParts(options);
  if (options.dialect === "mysql") {
    return `INSERT IGNORE INTO ${parts.qEvents} (event_id, status, created_at) VALUES (${placeholder(1, options)}, ${placeholder(2, options)}, CURRENT_TIMESTAMP)`;
  }
  return `INSERT INTO ${parts.qEvents} (event_id, status, created_at) VALUES (${placeholder(1, options)}, ${placeholder(2, options)}, CURRENT_TIMESTAMP) ON CONFLICT (event_id) DO NOTHING`;
}

function placeholder(index: number, options: NormalizedOptions): string {
  return options.param_style === "numbered" ? `$${index}` : "?";
}

function quoteIdentifier(identifier: string, dialect: SiglumeSqlDialect): string {
  const quote = dialect === "mysql" ? "`" : "\"";
  return identifier.split(".").map((part) => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(part)) {
      throw new Error(`Unsafe SQL identifier: ${identifier}`);
    }
    return `${quote}${part}${quote}`;
  }).join(".");
}

function stableAttempt(orderId: string): { attempt_id: string; stable_nonce: string } {
  const digest = hash(orderId).slice(0, 32);
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

function normalizeRows(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value as Record<string, unknown>[];
  if (value && typeof value === "object" && Array.isArray((value as { rows?: unknown[] }).rows)) {
    return (value as { rows: Record<string, unknown>[] }).rows;
  }
  return [];
}

function affectedRows(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  for (const key of ["rowCount", "affectedRows", "changes"]) {
    if (typeof record[key] === "number") return record[key] as number;
  }
  return null;
}

function toDrizzleStatement(
  sqlTag: {
    (strings: TemplateStringsArray, ...params: unknown[]): unknown;
    raw?: (value: string) => unknown;
    join?: (items: unknown[], separator: unknown) => unknown;
  },
  statement: string,
  params: readonly unknown[],
): unknown {
  if (!sqlTag.raw || !sqlTag.join) {
    throw new Error("Drizzle adapter requires the drizzle-orm sql tag.");
  }
  const fragments = statement.split("?");
  const chunks: unknown[] = [];
  fragments.forEach((fragment, index) => {
    if (fragment) chunks.push(sqlTag.raw?.(fragment));
    if (index < params.length) chunks.push(sqlTag`${params[index]}`);
  });
  return sqlTag.join(chunks, sqlTag.raw(""));
}

const noopExecutor: SiglumeSqlExecutor = {
  async query() {
    return [];
  },
  async execute() {
    return 0;
  },
};
