# Micro / Nano Statements and Notices

This guide is the operating manual for SDRP Micro Payment and Nano Payment
after a payment is accepted.

Use it when you need to answer:

- how much Micro / Nano usage happened in the current period,
- when the period closes,
- when Siglume may first attempt the aggregated debit,
- how much provider revenue is settled, unsettled, retrying, or past due,
- what a buyer must fix before new Micro / Nano usage can resume.

Micro and Nano are automatic amount bands. You do not create a separate Micro or
Nano checkout request. The same payment or paid-capability flow runs, then
Siglume applies the settlement band from the amount.

## Core Settlement Rules

| Band | Cadence | Period close | First debit attempt | Revenue recognition |
| --- | --- | --- | --- | --- |
| Micro Payment | Weekly, with amount-threshold close | Account-assigned fixed weekly slot in the buyer settlement timezone; closes early when provider gross exposure for the same buyer / provider / token / pricing band becomes greater than or equal to JPY 10,000 or USD 100.00 | After final debit notice delivery and the fixed close-plus-3-day window | Only after the aggregated settlement confirms on-chain |
| Nano Payment | Monthly, with amount-threshold close | Account-assigned fixed monthly slot in the buyer settlement timezone; closes early when provider gross exposure for the same buyer / provider / token / pricing band becomes greater than or equal to JPY 10,000 or USD 100.00 | After final debit notice delivery and the fixed close-plus-3-day window | Only after the aggregated settlement confirms on-chain |

The schedule is platform-managed. Buyers and providers can see the resulting
batch period and scheduled attempt times through the statement APIs, but cannot
choose a custom close day. Amount-threshold close creates a batch before the
account-assigned weekly or monthly close when
`accrued_provider_gross_minor >= settlement_threshold_minor`. The scope is the
same buyer / provider / token / pricing band, and the basis is provider gross
before protocol-fee deduction. `accrued_provider_gross_minor` is the
active-batch sum of accepted open-period `provider_gross_amount_minor` rows for
that scope; it names the threshold calculation and is not a separate required
API field. The usage event that reaches or crosses the threshold is accepted
into the closing batch, so threshold overshoot is bounded by that event's
`provider_gross_amount_minor`. After the close, new usage for the same scope is
paused while `total_unsettled_exposure_minor` remains at or above the threshold.

The important timestamp is `not_before_attempt_at`. Siglume does not execute the
debit before this timestamp. It is always after the final debit notice is
recorded and at least 72 hours after the period close.

Provider revenue is not settled revenue while a batch is open, scheduled,
failed, retrying, submitted, or past due. Treat `settled_at` and
`chain_receipt_id` on a `settled` batch as the durable on-chain settlement
signal.

## Authentication Roles

Buyer endpoints use the buyer's Siglume bearer token. Use these only in a buyer
account page or buyer support view.

Provider endpoints use the provider / publisher / merchant user's Siglume bearer
token. Provider responses never include raw `buyer_user_id`, buyer email, or raw
wallet identifiers. Use `buyer_period_ref` to reconcile repeated usage by the
same buyer within the provider's statement period without receiving buyer PII.

TypeScript and Python expose named helpers for the JSON statement endpoints.
Use raw HTTPS only for the CSV export.

## Buyer Statement APIs

### Summary

TypeScript:

```ts
import { DirectRequestPaymentClient } from "@siglume/direct-request-payment";

const siglume = new DirectRequestPaymentClient({
  auth_token: buyerSiglumeBearerToken,
});

const summary = await siglume.getBuyerMeteredSummary({
  plan_type: "micro",
  token_symbol: "JPYC",
});
```

Python:

```py
summary = siglume.get_buyer_metered_summary(plan_type="micro", token_symbol="JPYC")
```

Raw HTTP:

```bash
curl https://siglume.com/v1/sdrp/metered/my-summary?plan_type=micro\&token_symbol=JPYC \
  -H "Authorization: Bearer <buyer-siglume-bearer-token>"
```

