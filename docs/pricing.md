# Pricing

This page documents the trial-phase merchant pricing for Siglume Direct Request
Payment as of SDK v0.4.26. Pricing can change by agreement or future product
release; the Siglume platform response is the source of truth for per-payment
fee data returned at runtime.

Pricing has one structure: a merchant selects the Standard Payment plan during
setup, then Siglume applies the fee for each payment by amount. Micro Payment
and Nano Payment are automatic amount bands, not separate choices. Merchant
setup and the billing mandate terms assume the merchant accepts Micro / Nano
delayed aggregated settlement whenever they offer amounts in those bands.

## Settlement Currencies

Siglume Direct Request Payment launches in the US and Japan, and both settlement
currencies are first-class where enabled:

- **JPY**, settled on-chain in **JPYC**
- **USD**, settled on-chain in **USDC**

A merchant settles in a single currency, chosen at onboarding. Some accounts may
require agreed USD/USDC terms before USD is enabled. The settlement fee
percentage (the payment fee column below) is identical in both currencies. Only
the flat amounts — the monthly base fee and the per-payment minimum fee — are
quoted per currency.

Current public beta settlement is on **Polygon PoS only**. The public SDK does
not expose chain selection, cross-chain payment, multiple merchant settlement
wallets, per-payment settlement-wallet overrides, or split / multi-wallet
charging.

## Pricing Table

