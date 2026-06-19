# Troubleshooting

Use this page when an integration fails before, during, or after checkout.
Where a Siglume API response includes `request_id`, `trace_id`, or
`support_reference`, include that value when contacting Siglume support or your
Siglume account contact.

## Hosted Checkout readiness

Hosted Checkout is enabled account by account during beta. Check this before
building a human web checkout:

```bash
npx siglume-check readiness
```

The command validates local configuration, reads the merchant account, and
creates one unpaid expiring checkout session to prove Hosted Checkout is
available for this merchant account.

- The merchant account exists.
- The merchant billing mandate is active.
- The webhook callback URL is HTTPS and reachable.
- The checkout return URL origins are registered through
  `checkout_allowed_origins`.
- The account has Hosted Checkout enabled.

If `createCheckoutSession(...)` or `getCheckoutSession(...)` raises
`HostedCheckoutNotAvailableError`, do not show the raw 404/409 to the buyer.
Stop the human checkout flow and contact Siglume support or your Siglume account
contact for Hosted Checkout enablement.

## API errors

| Status / code | Likely cause | Retry? | Same idempotency key? | Buyer copy | Operator action |
| --- | --- | --- | --- | --- | --- |
| `401` / `403` | Missing token, expired token, wrong account, or insufficient scope. | No, not until credentials are fixed. | n/a | "Payment setup needs attention. Please try later." | Check whether you used a merchant Siglume bearer token for merchant setup and a buyer/provider Siglume bearer token for buyer/provider APIs. Do not use `cli_` keys. |
| `404` / `409` Hosted Checkout rollout | Hosted Checkout is not enabled for this merchant account. | No. | n/a | "This payment method is not available for this store yet." | Contact Siglume for enablement; use agent/API only if that is actually your buyer flow. |
| `409` idempotency conflict | The same idempotency key was reused with different Micro / Nano input. | No. | Do not reuse with different payload. | "This payment attempt could not be completed. Please retry from the order page." | Create a new payment attempt nonce/key for the changed order. |
| `422` validation error | Invalid amount, currency, nonce, URL, origin, or metadata shape. | No, fix input. | n/a | "Payment information is invalid. Please refresh and retry." | Validate server-side amount/currency and registered URL origins. |
| `429` | Rate limit. | Yes, after `Retry-After` when present. | Reuse only for the same logical attempt and same payload. | "Payment is busy. Please retry shortly." | Back off; do not create many new payment attempts. |
| `5xx` or timeout | Temporary Siglume or network failure. | Yes, with bounded exponential backoff. | Reuse for the same logical attempt and same payload. | "Payment is temporarily unavailable. Please retry shortly." | Log request identifiers; avoid fulfilling without a verified webhook. |
| `METERED_SETTLEMENT_PAST_DUE` | Micro / Nano usage is paused because unsettled exposure or a past-due batch remains unresolved for the same buyer / provider / token / pricing band. | No, until settlement succeeds or is resolved. | n/a | "This low-value payment is paused until previous settlement completes." | Check statement APIs and `support_reference`; do not call the provider API. |

## Webhook failures

- Verify the exact raw request body bytes or raw body string.
- Do not verify a parsed JSON object or a re-stringified JSON body.
- Return a 2xx only after you have durably recorded the event or safely decided
  it is duplicate/ignored.
- Store processed webhook event ids or settlement identifiers durably; an
  in-memory set is not enough for production.
- Do not assume delivery order. A settlement batch event may be reconciled from
  statement APIs rather than from one order challenge.
- On signature failure, return a non-2xx status and do not mutate order state.
- On a valid but unknown payment classification, return 2xx only after routing
  it to durable manual review.

## Refunds and adjustments

This SDK release does not expose a self-service refund API. For Standard
Payment refunds or Micro / Nano adjustments, use the explicit Siglume support or
platform process available to your account. Do not reverse settled revenue by
editing local statements or CSV exports.

## Safe buyer messages

Keep buyer-facing messages short and non-diagnostic. Do not expose raw API
errors, wallet internals, RPC URLs, stack traces, webhook secrets, or support
references. Log detailed context server-side with request identifiers.
