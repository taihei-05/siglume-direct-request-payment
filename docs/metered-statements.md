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
| Micro Payment | Weekly | Account-assigned fixed weekly slot in the buyer settlement timezone | After final debit notice delivery and the fixed close-plus-3-day site | Only after the aggregated settlement confirms on-chain |
| Nano Payment | Monthly | Account-assigned fixed monthly slot in the buyer settlement timezone | After final debit notice delivery and the fixed close-plus-3-day site | Only after the aggregated settlement confirms on-chain |

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

TypeScript can call JSON statement endpoints with
`DirectRequestPaymentClient.request<T>()`. Python does not expose a public
generic request helper in this release; use ordinary HTTPS requests with the
same bearer token.

## Buyer Statement APIs

### Summary

TypeScript:

```ts
import { DirectRequestPaymentClient } from "@siglume/direct-request-payment";

const siglume = new DirectRequestPaymentClient({
  auth_token: buyerSiglumeBearerToken,
});

const summary = await siglume.request<{
  role: "buyer";
  open_periods: Array<Record<string, unknown>>;
  settlement_batches: Array<Record<string, unknown>>;
  past_due_blocks: Array<Record<string, unknown>>;
  balance_sufficiency: Record<string, unknown>;
}>(
  "GET",
  "/sdrp/metered/my-summary?plan_type=micro&token_symbol=JPYC",
);
```

Raw HTTP / Python:

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

### Usage Events

```text
GET /v1/sdrp/metered/my-usage-events
```

Query parameters:

- `plan_type`: `micro` or `nano`
- `token_symbol`: `JPYC` or `USDC`
- `status`: for example `pending_settlement`, `settled`, `failed_chargeable`
- `limit`: 1 to 500

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
- `limit`: 1 to 200

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

const providerSummary = await siglume.request<{
  role: "provider";
  timezone: string;
  filters: Record<string, unknown>;
  open_periods: Array<Record<string, unknown>>;
  periods: Array<Record<string, unknown>>;
  totals: Record<string, string>;
}>(
  "GET",
  "/sdrp/metered/provider/summary?plan_type=micro&token_symbol=JPYC",
);
```

Raw HTTP / Python:

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
- `limit`: 1 to 500

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
- `limit`: 1 to 200

The detail endpoint also accepts `listing_id` and `capability_key`.

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
- Standard Payment fulfillment still uses verified `direct_payment.confirmed`.
- Micro / Nano accounting uses statement APIs or CSV, not only webhooks.
- Your dashboard separates settled, unsettled, and past-due provider amounts.
- Your support UI shows sanitized failure fields and `support_reference`.
- You do not store or display raw buyer IDs from provider APIs; use
  `buyer_period_ref`.
- You do not recognize Micro / Nano provider revenue before on-chain settlement.
