export const DEFAULT_SIGLUME_API_BASE = "https://siglume.com/v1";
export const DIRECT_REQUEST_PAYMENT_CHALLENGE_SCHEME = "siglume-external-402-v1";
// Recurring (subscription / scheduled autopay) approval uses a DISTINCT scheme
// with cadence bound into the HMAC, so a one-time checkout challenge can never
// be replayed as a recurring authorization and vice versa.
export const DIRECT_REQUEST_PAYMENT_RECURRING_CHALLENGE_SCHEME = "siglume-external-402-recurring-v1";
export const DIRECT_REQUEST_PAYMENT_MODE = "external_402";
export const DIRECT_REQUEST_PAYMENT_RECEIPT_KIND = "api_store_direct_payment";
export const DIRECT_REQUEST_PAYMENT_ALLOWANCE_RECEIPT_KIND = "api_store_direct_payment_allowance";
export const DIRECT_REQUEST_PAYMENT_REFERENCE_TYPE = "api_store_direct_payment_requirement";
export const DEFAULT_WEBHOOK_TOLERANCE_SECONDS = 300;

export type DirectRequestPaymentCurrency = "JPY" | "USD";
export type DirectRequestPaymentToken = "JPYC" | "USDC";

export interface DirectRequestPaymentChallengeInput {
  merchant: string;
  amount_minor: number;
  currency: DirectRequestPaymentCurrency | string;
  secret: string;
  nonce?: string;
}

export interface DirectRequestPaymentChallenge {
  scheme: typeof DIRECT_REQUEST_PAYMENT_CHALLENGE_SCHEME;
  merchant: string;
  amount_minor: number;
  currency: DirectRequestPaymentCurrency;
  nonce: string;
  signature: string;
  challenge: string;
  challenge_hash: string;
}

export interface ParsedDirectRequestPaymentChallenge {
  scheme: string;
  nonce: string;
  signature: string;
}

/** "monthly" authorizes a Siglume-swept subscription; "daily" authorizes a
 *  scheduled autopay (at most one charge per day, merchant-triggered). */
export type DirectRequestPaymentRecurringCadence = "monthly" | "daily";

export interface DirectRequestPaymentRecurringChallengeInput {
  merchant: string;
  amount_minor: number;
  currency: DirectRequestPaymentCurrency | string;
  cadence: DirectRequestPaymentRecurringCadence | string;
  secret: string;
  nonce?: string;
}

export interface DirectRequestPaymentRecurringChallenge {
  scheme: typeof DIRECT_REQUEST_PAYMENT_RECURRING_CHALLENGE_SCHEME;
  merchant: string;
  amount_minor: number;
  currency: DirectRequestPaymentCurrency;
  cadence: DirectRequestPaymentRecurringCadence;
  nonce: string;
  signature: string;
  challenge: string;
  challenge_hash: string;
}

