# Payment Lifecycle

This page separates three ideas that are easy to mix up:

- **checkout status**: the shopper's Hosted Checkout session state,
- **merchant fulfillment state**: whether your system can deliver the order,
- **provider revenue state**: whether the provider has settled revenue.

## Standard Payment

```text
checkout open
  -> buyer authenticates
  -> buyer pays
  -> direct_payment.confirmed webhook
  -> classifier kind: standard_settled
  -> merchant marks order paid once
  -> provider revenue is settled
```

For Standard Payment, fulfill only after a signed
`direct_payment.confirmed` webhook verifies and
`classifyDirectPaymentConfirmation(event)` returns `standard_settled`. That
classification requires Standard pricing, per-payment on-chain finality, settled
status, non-empty `requirement_id`, non-empty `challenge_hash`, and non-empty
`chain_receipt_id`.

## Micro / Nano Payment

```text
checkout open or agent/API payment starts
  -> usage accepted
  -> direct_payment.confirmed webhook
  -> classifier kind: metered_usage_accepted
  -> merchant may fulfill as fulfilled_unsettled
  -> open period closes by amount threshold or schedule
  -> final notice window
  -> submitted / retrying / past_due if needed
  -> aggregated on-chain settlement
  -> classifier kind: metered_batch_settled
  -> provider revenue is settled
```

For Micro / Nano, `metered_usage_accepted` means the usage can be fulfilled
under the SDRP delayed settlement model, but provider revenue is not settled
yet. Provider revenue becomes settled only when the settlement batch is settled
on-chain and has a `chain_receipt_id`.

## Field meanings

| Field or state | What it means | What it does not mean |
| --- | --- | --- |
| Hosted Checkout `status: "paid"` | The checkout session accepted the wallet payment flow. | For Micro / Nano, it does not mean provider revenue is settled. |
| `standard_settled` | Standard payment is on-chain settled and can mark an order paid. | It is not used for Micro / Nano accepted usage. |
| `metered_usage_accepted` | Micro / Nano usage is accepted and may be fulfilled as unsettled. | It is not settled provider revenue. |
| `fulfilled_unsettled` | Your merchant system delivered the item before Micro / Nano settlement. | It is not a Siglume settlement status. |
| `metered_batch_settled` | Aggregated Micro / Nano batch settled on-chain. | It does not identify one order by challenge hash. |
| `pending_settlement` | Micro / Nano usage is waiting for aggregated settlement. | It is not a failure by itself. |
| `past_due` | Settlement failed or remains unresolved after retry state. | It is not collected revenue. |
| `uncollectible` / `written_off` | Operator terminal resolution after past-due review. | It is not settled, unsettled, or past-due revenue. |

## Fulfillment rules

- Use the webhook raw body and `Siglume-Signature`; do not verify a
  re-stringified JSON object.
- Store `challenge_hash` on the order before redirecting the buyer.
- For Standard, mark paid only from `standard_settled`.
- For Micro / Nano, use a separate local state such as
  `fulfilled_unsettled`; reconcile final revenue from statement APIs and batch
  settlement events.
- Treat `unknown` classifications as manual review. Do not mark paid or
  fulfilled from the event name alone.

## Revenue rules

- Standard revenue is settled when the payment confirms on-chain.
- Micro / Nano buyer debit is seller-borne-fee safe:
  `buyer_debit_minor = provider_gross_amount_minor`.
- Micro / Nano provider receivable is
  `provider_gross_amount_minor - protocol_fee_minor`.
- Micro / Nano revenue is settled only after the aggregated batch is settled
  on-chain.
- If `total_unsettled_exposure_minor` for the same buyer / provider / token /
  pricing band is at or above the fixed threshold, new Micro / Nano usage is
  paused until settlement succeeds or an operator resolves the state.
