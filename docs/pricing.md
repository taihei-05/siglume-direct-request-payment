# Pricing

This page documents the trial-phase merchant pricing for Siglume Direct Request
Payment as of 2026-06-11. Pricing can change by agreement or future product
release; the Siglume platform response is the source of truth for per-payment
fee data returned at runtime.

## Settlement Currencies

Siglume Direct Request Payment launches in the US and Japan, and both settlement
currencies are first-class:

- **JPY**, settled on-chain in **JPYC**
- **USD**, settled on-chain in **USDC**

A merchant settles in a single currency, chosen at onboarding. The settlement fee
percentage (the payment fee column below) is identical in both currencies. Only
the flat amounts — the monthly base fee and the per-payment minimum fee — are
quoted per currency.

## Trial Plans

| Plan | Monthly fee (JPY) | Monthly fee (USD) | Payment fee | Intended starting point |
| --- | ---: | ---: | ---: | --- |
| Launch | JPY 0 | USD 0 | 1.8% | Proofs of concept and low-volume trials |
| Starter | JPY 980 | USD 6.00 | 1.0% | Early production checkout trials |
| Growth | JPY 2,980 | USD 18.00 | 0.7% | Growing EC, booking, membership, and API services |
| Pro | JPY 9,800 | USD 60.00 | 0.5% | Higher-volume merchant integrations |

Every payment is fee-bearing at the plan rate. The minimum fee is JPY 30
(USD merchants: USD 0.20) per payment. The minimum covers the worst-case
per-payment settlement cost (an on-chain signature plus network gas), so small
payments are never processed at a loss; on larger payments the percentage rate
applies instead.

USD pricing is the JPY tier converted at roughly 160 JPY/USD and rounded to
clean price points that keep the same 1:3:10 tier ratio.

If no paid plan is selected during merchant setup, the merchant account uses the
Launch plan. A merchant billing mandate is still required before accepting
payments so Siglume can collect the monthly base fee automatically.

The current Siglume API and merchant registry may still expose the internal
`billing_plan` value `free` for the Launch tier. Treat `free` as an internal
compatibility key, not the public plan name. (Until 2026-06-12 the Launch plan
included a free monthly allowance of 100 payments; that allowance has been
retired — the platform `fee_bps` response is always the source of truth.)

Per-payment fees are collected during payment settlement through the
DirectPaymentHub split. The merchant receives the net amount after that fee.
Monthly base fees are collected separately through the merchant billing mandate.

The same fee schedule applies in JPY and USD. The Siglume platform returns
`fee_bps` in the merchant's settlement currency on every payment requirement, so
the SDK never has to know which currency table to read — it just trusts the
value Siglume returns.

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
- Agent-to-agent payment experiments