export interface Web3TransactionRequest {
  network?: string;
  chain_id?: number;
  from?: string;
  to?: string;
  data?: string;
  value?: string | number;
  metadata_jsonb?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface DirectPaymentRequirement {
  direct_payment_requirement_id: string;
  requirement_id: string;
  id: string;
  mode: string;
  merchant?: string | null;
  challenge_hash?: string | null;
  buyer_user_id: string;
  agent_id?: string | null;
  product_listing_id: string;
  listing_id: string;
  access_grant_id?: string | null;
  capability_key: string;
  requirement_hash: string;
  request_hash: string;
  siglume_signature: string;
  token_symbol: string;
  currency: string;
  amount_minor: number;
  fee_bps: number;
  status: string;
  expires_at?: string | null;
  confirmed_at?: string | null;
  spent_at?: string | null;
  chain_receipt_id?: string | null;
  transaction_request: Web3TransactionRequest;
  approve_transaction_request?: Web3TransactionRequest | null;
  buyer_confirmation?: string | null;
  non_custodial: boolean;
  metadata_jsonb?: Record<string, unknown>;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface DirectPaymentRequirementCreateInput {
  merchant: string;
  amount_minor: number;
  currency: DirectRequestPaymentCurrency | string;
  challenge: string;
  token_symbol?: DirectRequestPaymentToken | string;
  allowance_amount_minor?: number;
  metadata?: Record<string, unknown>;
}

export interface DirectPaymentVerifyInput {
  receipt_id?: string | null;
  chain_receipt_id?: string | null;
  await_finality?: boolean;
  await_required_status?: string | null;
  await_timeout_seconds?: number;
  await_poll_seconds?: number;
}

export interface Web3PreparedTransactionExecutePayload {
  transaction_request: Web3TransactionRequest;
  receipt_kind: string;
  reference_type: typeof DIRECT_REQUEST_PAYMENT_REFERENCE_TYPE;
  reference_id: string;
  metadata?: Record<string, unknown>;
  await_finality?: boolean;
}

export interface Web3PreparedTransactionExecuteResult {
  receipt?: Record<string, unknown>;
  finalization?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface DirectRequestPaymentClientOptions {
  auth_token?: string;
  base_url?: string;
  fetch?: typeof fetch;
  timeout_ms?: number;
  user_agent?: string;
}

export type DirectRequestPaymentBillingPlan = "launch" | "free" | "starter" | "growth" | "pro";

export interface DirectRequestPaymentMerchantAccount {
  merchant_account_id: string;
  merchant: string;
  merchant_user_id: string;
  user_wallet_id?: string | null;
  billing_mandate_id?: string | null;
  display_name?: string | null;
  status?: string | null;
  billing_status?: string | null;
  billing_plan?: string | null;
  billing_currency?: string | null;
  token_symbol?: string | null;
  monthly_fee_minor?: number | null;
  settlement_fee_bps?: number | null;
  settlement_fee_min_minor?: number | null;
  included_monthly_payments?: number | null;
  metadata_jsonb?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface DirectRequestPaymentMerchantSetupInput {
  merchant: string;
  display_name?: string;
  billing_plan?: DirectRequestPaymentBillingPlan | string;
  billing_currency?: DirectRequestPaymentCurrency | string;
  allowed_currencies?: Record<string, string> | Array<DirectRequestPaymentCurrency | string>;
  webhook_callback_url?: string;
  billing_mandate_cap_minor?: number;
  max_amount_minor?: number;
}

export interface DirectRequestPaymentMerchantBillingMandateInput {
  currency?: DirectRequestPaymentCurrency | string;
  billing_currency?: DirectRequestPaymentCurrency | string;
  max_amount_minor?: number;
}

export interface DirectRequestPaymentMerchantResponse {
  merchant_account: DirectRequestPaymentMerchantAccount;
  challenge_secret?: string | null;
  challenge_secret_created?: boolean;
  created?: boolean | null;
  listing_id?: string | null;
  mandate?: Record<string, unknown> | null;
  next_steps?: Record<string, unknown>;
}

export interface DirectRequestPaymentWebhookSubscriptionInput {
  callback_url: string;
  description?: string;
  event_types?: string[];
  metadata?: Record<string, unknown>;
}

export interface DirectRequestPaymentWebhookSubscription {
  webhook_subscription_id?: string;
  subscription_id?: string;
  id?: string;
  callback_url?: string;
  signing_secret?: string;
  status?: string;
  event_types?: string[];
  [key: string]: unknown;
}

export interface DirectRequestPaymentCheckoutSetupInput extends DirectRequestPaymentMerchantSetupInput {
  create_webhook_subscription?: boolean;
  prepare_billing_mandate?: boolean;
  webhook_event_types?: string[];
  webhook_description?: string;
}

export interface DirectRequestPaymentCheckoutSetupResult {
  merchant: DirectRequestPaymentMerchantResponse;
  billing_mandate?: DirectRequestPaymentMerchantResponse | null;
  webhook_subscription?: DirectRequestPaymentWebhookSubscription | null;
  env: Record<string, string>;
}

export interface SiglumeEnvelopeMeta {
  request_id?: string | null;
  trace_id?: string | null;
  [key: string]: unknown;
}

export interface WebhookSignatureVerification {
  timestamp: number;
  signature: string;
}

export interface DirectRequestPaymentWebhookEvent {
  id: string;
  type: "direct_payment.confirmed" | string;
  api_version: string;
  occurred_at: string;
  data: {
    mode?: string;
    merchant?: string;
    direct_payment_requirement_id?: string;
    requirement_id?: string;
    challenge_hash?: string;
    amount_minor?: number;
    currency?: string;
    token_symbol?: string;
    status?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export class SiglumeDirectRequestPaymentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SiglumeDirectRequestPaymentError";
  }
}

export class SiglumeApiError extends SiglumeDirectRequestPaymentError {
  readonly status: number;
  readonly code: string;
  readonly data: unknown;

  constructor(message: string, options: { status: number; code?: string; data?: unknown }) {
    super(message);
    this.name = "SiglumeApiError";
    this.status = options.status;
    this.code = options.code ?? "SIGLUME_API_ERROR";
    this.data = options.data;
  }
}

export class SiglumeWebhookSignatureError extends SiglumeDirectRequestPaymentError {
  constructor(message: string) {
    super(message);
    this.name = "SiglumeWebhookSignatureError";
  }
}

export class SiglumeWebhookPayloadError extends SiglumeDirectRequestPaymentError {
  constructor(message: string) {
    super(message);
    this.name = "SiglumeWebhookPayloadError";
  }
}

export class DirectRequestPaymentClient {
  readonly auth_token: string;
  readonly base_url: string;
  readonly timeout_ms: number;
  readonly user_agent: string;
  private readonly fetch_impl: typeof fetch;

  constructor(options: DirectRequestPaymentClientOptions = {}) {
    const authToken = options.auth_token ?? envValue("SIGLUME_AUTH_TOKEN");
    if (!authToken) {
      throw new SiglumeDirectRequestPaymentError(
        "A buyer Siglume bearer token is required for Direct Request Payment API calls. Developer Portal API keys are not accepted.",
      );
    }
    const fetchImpl = options.fetch ?? globalThis.fetch;
    if (!fetchImpl) {
      throw new SiglumeDirectRequestPaymentError("A fetch implementation is required in this runtime.");
    }
    this.auth_token = authToken;
    this.base_url = (options.base_url ?? envValue("SIGLUME_API_BASE") ?? DEFAULT_SIGLUME_API_BASE).replace(/\/+$/, "");
    this.timeout_ms = Math.max(1, Math.trunc(options.timeout_ms ?? 15000));
    this.user_agent = options.user_agent ?? "@siglume/direct-request-payment/0.3.0";
    this.fetch_impl = fetchImpl;
  }

  async createPaymentRequirement(input: DirectPaymentRequirementCreateInput): Promise<DirectPaymentRequirement> {
    const payload: Record<string, unknown> = {
      mode: DIRECT_REQUEST_PAYMENT_MODE,
      merchant: normalizeMerchant(input.merchant),
      amount_minor: positiveInteger(input.amount_minor, "amount_minor"),
      currency: normalizeCurrency(input.currency),
      challenge: requireNonEmpty(input.challenge, "challenge"),
    };
    if (input.token_symbol !== undefined) {
      payload.token_symbol = normalizeToken(input.token_symbol);
    }
    if (input.allowance_amount_minor !== undefined) {
      payload.allowance_amount_minor = positiveInteger(input.allowance_amount_minor, "allowance_amount_minor");
    }
    if (input.metadata !== undefined) {
      payload.metadata = cloneJsonObject(input.metadata, "metadata");
    }
    return this.request<DirectPaymentRequirement>("POST", "/market/api-store/direct-payments/requirements", payload);
  }

  async getPaymentRequirement(requirement_id: string): Promise<DirectPaymentRequirement> {
    return this.request<DirectPaymentRequirement>(
      "GET",
      `/market/api-store/direct-payments/requirements/${encodeURIComponent(requireNonEmpty(requirement_id, "requirement_id"))}`,
    );
  }

  async verifyPaymentRequirement(
    requirement_id: string,
    input: DirectPaymentVerifyInput,
  ): Promise<DirectPaymentRequirement> {
    return this.request<DirectPaymentRequirement>(
      "POST",
      `/market/api-store/direct-payments/requirements/${encodeURIComponent(requireNonEmpty(requirement_id, "requirement_id"))}/verify`,
      input,
    );
  }

  async executePreparedTransaction(
    payload: Web3PreparedTransactionExecutePayload,
  ): Promise<Web3PreparedTransactionExecuteResult> {
    return this.request<Web3PreparedTransactionExecuteResult>(
      "POST",
      "/market/web3/transactions/execute-prepared",
      payload,
    );
  }

  async executePaymentTransaction(
    requirement: DirectPaymentRequirement,
    options: { await_finality?: boolean; metadata?: Record<string, unknown> } = {},
  ): Promise<Web3PreparedTransactionExecuteResult> {
    return this.executePreparedTransaction(buildPaymentExecutionPayload(requirement, options));
  }

  async executeAllowanceTransaction(
    requirement: DirectPaymentRequirement,
    options: { await_finality?: boolean; metadata?: Record<string, unknown> } = {},
  ): Promise<Web3PreparedTransactionExecuteResult> {
    return this.executePreparedTransaction(buildAllowanceExecutionPayload(requirement, options));
  }

  async request<T>(method: string, path: string, json_body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeout_ms);
    try {
      const headers: Record<string, string> = {
        "Accept": "application/json",
        "Authorization": `Bearer ${this.auth_token}`,
        "User-Agent": this.user_agent,
      };
      let body: string | undefined;
      if (json_body !== undefined) {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify(json_body);
      }
      const response = await this.fetch_impl(`${this.base_url}${path}`, {
        method,
        headers,
        body,
        signal: controller.signal,
      });
      const rawText = await response.text();
      const parsed = rawText ? parseJson(rawText) : {};
      if (!response.ok) {
        const error = isRecord(parsed) && isRecord(parsed.error) ? parsed.error : {};
        const code = stringOrNull(error.code) ?? stringOrNull((parsed as Record<string, unknown>).code) ?? `HTTP_${response.status}`;
        const message = stringOrNull(error.message) ?? stringOrNull((parsed as Record<string, unknown>).message) ?? response.statusText;
        throw new SiglumeApiError(message, { status: response.status, code, data: parsed });
      }
      if (isRecord(parsed) && "data" in parsed) {
        return parsed.data as T;
      }
      return parsed as T;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export class DirectRequestPaymentMerchantClient {
  readonly auth_token: string;
  readonly base_url: string;
  readonly timeout_ms: number;
  readonly user_agent: string;
  private readonly fetch_impl: typeof fetch;

  constructor(options: DirectRequestPaymentClientOptions = {}) {
    const authToken = options.auth_token ?? envValue("SIGLUME_MERCHANT_AUTH_TOKEN") ?? envValue("SIGLUME_AUTH_TOKEN");
    if (!authToken) {
      throw new SiglumeDirectRequestPaymentError(
        "A merchant Siglume bearer token is required for Direct Request Payment merchant setup. Developer Portal API keys are not accepted.",
      );
    }
    const fetchImpl = options.fetch ?? globalThis.fetch;
    if (!fetchImpl) {
      throw new SiglumeDirectRequestPaymentError("A fetch implementation is required in this runtime.");
    }
    this.auth_token = authToken;
    this.base_url = (options.base_url ?? envValue("SIGLUME_API_BASE") ?? DEFAULT_SIGLUME_API_BASE).replace(/\/+$/, "");
    this.timeout_ms = Math.max(1, Math.trunc(options.timeout_ms ?? 15000));
    this.user_agent = options.user_agent ?? "@siglume/direct-request-payment/0.3.0";
    this.fetch_impl = fetchImpl;
  }

  async setupMerchant(input: DirectRequestPaymentMerchantSetupInput): Promise<DirectRequestPaymentMerchantResponse> {
    const payload: Record<string, unknown> = {
      merchant: normalizeSelfServiceMerchant(input.merchant),
      billing_plan: normalizeBillingPlan(input.billing_plan ?? "launch"),
      billing_currency: normalizeCurrency(input.billing_currency ?? "JPY"),
    };
    if (input.display_name !== undefined) {
      payload.display_name = requireNonEmpty(input.display_name, "display_name");
    }
    if (input.allowed_currencies !== undefined) {
      payload.allowed_currencies = normalizeAllowedCurrencies(input.allowed_currencies);
    }
    if (input.webhook_callback_url !== undefined) {
      payload.webhook_callback_url = requireNonEmpty(input.webhook_callback_url, "webhook_callback_url");
    }
    if (input.billing_mandate_cap_minor !== undefined) {
      payload.billing_mandate_cap_minor = positiveInteger(input.billing_mandate_cap_minor, "billing_mandate_cap_minor");
    }
    if (input.max_amount_minor !== undefined) {
      payload.max_amount_minor = positiveInteger(input.max_amount_minor, "max_amount_minor");
    }
    return this.request<DirectRequestPaymentMerchantResponse>("POST", "/market/api-store/direct-payments/merchants", payload);
  }

  async getMerchant(merchant: string): Promise<DirectRequestPaymentMerchantResponse> {
    return this.request<DirectRequestPaymentMerchantResponse>(
      "GET",
      `/market/api-store/direct-payments/merchants/${encodeURIComponent(normalizeSelfServiceMerchant(merchant))}`,
    );
  }

  async rotateChallengeSecret(merchant: string): Promise<DirectRequestPaymentMerchantResponse> {
    return this.request<DirectRequestPaymentMerchantResponse>(
      "POST",
      `/market/api-store/direct-payments/merchants/${encodeURIComponent(normalizeSelfServiceMerchant(merchant))}/challenge-secret/rotate`,
    );
  }

  async prepareBillingMandate(
    merchant: string,
    input: DirectRequestPaymentMerchantBillingMandateInput = {},
  ): Promise<DirectRequestPaymentMerchantResponse> {
    const payload: Record<string, unknown> = {};
    if (input.currency !== undefined) {
      payload.currency = normalizeCurrency(input.currency);
    }
    if (input.billing_currency !== undefined) {
      payload.billing_currency = normalizeCurrency(input.billing_currency);
    }
    if (input.max_amount_minor !== undefined) {
      payload.max_amount_minor = positiveInteger(input.max_amount_minor, "max_amount_minor");
    }
    return this.request<DirectRequestPaymentMerchantResponse>(
      "POST",
      `/market/api-store/direct-payments/merchants/${encodeURIComponent(normalizeSelfServiceMerchant(merchant))}/billing-mandate`,
      payload,
    );
  }

  async createWebhookSubscription(
    input: DirectRequestPaymentWebhookSubscriptionInput,
  ): Promise<DirectRequestPaymentWebhookSubscription> {
    const payload: Record<string, unknown> = {
      callback_url: requireNonEmpty(input.callback_url, "callback_url"),
      event_types: input.event_types?.length
        ? input.event_types.map((eventType) => requireNonEmpty(eventType, "event_type"))
        : ["direct_payment.confirmed", "direct_payment.spent"],
    };
    if (input.description !== undefined) {
      payload.description = requireNonEmpty(input.description, "description");
    }
    if (input.metadata !== undefined) {
      payload.metadata = cloneJsonObject(input.metadata, "metadata");
    }
    return this.request<DirectRequestPaymentWebhookSubscription>("POST", "/market/webhooks/subscriptions", payload);
  }

  async setupCheckout(input: DirectRequestPaymentCheckoutSetupInput): Promise<DirectRequestPaymentCheckoutSetupResult> {
    const merchant = await this.setupMerchant(input);
    const merchantKey = merchant.merchant_account.merchant;
    const billing_mandate = input.prepare_billing_mandate === false
      ? null
      : await this.prepareBillingMandate(merchantKey, {
        billing_currency: merchant.merchant_account.billing_currency ?? input.billing_currency ?? "JPY",
        max_amount_minor: input.max_amount_minor ?? input.billing_mandate_cap_minor,
      });
    const shouldCreateWebhook = input.create_webhook_subscription ?? Boolean(input.webhook_callback_url);
    const webhook_subscription = shouldCreateWebhook && input.webhook_callback_url
      ? await this.createWebhookSubscription({
        callback_url: input.webhook_callback_url,
        description: input.webhook_description ?? `${merchantKey} Direct Request Payment`,
        event_types: input.webhook_event_types,
        metadata: { merchant: merchantKey, sdk: "@siglume/direct-request-payment" },
      })
      : null;
    const env: Record<string, string> = {
      SIGLUME_DIRECT_PAYMENT_MERCHANT: merchantKey,
    };
    if (merchant.challenge_secret) {
      env.SIGLUME_DIRECT_PAYMENT_CHALLENGE_SECRET = merchant.challenge_secret;
    }
    const webhookSecret = stringOrNull(webhook_subscription?.signing_secret);
    if (webhookSecret) {
      env.SIGLUME_WEBHOOK_SECRET = webhookSecret;
    }
    return { merchant, billing_mandate, webhook_subscription, env };
  }

  async request<T>(method: string, path: string, json_body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeout_ms);
    try {
      const headers: Record<string, string> = {
        "Accept": "application/json",
        "Authorization": `Bearer ${this.auth_token}`,
        "User-Agent": this.user_agent,
      };
      let body: string | undefined;
      if (json_body !== undefined) {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify(json_body);
      }
      const response = await this.fetch_impl(`${this.base_url}${path}`, {
        method,
        headers,
        body,
        signal: controller.signal,
      });
      const rawText = await response.text();
      const parsed = rawText ? parseJson(rawText) : {};
      if (!response.ok) {
        const error = isRecord(parsed) && isRecord(parsed.error) ? parsed.error : {};
        const code = stringOrNull(error.code) ?? stringOrNull((parsed as Record<string, unknown>).code) ?? `HTTP_${response.status}`;
        const message = stringOrNull(error.message) ?? stringOrNull((parsed as Record<string, unknown>).message) ?? response.statusText;
        throw new SiglumeApiError(message, { status: response.status, code, data: parsed });
      }
      if (isRecord(parsed) && "data" in parsed) {
        return parsed.data as T;
      }
      return parsed as T;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export async function createDirectRequestPaymentChallenge(
  input: DirectRequestPaymentChallengeInput,
): Promise<DirectRequestPaymentChallenge> {
  const merchant = normalizeMerchant(input.merchant);
  const amount_minor = positiveInteger(input.amount_minor, "amount_minor");
  const currency = normalizeCurrency(input.currency);
  const nonce = input.nonce ? normalizeChallengeNonce(input.nonce) : await randomNonce();
  const signature = await createDirectRequestPaymentChallengeSignature(input.secret, {
    merchant,
    amount_minor,
    currency,
    nonce,
  });
  const challenge = `${DIRECT_REQUEST_PAYMENT_CHALLENGE_SCHEME}:${nonce}:${signature}`;
  return {
    scheme: DIRECT_REQUEST_PAYMENT_CHALLENGE_SCHEME,
    merchant,
    amount_minor,
    currency,
    nonce,
    signature,
    challenge,
    challenge_hash: await sha256Prefixed(challenge),
  };
}

export async function createDirectRequestPaymentChallengeSignature(
  secret: string,
  input: {
    merchant: string;
    amount_minor: number;
    currency: DirectRequestPaymentCurrency | string;
    nonce: string;
  },
): Promise<string> {
  const normalizedSecret = requireNonEmpty(secret, "secret");
  const merchant = normalizeMerchant(input.merchant);
  const amount = positiveInteger(input.amount_minor, "amount_minor");
  const currency = normalizeCurrency(input.currency);
  const nonce = normalizeChallengeNonce(input.nonce);
  const material = `${merchant}:${amount}:${currency}:${nonce}`;
  return hmacSha256Hex(normalizedSecret, new TextEncoder().encode(material));
}

export function parseDirectRequestPaymentChallenge(challenge: string): ParsedDirectRequestPaymentChallenge {
  const parts = requireNonEmpty(challenge, "challenge").split(":");
  if (parts.length !== 3) {
    throw new SiglumeDirectRequestPaymentError("Direct Request Payment challenge must be scheme:nonce:signature.");
  }
  const [scheme, nonce, signature] = parts;
  if (!scheme || !nonce || !signature) {
    throw new SiglumeDirectRequestPaymentError("Direct Request Payment challenge is incomplete.");
  }
  return { scheme, nonce, signature };
}

/** Merchant-side, ONE-TIME approval of a recurring authorization: amount +
 *  currency + cadence are bound into the HMAC. Recurring charges afterwards
 *  are deliberately challenge-free — the on-chain mandate cap/cadence and the
 *  amount frozen on the Siglume authorization are the per-charge integrity
 *  checks. Cadence "monthly" = subscription, "daily" = scheduled autopay. */
export async function createDirectRequestPaymentRecurringChallenge(
  input: DirectRequestPaymentRecurringChallengeInput,
): Promise<DirectRequestPaymentRecurringChallenge> {
  const merchant = normalizeMerchant(input.merchant);
  const amount_minor = positiveInteger(input.amount_minor, "amount_minor");
  const currency = normalizeCurrency(input.currency);
  const cadence = normalizeRecurringCadence(input.cadence);
  const nonce = input.nonce ? normalizeChallengeNonce(input.nonce) : await randomNonce();
  const signature = await createDirectRequestPaymentRecurringChallengeSignature(input.secret, {
    merchant,
    amount_minor,
    currency,
    cadence,
    nonce,
  });
  const challenge = `${DIRECT_REQUEST_PAYMENT_RECURRING_CHALLENGE_SCHEME}:${nonce}:${signature}`;
  return {
    scheme: DIRECT_REQUEST_PAYMENT_RECURRING_CHALLENGE_SCHEME,
    merchant,
    amount_minor,
    currency,
    cadence,
    nonce,
    signature,
    challenge,
    challenge_hash: await sha256Prefixed(challenge),
  };
}

export async function createDirectRequestPaymentRecurringChallengeSignature(
  secret: string,
  input: {
    merchant: string;
    amount_minor: number;
    currency: DirectRequestPaymentCurrency | string;
    cadence: DirectRequestPaymentRecurringCadence | string;
    nonce: string;
  },
): Promise<string> {
  const normalizedSecret = requireNonEmpty(secret, "secret");
  const merchant = normalizeMerchant(input.merchant);
  const amount = positiveInteger(input.amount_minor, "amount_minor");
  const currency = normalizeCurrency(input.currency);
  const cadence = normalizeRecurringCadence(input.cadence);
  const nonce = normalizeChallengeNonce(input.nonce);
  // MUST stay byte-identical to the server's
  // _external_402_recurring_challenge_signature — both sides change together.
  const material = `${merchant}:${amount}:${currency}:${cadence}:${nonce}`;
  return hmacSha256Hex(normalizedSecret, new TextEncoder().encode(material));
}

export async function verifyDirectRequestPaymentRecurringChallenge(
  secret: string,
  input: {
    merchant: string;
    amount_minor: number;
    currency: DirectRequestPaymentCurrency | string;
    cadence: DirectRequestPaymentRecurringCadence | string;
    challenge: string;
  },
): Promise<boolean> {
  const parsed = parseDirectRequestPaymentChallenge(input.challenge);
  if (parsed.scheme !== DIRECT_REQUEST_PAYMENT_RECURRING_CHALLENGE_SCHEME) {
    return false;
  }
  const expected = await createDirectRequestPaymentRecurringChallengeSignature(secret, {
    merchant: input.merchant,
    amount_minor: input.amount_minor,
    currency: input.currency,
    cadence: input.cadence,
    nonce: parsed.nonce,
  });
  return timingSafeEqualHex(expected, parsed.signature);
}

export async function verifyDirectRequestPaymentChallenge(
  secret: string,
  input: {
    merchant: string;
    amount_minor: number;
    currency: DirectRequestPaymentCurrency | string;
    challenge: string;
  },
): Promise<boolean> {
  const parsed = parseDirectRequestPaymentChallenge(input.challenge);
  if (parsed.scheme !== DIRECT_REQUEST_PAYMENT_CHALLENGE_SCHEME) {
    return false;
  }
  const expected = await createDirectRequestPaymentChallengeSignature(secret, {
    merchant: input.merchant,
    amount_minor: input.amount_minor,
    currency: input.currency,
    nonce: parsed.nonce,
  });
  return timingSafeEqualHex(expected, parsed.signature);
}

export async function directRequestPaymentChallengeHash(challenge: string): Promise<string> {
  return sha256Prefixed(requireNonEmpty(challenge, "challenge"));
}

export async function directRequestPaymentRequestHash(input: {
  merchant: string;
  amount_minor: number;
  currency: DirectRequestPaymentCurrency | string;
  challenge: string;
}): Promise<string> {
  const material = `${normalizeMerchant(input.merchant)}${positiveInteger(input.amount_minor, "amount_minor")}${normalizeCurrency(input.currency)}${requireNonEmpty(input.challenge, "challenge")}`;
  return sha256Prefixed(material);
}

export function buildPaymentExecutionPayload(
  requirement: DirectPaymentRequirement,
  options: { await_finality?: boolean; metadata?: Record<string, unknown> } = {},
): Web3PreparedTransactionExecutePayload {
  return buildPreparedTransactionExecutionPayload(requirement, requirement.transaction_request, {
    receipt_kind: DIRECT_REQUEST_PAYMENT_RECEIPT_KIND,
    await_finality: options.await_finality,
    metadata: options.metadata,
  });
}

export function buildAllowanceExecutionPayload(
  requirement: DirectPaymentRequirement,
  options: { await_finality?: boolean; metadata?: Record<string, unknown> } = {},
): Web3PreparedTransactionExecutePayload {
  const approveRequest = requirement.approve_transaction_request;
  if (!approveRequest || Object.keys(approveRequest).length === 0) {
    throw new SiglumeDirectRequestPaymentError("This payment requirement does not include an allowance approval transaction.");
  }
  return buildPreparedTransactionExecutionPayload(requirement, approveRequest, {
    receipt_kind: DIRECT_REQUEST_PAYMENT_ALLOWANCE_RECEIPT_KIND,
    await_finality: options.await_finality,
    metadata: options.metadata,
  });
}

export function buildPreparedTransactionExecutionPayload(
  requirement: DirectPaymentRequirement,
  transaction_request: Web3TransactionRequest,
  options: {
    receipt_kind: string;
    await_finality?: boolean;
    metadata?: Record<string, unknown>;
  },
): Web3PreparedTransactionExecutePayload {
  const metadata = {
    ...(isRecord(transaction_request.metadata_jsonb) ? transaction_request.metadata_jsonb : {}),
    ...(options.metadata ?? {}),
  };
  return {
    transaction_request,
    receipt_kind: requireNonEmpty(options.receipt_kind, "receipt_kind"),
    reference_type: DIRECT_REQUEST_PAYMENT_REFERENCE_TYPE,
    reference_id: requirement.requirement_id,
    metadata,
    await_finality: Boolean(options.await_finality),
  };
}

export async function computeWebhookSignature(
  signing_secret: string,
  body: Uint8Array | ArrayBuffer | string | Record<string, unknown>,
  options: { timestamp: number },
): Promise<string> {
  if (!signing_secret) {
    throw new SiglumeWebhookSignatureError("SIGLUME webhook signing secret is required.");
  }
  const timestamp = Math.trunc(options.timestamp);
  const bytes = bodyBytes(body);
  const prefix = new TextEncoder().encode(`${timestamp}.`);
  const payload = new Uint8Array(prefix.length + bytes.length);
  payload.set(prefix, 0);
  payload.set(bytes, prefix.length);
  return hmacSha256Hex(signing_secret, payload);
}

export async function buildWebhookSignatureHeader(
  signing_secret: string,
  body: Uint8Array | ArrayBuffer | string | Record<string, unknown>,
  options: { timestamp?: number } = {},
): Promise<string> {
  const timestamp = Math.trunc(options.timestamp ?? Date.now() / 1000);
  const signature = await computeWebhookSignature(signing_secret, body, { timestamp });
  return `t=${timestamp},v1=${signature}`;
}

export async function verifyWebhookSignature(
  signing_secret: string,
  body: Uint8Array | ArrayBuffer | string | Record<string, unknown>,
  signature_header: string,
  options: { tolerance_seconds?: number; now?: number } = {},
): Promise<WebhookSignatureVerification> {
  const { timestamp, signature } = parseSignatureHeader(signature_header);
  const toleranceSeconds = Math.max(1, Math.trunc(options.tolerance_seconds ?? DEFAULT_WEBHOOK_TOLERANCE_SECONDS));
  const nowSeconds = Math.trunc(options.now ?? Date.now() / 1000);
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) {
    throw new SiglumeWebhookSignatureError("Webhook timestamp is outside the allowed tolerance window.");
  }
  const expected = await computeWebhookSignature(signing_secret, body, { timestamp });
  if (!(await timingSafeEqualHex(expected, signature))) {
    throw new SiglumeWebhookSignatureError("Webhook signature did not match.");
  }
  return { timestamp, signature };
}

export function parseDirectRequestPaymentWebhookEvent(payload: unknown): DirectRequestPaymentWebhookEvent {
  const event = requireRecord(payload, "webhook event");
  const data = requireRecord(event.data, "webhook event data");
  const parsed = {
    ...event,
    id: requireNonEmpty(stringOrNull(event.id) ?? "", "webhook event id"),
    type: requireNonEmpty(stringOrNull(event.type) ?? "", "webhook event type"),
    api_version: requireNonEmpty(stringOrNull(event.api_version) ?? "", "webhook api_version"),
    occurred_at: requireNonEmpty(stringOrNull(event.occurred_at) ?? "", "webhook occurred_at"),
    data: { ...data },
  } as DirectRequestPaymentWebhookEvent;
  if (parsed.type === "direct_payment.confirmed" && parsed.data.mode !== DIRECT_REQUEST_PAYMENT_MODE) {
    throw new SiglumeWebhookPayloadError("direct_payment.confirmed webhook must carry data.mode='external_402'.");
  }
  return parsed;
}

export async function verifyDirectRequestPaymentWebhook(
  signing_secret: string,
  body: Uint8Array | ArrayBuffer | string | Record<string, unknown>,
  signature_header: string,
  options: { tolerance_seconds?: number; now?: number } = {},
): Promise<{ event: DirectRequestPaymentWebhookEvent; verification: WebhookSignatureVerification }> {
  const verification = await verifyWebhookSignature(signing_secret, body, signature_header, options);
  const text = new TextDecoder().decode(bodyBytes(body));
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new SiglumeWebhookPayloadError("Webhook body must contain valid JSON.");
  }
  return { event: parseDirectRequestPaymentWebhookEvent(parsed), verification };
}

export const createExternal402Challenge = createDirectRequestPaymentChallenge;
export const verifyExternal402Challenge = verifyDirectRequestPaymentChallenge;

function normalizeMerchant(value: string): string {
  const merchant = requireNonEmpty(value, "merchant").toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{0,95}$/.test(merchant)) {
    throw new SiglumeDirectRequestPaymentError("merchant must be a lowercase key using letters, numbers, dot, underscore, or hyphen.");
  }
  return merchant;
}

function normalizeSelfServiceMerchant(value: string): string {
  const merchant = requireNonEmpty(value, "merchant").toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{2,63}$/.test(merchant)) {
    throw new SiglumeDirectRequestPaymentError("merchant must be 3-64 chars using lowercase letters, numbers, underscore, or hyphen.");
  }
  return merchant;
}

function normalizeBillingPlan(value: string): DirectRequestPaymentBillingPlan {
  const plan = requireNonEmpty(value, "billing_plan").toLowerCase();
  if (plan === "launch" || plan === "free" || plan === "starter" || plan === "growth" || plan === "pro") {
    return plan;
  }
  throw new SiglumeDirectRequestPaymentError("billing_plan must be launch, starter, growth, or pro.");
}

function normalizeCurrency(value: string): DirectRequestPaymentCurrency {
  const currency = requireNonEmpty(value, "currency").toUpperCase();
  if (currency !== "JPY" && currency !== "USD") {
    throw new SiglumeDirectRequestPaymentError("currency must be JPY or USD.");
  }
  return currency;
}

function normalizeToken(value: string): DirectRequestPaymentToken {
  const token = requireNonEmpty(value, "token_symbol").toUpperCase();
  if (token !== "JPYC" && token !== "USDC") {
    throw new SiglumeDirectRequestPaymentError("token_symbol must be JPYC or USDC.");
  }
  return token;
}

function normalizeAllowedCurrencies(value: Record<string, string> | Array<DirectRequestPaymentCurrency | string>): Record<string, string> {
  const normalized: Record<string, string> = {};
  if (Array.isArray(value)) {
    for (const item of value) {
      const currency = normalizeCurrency(item);
      normalized[currency] = defaultTokenForCurrency(currency);
    }
  } else if (isRecord(value)) {
    for (const [rawCurrency, rawToken] of Object.entries(value)) {
      normalized[normalizeCurrency(rawCurrency)] = normalizeToken(String(rawToken));
    }
  } else {
    throw new SiglumeDirectRequestPaymentError("allowed_currencies must be an array or a currency-to-token object.");
  }
  if (Object.keys(normalized).length === 0) {
    throw new SiglumeDirectRequestPaymentError("allowed_currencies must include at least one currency.");
  }
  return normalized;
}

function defaultTokenForCurrency(currency: DirectRequestPaymentCurrency): DirectRequestPaymentToken {
  return currency === "JPY" ? "JPYC" : "USDC";
}

function positiveInteger(value: number, name: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new SiglumeDirectRequestPaymentError(`${name} must be a positive safe integer.`);
  }
  return parsed;
}

function requireNonEmpty(value: string, name: string): string {
  const text = String(value ?? "").trim();
  if (!text) {
    throw new SiglumeDirectRequestPaymentError(`${name} is required.`);
  }
  return text;
}

function normalizeChallengeNonce(value: string): string {
  const nonce = requireNonEmpty(value, "nonce");
  if (nonce.includes(":")) {
    throw new SiglumeDirectRequestPaymentError("nonce must not contain ':'.");
  }
  return nonce;
}

function normalizeRecurringCadence(value: string): DirectRequestPaymentRecurringCadence {
  const cadence = requireNonEmpty(value, "cadence").toLowerCase();
  if (cadence !== "monthly" && cadence !== "daily") {
    throw new SiglumeDirectRequestPaymentError(
      'cadence must be "monthly" (subscription) or "daily" (scheduled autopay).',
    );
  }
  return cadence;
}

function cloneJsonObject(value: Record<string, unknown>, name: string): Record<string, unknown> {
  try {
    const cloned = JSON.parse(JSON.stringify(value)) as unknown;
    if (!isRecord(cloned)) {
      throw new Error("not an object");
    }
    return cloned;
  } catch (error) {
    throw new SiglumeDirectRequestPaymentError(`${name} must be a JSON-serializable object.`);
  }
}

function parseJson(rawText: string): unknown {
  try {
    return JSON.parse(rawText);
  } catch (error) {
    throw new SiglumeApiError("Siglume API returned invalid JSON.", {
      status: 502,
      code: "INVALID_JSON_RESPONSE",
      data: rawText,
    });
  }
}

function stringOrNull(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const text = value.trim();
  return text ? text : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, name: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new SiglumeWebhookPayloadError(`${name} must be an object.`);
  }
  return value;
}

function envValue(name: string): string | undefined {
  if (typeof process === "undefined") {
    return undefined;
  }
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}

function bodyBytes(body: Uint8Array | ArrayBuffer | string | Record<string, unknown>): Uint8Array {
  if (body instanceof Uint8Array) {
    return body;
  }
  if (body instanceof ArrayBuffer) {
    return new Uint8Array(body);
  }
  if (typeof body === "string") {
    return new TextEncoder().encode(body);
  }
  if (isRecord(body)) {
    return new TextEncoder().encode(JSON.stringify(body));
  }
  throw new SiglumeWebhookPayloadError("Webhook body must be raw bytes, a string, or a JSON object.");
}

function parseSignatureHeader(signatureHeader: string): { timestamp: number; signature: string } {
  let timestamp: number | null = null;
  let signature: string | null = null;
  for (const item of String(signatureHeader ?? "").split(",")) {
    const [key, value] = item.trim().split("=", 2);
    if (key === "t") {
      const parsed = Number.parseInt(value ?? "", 10);
      if (!Number.isFinite(parsed)) {
        throw new SiglumeWebhookSignatureError("Webhook signature timestamp is invalid.");
      }
      timestamp = parsed;
    }
    if (key === "v1") {
      signature = String(value ?? "").trim();
    }
  }
  if (timestamp === null || !signature) {
    throw new SiglumeWebhookSignatureError("Webhook signature header is incomplete.");
  }
  return { timestamp, signature };
}

async function randomNonce(): Promise<string> {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else if (typeof process !== "undefined" && process.versions?.node) {
    const crypto = await import("node:crypto");
    bytes.set(crypto.randomBytes(16));
  } else {
    throw new SiglumeDirectRequestPaymentError("Crypto random number generation is unavailable in this runtime.");
  }
  return bytesToHex(bytes);
}

async function hmacSha256Hex(secret: string, payload: Uint8Array): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const stablePayload = new Uint8Array(payload.byteLength);
    stablePayload.set(payload);
    const key = await globalThis.crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const digest = await globalThis.crypto.subtle.sign("HMAC", key, stablePayload);
    return bytesToHex(new Uint8Array(digest));
  }
  if (typeof process !== "undefined" && process.versions?.node) {
    const crypto = await import("node:crypto");
    return crypto.createHmac("sha256", secret).update(Buffer.from(payload)).digest("hex");
  }
  throw new SiglumeDirectRequestPaymentError("Web Crypto is required for HMAC-SHA256 in this runtime.");
}