Use `open_periods` to show current-period estimated debit. Use
`settlement_batches` for closed or already scheduled periods. Use
`past_due_blocks` to explain why new Micro / Nano usage is blocked.

`balance_sufficiency` is a cheap current-state indicator. When available, it
checks whether BudgetVault status and configured caps look sufficient for the
open period. It can report `wallet_balance_checked: false` or
`allowance_checked: false`; in that case it is guidance, not a final on-chain
guarantee.

## Seller-borne Micro / Nano Amounts

Micro / Nano usage rows keep provider price and protocol fee values as decimal
minor-unit amounts. This allows Nano fees such as JPY 0.2 per SDRP Tx to be
accounted without rounding every accepted payment.

The buyer is charged only the provider-visible usage amount. Micro / Nano
protocol fees are seller-borne and are deducted from provider receivable:

```text
provider_gross_amount_minor = sum(provider price minor units for accepted metered rows)
provider_usage_amount_minor = provider_gross_amount_minor   # legacy alias
gross_buyer_debit_minor = provider_gross_amount_minor       # legacy alias
buyer_debit_minor = provider_gross_amount_minor
protocol_fee_minor = sum(Micro/Nano fixed protocol fee minor units for accepted metered rows)
provider_receivable_minor = provider_gross_amount_minor - protocol_fee_minor
rounding_delta_minor = 0 for buyer/provider accounting
```

Example: a JPY 100 Micro usage event has `buyer_debit_minor = 100`,
`protocol_fee_minor = 2`, and `provider_receivable_minor = 98`.

The `rounding_delta_minor` field remains in some statement schemas for
compatibility. It is not added to `buyer_debit_minor`, not added to
`provider_gross_amount_minor`, and not deducted again from
`provider_receivable_minor`. If non-zero in a historical or internal record,
treat it as a Siglume platform accounting adjustment, not buyer debit or
provider revenue.

Micro / Nano amount fields are decimal minor-unit strings. JavaScript
integrations should aggregate them with a decimal library, not `number`. Python
integrations should use `Decimal` for accounting.

### Usage Events

```text
GET /v1/sdrp/metered/my-usage-events
```

Query parameters:

- `plan_type`: `micro` or `nano`
- `token_symbol`: `JPYC` or `USDC`
- `status`: for example `pending_settlement`, `settled`, `failed_chargeable`
- `cursor`: pass the previous response's `next_cursor` to fetch the next page
- `limit`: 1 to 500

SDK methods: `listBuyerUsageEvents(...)` / `list_buyer_usage_events(...)`.
They return `{items, next_cursor}`.

Buyer usage event amount fields:

- `provider_usage_amount_minor`: provider price for the usage event
- `protocol_fee_minor`: provider-borne metered protocol fee
- `provider_gross_amount_minor`: provider price before protocol fee
- `gross_buyer_debit_minor`: legacy alias of `provider_gross_amount_minor`
- `buyer_debit_minor`: buyer debit; equals `provider_gross_amount_minor`
- `expected_scheduled_debit_at`: derived schedule for an open period before a
  settlement batch exists

### Settlement Batches

```text
GET /v1/sdrp/metered/my-settlement-batches
```

Query parameters:

- `plan_type`: `micro` or `nano`
- `token_symbol`: `JPYC` or `USDC`
- `status`: `notice_pending`, `ready`, `submitted`, `settled`, `failed`,
  `past_due`, or `notice_delivery_failed`
- `cursor`: pass the previous response's `next_cursor` to fetch the next page
- `limit`: 1 to 200

SDK methods: `listBuyerSettlementBatches(...)` /
`list_buyer_settlement_batches(...)`. They return `{items, next_cursor}`.

Buyer batch amount fields:

- `estimated_buyer_debit_minor`: total buyer debit for the batch
- `provider_usage_amount_minor`: provider usage amount before protocol fee
- `provider_gross_amount_minor`: provider gross before protocol fee
- `gross_buyer_debit_minor`: legacy alias of `provider_gross_amount_minor`
- `buyer_debit_minor`: amount scheduled for the debit transaction
- `provider_receivable_minor`: provider gross minus provider-borne protocol fee

