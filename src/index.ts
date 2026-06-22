export const DEFAULT_SIGLUME_API_BASE = "https://siglume.com/v1";
export const DEFAULT_SIGLUME_SANDBOX_API_BASE = "http://127.0.0.1:8787/v1";
export const DIRECT_REQUEST_PAYMENT_CHALLENGE_SCHEME = "siglume-external-402-v1";
// Recurring (subscription / scheduled autopay) approval uses a DISTINCT scheme
// with cadence bound into the HMAC, so a one-time checkout challenge can never
// be replayed as a recurring authorization and vice versa.
export const DIRECT_REQUEST_PAYMENT_RECURRING_CHALLENGE_SCHEME = "siglume-external-402-recurring-v1";
export const DIRECT_REQUEST_PAYMENT_MODE = "external_402";
export const DIRECT_REQUEST_PAYMENT_RECEIPT_KIND = "sdrp_direct_payment";
export const DIRECT_REQUEST_PAYMENT_ALLOWANCE_RECEIPT_KIND = "sdrp_direct_payment_allowance";
export const DIRECT_REQUEST_PAYMENT_REFERENCE_TYPE = "sdrp_direct_payment_requirement";
export const DEFAULT_WEBHOOK_TOLERANCE_SECONDS = 300;
export const DIRECT_REQUEST_PAYMENT_SDK_VERSION = "0.5.7";
export const SIGLUME_ACCOUNT_REQUIRED = "SIGLUME_ACCOUNT_REQUIRED";
export const DIRECT_REQUEST_PAYMENT_STANDARD_SETTLED_STATUS = "settled";
export const DIRECT_REQUEST_PAYMENT_METERED_ACCEPTED_STATUS = "pending_settlement";
export const DIRECT_REQUEST_PAYMENT_STANDARD_FINALITY = "per_payment_onchain";
export const DIRECT_REQUEST_PAYMENT_METERED_FINALITY = "aggregated_onchain_settlement";
const DIRECT_REQUEST_PAYMENT_CONFIRMED_WEBHOOK_MODES = new Set([DIRECT_REQUEST_PAYMENT_MODE, "metered_settlement_batch"]);

export type DirectRequestPaymentCurrency = "JPY" | "USD";
export type DirectRequestPaymentToken = "JPYC" | "USDC";
export type DirectRequestPaymentMeteredPlanType = "micro" | "nano";
export type DirectRequestPaymentSettlementTrigger = "amount_threshold" | "scheduled_close";
export type DirectRequestPaymentMinorAmount = string;
export type DirectRequestPaymentRawWebhookBody = Uint8Array | ArrayBuffer | string;
export type DirectRequestPaymentWebhookSignatureBody = DirectRequestPaymentRawWebhookBody | Record<string, unknown>;

export interface DirectRequestPaymentBuyerMeteredQuery {
  plan_type?: DirectRequestPaymentMeteredPlanType | string;
  token_symbol?: DirectRequestPaymentToken | string;
}

export interface DirectRequestPaymentMeteredListQuery extends DirectRequestPaymentBuyerMeteredQuery {
  status?: string;
  cursor?: string;
  limit?: number;
}

export interface DirectRequestPaymentProviderMeteredQuery extends DirectRequestPaymentBuyerMeteredQuery {
  listing_id?: string;
  capability_key?: string;
}

export interface DirectRequestPaymentProviderMeteredListQuery extends DirectRequestPaymentProviderMeteredQuery {
  status?: string;
  cursor?: string;
  limit?: number;
}

export interface DirectRequestPaymentListResponse<T> {
  items: T[];
  next_cursor?: string | null;
  [key: string]: unknown;
}

export interface DirectRequestPaymentBuyerUsageEvent {
  metered_usage_id: string;
  created_at?: string | null;
  plan_type: string;
  settlement_cadence: string;
  product_listing_id?: string | null;
  listing_id?: string | null;
  capability_key?: string | null;
  operation_key?: string | null;
  currency: string;
  token_symbol: string;
  provider_gross_amount_minor: DirectRequestPaymentMinorAmount;
  provider_usage_amount_minor: DirectRequestPaymentMinorAmount;
  protocol_fee_minor: DirectRequestPaymentMinorAmount;
  gross_buyer_debit_minor: DirectRequestPaymentMinorAmount;
  buyer_debit_minor?: DirectRequestPaymentMinorAmount;
  rounding_delta_minor?: DirectRequestPaymentMinorAmount;
  status: string;
  period_start?: string | null;
  period_end?: string | null;
  settlement_batch_id?: string | null;
  expected_scheduled_debit_at?: string | null;
  [key: string]: unknown;
}

export interface DirectRequestPaymentProviderUsageEvent {
  metered_usage_id: string;
  created_at?: string | null;
  plan_type: string;
  settlement_cadence: string;
  product_listing_id?: string | null;
  listing_id?: string | null;
  capability_key?: string | null;
  operation_key?: string | null;
  currency: string;
  token_symbol: string;
  provider_gross_amount_minor: DirectRequestPaymentMinorAmount;
  provider_usage_amount_minor: DirectRequestPaymentMinorAmount;
  provider_receivable_minor: DirectRequestPaymentMinorAmount;
  protocol_fee_minor: DirectRequestPaymentMinorAmount;
  gross_buyer_debit_minor: DirectRequestPaymentMinorAmount;
  buyer_debit_minor?: DirectRequestPaymentMinorAmount;
  rounding_delta_minor?: DirectRequestPaymentMinorAmount;
  status: string;
  period_start?: string | null;
  period_end?: string | null;
  expected_scheduled_debit_at?: string | null;
  settlement_batch_id?: string | null;
  buyer_period_ref?: string | null;
  [key: string]: unknown;
}

export interface DirectRequestPaymentSettlementBatch {
  settlement_batch_id: string;
  plan_type: string;
  settlement_cadence: string;
  status: string;
  settlement_trigger?: DirectRequestPaymentSettlementTrigger | null;
  settlement_threshold_minor?: DirectRequestPaymentMinorAmount | null;
  threshold_reached_at?: string | null;
  total_unsettled_exposure_minor?: DirectRequestPaymentMinorAmount | null;
  notice_status?: string | null;
  period_start?: string | null;
  period_end?: string | null;
  close_at?: string | null;
  expected_scheduled_debit_at?: string | null;
  scheduled_debit_at?: string | null;
  not_before_attempt_at?: string | null;
  execution_status?: string | null;
  latest_execution_attempt_status?: string | null;
  attempt_count?: number | null;
  next_attempt_at?: string | null;
  chain_receipt_id?: string | null;
  usage_event_digest?: string | null;
  protocol_fee_minor?: DirectRequestPaymentMinorAmount;
  gross_buyer_debit_minor?: DirectRequestPaymentMinorAmount;
  rounding_delta_minor?: DirectRequestPaymentMinorAmount;
  buyer_debit_minor?: DirectRequestPaymentMinorAmount;
  provider_gross_amount_minor?: DirectRequestPaymentMinorAmount;
  provider_usage_amount_minor?: DirectRequestPaymentMinorAmount;
  provider_receivable_minor?: DirectRequestPaymentMinorAmount;
  settled_provider_receivable_minor?: DirectRequestPaymentMinorAmount;
  unsettled_provider_receivable_minor?: DirectRequestPaymentMinorAmount;
  past_due_provider_receivable_minor?: DirectRequestPaymentMinorAmount;
  terminal_provider_receivable_minor?: DirectRequestPaymentMinorAmount;
  uncollectible_provider_receivable_minor?: DirectRequestPaymentMinorAmount;
  written_off_provider_receivable_minor?: DirectRequestPaymentMinorAmount;
  terminal_status?: "uncollectible" | "written_off" | string | null;
  terminal_marked_at?: string | null;
  terminal_reason_code?: string | null;
  buyer_period_ref?: string | null;
  failure_reason_code?: string | null;
  failure_reason_label?: string | null;
  failure_reason_help?: string | null;
  support_reference?: string | null;
  [key: string]: unknown;
}

