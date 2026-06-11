# Pricing

This page documents the trial-phase merchant pricing for Siglume Direct Request
Payment as of 2026-06-11. Pricing can change by agreement or future product
release; the Siglume platform response is the source of truth for per-payment
fee data returned at runtime.

## Trial Plans

| Plan | Monthly fee | Payment fee | Intended starting point |
| --- | ---: | ---: | --- |
| Launch | JPY 0 | 0% through 100 payments/month, then 1.8% | Proofs of concept and low-volume trials |
| Starter | JPY 980 | 1.0% | Early production checkout trials |
| Growth | JPY 2,980 | 0.7% | Growing EC, booking, membership, and API services |
| Pro | JPY 9,800 | 0.5% | Higher-volume merchant integrations |

The minimum fee is JPY 3 for each fee-bearing payment, including Launch-plan
payments after the included monthly allowance.

If no paid plan is selected during onboarding, the merchant account uses the
Launch plan. A merchant billing mandate is still required before accepting
payments so Siglume can collect fees automatically after the 100-payment monthly
allowance is exceeded.

The current Siglume API and merchant registry may still expose the internal
`billing_plan` value `free` for the Launch tier. Treat `free` as an internal
compatibility key, not the public plan name.

The 100-payment monthly allowance is not a hard processing cap. Payments after
the allowance can continue when merchant billing is active, and those payments
are fee-bearing at the Launch overage rate.

Per-payment fees are collected during payment settlement through the
DirectPaymentHub split. The merchant receives the net amount after that fee.
Monthly base fees are collected separately through the merchant billing mandate.

The public trial pricing above is JPY-denominated. If a merchant needs USD/USDC
settlement, agree the USD merchant billing terms during onboarding; do not infer
USD monthly or minimum fees from the JPY table.

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