Past-due batches include:

- `past_due_block_reason`: `METERED_SETTLEMENT_PAST_DUE`
- `failure_reason_code`
- `failure_reason_label`
- `failure_reason_help`
- `support_reference`

Buyer-triggered requeue is not part of the MVP. The buyer-facing UI should show
the block reason, tell the buyer to repair balance / allowance / BudgetVault /
caps, and point them to support with `support_reference`.

Threshold-control fields:

- `settlement_trigger`: `amount_threshold` or `scheduled_close`
- `settlement_threshold_minor`: JPY `10000` or USD `10000` minor units
- `threshold_reached_at`: set when the fixed amount threshold closed the batch
- `total_unsettled_exposure_minor`: chargeable provider gross exposure for the
  same buyer / provider / token / pricing band where the batch is not
  `settled`, `uncollectible`, or `written_off`. This includes open usage,
  `notice_pending`, `notice_delivery_failed`, `ready`, `submitted`,
  `submitted_reconcile_required`, `failed_retryable`, `retrying`, and
  `past_due`.

JPY 10,000 and USD 100.00 are market-specific fixed thresholds, not FX
conversions of one another.

## Provider Statement APIs

### Summary

TypeScript:

```ts
const siglume = new DirectRequestPaymentClient({
  auth_token: providerSiglumeBearerToken,
});

const providerSummary = await siglume.getProviderMeteredSummary({
  plan_type: "micro",
  token_symbol: "JPYC",
});
```

Python:

```py
provider_summary = siglume.get_provider_metered_summary(plan_type="micro", token_symbol="JPYC")
```

Raw HTTP:

```bash
curl https://siglume.com/v1/sdrp/metered/provider/summary?plan_type=micro\&token_symbol=JPYC \
  -H "Authorization: Bearer <provider-siglume-bearer-token>"
```

Query parameters:

- `plan_type`: `micro` or `nano`
- `token_symbol`: `JPYC` or `USDC`
- `listing_id`: restrict to one listing
- `capability_key`: restrict to one capability

Use:

- `open_periods` for current-period expected revenue before a batch exists,
- `periods` for closed, scheduled, retrying, past-due, submitted, or settled
  batches,
- `totals.settled_provider_receivable_minor` for revenue already settled,
- `totals.unsettled_provider_receivable_minor` for expected but not yet settled
  revenue,
- `totals.past_due_provider_receivable_minor` for provider revenue blocked on a
  past-due buyer settlement,
- `totals.terminal_provider_receivable_minor` for provider receivable that an
  operator has marked `uncollectible` or `written_off` after past-due review.

### Usage Events

```text
GET /v1/sdrp/metered/provider/usage-events
```

Query parameters:

- `plan_type`
- `token_symbol`
- `status`
- `listing_id`
- `capability_key`
- `cursor`: pass the previous response's `next_cursor` to fetch the next page
- `limit`: 1 to 500

SDK methods: `listProviderUsageEvents(...)` /
`list_provider_usage_events(...)`. They return `{items, next_cursor}`.

Provider usage event fields include:

- `provider_receivable_minor`
- `protocol_fee_minor`
- `gross_buyer_debit_minor`
- `period_start`
- `period_end`
- `expected_scheduled_debit_at`
- `settlement_batch_id`
- `buyer_period_ref`

`buyer_period_ref` is the only buyer correlation identifier exposed to
providers. Do not expect raw buyer account IDs in provider APIs.

### Settlement Batches

```text
GET /v1/sdrp/metered/provider/settlement-batches
GET /v1/sdrp/metered/provider/settlement-batches/{settlement_batch_id}
```

Query parameters for the list endpoint:

- `plan_type`
- `token_symbol`
- `status`
- `listing_id`
- `capability_key`
- `cursor`: pass the previous response's `next_cursor` to fetch the next page
- `limit`: 1 to 200

The detail endpoint also accepts `listing_id` and `capability_key`.

SDK methods: `listProviderSettlementBatches(...)` /
`list_provider_settlement_batches(...)` and `getProviderSettlementBatch(...)` /
`get_provider_settlement_batch(...)`. List methods return `{items, next_cursor}`.

