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
| Micro Payment | Weekly | Account-assigned fixed weekly slot in the buyer settlement timezone | After final debit notice delivery and the fixed close-plus-3-day window | Only after the aggregated settlement confirms on-chain |
| Nano Payment | Monthly | Account-assigned fixed monthly slot in the buyer settlement timezone | After final debit notice delivery and the fixed close-plus-3-day window | Only after the aggregated settlement confirms on-chain |

The schedule is platform-managed. Buyers and providers can see the assigned
period and scheduled attempt times through the statement APIs, but cannot choose
a custom close day.

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

## Amount Rounding

Micro / Nano usage rows keep provider price and protocol fee values as decimal
minor-unit amounts. This allows Nano fees such as about JPY 0.2 per usage to be
accounted without rounding every event.

Rounding happens once when a settlement batch is created:

```text
provider_usage_amount_minor = sum(provider price minor units for accepted usage)
protocol_fee_minor = sum(Micro/Nano fixed protocol fee minor units for accepted usage)
gross_buyer_debit_minor = provider_usage_amount_minor + protocol_fee_minor
buyer_debit_minor = ceil(gross_buyer_debit_minor)
rounding_delta_minor = buyer_debit_minor - gross_buyer_debit_minor
```

For low-count Nano batches, the ceiling can make the effective buyer burden per
usage higher than the headline "USD 0.001 / usage" protocol fee. The protocol
fee remains the decimal statement amount; the extra integer-minor-unit
adjustment is recorded as `rounding_delta_minor` on the settlement batch. Each
settlement batch can add a positive rounding adjustment of less than 1 token
minor unit; if a buyer uses many providers / payees in one period, that
adjustment can occur once per settlement batch.

`rounding_delta_minor` belongs to the buyer debit and Siglume's rounding
adjustment accounting for that batch. It is not provider revenue. Provider
reports should use `provider_receivable_minor`,
`settled_provider_receivable_minor`, `unsettled_provider_receivable_minor`, and
`past_due_provider_receivable_minor`.

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
- `protocol_fee_minor`: metered protocol fee
- `gross_buyer_debit_minor`: expected buyer debit for the event
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
- `gross_buyer_debit_minor`: provider usage amount plus protocol fee
- `buyer_debit_minor`: amount scheduled for the debit transaction

Past-due batches include:

- `past_due_block_reason`: `METERED_SETTLEMENT_PAST_DUE`
- `failure_reason_code`
- `failure_reason_label`
- `failure_reason_help`
- `support_reference`

Buyer-triggered requeue is not part of the MVP. The buyer-facing UI should show
the block reason, tell the buyer to repair balance / allowance / BudgetVault /
caps, and point them to support with `support_reference`.

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
  past-due buyer settlement.

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
| `status` | Batch lifecycle state such as `notice_pending`, `ready`, `submitted`, `settled`, `failed`, `past_due`, or `notice_delivery_failed` |
| `notice_status` | Final debit notice delivery status |
| `period_start`, `period_end`, `close_at` | Statement period boundaries |
| `expected_scheduled_debit_at` | Expected debit time for an open period before a batch exists |
| `scheduled_debit_at` | Scheduled debit time after batch creation |
| `not_before_attempt_at` | Earliest allowed debit attempt; this is the close-plus-3-day gate |
| `execution_status` | Public execution state such as `scheduled`, `submitted_reconcile_required`, `settled`, `failed_retryable`, or `past_due` |
| `latest_execution_attempt_status` | Latest non-sensitive execution attempt status |
| `chain_receipt_id` | On-chain receipt id when available |
| `usage_event_digest` | Digest of usage rows included in the batch |
| `provider_receivable_minor` | Provider amount for the batch |
| `settled_provider_receivable_minor` | Provider amount that is settled on-chain |
| `unsettled_provider_receivable_minor` | Provider amount not yet settled |
| `past_due_provider_receivable_minor` | Provider amount blocked on past-due settlement |
| `gross_buyer_debit_minor` | Provider amount plus protocol fee |
| `protocol_fee_minor` | Micro / Nano protocol fee |
| `buyer_debit_minor` | Amount scheduled for the buyer debit |
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
metered_usage_id,created_at,plan_type,settlement_cadence,period_start,period_end,listing_id,capability_key,operation_key,currency,token_symbol,provider_receivable_minor,protocol_fee_minor,gross_buyer_debit_minor,rounding_delta_minor,buyer_debit_minor,status,settlement_batch_id,buyer_period_ref
```

The CSV uses `buyer_period_ref`, not `buyer_user_id`.
`rounding_delta_minor` is present for a stable usage-event schema, but per-row
values are `0`. The authoritative rounding adjustment is the settlement batch
`rounding_delta_minor`; do not allocate that adjustment to provider revenue
from individual CSV rows.

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

New Micro / Nano usage for the same buyer, plan type, and token is paused while
the past-due block remains. The provider API is not called for the rejected
request, and the request is not charged.

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
| Usage cancellation/refund before settlement | Depends on platform support and status | Not self-service in this SDK release | Contact support or use the platform path Siglume provides for the account; do not mutate CSV/statement totals locally. |
| Refund/adjustment after settlement | Settled on-chain | Not self-service in this SDK release | Handle through an explicit adjustment/refund process; do not reverse settled revenue by editing statements. |

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
| `past_due` | Buyer has an unresolved settlement block; provider sees past-due revenue | New Micro / Nano usage for the same buyer / plan / token is paused | Operator requeue or manual resolution only | Do not promise collection or provider payment. Ask the buyer to repair balance / allowance / BudgetVault / caps and reference `support_reference`. |
| `failed_chargeable` | Usage is still chargeable because provider work was accepted or completed | Included in later settlement attempts | Review if the provider disputes completion | Keep fulfillment idempotent and preserve evidence keyed by idempotency key. |

Future platform versions may add explicit terminal states such as
`closed_unpaid`, `uncollectible`, or `written_off`. Treat unknown terminal
settlement states as not settled unless `status === "settled"` and
`chain_receipt_id` is present.

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
or authorization issue. Requeue is operator-only in the MVP.

### "What should our accounting system book?"

Book `settled_provider_receivable_minor` as settled revenue. Keep
`unsettled_provider_receivable_minor` and `past_due_provider_receivable_minor`
separate from settled revenue.

## Go-Live Checklist

- Your order fulfillment is idempotent by order id and requirement id.
- Standard Payment fulfillment still uses verified `direct_payment.confirmed`
  only when `pricing_band`, `finality`, and `settlement_status` show settled
  per-payment finality.
- Micro / Nano accounting uses statement APIs or CSV, not only webhooks.
- Your dashboard separates settled, unsettled, and past-due provider amounts.
- Your support UI shows sanitized failure fields and `support_reference`.
- You do not store or display raw buyer IDs from provider APIs; use
  `buyer_period_ref`.
- You do not recognize Micro / Nano provider revenue before on-chain settlement.
