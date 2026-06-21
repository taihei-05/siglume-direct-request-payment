# SDRP Standard Hosted Checkout Responsibility Boundary

This SDK page maps the already-published Siglume service boundary to SDK fields
and GA review scope. It does not create a separate merchant agreement.

Source documents:

- Terms of Service: https://siglume.com/legal/terms
- Direct Request Payment developer page:
  https://siglume.com/developers/direct-request-payment

Those public documents define Direct Request Payment as an SDRP payment protocol
where the merchant fixes the order, amount, and currency on its server; the
buyer pays with a Siglume wallet; card payment is not available for Direct
Request Payment; and Direct Request Payment is not stored value, prepaid points,
escrow, a platform balance, or a card fallback.

Standard Hosted Checkout is therefore a non-custodial payment protocol and
hosted wallet checkout interface. It is not a card acquiring service, merchant
of record service, custody service, or merchant underwriting/KYC product.

## GA Review Scope

The Standard Hosted Checkout GA surface is limited to:

- one-time Standard Hosted Checkout payments
- Polygon PoS
- JPY/JPYC and USD/USDC
- Express and FastAPI SDK integrations
- merchant-authenticated setup, signed webhooks, refund workflow records, and
  receipt-based reconciliation surfaces

Micro Payment, Nano Payment, subscription, scheduled autopay, custom settlement
rails, card payment, cross-chain payment, and merchant underwriting/KYC are not
part of this GA surface.

## Siglume Responsibilities

Siglume provides:

- protocol API and SDK behavior
- hosted Siglume wallet checkout UI
- buyer Siglume wallet authentication on the hosted page
- signed payment requirement/session creation
- signed webhook delivery and retry surfaces
- refund workflow records, amount caps, idempotency, audit entries, CSV export,
  and refund receipt verification
- public status/readiness and reconciliation status surfaces
- SDK/API compatibility policy for the public protocol surface

Siglume does not take custody of merchant or buyer funds in Standard Hosted
Checkout, does not become merchant of record, and does not perform merchant
underwriting as a protocol precondition.

## Merchant Responsibilities

The integrating merchant remains responsible for:

- being merchant of record for the goods or services sold
- product legality, fulfillment, buyer support, and order disputes
- refund decisions, refund customer support, and executing any refund transfer
  from the merchant-controlled settlement wallet or another lawful merchant rail
- taxes, accounting treatment, jurisdictional compliance, and prohibited or
  restricted business screening
- webhook endpoint operation, order-state updates, and buyer-facing messaging
- obtaining any business, regulatory, or customer consents required for its own
  service

## Merchant Responsibility Attestation

Live Standard Hosted Checkout requires a merchant responsibility attestation.
This maps the published Terms/developer-page responsibility boundary into an
API readiness receipt. It replaces the older `business_verification_status`
readiness gate for the Standard protocol surface.

Use:

- TypeScript: `merchant_responsibility_attested: true`
- Python: `merchant_responsibility_attested=True`

Optional version field:

- `responsibility_attestation_version:
  "sdrp_standard_hosted_checkout_responsibility_v1"`

The readiness API returns:

- `merchant_responsibility_attested`
- `business_verification_required: false`
- `provider_role`
- `responsibility_boundary`
- `ga_blockers: []` unless an actual platform blocker is present

If a separate merchant agreement, regulated product, or region-specific rollout
requires business verification, that requirement is outside the Standard Hosted
Checkout protocol precondition and must be presented as a separate commercial or
regulatory step.

## Refund Boundary

The refund API is a merchant refund workflow and receipt-tracking API. It
creates idempotent refund records, caps the remaining refundable amount, emits
refund webhooks, writes audit entries, exports CSV rows, and marks a refund
`succeeded` only when a validated refund chain receipt is attached.

It does not, by itself, move buyer or merchant funds. The merchant executes the
refund transfer from its settlement wallet or another lawful merchant refund
rail, then links the resulting receipt for protocol reconciliation.

Do not present `POST /refunds` success as proof that money has returned to the
buyer. Treat `pending` as an open merchant refund workflow and `succeeded` as a
receipt-verified refund state.