export interface DirectRequestPaymentMeteredOpenPeriod {
  plan_type?: DirectRequestPaymentMeteredPlanType | string;
  settlement_cadence?: "weekly" | "monthly" | string;
  currency?: DirectRequestPaymentCurrency | string;
  token_symbol?: DirectRequestPaymentToken | string;
  period_start?: string | null;
  period_end?: string | null;
  close_at?: string | null;
  settlement_trigger?: DirectRequestPaymentSettlementTrigger | null;
  settlement_threshold_minor?: DirectRequestPaymentMinorAmount | null;
  threshold_reached_at?: string | null;
  provider_gross_amount_minor?: DirectRequestPaymentMinorAmount;
  provider_usage_amount_minor?: DirectRequestPaymentMinorAmount;
  protocol_fee_minor?: DirectRequestPaymentMinorAmount;
  provider_receivable_minor?: DirectRequestPaymentMinorAmount;
  buyer_debit_minor?: DirectRequestPaymentMinorAmount;
  total_unsettled_exposure_minor?: DirectRequestPaymentMinorAmount | null;
  [key: string]: unknown;
}

export interface DirectRequestPaymentPastDueBlock {
  settlement_batch_id?: string;
  plan_type?: DirectRequestPaymentMeteredPlanType | string;
  currency?: DirectRequestPaymentCurrency | string;
  token_symbol?: DirectRequestPaymentToken | string;
  total_unsettled_exposure_minor?: DirectRequestPaymentMinorAmount | null;
  past_due_provider_receivable_minor?: DirectRequestPaymentMinorAmount;
  failure_reason_code?: string | null;
  support_reference?: string | null;
  [key: string]: unknown;
}

export interface DirectRequestPaymentBalanceSufficiency {
  sufficient?: boolean;
  currency?: DirectRequestPaymentCurrency | string;
  token_symbol?: DirectRequestPaymentToken | string;
  required_minor?: DirectRequestPaymentMinorAmount;
  available_minor?: DirectRequestPaymentMinorAmount;
  [key: string]: unknown;
}

export interface DirectRequestPaymentProviderMeteredTotals {
  settled_provider_receivable_minor?: DirectRequestPaymentMinorAmount;
  unsettled_provider_receivable_minor?: DirectRequestPaymentMinorAmount;
  past_due_provider_receivable_minor?: DirectRequestPaymentMinorAmount;
  terminal_provider_receivable_minor?: DirectRequestPaymentMinorAmount;
  uncollectible_provider_receivable_minor?: DirectRequestPaymentMinorAmount;
  written_off_provider_receivable_minor?: DirectRequestPaymentMinorAmount;
  [key: string]: DirectRequestPaymentMinorAmount | undefined;
}

export interface DirectRequestPaymentBuyerMeteredSummary {
  role: "buyer";
  open_periods: DirectRequestPaymentMeteredOpenPeriod[];
  settlement_batches: DirectRequestPaymentSettlementBatch[];
  past_due_blocks: DirectRequestPaymentPastDueBlock[];
  balance_sufficiency?: DirectRequestPaymentBalanceSufficiency;
  [key: string]: unknown;
}

export interface DirectRequestPaymentProviderMeteredSummary {
  role: "provider";
  timezone?: string | null;
  filters?: Record<string, unknown>;
  open_periods: DirectRequestPaymentMeteredOpenPeriod[];
  periods: DirectRequestPaymentSettlementBatch[];
  totals: DirectRequestPaymentProviderMeteredTotals;
  [key: string]: unknown;
}

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

/** "monthly" authorizes a Siglume-swept subscription; "daily" authorizes
 *  merchant-triggered scheduled autopay. It is an approval tag, not a
 *  run-count limiter. */
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
  request_hash_v2?: string | null;
  siglume_signature: string;
  token_symbol: string;
  currency: string;
  amount_minor: number;
  fee_bps: number;
  pricing_band?: "standard" | DirectRequestPaymentMeteredPlanType | string | null;
  settlement_cadence?: "per_payment" | "weekly" | "monthly" | string | null;
  finality?: string | null;
  protocol_fee_minor?: DirectRequestPaymentMinorAmount | null;
  settlement_status?: string | null;
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

export interface DirectPaymentSubscriptionCreateInput {
  merchant: string;
  amount_minor: number;
  currency: DirectRequestPaymentCurrency | string;
  challenge: string;
  cadence?: "monthly" | string;
  user_signing?: boolean;
  user_signing_flow?: boolean;
  external_signature?: string;
  external_safe_tx_hash?: string;
}

export interface DirectPaymentSubscriptionResponse {
  subscription_status: string;
  mode?: string;
  merchant: string;
  merchant_display_name?: string | null;
  mandate: Record<string, unknown>;
  receipt?: Record<string, unknown> | null;
  initial_charge?: Record<string, unknown> | null;
  idempotent_replay?: boolean | null;
  amount_minor?: number | null;
  currency?: string | null;
  token_symbol?: string | null;
  cadence?: string | null;
  fee_bps?: number | null;
  [key: string]: unknown;
}

export interface ScheduledAutoPayAuthorizationCreateInput {
  listing_id?: string;
  product_listing_id?: string;
  capability_key?: string;
  mode?: string;
  merchant?: string;
  challenge?: string;
  amount_minor?: number;
  agent_id?: string;
  operation_key?: string;
  allowed_operation_key?: string;
  expected_operation_key?: string;
  expected_amount_minor?: number;
  max_amount_minor?: number;
  max_amount_minor_per_run?: number;
  currency?: DirectRequestPaymentCurrency | string;
  token_symbol?: DirectRequestPaymentToken | string;
  buyer_token?: DirectRequestPaymentToken | string;
  max_runs?: number;
  cadence?: string | Record<string, unknown>;
  cadence_limit?: Record<string, unknown>;
  expires_at?: string;
  valid_until?: string;
  metadata?: Record<string, unknown>;
  user_signing?: boolean;
  user_signing_flow?: boolean;
  authorization_id?: string;
  external_signature?: string;
  external_safe_tx_hash?: string;
}