async function sha256Prefixed(material: string): Promise<string> {
  const bytes = new TextEncoder().encode(material);
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return `sha256:${bytesToHex(new Uint8Array(digest))}`;
  }
  if (typeof process !== "undefined" && process.versions?.node) {
    const crypto = await import("node:crypto");
    return `sha256:${crypto.createHash("sha256").update(Buffer.from(bytes)).digest("hex")}`;
  }
  throw new SiglumeDirectRequestPaymentError("Web Crypto is required for SHA-256 in this runtime.");
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((item) => item.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array {
  const normalized = String(hex ?? "").trim().toLowerCase();
  if (normalized.length % 2 !== 0 || !/^[0-9a-f]*$/.test(normalized)) {
    throw new SiglumeWebhookSignatureError("Hex digest is invalid.");
  }
  const bytes = new Uint8Array(normalized.length / 2);
  for (let index = 0; index < normalized.length; index += 2) {
    bytes[index / 2] = Number.parseInt(normalized.slice(index, index + 2), 16);
  }
  return bytes;
}

async function timingSafeEqualHex(left: string, right: string): Promise<boolean> {
  const leftBytes = hexToBytes(left);
  const rightBytes = hexToBytes(right);
  if (leftBytes.length !== rightBytes.length) {
    return false;
  }
  let diff = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    diff |= leftBytes[index]! ^ rightBytes[index]!;
  }
  return diff === 0;
}
