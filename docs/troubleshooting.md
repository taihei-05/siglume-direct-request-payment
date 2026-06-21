# Troubleshooting

Use this page when an integration fails before, during, or after checkout.
Where a Siglume API response includes `request_id`, `trace_id`, or
`support_reference`, keep that value for private support or your Siglume
account contact. Do not post request IDs, trace IDs, support references, buyer
identifiers, wallet addresses, tokens, or transaction-specific data in public
GitHub issues.

## Hosted Checkout readiness

Standard Hosted Checkout is available when the merchant readiness checks pass.
Use `preflight` before route mounting, then use `verify` after the webhook route
is mounted and your app is running:

```bash
npx siglume-check preflight
npx siglume-check verify --sandbox
npx siglume-check verify
```

Run `verify --sandbox` against the local SDK sandbox first. Then run `verify`
without `--sandbox` against live credentials. `verify` validates local
configuration, reads the merchant account, checks the active billing mandate,
confirms the webhook subscription, checks readiness, creates one unpaid expiring
checkout session, and queues a signed webhook test delivery. `preflight` skips
the delivery probe so it can run before your webhook endpoint exists, but it
still creates the unpaid expiring checkout session to confirm Hosted Checkout
readiness.

- The merchant account exists.
- The merchant billing mandate is active.
- `SIGLUME_WEBHOOK_SECRET` is present and matches the subscription secret hint.
- The webhook callback URL is HTTPS and matches an active subscription.
- The subscription includes `direct_payment.confirmed`.
- The checkout return URL origins are registered through
  `checkout_allowed_origins`.
- Standard Hosted Checkout terms are accepted.
- A sandbox checkout/webhook confirmation is recorded.
- Merchant responsibility attestation and live mode are recorded. The
  responsibility boundary is the published Siglume Terms
  (`https://siglume.com/legal/terms`) and Direct Request Payment developer page
  (`https://siglume.com/developers/direct-request-payment`).
- The signed webhook test delivery reaches the endpoint and returns success.

`--no-api` is only for local config smoke tests. `--no-probe` is a partial API
check and does not report readiness as ready. Prefer `preflight` for the
intentional no-delivery phase.

If sandbox readiness fails, make sure `SIGLUME_ENV=sandbox`,
`SIGLUME_API_BASE=http://127.0.0.1:8787/v1`, `SHOP_PUBLIC_ORIGIN`, and
`SHOP_WEBHOOK_URL` all point to your local product, and that
`siglume-sdrp sandbox --webhook-url ...` is still running.

If `createCheckoutSession(...)` raises `HOSTED_CHECKOUT_READINESS_REQUIRED`,
read the readiness details and complete the missing merchant action before
showing Siglume checkout to buyers. If `createCheckoutSession(...)` or
`getCheckoutSession(...)` raises `HostedCheckoutNotAvailableError`, do not show
the raw 404/409 to the buyer; the platform switch or route is unavailable.

Use these escalation paths:

- Use public GitHub issues for documentation or SDK bugs that do not include
  transaction identifiers or customer data.
- Use your private Siglume support channel or account contact for payment
  investigation, request / trace / support references, buyer identifiers, wallet
  addresses, or transaction-specific data.

Public support/status terms must be taken from your Siglume account agreement
or the published service objectives for your plan. Until those are published
for your account, keep a non-Siglume checkout fallback if your product needs
guaranteed immediate payment-method availability.

## API errors

| Status / code | Likely cause | Retry? | Same idempotency key? | Buyer copy | Operator action |
| --- | --- | --- | --- | --- | --- |
| `401` / `403` | Missing token, expired token, wrong account, or insufficient scope. | No, not until credentials are fixed. | n/a | "Payment setup needs attention. Please try later." | Check whether you used a merchant Siglume bearer token for merchant setup and a buyer/provider Siglume bearer token for buyer/provider APIs. Do not use `cli_` keys. |
| `409` / `HOSTED_CHECKOUT_READINESS_REQUIRED` | Merchant readiness is incomplete. | No. | n/a | "Payment setup needs attention. Please try later." | Read readiness details; complete billing, webhook, terms, sandbox, merchant responsibility attestation, and live-mode checks. |
| `404` / `409` Hosted Checkout unavailable | Hosted Checkout route or platform switch is unavailable. | No. | n/a | "This payment method is not available for this store yet." | Check service-objectives docs or private support; use agent/API only if that is actually your buyer flow. |
| `409` idempotency conflict | The same idempotency key was reused with different Micro / Nano input. | No. | Do not reuse with different payload. | "This payment attempt could not be completed. Please retry from the order page." | Create a new payment attempt nonce/key for the changed order. |
| `422` validation error | Invalid amount, currency, nonce, URL, origin, or metadata shape. | No, fix input. | n/a | "Payment information is invalid. Please refresh and retry." | Validate server-side amount/currency and registered URL origins. |
| `429` | Rate limit. | Yes, after `Retry-After` when present. | Reuse only for the same logical attempt and same payload. | "Payment is busy. Please retry shortly." | Back off; do not create many new payment attempts. |
| `5xx` or timeout | Temporary Siglume or network failure. | Yes, with bounded exponential backoff. | Reuse for the same logical attempt and same payload. | "Payment is temporarily unavailable. Please retry shortly." | Log request identifiers; avoid fulfilling without a verified webhook. |
| `METERED_SETTLEMENT_PAST_DUE` | Micro / Nano usage is paused because unsettled exposure or a past-due batch remains unresolved for the same buyer / provider / token / pricing band. | No, until settlement succeeds or is resolved. | n/a | "This low-value payment is paused until previous settlement completes." | Check statement APIs and `support_reference`; do not call the provider API. |

## Webhook failures

- Verify the exact raw request body bytes or raw body string.
- Do not verify a parsed JSON object or a re-stringified JSON body.
- Return a 2xx only after the order update or durable manual-review write has
  succeeded, or after you safely decided the event is duplicate/ignored.
- Store processed webhook event ids or settlement identifiers durably. Use one
  database transaction with the order update / review write where supported;
  otherwise use an equivalent durable claim, stale-lease recovery, and
  idempotent order-repair pattern such as the official adapters provide. An
  in-memory set is not enough for production.
- Do not assume delivery order. A settlement batch event may be reconciled from
  statement APIs rather than from one order challenge.
- On signature failure, return a non-2xx status and do not mutate order state.
- On a valid but unknown payment classification, return 2xx only after routing
  it to durable manual review.

## Refunds and adjustments

The SDRP SDK does not provide refund endpoints, refund webhooks, or a refund
state machine. If your product offers refunds, handle the buyer policy, support
workflow, transfer, and accounting inside your own merchant system. Use SDRP
payment identifiers and signed payment evidence only as reconciliation inputs.

For Micro / Nano, use statement APIs to separate unsettled, settled, past-due,
and terminal/write-off amounts. Do not reverse settled revenue by editing local
statements or CSV exports; merchant refund or adjustment policy remains outside
SDRP and should be reconciled in the merchant system.

## Safe buyer messages

Keep buyer-facing messages short and non-diagnostic. Do not expose raw API
errors, wallet internals, RPC URLs, stack traces, webhook secrets, or support
references. Log detailed context server-side with request identifiers.
