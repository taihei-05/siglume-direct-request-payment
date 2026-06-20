import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
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

const CHECKOUT_CREATION_LEASE_MS = 30_000;
const CHECKOUT_CREATION_WAIT_MS = 10_000;
const CHECKOUT_CREATION_POLL_MS = 100;
const WEBHOOK_PROCESSING_STALE_MS = 10 * 60 * 1000;

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
  attempt_id ${text} PRIMARY KEY,
  order_id ${text} NOT NULL,
  attempt_number INTEGER NOT NULL,
  stable_nonce ${text} NOT NULL UNIQUE,
  active_key ${text} UNIQUE,
  status ${text} NOT NULL DEFAULT 'created',
  challenge_hash ${text} UNIQUE,
  checkout_session_id ${text},
  checkout_url ${text},
  expires_at ${timestamp},
  cancelled_at ${timestamp},
  failed_at ${timestamp},
  creation_owner_id ${text},
  creation_lease_expires_at ${timestamp},
  error_message ${text},
  requirement_id ${text},
  chain_receipt_id ${text},
  pricing_band ${text},
  paid_at ${timestamp},
  fulfilled_unsettled_at ${timestamp},
  created_at ${timestamp} NOT NULL DEFAULT ${now},
  updated_at ${timestamp} NOT NULL DEFAULT ${now},
  UNIQUE (order_id, attempt_number)
)`.trim());
  if (normalized.dialect !== "mysql") {
    statements.push(`CREATE INDEX IF NOT EXISTS ${quoteIdentifier("idx_siglume_checkout_attempts_order", normalized.dialect)} ON ${parts.qAttempts} (order_id)`);
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
    const waitUntil = Date.now() + CHECKOUT_CREATION_WAIT_MS;
    for (;;) {
      const result = await this.withTransaction(async (executor) => {
        const order = await this.findProductOrder(cleanOrderId);
        if (!order) return { done: true, attempt: null as SiglumeCheckoutAttempt | null };
        if (this.options.authorize_order && !(await this.options.authorize_order(order, req))) {
          return { done: true, attempt: null as SiglumeCheckoutAttempt | null };
        }

        const active = await this.findActiveCheckoutAttempt(executor, cleanOrderId);
        if (active && isReusableCheckoutAttempt(active)) {
          return { done: true, attempt: this.toCheckoutAttempt(order, active) };
        }
        if (active && isCreatingCheckoutAttempt(active) && !timestampHasPassed(active.creation_lease_expires_at)) {
          return { done: false, attempt: this.toCheckoutAttempt(order, active, true) };
        }
        if (active) {
          await this.releaseInactiveAttempt(executor, active, active.status === "pending" ? "expired" : "failed");
        }

        const attemptNumber = await this.nextAttemptNumber(executor, cleanOrderId);
        const attempt = stableAttempt(cleanOrderId, attemptNumber);
        const inserted = await this.executeChangedWith(
          executor,
          insertAttemptSql(this.options),
          [
            cleanOrderId,
            attemptNumber,
            attempt.attempt_id,
            attempt.stable_nonce,
            cleanOrderId,
            "creating",
            `sdrp_create_${randomUUID()}`,
            sqlTimestamp(Date.now() + CHECKOUT_CREATION_LEASE_MS),
          ],
        );
        if (inserted === 0) {
          return { done: false, attempt: this.toCheckoutAttempt(order, {
            order_id: cleanOrderId,
            attempt_number: attemptNumber,
            attempt_id: attempt.attempt_id,
            stable_nonce: attempt.stable_nonce,
            status: "creating",
          }, true) };
        }
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
          },
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
    const parts = sqlParts(this.options);
    await this.executor().execute(
      `UPDATE ${parts.qAttempts}
       SET status = ${this.p(1)}, stable_nonce = ${this.p(2)}, challenge_hash = ${this.p(3)},
           checkout_session_id = ${this.p(4)}, checkout_url = ${this.p(5)}, expires_at = ${this.p(6)},
           creation_owner_id = NULL, creation_lease_expires_at = NULL, error_message = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE order_id = ${this.p(7)} AND attempt_id = ${this.p(8)} AND status = ${this.p(9)}`,
      ["pending", input.stable_nonce, input.challenge_hash, input.checkout_session_id, input.checkout_url, sqlTimestampOrNull(input.expires_at), input.order_id, input.attempt_id, "creating"],
    );
  }

  async markCheckoutFailed(input: {
    order_id: string;
    attempt_id: string;
    error_message?: string;
  }): Promise<void> {
    const parts = sqlParts(this.options);
    await this.executor().execute(
      `UPDATE ${parts.qAttempts}
       SET status = ${this.p(1)}, active_key = NULL, failed_at = CURRENT_TIMESTAMP,
           creation_owner_id = NULL, creation_lease_expires_at = NULL,
           error_message = ${this.p(2)}, updated_at = CURRENT_TIMESTAMP
       WHERE order_id = ${this.p(3)} AND attempt_id = ${this.p(4)} AND status = ${this.p(5)}`,
      ["failed", textOrNull(input.error_message), input.order_id, input.attempt_id, "creating"],
    );
  }

  async processWebhookEventOnce(eventId: string, handler: () => Promise<void>): Promise<"processed" | "duplicate"> {
    const cleanEventId = requireText(eventId, "event_id");
    if (!this.options.executor.transaction && !this.tx.getStore()) {
      return this.processWebhookEventOnceWithoutTransaction(cleanEventId, handler);
    }
    return this.withTransaction(async (executor) => {
      const parts = sqlParts(this.options);
      const existing = await executor.query<{ status?: unknown; created_at?: unknown }>(
        `SELECT status, created_at FROM ${parts.qEvents} WHERE event_id = ${this.p(1)} LIMIT 1`,
        [cleanEventId],
      );
      const existingStatus = existing.length ? String(existing[0]?.status || "") : "";
      if (existingStatus === "processed") return "duplicate";
      if (existingStatus === "processing" && !webhookProcessingIsStale(existing[0]?.created_at)) return "duplicate";
      if (existingStatus === "failed" || existingStatus === "processing") {
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
    const existing = await this.options.executor.query<{ status?: unknown; created_at?: unknown }>(
      `SELECT status, created_at FROM ${parts.qEvents} WHERE event_id = ${this.p(1)} LIMIT 1`,
      [cleanEventId],
    );
    const existingStatus = existing.length ? String(existing[0]?.status || "") : "";
    if (existingStatus === "processed") return "duplicate";
    if (existingStatus === "processing" && !webhookProcessingIsStale(existing[0]?.created_at)) return "duplicate";
    if (existingStatus === "failed" || existingStatus === "processing") {
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
       SET status = ${this.p(1)}, active_key = NULL, requirement_id = ${this.p(2)}, chain_receipt_id = ${this.p(3)}, paid_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE order_id = ${this.p(4)} AND status NOT IN (${this.p(5)}, ${this.p(6)}, ${this.p(7)}, ${this.p(8)})`,
      ["paid", input.requirement_id, input.chain_receipt_id, input.order_id, "paid", "expired", "cancelled", "failed"],
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
       SET status = ${this.p(1)}, active_key = NULL, requirement_id = ${this.p(2)}, pricing_band = ${this.p(3)}, fulfilled_unsettled_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE order_id = ${this.p(4)} AND status NOT IN (${this.p(5)}, ${this.p(6)}, ${this.p(7)}, ${this.p(8)}, ${this.p(9)})`,
      ["fulfilled_unsettled", input.requirement_id, input.pricing_band, input.order_id, "fulfilled_unsettled", "paid", "expired", "cancelled", "failed"],
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

  private async findActiveCheckoutAttempt(executor: SiglumeSqlExecutor, orderId: string): Promise<Record<string, unknown> | null> {
    const parts = sqlParts(this.options);
    const rows = await executor.query<Record<string, unknown>>(
      `SELECT order_id, attempt_number, attempt_id, stable_nonce, status, checkout_session_id, checkout_url, expires_at,
              creation_lease_expires_at
       FROM ${parts.qAttempts}
       WHERE active_key = ${this.p(1)}
       LIMIT 1`,
      [orderId],
    );
    return rows[0] ?? null;
  }

  private async nextAttemptNumber(executor: SiglumeSqlExecutor, orderId: string): Promise<number> {
    const parts = sqlParts(this.options);
    const rows = await executor.query<Record<string, unknown>>(
      `SELECT MAX(attempt_number) AS max_attempt_number FROM ${parts.qAttempts} WHERE order_id = ${this.p(1)}`,
      [orderId],
    );
    const current = Number(rows[0]?.max_attempt_number || 0);
    return Number.isSafeInteger(current) && current > 0 ? current + 1 : 1;
  }

  private async releaseInactiveAttempt(executor: SiglumeSqlExecutor, attempt: Record<string, unknown>, status: "expired" | "failed"): Promise<void> {
    const parts = sqlParts(this.options);
    const timestampColumn = status === "expired" ? "expires_at" : "failed_at";
    await executor.execute(
      `UPDATE ${parts.qAttempts}
       SET status = ${this.p(1)}, active_key = NULL, ${quoteIdentifier(timestampColumn, this.options.dialect)} = COALESCE(${quoteIdentifier(timestampColumn, this.options.dialect)}, CURRENT_TIMESTAMP),
           creation_owner_id = NULL, creation_lease_expires_at = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE attempt_id = ${this.p(2)}`,
      [status, attempt.attempt_id],
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

  private async executeChangedWith(executor: SiglumeSqlExecutor, statement: string, params: readonly unknown[]): Promise<number | null> {
    const result = await executor.execute(statement, params);
    return affectedRows(result);
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
    return `INSERT IGNORE INTO ${parts.qAttempts} (order_id, attempt_number, attempt_id, stable_nonce, active_key, status, creation_owner_id, creation_lease_expires_at)
      VALUES (${placeholder(1, options)}, ${placeholder(2, options)}, ${placeholder(3, options)}, ${placeholder(4, options)}, ${placeholder(5, options)}, ${placeholder(6, options)}, ${placeholder(7, options)}, ${placeholder(8, options)})`;
  }
  return `INSERT INTO ${parts.qAttempts} (order_id, attempt_number, attempt_id, stable_nonce, active_key, status, creation_owner_id, creation_lease_expires_at)
    VALUES (${placeholder(1, options)}, ${placeholder(2, options)}, ${placeholder(3, options)}, ${placeholder(4, options)}, ${placeholder(5, options)}, ${placeholder(6, options)}, ${placeholder(7, options)}, ${placeholder(8, options)})
    ON CONFLICT (active_key) DO NOTHING`;
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

function webhookProcessingIsStale(value: unknown): boolean {
  if (!value) return false;
  const timestamp = Date.parse(String(value));
  return Number.isFinite(timestamp) && Date.now() - timestamp > WEBHOOK_PROCESSING_STALE_MS;
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

function timestampHasPassed(value: unknown): boolean {
  if (!value) return false;
  const timestamp = Date.parse(String(value));
  return Number.isFinite(timestamp) && timestamp <= Date.now();
}

function sqlTimestamp(value: number | string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  const pad = (item: number) => String(item).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function sqlTimestampOrNull(value: unknown): string | null {
  if (!value) return null;
  const timestamp = Date.parse(String(value));
  if (!Number.isFinite(timestamp)) return null;
  return sqlTimestamp(timestamp);
}

function timestampTextOrNull(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