Important batch fields:

| Field | Meaning |
| --- | --- |
| `status` | Batch lifecycle state such as `notice_pending`, `ready`, `submitted`, `settled`, `failed`, `past_due`, `uncollectible`, `written_off`, or `notice_delivery_failed` |
| `notice_status` | Final debit notice delivery status |
| `period_start`, `period_end`, `close_at` | Statement period boundaries |
| `settlement_trigger` | `amount_threshold` for early threshold close, or `scheduled_close` for weekly/monthly close |
| `settlement_threshold_minor` | Fixed market threshold for early settlement: JPY `10000` or USD `10000` minor units |
| `threshold_reached_at` | Timestamp when the fixed threshold closed the batch, otherwise null |
| `total_unsettled_exposure_minor` | Chargeable provider gross exposure for the same buyer / provider / token / pricing band where status is not `settled`, `uncollectible`, or `written_off`; includes open, notice, ready, submitted, reconcile-required, retryable, retrying, and past-due states |
| `expected_scheduled_debit_at` | Expected debit time for an open period before a batch exists |
| `scheduled_debit_at` | Scheduled debit time after batch creation |
| `not_before_attempt_at` | Earliest allowed debit attempt; this is the close-plus-3-day gate |
| `execution_status` | Public execution state such as `scheduled`, `submitted_reconcile_required`, `settled`, `failed_retryable`, or `past_due` |
| `latest_execution_attempt_status` | Latest non-sensitive execution attempt status |
| `chain_receipt_id` | On-chain receipt id when available |
| `usage_event_digest` | Digest of usage rows included in the batch |
| `provider_gross_amount_minor` | Provider gross before provider-borne protocol fee |
| `provider_usage_amount_minor` | Provider usage amount before protocol fee |
| `provider_receivable_minor` | Provider amount for the batch after provider-borne protocol fee |
| `settled_provider_receivable_minor` | Provider receivable that is settled on-chain |
| `unsettled_provider_receivable_minor` | Provider receivable not yet settled |
| `past_due_provider_receivable_minor` | Provider receivable blocked on past-due settlement |
| `terminal_provider_receivable_minor` | Provider receivable marked terminal after operator review |
| `uncollectible_provider_receivable_minor` | Terminal provider receivable classified as uncollectible |
| `written_off_provider_receivable_minor` | Terminal provider receivable classified as written off |
| `terminal_status`, `terminal_marked_at`, `terminal_reason_code` | Public terminal resolution fields, present only for terminal batches |
| `gross_buyer_debit_minor` | Legacy alias of provider gross; protocol fee is not added |
| `protocol_fee_minor` | Micro / Nano protocol fee deducted from provider receivable |
| `buyer_debit_minor` | Amount scheduled for the buyer debit; equals provider gross |
| `attempt_count`, `next_attempt_at` | Retry state |
| `failure_reason_code`, `failure_reason_label`, `failure_reason_help` | Sanitized public failure reason |
| `support_reference` | Non-secret support reference |

Provider APIs do not expose relayer IDs, nonce values, gas data, raw RPC errors,
raw `failure_message`, buyer email, buyer wallet address, or raw `buyer_user_id`.

### CSV Export

```bash
curl https://siglume.com/v1/sdrp/metered/provider/settlement-batches/<batch-id>/usage-events.csv \
  -H "Authorization: Bearer <provider-siglume-bearer-token>" \
  -o sdrp-metered.csv
```

The CSV contains exactly these columns:

```text
metered_usage_id,created_at,plan_type,settlement_cadence,period_start,period_end,listing_id,capability_key,operation_key,currency,token_symbol,provider_gross_amount_minor,provider_usage_amount_minor,provider_receivable_minor,protocol_fee_minor,gross_buyer_debit_minor,rounding_delta_minor,buyer_debit_minor,status,settlement_batch_id,buyer_period_ref
```