| Public one-time payment amount | Applied automatically | What you select | Fee | Settlement |
| --- | --- | --- | --- | --- |
| JPY 501+ / USD 3.01+ | Standard Payment | Select one Standard plan: Launch, Starter, Growth, or Pro | Launch: JPY 0 / USD 0 monthly, 1.8%; Starter: JPY 980 / USD 6 monthly, 1.0%; Growth: JPY 2,980 / USD 18 monthly, 0.7%; Pro: JPY 9,800 / USD 60 monthly, 0.5%. Minimum JPY 30 / USD 0.20 per payment. | Settled on-chain immediately after the payment confirms |
| JPY 50-500 / USD 0.31-3.00 | Micro Payment | Applied automatically by amount | JPY 2 / USD 0.01 per SDRP Tx | Aggregated and settled **weekly**, or earlier once the same buyer / provider / token / pricing band reaches JPY 10,000 / USD 100.00 (see [Settlement schedule](#settlement-schedule)) |
| JPY 1-49 / USD 0.01-0.30 | Nano Payment | Applied automatically by amount | JPY 0.2 / USD 0.001 per SDRP Tx | Aggregated and settled **monthly**, or earlier once the same buyer / provider / token / pricing band reaches JPY 10,000 / USD 100.00 (see [Settlement schedule](#settlement-schedule)) |

In this table, `Tx` means one accepted SDRP payment, not an on-chain settlement
transaction. Micro / Nano settlement batches are aggregated on-chain after the
weekly or monthly close, or earlier when the fixed amount threshold is reached.

Standard Payment settles per payment. Micro Payment and Nano Payment are
aggregated and settled in account-assigned weekly / monthly slots, with early
settlement when the same buyer / provider / token / pricing band reaches JPY
10,000 or USD 100.00. See [Settlement schedule](#settlement-schedule) for how each band
closes, when the pre-debit notice window elapses, when revenue becomes settled,
and how rejected requests behave.

The current public API chooses the band from `amount_minor`; JPY 500-and-under /
USD 3-and-under payments are routed to Micro / Nano delayed aggregated
settlement. If a merchant needs immediate on-chain finality, the payment amount
must be in the Standard band. In practice, do not offer JPY 500-and-under or
USD 3-and-under items for a product that cannot accept Micro / Nano delayed
aggregated settlement. For public one-time Direct Payment / Hosted Checkout,
`amount_minor` is a positive integer in minor currency units. That means the
smallest public one-time checkout amount is JPY 1 or USD 0.01. Nano Payment on
this public path therefore means JPY 1-49 / USD 0.01-0.30. Sub-minor Nano
protocol fees are settlement-accounting amounts, not externally submitted
one-time item prices.

For the operational statement APIs, CSV export, buyer past-due blocks, and the
field-by-field meaning of `scheduled_debit_at`, `not_before_attempt_at`,
`execution_status`, and `buyer_period_ref`, see
[Micro / Nano Statements and Notices](./metered-statements.md).

USD plan prices are set as separate public price points. The JPY 10,000 and USD
100.00 Micro / Nano early-settlement thresholds are fixed market thresholds,
not FX conversions of one another.

If no paid plan is selected during merchant setup, the merchant account uses the
Launch plan. A merchant billing mandate is still required before accepting
payments so Siglume can collect the monthly base fee automatically.

All SDRP payment fees are seller-borne. Standard Payment fees are deducted at
settlement, so the merchant receives the net amount for each Standard payment.
Micro / Nano protocol fees are deducted from provider receivable at aggregated
settlement, are reported as `protocol_fee_minor`, and are not added to the buyer
debit. Monthly base fees are collected separately through the merchant billing
mandate.

The same Standard Payment percentage schedule applies in JPY and USD. For
Standard Payment, the Siglume platform returns `fee_bps` in the merchant's
settlement currency on the payment requirement, so the SDK never has to know
which currency table to read — it just trusts the value Siglume returns. For
Micro / Nano, the authoritative fee fields are the statement API amounts:
`protocol_fee_minor`, `gross_buyer_debit_minor`, `buyer_debit_minor`, and
`rounding_delta_minor`.

## Settlement schedule

Standard Payment, Micro Payment, and Nano Payment differ mainly in *when* a
confirmed payment turns into money in your settlement wallet.

| Band | Cadence | Period | You are paid |
| --- | --- | --- | --- |
| Standard Payment | Per payment | n/a | On-chain, immediately after each payment confirms |
| Micro Payment | Weekly, with early threshold settlement | Account-assigned fixed weekly slot in the buyer settlement timezone; the assigned close time is visible through the statement APIs. If the same buyer / provider / token / pricing band reaches JPY 10,000 or USD 100.00 first, Siglume can close that batch early. | After the period closes or the fixed amount threshold is reached, and the roughly 3-day pre-debit notice window has elapsed, in aggregated on-chain settlement(s) grouped per buyer, provider, token, pricing band, and period |
| Nano Payment | Monthly, with early threshold settlement | Account-assigned fixed monthly slot in the buyer settlement timezone; the assigned close time is visible through the statement APIs. If the same buyer / provider / token / pricing band reaches JPY 10,000 or USD 100.00 first, Siglume can close that batch early. | After the period closes or the fixed amount threshold is reached, and the roughly 3-day pre-debit notice window has elapsed, in aggregated on-chain settlement(s) grouped per buyer, provider, token, pricing band, and period |

### Micro weekly settlement

- **Closing period.** Micro-band payments accrue across one weekly period. The
  specific closing weekday and time are assigned as a fixed slot per account to
  spread settlement load.
- **Early threshold settlement.** If the same buyer / provider / token /
  pricing band reaches JPY 10,000 or USD 100.00 before the weekly close,
  Siglume can close that batch early and start the same final-notice and
  settlement flow. JPY 10,000 and USD 100.00 are market-specific fixed
  thresholds, not FX conversions of one another.
- **Timezone.** Period boundaries are evaluated in the buyer's configured
  settlement timezone, defaulting to UTC. Assigned slots are persisted and are
  not recalculated on the fly.
- **Settlement.** After the week closes or the early threshold is reached,
  Siglume aggregates the Micro
  payments — grouped per buyer, provider, token, pricing band, and period — into on-chain
  settlement(s). Siglume sends the final debit notice first; the on-chain debit
  is not attempted until the scheduled attempt time after an approximately
  3-day pre-debit notice window (`not_before_attempt_at`).
- **Revenue recognition.** A Micro payment is final only once its aggregated
  settlement confirms on-chain. Until then it is accrued, not settled.

### Nano monthly settlement

- **Closing period.** Nano-band payments accrue across one monthly period. The
  specific closing day and time are assigned as a fixed slot per account to
  spread settlement load.
- **Early threshold settlement.** If the same buyer / provider / token /
  pricing band reaches JPY 10,000 or USD 100.00 before the monthly close,
  Siglume can close that batch early and start the same final-notice and
  settlement flow. JPY 10,000 and USD 100.00 are market-specific fixed
  thresholds, not FX conversions of one another.
- **Timezone.** As with Micro, period boundaries use the buyer's configured
  settlement timezone, defaulting to UTC. Assigned slots are persisted and are
  not recalculated on the fly.
- **Settlement.** After the month closes or the early threshold is reached,
  Siglume aggregates the Nano
  payments — grouped per buyer, provider, token, pricing band, and period — into on-chain
  settlement(s). Siglume sends the final debit notice first; the on-chain debit
  is not attempted until the scheduled attempt time after an approximately
  3-day pre-debit notice window (`not_before_attempt_at`).
- **Revenue recognition.** A Nano payment is final only once its aggregated
  settlement confirms on-chain.

### Failures, retries, and carry-over

- Settlement is on-chain, so there are no banking-holiday gaps — periods close on
  the calendar boundary regardless of weekday.
- If a settlement fails because of insufficient balance, insufficient allowance,
  inactive BudgetVault authorization, a per-payout cap, or an on-chain failure,
  the affected batch is treated as past due. Siglume currently retries every 6
  hours for up to 28 automatic attempts. After that, the batch remains past due
  and requires manual resolution before another attempt.
- While the same buyer / provider / token / pricing band has total unsettled
  exposure at or above the fixed threshold, new Micro/Nano usage is paused with the
  machine-readable error `METERED_SETTLEMENT_PAST_DUE`; the provider API is not
  called. Exposure is chargeable provider gross where status is not `settled`,
  `uncollectible`, or `written_off`; it includes open usage,
  `notice_pending`, `notice_delivery_failed`, `ready`, `submitted`,
  `submitted_reconcile_required`, `failed_retryable`, `retrying`, and
  `past_due`. Usage remains paused while settlement failure or `past_due` is
  unresolved.
- Outstanding amounts remain attached to the failed settlement and are retried
  under this policy. They are not settled revenue, and Siglume does not advance,
  guarantee, or insure provider revenue before on-chain settlement succeeds.
- A `past_due` batch remains recorded until operator resolution or requeue, but
  this does not guarantee collection from the buyer or payment to the provider.

### Rejected / no-charge behavior

Micro and Nano run a budget check before the buyer's paid request is fulfilled:

- A buyer's wallet budget reservation is consumed at the **provider gross
  amount** (your usage price, before any provider-borne protocol fee) from
  acceptance until settlement confirms. This
  is a reservation against Siglume spending limits; it does not lock, escrow,
  preserve, or guarantee the buyer's token balance, allowance, BudgetVault
  authorization, or payment source.
- If the buyer's budget, scope, or amount band does not allow a request, it is
  **rejected with no charge**: the request is not fulfilled, no amount is
  accrued, and nothing is added to a settlement. A buyer near their budget
  ceiling can have a request rejected even though earlier requests in the same
  period succeeded.
- Treat Siglume's statement status, `settled_at`, and `chain_receipt_id` as the
  source of truth for Micro / Nano provider revenue. Webhooks are still required
  for fulfillment, but they are not the complete Micro / Nano settlement ledger.

### What is fixed vs platform-managed

The cadence fields are fixed: **Micro is weekly, Nano is monthly**. In both
bands, Siglume can close a buyer / provider / token / pricing-band batch early
once provider gross reaches JPY 10,000 or USD 100.00. These are fixed
market-specific thresholds, not FX conversions of one another. A payment is
final only after its on-chain settlement confirms. Micro and Nano are automatic
amount bands, not customer-selected options. The account-assigned period
boundaries, roughly 3-day pre-debit notice window, and current retry policy above
are platform-managed public behavior as of 2026-06-19. Treat the platform's
statement status, `not_before_attempt_at`, Standard `fee_bps`, and Micro / Nano
statement amount fields as authoritative rather than hard-coding local revenue
recognition.

## Micro / Nano Seller-borne Amounts

Micro / Nano fees are stored internally as decimal minor-unit values so
sub-yen and sub-cent Nano fees are not silently rounded per accepted SDRP Tx.
The buyer is charged only the provider-visible usage amount; the protocol fee is
not added to the buyer debit:

```text
provider_gross_amount_minor = sum(provider price minor units for accepted metered rows)
provider_usage_amount_minor = provider_gross_amount_minor   # legacy alias
gross_buyer_debit_minor = provider_gross_amount_minor       # legacy alias
buyer_debit_minor = provider_gross_amount_minor
protocol_fee_minor = sum(Micro/Nano fixed protocol fee minor units for accepted metered rows)
provider_receivable_minor = provider_gross_amount_minor - protocol_fee_minor
rounding_delta_minor = 0 for buyer/provider accounting
```

Example: a JPY 100 Micro usage event has buyer debit JPY 100, protocol fee JPY
2, and provider receivable JPY 98.

The `rounding_delta_minor` field is retained in some schemas for compatibility.
It is not added to `buyer_debit_minor`, not added to
`provider_gross_amount_minor`, and not deducted again from
`provider_receivable_minor`. If non-zero in a historical or internal record,
treat it as a Siglume platform accounting adjustment, not buyer debit or
provider revenue. JavaScript integrations should not sum Micro / Nano minor
amounts with `number`; use a decimal library. Python integrations should use
`Decimal`.

## Statement APIs and Notices

Micro and Nano require operational reconciliation after usage is accepted. The
payment requirement response tells you the immediate payment requirement state,
but it does not replace the Micro / Nano statement APIs.

Use [Micro / Nano Statements and Notices](./metered-statements.md) to integrate:

- provider summary of open, settled, unsettled, past-due, and terminal
  `uncollectible` / `written_off` revenue buckets,
- provider usage-event CSV export,
- buyer summaries for open-period estimated debit and past-due blocks,
- sanitized public failure reasons and support references,
- the fixed final notice plus close-plus-3-day debit window.

Reusing the same Micro / Nano execution idempotency key with a different input
payload fails closed before provider execution with
`IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD` and HTTP status `409`.

## SDK Behavior

The SDK does not calculate merchant invoices or enforce plan limits locally.
Instead, it exposes billing-related values returned by Siglume, including
Standard Payment `fee_bps` on a payment requirement and Micro / Nano statement
amount fields. This keeps merchant billing centralized in the Siglume platform
and avoids stale client-side pricing logic.

## Supported Use Cases

The trial pricing is intended for:

- Small EC checkout
- Booking and reservation services
- Membership services
- Paid API access
- Scheduled autopay for external merchant workflows

## Compatibility note

The Siglume API and merchant registry may still expose the legacy `billing_plan`
value `free` for the Launch tier. Treat `free` as a wire-compatibility key, not a
public plan name. (Until 2026-06-12 the Launch plan included a free monthly
allowance of 100 payments; that allowance has been retired — the platform
Standard `fee_bps` response and Micro / Nano statement amount fields are always
the source of truth.)
