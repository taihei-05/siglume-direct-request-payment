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
| Over JPY 500 / over USD 3.00, or whenever immediate finality is required | Standard Payment | Select one Standard plan: Launch, Starter, Growth, or Pro | Launch: JPY 0 / USD 0 monthly, 1.8%; Starter: JPY 980 / USD 6 monthly, 1.0%; Growth: JPY 2,980 / USD 18 monthly, 0.7%; Pro: JPY 9,800 / USD 60 monthly, 0.5%. Minimum JPY 30 / USD 0.20 per payment. | Immediate on-chain split through DirectPaymentHub after payment confirmation |
| JPY 50-500 / about USD 0.30-3.00 | Micro Payment | No selection. Applied automatically by amount. | USD 0.01 / Tx, about JPY 2 | Meter gate before provider execution; weekly delayed settlement |
| Under JPY 1 to JPY 49 / under USD 0.01 to about USD 0.30 | Nano Payment | No selection. Applied automatically by amount. | USD 0.001 / usage, about JPY 0.2 | Meter gate before provider execution; monthly delayed settlement |

For Micro Payment and Nano Payment, the SDRP meter gate runs before provider
execution. Budget or scope failures are recorded as `rejected_no_charge`; the
provider API is not called and no pending provider revenue is created.

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
- Scheduled autopay for external merchant workflows