The CSV uses `buyer_period_ref`, not `buyer_user_id`.
`rounding_delta_minor` is present for a stable usage-event schema, but per-row
values are `0`. If a batch-level `rounding_delta_minor` appears in historical or
internal records, do not add it to buyer debit and do not allocate it to provider
revenue.

## Notifications

Siglume sends platform notifications for Micro / Nano settlement state. Your
integration should not send a buyer debit notice as if it were the source of
truth.

Buyer-facing notifications:

- estimate before close when there is chargeable usage in the period,
- final debit scheduled after period close,
- settlement failed / retry scheduled when the buyer can fix balance,
  allowance, BudgetVault, or caps,
- settlement past due after automatic attempts are exhausted.

Provider-facing notifications:

- period summary / expected settlement,
- settlement succeeded,
- settlement failed / retry scheduled,
- settlement past due.

There is no provider "final debit" notice. Providers should use statement APIs
for expected and settled revenue. Standard `direct_payment.confirmed` webhooks
remain the source for immediate Standard Payment fulfillment, but they are not a
complete revenue statement for Micro / Nano aggregated settlement.

## Failure and Retry Policy

Siglume retries failed Micro / Nano settlement every 6 hours for up to 28
automatic attempts. After that the batch remains `past_due` until operator
requeue.

New Micro / Nano usage for the same buyer / provider / token / pricing band is
paused while the total unsettled exposure is at or above the fixed threshold,
and while a failed or past-due block remains. The provider API is not called for
the rejected request, and the request is not charged.

Public failure fields are sanitized. Show `failure_reason_code`,
`failure_reason_label`, `failure_reason_help`, and `support_reference` to users
or support staff. Do not depend on raw platform failure messages.

## Usage Accounting by Result

Use idempotency keys for every paid operation. For Siglume Marketplace paid
capability execution and MCP tools, pass `idempotency_key` as a top-level JSON
field on the execution payload / tool arguments. Do not rely on an HTTP
`Idempotency-Key` header for this public paid-operation contract; Siglume may
also use that header internally when it calls providers.

The key should be a stable retry key for one logical paid operation, such as
`order:<order_id>:attempt:<n>` or `<provider_event_id>`, and should not be reused
for a different payload. The current public contract stores up to 128
characters. Siglume records one chargeable usage event per idempotency key within
the same buyer / listing / capability scope; a retry with the same key returns or
reconciles the first recorded outcome rather than creating another chargeable
event. If a provider times out after doing work, retry or reconcile with the
same key before repeating side effects.

| Case | Provider API executed? | Usage counted? | Integration rule |
| --- | --- | --- | --- |
| Budget gate rejected | No | No | Treat the request as rejected with no charge. The provider must not fulfill work. |
| Provider returns 2xx | Yes | Yes | Chargeable usage is recorded once. Fulfill idempotently by order id / requirement id / idempotency key. |
| Provider returns 4xx | Yes | Usually no, unless your integration deliberately marks the work as accepted before returning the 4xx | Prefer returning 2xx for completed work and 4xx only for unfulfilled client errors. Document any deliberate `failed_chargeable` mapping in your provider. |
| Provider returns 5xx | Yes | No by default | Treat as unfulfilled; retry from the caller with the same idempotency key if safe. |
| Provider timeout | Unknown | No by default unless the provider later confirms successful work under the same idempotency key | Reconcile by idempotency key before retrying side effects. |
| Client disconnects after provider success | Yes | Yes if the provider completed work and Siglume observed/records that success | The client may see failure while the provider completed work; use idempotency to avoid duplicate fulfillment. |
| Duplicate idempotency key | Maybe | One usage event | Return/reconcile the first outcome; do not create another chargeable event. |
| Merchant refund or buyer adjustment | Outside SDRP metered settlement | Not provided by this SDK | Handle the buyer policy, transfer, and accounting in the merchant system; keep SDRP statement totals immutable and reconcile against original payment identifiers. |
| Settlement dispute or ledger investigation | Depends on the recorded SDRP status | Private support / account channel | Use the SDRP statement ids, payment ids, and chain receipts for investigation; do not mutate CSV/statement totals locally. |

