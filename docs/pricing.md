# Pricing

This page documents the trial-phase merchant pricing for Siglume Direct Request
Payment as of 2026-06-18. Pricing can change by agreement or future product
release; the Siglume platform response is the source of truth for per-payment
fee data returned at runtime.

Pricing has one structure: a merchant selects the Standard Payment plan during
setup, then Siglume applies the fee for each payment by amount. Micro Payment
and Nano Payment are automatic amount bands, not separate choices.

## Settlement Currencies

Siglume Direct Request Payment launches in the US and Japan, and both settlement
currencies are first-class:

- **JPY**, settled on-chain in **JPYC**
- **USD**, settled on-chain in **USDC**

A merchant settles in a single currency, chosen at onboarding. The settlement fee
percentage (the payment fee column below) is identical in both currencies. Only
the flat amounts — the monthly base fee and the per-payment minimum fee — are
quoted per currency.

## Pricing Table

| Payment amount | Applied automatically | What you select | Fee | Settlement |
| --- | --- | --- | --- | --- |
| Over JPY 500 / over USD 3.00, or whenever immediate finality is required | Standard Payment | Select one Standard plan: Launch, Starter, Growth, or Pro | Launch: JPY 0 / USD 0 monthly, 1.8%; Starter: JPY 980 / USD 6 monthly, 1.0%; Growth: JPY 2,980 / USD 18 monthly, 0.7%; Pro: JPY 9,800 / USD 60 monthly, 0.5%. Minimum JPY 30 / USD 0.20 per payment. | Settled on-chain immediately after the payment confirms |
| JPY 50-500 / about USD 0.30-3.00 | Micro Payment | Applied automatically by amount | USD 0.01 / Tx, about JPY 2 | Aggregated and settled **weekly** (see [Settlement schedule](#settlement-schedule)) |
| Under JPY 1 to JPY 49 / under USD 0.01 to about USD 0.30 | Nano Payment | Applied automatically by amount | USD 0.001 / usage, about JPY 0.2 | Aggregated and settled **monthly** (see [Settlement schedule](#settlement-schedule)) |

Standard Payment settles per payment. Micro Payment and Nano Payment are
aggregated and settled on a fixed weekly / monthly cadence — see
[Settlement schedule](#settlement-schedule) for exactly when each band closes,
when revenue becomes settled, and how rejected requests behave.

USD pricing is the JPY tier converted at roughly 160 JPY/USD and rounded to
clean price points that keep the same 1:3:10 tier ratio.

If no paid plan is selected during merchant setup, the merchant account uses the
Launch plan. A merchant billing mandate is still required before accepting
payments so Siglume can collect the monthly base fee automatically.

Per-payment fees are deducted at settlement, so the merchant receives the net
amount for each payment. Monthly base fees are collected separately through the
merchant billing mandate.

The same fee schedule applies in JPY and USD. The Siglume platform returns
`fee_bps` in the merchant's settlement currency on every payment requirement, so
the SDK never has to know which currency table to read — it just trusts the
value Siglume returns.

## Settlement schedule

Standard Payment, Micro Payment, and Nano Payment differ mainly in *when* a
confirmed payment turns into money in your settlement wallet.

| Band | Cadence | Period | You are paid |
| --- | --- | --- | --- |
| Standard Payment | Per payment | n/a | On-chain, immediately after each payment confirms |
| Micro Payment | Weekly | Buyer settlement timezone Monday 00:00 to the next Monday 00:00; default timezone is UTC | After the week closes, in aggregated on-chain settlement(s) grouped per buyer, payee, token, and period |
| Nano Payment | Monthly | Buyer settlement timezone 1st 00:00 to the 1st of the next month 00:00; default timezone is UTC | After the month closes, in aggregated on-chain settlement(s) grouped per buyer, payee, token, and period |

### Micro weekly settlement

- **Closing period.** Micro-band payments accrue across one calendar week:
  Monday 00:00 to the following Monday 00:00 in the buyer settlement timezone.
- **Timezone.** Period boundaries are evaluated in the buyer's configured
  settlement timezone, defaulting to UTC, so different buyers can close on
  slightly different local boundaries.
- **Settlement.** After the week closes, Siglume aggregates that week's Micro
  payments — grouped per buyer, payee, token, and period — into on-chain
  settlement(s). Aggregation and payment run automatically on the next settlement
  pass after the period closes; there is a short, platform-managed lag between
  the close and the on-chain transaction.
- **Revenue recognition.** A Micro payment is final only once its weekly
  settlement confirms on-chain. Until then it is accrued, not settled.

### Nano monthly settlement

- **Closing period.** Nano-band payments accrue across one calendar month:
  the 1st at 00:00 to the 1st of the next month at 00:00 in the buyer
  settlement timezone.
- **Timezone.** As with Micro, period boundaries use the buyer's configured
  settlement timezone, defaulting to UTC.
- **Settlement.** After the month closes, Siglume aggregates that month's Nano
  payments — grouped per buyer, payee, token, and period — into on-chain
  settlement(s), on the next settlement pass after the period closes.
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

### Rejected / no-charge behavior

Micro and Nano run a budget check before the buyer's paid request is fulfilled:

- A buyer's wallet budget is consumed at the **gross amount** (your price plus
  the protocol fee), held from the moment a request is accepted until its
  settlement confirms.
- If the buyer's budget, scope, or amount band does not allow a request, it is
  **rejected with no charge**: the request is not fulfilled, no amount is
  accrued, and nothing is added to a settlement. A buyer near their budget
  ceiling can have a request rejected even though earlier requests in the same
  period succeeded.
- Treat Siglume's settled status and webhooks as the source of truth for what has
  actually been paid.

### What is fixed vs platform-managed

The cadence is fixed: **Micro settles weekly, Nano settles monthly**, and a
payment is final only after its on-chain settlement confirms. The buyer-timezone
period boundaries and the current retry policy above are the public behavior as
of 2026-06-18. The scheduler lag between a period close and the on-chain
transaction is platform-managed; treat the platform's settlement status and
`fee_bps` response as authoritative rather than hard-coding local revenue
recognition.

## SDK Behavior

The SDK does not calculate merchant invoices or enforce plan limits locally.
Instead, it exposes billing-related values returned by Siglume, including
`fee_bps` on a payment requirement. This keeps merchant billing centralized in
the Siglume platform and avoids stale client-side pricing logic.

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
`fee_bps` response is always the source of truth.)
