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
- merchant-authenticated setup, signed payment webhooks, and payment
  reconciliation/status surfaces

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
- public status/readiness and reconciliation status surfaces
- SDK/API compatibility policy for the public protocol surface

Siglume does not take custody of merchant or buyer funds in Standard Hosted
Checkout, does not become merchant of record, and does not perform merchant
underwriting as a protocol precondition.

## Merchant Responsibilities

The integrating merchant remains responsible for:

- being merchant of record for the goods or services sold
- product legality, fulfillment, buyer support, and order disputes
- refund policy, refund decisions, refund customer support, and any refund
  transfer outside SDRP
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

The public SDRP SDK does not provide a merchant refund API, refund receipt
registry, refund webhook, or refund state machine. Siglume records and exposes
the original payment evidence for Standard Hosted Checkout. If a merchant offers
refunds to its buyers, that policy, support flow, transfer, and accounting are
handled by the merchant outside SDRP under the merchant's own terms and systems.
