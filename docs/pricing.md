# Pricing

This page documents the trial-phase merchant pricing for Siglume Direct Request
Payment as of 2026-06-18. Pricing can change by agreement or future product
release; the Siglume platform response is the source of truth for per-payment
fee data returned at runtime.

Pricing has one structure: a merchant selects the Standard Payment plan during
setup, then Siglume applies the fee for each payment by amount. Micro Payment
and Nano Payment are automatic amount bands, not separate choices. Merchant
setup and the billing mandate terms assume the merchant accepts Micro / Nano
delayed aggregated settlement whenever they offer amounts in those bands.

## Settlement Currencies

Siglume Direct Request Payment launches in the US and Japan, and both settlement
currencies are first-class:

- **JPY**, settled on-chain in **JPYC**
- **USD**, settled on-chain in **USDC**

A merchant settles in a single currency, chosen at onboarding. The settlement fee
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
| JPY 50-500 / USD 0.31-3.00 | Micro Payment | Applied automatically by amount | USD 0.01 / Tx, about JPY 2 | Aggregated and settled **weekly** (see [Settlement schedule](#settlement-schedule)) |
| JPY 1-49 / USD 0.01-0.30 | Nano Payment | Applied automatically by amount | USD 0.001 / usage, about JPY 0.2 | Aggregated and settled **monthly** (see [Settlement schedule](#settlement-schedule)) |

Standard Payment settles per payment. Micro Payment and Nano Payment are
aggregated and settled in account-assigned weekly / monthly slots - see
[Settlement schedule](#settlement-schedule) for how each band closes, when the
pre-debit notice window elapses, when revenue becomes settled, and how rejected
requests behave.

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

USD pricing is the JPY tier converted at roughly 160 JPY/USD and rounded to
clean price points that keep the same 1:3:10 tier ratio.

If no paid plan is selected during merchant setup, the merchant account uses the
Launch plan. A merchant billing mandate is still required before accepting
payments so Siglume can collect the monthly base fee automatically.

Standard Payment fees are deducted at settlement, so the merchant receives the
net amount for each Standard payment. Micro / Nano protocol fees are different:
they are added to the buyer debit, are reported as `protocol_fee_minor`, and are
not provider revenue. Monthly base fees are collected separately through the
merchant billing mandate.

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
| Micro Payment | Weekly | Account-assigned fixed weekly slot in the buyer settlement timezone; the assigned close time is visible through the statement APIs | After the period closes and the roughly 3-day pre-debit notice window has elapsed, in aggregated on-chain settlement(s) grouped per buyer, payee, token, and period |
| Nano Payment | Monthly | Account-assigned fixed monthly slot in the buyer settlement timezone; the assigned close time is visible through the statement APIs | After the period closes and the roughly 3-day pre-debit notice window has elapsed, in aggregated on-chain settlement(s) grouped per buyer, payee, token, and period |

### Micro weekly settlement

- **Closing period.** Micro-band payments accrue across one weekly period. The
  specific closing weekday and time are assigned as a fixed slot per account to
  spread settlement load.
- **Timezone.** Period boundaries are evaluated in the buyer's configured
  settlement timezone, defaulting to UTC. Assigned slots are persisted and are
  not recalculated on the fly.
- **Settlement.** After the week closes, Siglume aggregates that week's Micro
  payments — grouped per buyer, payee, token, and period — into on-chain
  settlement(s). Siglume sends the final debit notice first; the on-chain debit
  is not attempted until the scheduled attempt time after an approximately
  3-day pre-debit notice window (`not_before_attempt_at`).
- **Revenue recognition.** A Micro payment is final only once its weekly
  settlement confirms on-chain. Until then it is accrued, not settled.

### Nano monthly settlement

- **Closing period.** Nano-band payments accrue across one monthly period. The
  specific closing day and time are assigned as a fixed slot per account to
  spread settlement load.
- **Timezone.** As with Micro, period boundaries use the buyer's configured
  settlement timezone, defaulting to UTC. Assigned slots are persisted and are
  not recalculated on the fly.
- **Settlement.** After the month closes, Siglume aggregates that month's Nano
  payments — grouped per buyer, payee, token, and period — into on-chain
  settlement(s). Siglume sends the final debit notice first; the on-chain debit
  is not attempted until the scheduled attempt time after an approximately
  3-day pre-debit notice window (`not_before_attempt_at`).
- **Revenue recognition.** A Nano payment is final only once its monthly
  settlement confirms on-chain.

### Failures, retries, and carry-over

- Settlement is on-chain, so there are no banking-holiday gaps — periods close on
  the calendar boundary regardless of weekday.
- If a settlement fails because of insufficient balance, insufficient allowance,
  inactive BudgetVault authorization, a per-payout cap, or an on-chain failure,
  the affected batch is treated as past due. Siglume currently retries every 6
  hours for up to 28 automatic attempts. After that, the batch remains past due
  and requires manual resolution before another attempt.
- While a buyer has an unresolved failed Micro/Nano settlement for the same
  payment band and token, new Micro/Nano usage is paused with the machine-readable
  error `METERED_SETTLEMENT_PAST_DUE`; the provider API is not called.
- Outstanding amounts remain attached to the failed settlement and are retried
  under this policy. They are not settled revenue, and Siglume does not advance,
  guarantee, or insure provider revenue before on-chain settlement succeeds.
- A `past_due` batch remains recorded until operator resolution or requeue, but
  this does not guarantee collection from the buyer or payment to the provider.

### Rejected / no-charge behavior

Micro and Nano run a budget check before the buyer's paid request is fulfilled:

- A buyer's wallet budget reservation is consumed at the **gross amount** (your
  price plus the protocol fee) from acceptance until settlement confirms. This
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

The cadence is fixed: **Micro settles weekly, Nano settles monthly**, and a
payment is final only after its on-chain settlement confirms. Micro and Nano are
automatic amount bands, not customer-selected options. The account-assigned
period boundaries, roughly 3-day pre-debit notice window, and current retry policy
above are the public behavior as of 2026-06-18. Treat the platform's statement
status, `not_before_attempt_at`, Standard `fee_bps`, and Micro / Nano statement
amount fields as authoritative rather than hard-coding local revenue
recognition.

## Micro / Nano Amount Rounding

Micro / Nano fees are stored internally as decimal minor-unit values so
sub-yen and sub-cent Nano fees are not silently rounded per usage event. The
current settlement rule is:

```text
provider_usage_amount_minor = sum(provider price minor units for accepted usage)
protocol_fee_minor = sum(Micro/Nano fixed protocol fee minor units for accepted usage)
gross_buyer_debit_minor = provider_usage_amount_minor + protocol_fee_minor
buyer_debit_minor = ceil(gross_buyer_debit_minor)
rounding_delta_minor = buyer_debit_minor - gross_buyer_debit_minor
```

Rounding happens once when the settlement batch is created, not per usage event.
The rounding mode is ceiling to the next integer token minor unit because
on-chain settlement cannot debit fractional JPYC/USDC minor units. The positive
`rounding_delta_minor` is part of the buyer debit for that batch and is retained
as a rounding adjustment in Siglume's settlement accounting; it is not provider
revenue. Providers should reconcile their revenue with
`provider_receivable_minor`, `settled_provider_receivable_minor`,
`unsettled_provider_receivable_minor`, and
`past_due_provider_receivable_minor`, not with `buyer_debit_minor`.

For low-count Nano batches, the integer ceiling can make the effective buyer
burden per usage higher than the headline USD 0.001 / usage protocol fee. The
decimal protocol fee remains visible as `protocol_fee_minor`; the difference
created by integer-token settlement is visible as `rounding_delta_minor` on the
batch. Each settlement batch can add a positive rounding adjustment of less than
1 token minor unit. If a buyer uses many providers / payees in one period, that
adjustment can occur once per settlement batch. JavaScript integrations should
not sum Micro / Nano minor amounts with `number`; use a decimal library. Python
integrations should use `Decimal`.

## Statement APIs and Notices

Micro and Nano require operational reconciliation after usage is accepted. The
payment requirement response tells you the immediate payment requirement state,
but it does not replace the Micro / Nano statement APIs.

Use [Micro / Nano Statements and Notices](./metered-statements.md) to integrate:

- provider summary of open, settled, unsettled, and past-due revenue,
- provider usage-event CSV export,
- buyer summaries for open-period estimated debit and past-due blocks,
- sanitized public failure reasons and support references,
- the fixed final notice plus close-plus-3-day debit window.

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