export interface ScheduledAutoPayAuthorizationResponse {
  authorization_id: string;
  id: string;
  buyer_user_id: string;
  agent_id?: string | null;
  product_listing_id: string;
  listing_id: string;
  access_grant_id?: string | null;
  capability_key: string;
  operation_key?: string | null;
  expected_amount_minor: number;
  max_amount_minor: number;
  currency: string;
  token_symbol: string;
  max_runs?: number | null;
  status: string;
  token_hint?: string | null;
  schedule_token?: string | null;
  cadence?: Record<string, unknown>;
  metadata_jsonb?: Record<string, unknown>;
  expires_at?: string | null;
  revoked_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  requires_user_signature?: boolean | null;
  mandate?: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface ScheduledAutoPayExecuteInput {
  schedule_token: string;
  slot_id: string;
  input?: Record<string, unknown>;
  arguments?: Record<string, unknown>;
  scheduled_for?: string;
  draft_token?: string;
  await_finality?: boolean;
  await_required_status?: string;
  await_timeout_seconds?: number;
  await_poll_seconds?: number;
  metadata?: Record<string, unknown>;
}

export interface ScheduledAutoPayExecutionResponse {
  status: string;
  charge_status: string;
  authorization: ScheduledAutoPayAuthorizationResponse | Record<string, unknown>;
  slot?: Record<string, unknown> | null;
  reason_code?: string | null;
  reason?: string | null;
  retryable?: boolean | null;
  manual_reconciliation_required?: boolean | null;
  direct_payment_requirement_id?: string | null;
  direct_payment_requirement?: Record<string, unknown> | null;
  direct_payment_execution?: Record<string, unknown> | null;
  capability_result?: Record<string, unknown> | null;
  [key: string]: unknown;
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
  // Hosted Checkout return-URL origin allowlist (open-redirect defense). Each
  // entry is an absolute origin such as "https://shop.example.com". The origin
  // of webhook_callback_url is auto-allowed in addition to these.
  checkout_allowed_origins?: string[];
  standard_terms_accepted?: boolean;
  terms_accepted?: boolean;
  terms_version?: string;
  sandbox_confirmed?: boolean;
  sandbox_session_id?: string;
  merchant_responsibility_attested?: boolean;
  responsibility_attestation_version?: string;
  live_mode_requested?: boolean;
}

export interface HostedCheckoutSessionCreateInput {
  merchant: string;
  amount_minor: number;
  currency: DirectRequestPaymentCurrency | string;
  nonce: string;
  success_url: string;
  cancel_url: string;
  metadata?: Record<string, unknown>;
}

export interface HostedCheckoutSessionCreateResult {
  checkout_url: string;
  session_id: string;
  challenge_hash: string;
  status?: string;
  expires_at?: string | null;
}

export interface HostedCheckoutSession {
  session_id: string;
  merchant: string;
  currency: string;
  token_symbol: string;
  amount_minor: number;
  status: string;
  challenge_hash: string;
  requirement_id?: string | null;
  pricing_band?: "standard" | DirectRequestPaymentMeteredPlanType | string | null;
  settlement_cadence?: "per_payment" | "weekly" | "monthly" | string | null;
  finality?: string | null;
  protocol_fee_minor?: DirectRequestPaymentMinorAmount | null;
  settlement_status?: string | null;
  chain_receipt_id?: string | null;
  success_url: string;
  cancel_url: string;
  expires_at?: string | null;
  authenticated_at?: string | null;
  paid_at?: string | null;
  cancelled_at?: string | null;
  created_at?: string | null;
  metadata_jsonb?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface DirectRequestPaymentHostedCheckoutReadiness {
  scope: "standard_hosted_checkout" | string;
  ready: boolean;
  status: string;
  checks: Array<Record<string, unknown>>;
  missing_requirements: string[];
  blockers: string[];
  live_mode_requested?: boolean;
  live_mode_enabled?: boolean;
  merchant_responsibility_attested?: boolean;
  responsibility_attestation_version?: string | null;
  responsibility_attestation_source?: string | null;
  /** Legacy compatibility only; not a Standard Hosted Checkout protocol gate. */
  business_verification_status?: string;
  business_verification_required?: boolean;
  provider_role?: Record<string, unknown>;
  responsibility_boundary?: Record<string, unknown>;
  ga_blockers?: string[];
  [key: string]: unknown;
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
  standard_hosted_checkout_readiness?: DirectRequestPaymentHostedCheckoutReadiness | null;
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

export interface DirectRequestPaymentWebhookTestDeliveryInput {
  event_type: string;
  data?: Record<string, unknown>;
  subscription_ids?: string[];
}

export interface DirectRequestPaymentWebhookDelivery {
  id?: string;
  subscription_id?: string;
  event_id?: string;
  event_type?: string;
  delivery_status?: string;
  response_status?: number | null;
  delivered_at?: string | null;
  [key: string]: unknown;
}

export interface DirectRequestPaymentWebhookDeliveryListInput {
  subscription_id?: string;
  event_type?: string;
  status?: string;
  limit?: number;
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
    request_hash_v2?: string | null;
    pricing_band?: "standard" | DirectRequestPaymentMeteredPlanType | string | null;
    settlement_cadence?: "per_payment" | "weekly" | "monthly" | string | null;
    finality?: string | null;
    protocol_fee_minor?: DirectRequestPaymentMinorAmount | null;
    provider_gross_amount_minor?: DirectRequestPaymentMinorAmount | null;
    provider_usage_amount_minor?: DirectRequestPaymentMinorAmount | null;
    provider_receivable_minor?: DirectRequestPaymentMinorAmount | null;
    buyer_debit_minor?: DirectRequestPaymentMinorAmount | null;
    settlement_trigger?: DirectRequestPaymentSettlementTrigger | string | null;
    settlement_threshold_minor?: DirectRequestPaymentMinorAmount | null;
    threshold_reached_at?: string | null;
    total_unsettled_exposure_minor?: DirectRequestPaymentMinorAmount | null;
    settlement_status?: string | null;
    settlement_batch_id?: string | null;
    chain_receipt_id?: string | null;
    usage_event_digest?: string | null;
    settled_at?: string | null;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export type DirectPaymentConfirmationKind =
  | "standard_settled"
  | "metered_usage_accepted"
  | "metered_batch_settled"
  | "unknown";

export type DirectPaymentConfirmationUnknownReason =
  | "not_direct_payment_confirmed"
  | "unsupported_confirmation_mode"
  | "invalid_metered_settlement_confirmation"
  | "missing_standard_settlement_fields"
  | "missing_metered_usage_fields"
  | "unknown_confirmation_shape";

export interface DirectPaymentStandardSettledClassification {
  kind: "standard_settled";
  event: DirectRequestPaymentWebhookEvent;
  data: DirectRequestPaymentWebhookEvent["data"];
  requirement_id: string;
  challenge_hash: string;
  chain_receipt_id: string;
  request_hash_v2?: string | null;
}

export interface DirectPaymentMeteredUsageAcceptedClassification {
  kind: "metered_usage_accepted";
  event: DirectRequestPaymentWebhookEvent;
  data: DirectRequestPaymentWebhookEvent["data"];
  pricing_band: DirectRequestPaymentMeteredPlanType;
  settlement_cadence: "weekly" | "monthly";
  requirement_id: string;
  challenge_hash: string;
  request_hash_v2?: string | null;
}

export interface DirectPaymentMeteredBatchSettledClassification {
  kind: "metered_batch_settled";
  event: DirectRequestPaymentWebhookEvent;
  data: DirectRequestPaymentWebhookEvent["data"];
  pricing_band: DirectRequestPaymentMeteredPlanType;
  settlement_cadence: "weekly" | "monthly";
  settlement_batch_id: string;
  chain_receipt_id: string;
  usage_event_digest: string;
  settled_at?: string | null;
}

export interface DirectPaymentUnknownClassification {
  kind: "unknown";
  event: DirectRequestPaymentWebhookEvent;
  data: DirectRequestPaymentWebhookEvent["data"];
  reason: DirectPaymentConfirmationUnknownReason;
  requirement_id?: string | null;
  settlement_batch_id?: string | null;
  pricing_band?: string | null;
  settlement_cadence?: string | null;
  settlement_status?: string | null;
  finality?: string | null;
}

export type DirectPaymentConfirmationClassification =
  | DirectPaymentStandardSettledClassification
  | DirectPaymentMeteredUsageAcceptedClassification
  | DirectPaymentMeteredBatchSettledClassification
  | DirectPaymentUnknownClassification;

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

export class HostedCheckoutNotAvailableError extends SiglumeApiError {
  constructor(message = "Hosted Checkout is disabled by the platform rollout switch.") {
    super(message, { status: 409, code: "HOSTED_CHECKOUT_NOT_ENABLED" });
    this.name = "HostedCheckoutNotAvailableError";
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
  readonly #authToken: string;
  readonly base_url: string;
  readonly timeout_ms: number;
  readonly user_agent: string;
  private readonly fetch_impl: typeof fetch;

  constructor(options: DirectRequestPaymentClientOptions = {}) {
    const authToken = options.auth_token ?? envValue("SIGLUME_AUTH_TOKEN");
    if (!authToken) {
      throw new SiglumeDirectRequestPaymentError(
        "A buyer or provider Siglume user bearer token is required for Direct Request Payment API calls. Developer Portal API keys are not accepted.",
      );
    }
    const fetchImpl = options.fetch ?? globalThis.fetch;
    if (!fetchImpl) {
      throw new SiglumeDirectRequestPaymentError("A fetch implementation is required in this runtime.");
    }
    this.#authToken = authToken;
    this.base_url = normalizeApiBaseUrl(options.base_url ?? defaultApiBaseUrl());
    this.timeout_ms = Math.max(1, Math.trunc(options.timeout_ms ?? 15000));
    this.user_agent = options.user_agent ?? `@siglume/direct-request-payment/${DIRECT_REQUEST_PAYMENT_SDK_VERSION}`;
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
    return this.request<DirectPaymentRequirement>("POST", "/sdrp/direct-payments/requirements", payload);
  }

  async getPaymentRequirement(requirement_id: string): Promise<DirectPaymentRequirement> {
    return this.request<DirectPaymentRequirement>(
      "GET",
      `/sdrp/direct-payments/requirements/${encodeURIComponent(requireNonEmpty(requirement_id, "requirement_id"))}`,
    );
  }

  async verifyPaymentRequirement(
    requirement_id: string,
    input: DirectPaymentVerifyInput,
  ): Promise<DirectPaymentRequirement> {
    return this.request<DirectPaymentRequirement>(
      "POST",
      `/sdrp/direct-payments/requirements/${encodeURIComponent(requireNonEmpty(requirement_id, "requirement_id"))}/verify`,
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

  async createSubscription(input: DirectPaymentSubscriptionCreateInput): Promise<DirectPaymentSubscriptionResponse> {
    const payload: Record<string, unknown> = {
      merchant: normalizeMerchant(input.merchant),
      amount_minor: positiveInteger(input.amount_minor, "amount_minor"),
      currency: normalizeCurrency(input.currency),
      challenge: requireNonEmpty(input.challenge, "challenge"),
    };
    if (input.cadence !== undefined) {
      payload.cadence = requireNonEmpty(input.cadence, "cadence");
    }
    if (input.user_signing !== undefined) {
      payload.user_signing = Boolean(input.user_signing);
    }
    if (input.user_signing_flow !== undefined) {
      payload.user_signing_flow = Boolean(input.user_signing_flow);
    }
    if (input.external_signature !== undefined) {
      payload.external_signature = requireNonEmpty(input.external_signature, "external_signature");
    }
    if (input.external_safe_tx_hash !== undefined) {
      payload.external_safe_tx_hash = requireNonEmpty(input.external_safe_tx_hash, "external_safe_tx_hash");
    }
    return this.request<DirectPaymentSubscriptionResponse>("POST", "/sdrp/direct-payments/subscriptions", payload);
  }

  async createScheduledAutoPayAuthorization(
    input: ScheduledAutoPayAuthorizationCreateInput,
  ): Promise<ScheduledAutoPayAuthorizationResponse> {
    const payload: Record<string, unknown> = {};
    for (const key of [
      "listing_id",
      "product_listing_id",
      "capability_key",
      "mode",
      "merchant",
      "challenge",
      "agent_id",
      "operation_key",
      "allowed_operation_key",
      "expected_operation_key",
      "expires_at",
      "valid_until",
      "authorization_id",
      "external_signature",
      "external_safe_tx_hash",
    ] as const) {
      const value = input[key];
      if (value !== undefined) {
        payload[key] = requireNonEmpty(value, key);
      }
    }
    for (const key of [
      "amount_minor",
      "expected_amount_minor",
      "max_amount_minor",
      "max_amount_minor_per_run",
      "max_runs",
    ] as const) {
      const value = input[key];
      if (value !== undefined) {
        payload[key] = positiveInteger(value, key);
      }
    }
    if (input.currency !== undefined) {
      payload.currency = normalizeCurrency(input.currency);
    }
    if (input.token_symbol !== undefined) {
      payload.token_symbol = normalizeToken(input.token_symbol);
    }
    if (input.buyer_token !== undefined) {
      payload.buyer_token = normalizeToken(input.buyer_token);
    }
    if (input.cadence !== undefined) {
      payload.cadence = typeof input.cadence === "string"
        ? requireNonEmpty(input.cadence, "cadence")
        : cloneJsonObject(input.cadence, "cadence");
    }
    if (input.cadence_limit !== undefined) {
      payload.cadence_limit = cloneJsonObject(input.cadence_limit, "cadence_limit");
    }
    if (input.metadata !== undefined) {
      payload.metadata = cloneJsonObject(input.metadata, "metadata");
    }
    if (input.user_signing !== undefined) {
      payload.user_signing = Boolean(input.user_signing);
    }
    if (input.user_signing_flow !== undefined) {
      payload.user_signing_flow = Boolean(input.user_signing_flow);
    }
    return this.request<ScheduledAutoPayAuthorizationResponse>(
      "POST",
      "/account/auto-pay/scheduled-authorizations",
      payload,
    );
  }

  async revokeScheduledAutoPayAuthorization(authorization_id: string): Promise<ScheduledAutoPayAuthorizationResponse> {
    return this.request<ScheduledAutoPayAuthorizationResponse>(
      "DELETE",
      `/account/auto-pay/scheduled-authorizations/${encodeURIComponent(
        requireNonEmpty(authorization_id, "authorization_id"),
      )}`,
    );
  }

  async executeScheduledAutoPay(input: ScheduledAutoPayExecuteInput): Promise<ScheduledAutoPayExecutionResponse> {
    const scheduleToken = requireNonEmpty(input.schedule_token, "schedule_token");
    const payload: Record<string, unknown> = {
      slot_id: requireNonEmpty(input.slot_id, "slot_id"),
    };
    if (input.input !== undefined) {
      payload.input = cloneJsonObject(input.input, "input");
    }
    if (input.arguments !== undefined) {
      payload.arguments = cloneJsonObject(input.arguments, "arguments");
    }
    if (input.scheduled_for !== undefined) {
      payload.scheduled_for = requireNonEmpty(input.scheduled_for, "scheduled_for");
    }
    if (input.draft_token !== undefined) {
      payload.draft_token = requireNonEmpty(input.draft_token, "draft_token");
    }
    if (input.await_finality !== undefined) {
      payload.await_finality = Boolean(input.await_finality);
    }
    if (input.await_required_status !== undefined) {
      payload.await_required_status = requireNonEmpty(input.await_required_status, "await_required_status");
    }
    if (input.await_timeout_seconds !== undefined) {
      payload.await_timeout_seconds = positiveInteger(input.await_timeout_seconds, "await_timeout_seconds");
    }
    if (input.await_poll_seconds !== undefined) {
      payload.await_poll_seconds = positiveInteger(input.await_poll_seconds, "await_poll_seconds");
    }
    if (input.metadata !== undefined) {
      payload.metadata = cloneJsonObject(input.metadata, "metadata");
    }
    return this.request<ScheduledAutoPayExecutionResponse>(
      "POST",
      "/market/api-store/scheduled-auto-pay/execute",
      payload,
      { "Authorization": `Bearer ${scheduleToken}` },
    );
  }

  async getBuyerMeteredSummary(
    input: DirectRequestPaymentBuyerMeteredQuery = {},
  ): Promise<DirectRequestPaymentBuyerMeteredSummary> {
    return this.request<DirectRequestPaymentBuyerMeteredSummary>(
      "GET",
      meteredQueryPath("/sdrp/metered/my-summary", input),
    );
  }

  async listBuyerUsageEvents(
    input: DirectRequestPaymentMeteredListQuery = {},
  ): Promise<DirectRequestPaymentListResponse<DirectRequestPaymentBuyerUsageEvent>> {
    return this.request<DirectRequestPaymentListResponse<DirectRequestPaymentBuyerUsageEvent>>(
      "GET",
      meteredQueryPath("/sdrp/metered/my-usage-events", input),
    );
  }

  async listBuyerSettlementBatches(
    input: DirectRequestPaymentMeteredListQuery = {},
  ): Promise<DirectRequestPaymentListResponse<DirectRequestPaymentSettlementBatch>> {
    return this.request<DirectRequestPaymentListResponse<DirectRequestPaymentSettlementBatch>>(
      "GET",
      meteredQueryPath("/sdrp/metered/my-settlement-batches", input),
    );
  }

  async getProviderMeteredSummary(
    input: DirectRequestPaymentProviderMeteredQuery = {},
  ): Promise<DirectRequestPaymentProviderMeteredSummary> {
    return this.request<DirectRequestPaymentProviderMeteredSummary>(
      "GET",
      meteredQueryPath("/sdrp/metered/provider/summary", input),
    );
  }

  async listProviderUsageEvents(
    input: DirectRequestPaymentProviderMeteredListQuery = {},
  ): Promise<DirectRequestPaymentListResponse<DirectRequestPaymentProviderUsageEvent>> {
    return this.request<DirectRequestPaymentListResponse<DirectRequestPaymentProviderUsageEvent>>(
      "GET",
      meteredQueryPath("/sdrp/metered/provider/usage-events", input),
    );
  }

  async listProviderSettlementBatches(
    input: DirectRequestPaymentProviderMeteredListQuery = {},
  ): Promise<DirectRequestPaymentListResponse<DirectRequestPaymentSettlementBatch>> {
    return this.request<DirectRequestPaymentListResponse<DirectRequestPaymentSettlementBatch>>(
      "GET",
      meteredQueryPath("/sdrp/metered/provider/settlement-batches", input),
    );
  }

  async getProviderSettlementBatch(
    settlement_batch_id: string,
    input: Pick<DirectRequestPaymentProviderMeteredQuery, "listing_id" | "capability_key"> = {},
  ): Promise<DirectRequestPaymentSettlementBatch> {
    return this.request<DirectRequestPaymentSettlementBatch>(
      "GET",
      meteredQueryPath(
        `/sdrp/metered/provider/settlement-batches/${encodeURIComponent(
          requireNonEmpty(settlement_batch_id, "settlement_batch_id"),
        )}`,
        input,
      ),
    );
  }

  async request<T>(
    method: string,
    path: string,
    json_body?: unknown,
    extra_headers: Record<string, string> = {},
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeout_ms);
    try {
      const headers: Record<string, string> = {
        "Accept": "application/json",
        "Authorization": `Bearer ${this.#authToken}`,
        "User-Agent": this.user_agent,
        ...extra_headers,
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
  readonly #authToken: string;
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
    this.#authToken = authToken;
    this.base_url = normalizeApiBaseUrl(options.base_url ?? defaultApiBaseUrl());
    this.timeout_ms = Math.max(1, Math.trunc(options.timeout_ms ?? 15000));
    this.user_agent = options.user_agent ?? `@siglume/direct-request-payment/${DIRECT_REQUEST_PAYMENT_SDK_VERSION}`;
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
      payload.webhook_callback_url = normalizeHttpsUrl(input.webhook_callback_url, "webhook_callback_url");
    }
    if (input.billing_mandate_cap_minor !== undefined) {
      payload.billing_mandate_cap_minor = positiveInteger(input.billing_mandate_cap_minor, "billing_mandate_cap_minor");
    }
    if (input.max_amount_minor !== undefined) {
      payload.max_amount_minor = positiveInteger(input.max_amount_minor, "max_amount_minor");
    }
    if (input.checkout_allowed_origins !== undefined) {
      payload.checkout_allowed_origins = normalizeOriginList(input.checkout_allowed_origins);
    }
    if (input.standard_terms_accepted !== undefined) {
      payload.standard_terms_accepted = Boolean(input.standard_terms_accepted);
    }
    if (input.terms_accepted !== undefined) {
      payload.terms_accepted = Boolean(input.terms_accepted);
    }
    if (input.terms_version !== undefined) {
      payload.terms_version = requireNonEmpty(input.terms_version, "terms_version");
    }
    if (input.sandbox_confirmed !== undefined) {
      payload.sandbox_confirmed = Boolean(input.sandbox_confirmed);
    }
    if (input.sandbox_session_id !== undefined) {
      payload.sandbox_session_id = requireNonEmpty(input.sandbox_session_id, "sandbox_session_id");
    }
    if (input.merchant_responsibility_attested !== undefined) {
      payload.merchant_responsibility_attested = Boolean(input.merchant_responsibility_attested);
    }
    if (input.responsibility_attestation_version !== undefined) {
      payload.responsibility_attestation_version = requireNonEmpty(
        input.responsibility_attestation_version,
        "responsibility_attestation_version",
      );
    }
    if (input.live_mode_requested !== undefined) {
      payload.live_mode_requested = Boolean(input.live_mode_requested);
    }
    return this.request<DirectRequestPaymentMerchantResponse>("POST", "/sdrp/direct-payments/merchants", payload);
  }

  /**
   * Create a Hosted Checkout session for human web shoppers. Siglume authors
   * the challenge server-side, persists a single-use
   * expiring session, and returns a `checkout_url`. Redirect the shopper there;
   * they sign into Siglume or create a Siglume account on the hosted page,
   * approve, and pay from their own wallet, then return to your `success_url`.
   * Fulfill on the `direct_payment.confirmed` webhook (the source of truth),
   * exactly as with the agent flow. The merchant SDK does not create buyer
   * accounts or log buyers into Siglume.
   *
   * `success_url`/`cancel_url` must be on an origin you registered via
   * `checkout_allowed_origins` (or your `webhook_callback_url` origin).
   */
  async createCheckoutSession(input: HostedCheckoutSessionCreateInput): Promise<HostedCheckoutSessionCreateResult> {
    const payload: Record<string, unknown> = {
      merchant: normalizeSelfServiceMerchant(input.merchant),
      amount_minor: positiveInteger(input.amount_minor, "amount_minor"),
      currency: normalizeCurrency(input.currency),
      nonce: normalizeChallengeNonce(input.nonce),
      success_url: requireNonEmpty(input.success_url, "success_url"),
      cancel_url: requireNonEmpty(input.cancel_url, "cancel_url"),
    };
    if (input.metadata !== undefined) {
      payload.metadata = cloneJsonObject(input.metadata, "metadata");
    }
    return this.requestHostedCheckout<HostedCheckoutSessionCreateResult>(
      "POST",
      "/sdrp/direct-payments/checkout-sessions",
      payload,
    );
  }

  /** Read a Hosted Checkout session's status (open / authenticated / paid / expired / cancelled / failed). */
  async getCheckoutSession(session_id: string): Promise<HostedCheckoutSession> {
    return this.requestHostedCheckout<HostedCheckoutSession>(
      "GET",
      `/sdrp/direct-payments/checkout-sessions/${encodeURIComponent(requireNonEmpty(session_id, "session_id"))}`,
    );
  }

  async getMerchant(merchant: string): Promise<DirectRequestPaymentMerchantResponse> {
    return this.request<DirectRequestPaymentMerchantResponse>(
      "GET",
      `/sdrp/direct-payments/merchants/${encodeURIComponent(normalizeSelfServiceMerchant(merchant))}`,
    );
  }

  async getMerchantReadiness(merchant: string): Promise<DirectRequestPaymentHostedCheckoutReadiness> {
    const response = await this.request<Record<string, unknown>>(
      "GET",
      `/sdrp/direct-payments/merchants/${encodeURIComponent(normalizeSelfServiceMerchant(merchant))}/readiness`,
    );
    return (response.standard_hosted_checkout_readiness ?? response) as DirectRequestPaymentHostedCheckoutReadiness;
  }

  async rotateChallengeSecret(merchant: string): Promise<DirectRequestPaymentMerchantResponse> {
    return this.request<DirectRequestPaymentMerchantResponse>(
      "POST",
      `/sdrp/direct-payments/merchants/${encodeURIComponent(normalizeSelfServiceMerchant(merchant))}/challenge-secret/rotate`,
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
      `/sdrp/direct-payments/merchants/${encodeURIComponent(normalizeSelfServiceMerchant(merchant))}/billing-mandate`,
      payload,
    );
  }

  async createWebhookSubscription(
    input: DirectRequestPaymentWebhookSubscriptionInput,
  ): Promise<DirectRequestPaymentWebhookSubscription> {
    const payload: Record<string, unknown> = {
      callback_url: normalizeHttpsUrl(input.callback_url, "callback_url"),
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

  async listWebhookSubscriptions(): Promise<DirectRequestPaymentWebhookSubscription[]> {
    return this.request<DirectRequestPaymentWebhookSubscription[]>("GET", "/market/webhooks/subscriptions");
  }

  async queueWebhookTestDelivery(input: DirectRequestPaymentWebhookTestDeliveryInput): Promise<Record<string, unknown>> {
    const payload: Record<string, unknown> = {
      event_type: requireNonEmpty(input.event_type, "event_type"),
    };
    if (input.data !== undefined) {
      payload.data = cloneJsonObject(input.data, "data");
    }
    if (input.subscription_ids !== undefined) {
      payload.subscription_ids = input.subscription_ids.map((subscriptionId) => requireNonEmpty(subscriptionId, "subscription_id"));
    }
    return this.request<Record<string, unknown>>("POST", "/market/webhooks/test-deliveries", payload);
  }

  async listWebhookDeliveries(
    input: DirectRequestPaymentWebhookDeliveryListInput = {},
  ): Promise<DirectRequestPaymentWebhookDelivery[]> {
    const params = new URLSearchParams();
    if (input.subscription_id !== undefined) params.set("subscription_id", requireNonEmpty(input.subscription_id, "subscription_id"));
    if (input.event_type !== undefined) params.set("event_type", requireNonEmpty(input.event_type, "event_type"));
    if (input.status !== undefined) params.set("status", requireNonEmpty(input.status, "status"));
    if (input.limit !== undefined) params.set("limit", String(positiveInteger(input.limit, "limit")));
    const query = params.toString();
    return this.request<DirectRequestPaymentWebhookDelivery[]>("GET", `/market/webhooks/deliveries${query ? `?${query}` : ""}`);
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

  async request<T>(
    method: string,
    path: string,
    json_body?: unknown,
    extra_headers: Record<string, string> = {},
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeout_ms);
    try {
      const headers: Record<string, string> = {
        "Accept": "application/json",
        "Authorization": `Bearer ${this.#authToken}`,
        "User-Agent": this.user_agent,
        ...extra_headers,
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

  private async requestHostedCheckout<T>(method: string, path: string, json_body?: unknown): Promise<T> {
    try {
      return await this.request<T>(method, path, json_body);
    } catch (error) {
      if (isHostedCheckoutUnavailable(error)) {
        throw new HostedCheckoutNotAvailableError();
      }
      throw error;
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
 *  are deliberately challenge-free; the recurring authorization and the
 *  buyer's mandate/budget caps are the per-charge integrity checks. Cadence
 *  "monthly" = subscription, "daily" = scheduled autopay approval tag. */
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
  // _external_402_recurring_challenge_signature  Eboth sides change together.
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

export async function directRequestPaymentRequestHashV2(input: {
  merchant: string;
  amount_minor: number;
  currency: DirectRequestPaymentCurrency | string;
  challenge: string;
}): Promise<string> {
  const material = JSON.stringify({
    amount_minor: positiveInteger(input.amount_minor, "amount_minor"),
    challenge: requireNonEmpty(input.challenge, "challenge"),
    currency: normalizeCurrency(input.currency),
    merchant: normalizeMerchant(input.merchant),
    version: 2,
  });
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
  body: DirectRequestPaymentWebhookSignatureBody,
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
  body: DirectRequestPaymentWebhookSignatureBody,
  options: { timestamp?: number } = {},
): Promise<string> {
  const timestamp = Math.trunc(options.timestamp ?? Date.now() / 1000);
  const signature = await computeWebhookSignature(signing_secret, body, { timestamp });
  return `t=${timestamp},v1=${signature}`;
}

export async function verifyWebhookSignature(
  signing_secret: string,
  body: DirectRequestPaymentRawWebhookBody,
  signature_header: string,
  options: { tolerance_seconds?: number; now?: number } = {},
): Promise<WebhookSignatureVerification> {
  const { timestamp, signature } = parseSignatureHeader(signature_header);
  const toleranceSeconds = Math.max(1, Math.trunc(options.tolerance_seconds ?? DEFAULT_WEBHOOK_TOLERANCE_SECONDS));
  const nowSeconds = Math.trunc(options.now ?? Date.now() / 1000);
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) {
    throw new SiglumeWebhookSignatureError("Webhook timestamp is outside the allowed tolerance window.");
  }
  const rawBody = rawWebhookBodyBytes(body);
  const expected = await computeWebhookSignature(signing_secret, rawBody, { timestamp });
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
  return parsed;
}

export function classifyDirectPaymentConfirmation(
  event: DirectRequestPaymentWebhookEvent,
): DirectPaymentConfirmationClassification {
  const data = event.data;
  const requirementId = stringOrNull(data.requirement_id) ?? stringOrNull(data.direct_payment_requirement_id);
  const challengeHash = stringOrNull(data.challenge_hash);
  const pricingBand = stringOrNull(data.pricing_band);
  const settlementCadence = stringOrNull(data.settlement_cadence);
  const finality = stringOrNull(data.finality);
  const settlementStatus = stringOrNull(data.settlement_status);
  const mode = stringOrNull(data.mode);

  if (event.type !== "direct_payment.confirmed") {
    return {
      kind: "unknown",
      event,
      data,
      reason: "not_direct_payment_confirmed",
      requirement_id: requirementId,
      settlement_batch_id: stringOrNull(data.settlement_batch_id),
      pricing_band: pricingBand,
      settlement_cadence: settlementCadence,
      settlement_status: settlementStatus,
      finality,
    };
  }

  if (!DIRECT_REQUEST_PAYMENT_CONFIRMED_WEBHOOK_MODES.has(mode ?? "")) {
    return {
      kind: "unknown",
      event,
      data,
      reason: "unsupported_confirmation_mode",
      requirement_id: requirementId,
      settlement_batch_id: stringOrNull(data.settlement_batch_id),
      pricing_band: pricingBand,
      settlement_cadence: settlementCadence,
      settlement_status: settlementStatus,
      finality,
    };
  }

  if (mode === "metered_settlement_batch") {
    const settlementBatchId = stringOrNull(data.settlement_batch_id);
    const chainReceiptId = stringOrNull(data.chain_receipt_id);
    const usageEventDigest = stringOrNull(data.usage_event_digest);
    if (
      settlementStatus === DIRECT_REQUEST_PAYMENT_STANDARD_SETTLED_STATUS &&
      finality === DIRECT_REQUEST_PAYMENT_METERED_FINALITY &&
      (pricingBand === "micro" || pricingBand === "nano") &&
      settlementCadence === (pricingBand === "micro" ? "weekly" : "monthly") &&
      settlementBatchId &&
      chainReceiptId &&
      usageEventDigest
    ) {
      return {
        kind: "metered_batch_settled",
        event,
        data,
        pricing_band: pricingBand,
        settlement_cadence: pricingBand === "micro" ? "weekly" : "monthly",
        settlement_batch_id: settlementBatchId,
        chain_receipt_id: chainReceiptId,
        usage_event_digest: usageEventDigest,
        settled_at: stringOrNull(data.settled_at),
      };
    }
    return {
      kind: "unknown",
      event,
      data,
      reason: "invalid_metered_settlement_confirmation",
      requirement_id: requirementId,
      settlement_batch_id: settlementBatchId,
      pricing_band: pricingBand,
      settlement_cadence: settlementCadence,
      settlement_status: settlementStatus,
      finality,
    };
  }

  if (pricingBand === "standard") {
    const chainReceiptId = stringOrNull(data.chain_receipt_id);
    if (
      finality === DIRECT_REQUEST_PAYMENT_STANDARD_FINALITY &&
      settlementStatus === DIRECT_REQUEST_PAYMENT_STANDARD_SETTLED_STATUS &&
      requirementId &&
      challengeHash &&
      chainReceiptId
    ) {
      return {
        kind: "standard_settled",
        event,
        data,
        requirement_id: requirementId,
        challenge_hash: challengeHash,
        chain_receipt_id: chainReceiptId,
        request_hash_v2: stringOrNull(data.request_hash_v2),
      };
    }
    return {
      kind: "unknown",
      event,
      data,
      reason: "missing_standard_settlement_fields",
      requirement_id: requirementId,
      pricing_band: pricingBand,
      settlement_cadence: settlementCadence,
      settlement_status: settlementStatus,
      finality,
    };
  }

  if (pricingBand === "micro" || pricingBand === "nano") {
    if (
      finality === DIRECT_REQUEST_PAYMENT_METERED_FINALITY &&
      settlementStatus === DIRECT_REQUEST_PAYMENT_METERED_ACCEPTED_STATUS &&
      settlementCadence === (pricingBand === "micro" ? "weekly" : "monthly") &&
      requirementId &&
      challengeHash
    ) {
      return {
        kind: "metered_usage_accepted",
        event,
        data,
        pricing_band: pricingBand,
        settlement_cadence: pricingBand === "micro" ? "weekly" : "monthly",
        requirement_id: requirementId,
        challenge_hash: challengeHash,
        request_hash_v2: stringOrNull(data.request_hash_v2),
      };
    }
    return {
      kind: "unknown",
      event,
      data,
      reason: "missing_metered_usage_fields",
      requirement_id: requirementId,
      pricing_band: pricingBand,
      settlement_cadence: settlementCadence,
      settlement_status: settlementStatus,
      finality,
    };
  }

  return {
    kind: "unknown",
    event,
    data,
    reason: "unknown_confirmation_shape",
    requirement_id: requirementId,
    settlement_batch_id: stringOrNull(data.settlement_batch_id),
    pricing_band: pricingBand,
    settlement_cadence: settlementCadence,
    settlement_status: settlementStatus,
    finality,
  };
}

export async function verifyDirectRequestPaymentWebhook(
  signing_secret: string,
  body: DirectRequestPaymentRawWebhookBody,
  signature_header: string,
  options: { tolerance_seconds?: number; now?: number } = {},
): Promise<{ event: DirectRequestPaymentWebhookEvent; verification: WebhookSignatureVerification }> {
  const verification = await verifyWebhookSignature(signing_secret, body, signature_header, options);
  const text = new TextDecoder().decode(rawWebhookBodyBytes(body));
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
export const createExternal402RecurringChallenge = createDirectRequestPaymentRecurringChallenge;
export const verifyExternal402RecurringChallenge = verifyDirectRequestPaymentRecurringChallenge;

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

function normalizeMeteredPlanType(value: string): DirectRequestPaymentMeteredPlanType {
  const planType = requireNonEmpty(value, "plan_type").toLowerCase();
  if (planType === "micro" || planType === "nano") {
    return planType;
  }
  throw new SiglumeDirectRequestPaymentError("plan_type must be micro or nano.");
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

function normalizeApiBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(requireNonEmpty(value, "base_url"));
  } catch {
    throw new SiglumeDirectRequestPaymentError("base_url must be an absolute URL such as https://siglume.com/v1.");
  }
  if (url.username || url.password) {
    throw new SiglumeDirectRequestPaymentError("base_url must not include userinfo.");
  }
  if (!isAllowedCheckoutOriginScheme(url)) {
    throw new SiglumeDirectRequestPaymentError(
      "base_url must use https, except http is allowed for localhost, 127.0.0.1, or [::1].",
    );
  }
  return url.toString().replace(/\/+$/, "");
}

function normalizeHttpsUrl(value: string, name: string): string {
  let url: URL;
  try {
    url = new URL(requireNonEmpty(value, name));
  } catch {
    throw new SiglumeDirectRequestPaymentError(`${name} must be an absolute https URL.`);
  }
  if (url.username || url.password) {
    throw new SiglumeDirectRequestPaymentError(`${name} must not include userinfo.`);
  }
  if (url.protocol !== "https:" || !url.hostname) {
    throw new SiglumeDirectRequestPaymentError(`${name} must use https.`);
  }
  return url.toString();
}

function normalizeOriginList(value: string[]): string[] {
  if (!Array.isArray(value)) {
    throw new SiglumeDirectRequestPaymentError("checkout_allowed_origins must be an array of origin URLs.");
  }
  const seen = new Set<string>();
  const origins: string[] = [];
  for (const item of value) {
    let url: URL;
    try {
      url = new URL(requireNonEmpty(String(item), "checkout_allowed_origins entry"));
    } catch {
      throw new SiglumeDirectRequestPaymentError(
        "each checkout_allowed_origins entry must be an absolute origin such as https://shop.example.com.",
      );
    }
    if (url.username || url.password) {
      throw new SiglumeDirectRequestPaymentError("checkout_allowed_origins entries must not include userinfo.");
    }
    if (!isAllowedCheckoutOriginScheme(url)) {
      throw new SiglumeDirectRequestPaymentError(
        "checkout_allowed_origins entries must use https, except http is allowed for localhost, 127.0.0.1, or [::1].",
      );
    }
    const origin = url.origin.toLowerCase();
    if (!seen.has(origin)) {
      seen.add(origin);
      origins.push(origin);
    }
  }
  return origins;
}

function isAllowedCheckoutOriginScheme(url: URL): boolean {
  if (url.protocol === "https:") {
    return Boolean(url.hostname);
  }
  if (url.protocol !== "http:") {
    return false;
  }
  const hostname = url.hostname.toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}

function meteredQueryPath(
  path: string,
  input: DirectRequestPaymentBuyerMeteredQuery | DirectRequestPaymentMeteredListQuery | DirectRequestPaymentProviderMeteredQuery | DirectRequestPaymentProviderMeteredListQuery,
): string {
  const params = new URLSearchParams();
  if (input.plan_type !== undefined) {
    params.set("plan_type", normalizeMeteredPlanType(input.plan_type));
  }
  if (input.token_symbol !== undefined) {
    params.set("token_symbol", normalizeToken(input.token_symbol));
  }
  if ("status" in input && input.status !== undefined) {
    params.set("status", requireNonEmpty(input.status, "status"));
  }
  if ("listing_id" in input && input.listing_id !== undefined) {
    params.set("listing_id", requireNonEmpty(input.listing_id, "listing_id"));
  }
  if ("capability_key" in input && input.capability_key !== undefined) {
    params.set("capability_key", requireNonEmpty(input.capability_key, "capability_key"));
  }
  if ("limit" in input && input.limit !== undefined) {
    params.set("limit", String(positiveInteger(input.limit, "limit")));
  }
  if ("cursor" in input && input.cursor !== undefined) {
    params.set("cursor", requireNonEmpty(input.cursor, "cursor"));
  }
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

function positiveInteger(value: unknown, name: string): number {
  if (typeof value !== "number") {
    throw new SiglumeDirectRequestPaymentError(`${name} must be a positive safe integer.`);
  }
  const parsed = value;
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

function isHostedCheckoutUnavailable(error: unknown): boolean {
  if (!(error instanceof SiglumeApiError)) {
    return false;
  }
  const code = error.code.toUpperCase();
  if (error.status === 409 && (code === "HOSTED_CHECKOUT_NOT_ENABLED" || code === "FEATURE_DISABLED")) {
    return true;
  }
  return (
    error.status === 404 &&
    (code === "HTTP_404" || code === "NOT_FOUND" || code === "ROUTE_NOT_FOUND" || code === "FEATURE_DISABLED")
  );
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

function defaultApiBaseUrl(): string {
  const explicit = envValue("SIGLUME_API_BASE");
  if (explicit) return explicit;
  if ((envValue("SIGLUME_ENV") || "").toLowerCase() === "sandbox") {
    return envValue("SIGLUME_SANDBOX_API_BASE") || DEFAULT_SIGLUME_SANDBOX_API_BASE;
  }
  return DEFAULT_SIGLUME_API_BASE;
}

function bodyBytes(body: DirectRequestPaymentWebhookSignatureBody): Uint8Array {
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

function rawWebhookBodyBytes(body: unknown): Uint8Array {
  if (body instanceof Uint8Array) {
    return body;
  }
  if (body instanceof ArrayBuffer) {
    return new Uint8Array(body);
  }
  if (typeof body === "string") {
    return new TextEncoder().encode(body);
  }
  throw new SiglumeWebhookPayloadError(
    "Webhook verification requires the exact raw request body bytes or raw body string; JSON objects are only accepted by buildWebhookSignatureHeader for tests.",
  );
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