`failed_chargeable` means the provider-side work is treated as completed or
economically accepted even though the caller may have observed a failure state.
It is for cases such as "provider completed the operation, but the client
connection failed before receiving the response." It is not a catch-all for
provider 5xx errors. Integrations should make this state rare and defensible by
using stable idempotency keys and provider-side completion records.

## Operational Status Handling

| Status | Buyer / provider view | Automatic processing | Operator action | Integration guidance |
| --- | --- | --- | --- | --- |
| `notice_delivery_failed` | Buyer debit is not yet allowed; provider revenue remains unsettled | Notice delivery can be retried or reviewed | Required if delivery keeps failing | Do not attempt your own debit notice or mark revenue settled. Show support context only. |
| `submitted_reconcile_required` | A settlement submission exists but final on-chain outcome is not yet reconciled | Reconciliation may complete if a receipt is found | Required if reconciliation stalls | Do not retry payment yourself. Wait for `settled`, `failed_retryable`, or `past_due`. |
| `past_due` | Buyer has an unresolved settlement block; provider sees past-due revenue | New Micro / Nano usage for the same buyer / provider / token / pricing band is paused | Operator requeue or manual resolution only | Do not promise collection or provider payment. Ask the buyer to repair balance / allowance / BudgetVault / caps and reference `support_reference`. |
| `failed_chargeable` | Usage is still chargeable because provider work was accepted or completed | Included in later settlement attempts | Review if the provider disputes completion | Keep fulfillment idempotent and preserve evidence keyed by idempotency key. |

Terminal public states include `uncollectible` and `written_off` after operator
review. Treat unknown terminal settlement states as not settled unless
`status === "settled"` and `chain_receipt_id` is present.

## Operational Recipes

### "How much did we use this week or month?"

Call provider summary and read:

- `open_periods` for usage in the currently open period,
- `periods` for closed or settled periods,
- `provider_receivable_minor` on each period,
- CSV export for line-level reconciliation.

### "When will we be paid?"

For open periods, read `expected_scheduled_debit_at`. After a batch exists, read
`scheduled_debit_at` and `not_before_attempt_at`. Actual provider revenue is
settled only when `status === "settled"` and `chain_receipt_id` is present.

### "Why did new Micro / Nano usage stop?"

Buyer summary `past_due_blocks` returns `METERED_SETTLEMENT_PAST_DUE` with a
sanitized reason and support reference. The buyer must repair the listed balance
or authorization issue. Requeue is operator-only in the MVP. If operator review
marks a past-due batch `uncollectible` or `written_off`, new usage may resume,
but the provider receivable moves to terminal accounting instead of settled,
unsettled, or past-due revenue.

If the same execution idempotency key is reused with a different Micro / Nano
input payload, the platform fails closed before provider execution with
`IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD` and HTTP status `409`.

### "What should our accounting system book?"

Book `settled_provider_receivable_minor` as settled revenue. Keep
`unsettled_provider_receivable_minor` and `past_due_provider_receivable_minor`
separate from settled revenue. Keep
`terminal_provider_receivable_minor`, `uncollectible_provider_receivable_minor`,
and `written_off_provider_receivable_minor` outside settled, unsettled, and
past-due revenue; they represent operator terminal resolution, not successful
on-chain settlement.

## Go-Live Checklist

- Your order fulfillment is idempotent by order id and requirement id.
- Standard Payment fulfillment still uses verified `direct_payment.confirmed`
  only when `pricing_band`, `settlement_cadence`, `finality`, and
  `settlement_status` show settled per-payment finality.
- Micro / Nano accounting uses statement APIs or CSV, not only webhooks.
- Your dashboard separates settled, unsettled, and past-due provider amounts.
- Your dashboard separates terminal `uncollectible` / `written_off` provider
  amounts from settled, unsettled, and past-due revenue.
- Your support UI shows sanitized failure fields and `support_reference`.
- You do not store or display raw buyer IDs from provider APIs; use
  `buyer_period_ref`.
- You do not recognize Micro / Nano provider revenue before on-chain settlement.
