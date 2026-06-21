# SDRP API And SDK Stability

Status: public stability policy for the public SDRP protocol/API/SDK surface. It
is not a separate customer agreement.

## Scope

This policy applies to the public Express/FastAPI SDK helpers and HTTP endpoints
for SDRP on Polygon PoS for JPY/JPYC and USD/USDC:

- Standard Hosted Checkout one-time payments
- Micro Payment and Nano Payment amount-banded metered settlement
- subscription approval/creation
- scheduled autopay authorization/execution

Custom settlement wallets, cross-chain payment, card payment, and merchant
refund workflow remain outside this public SDRP SDK/API surface.

## Versioning

- SDK packages use SemVer.
- Additive SDK methods, response fields, endpoints, and webhook fields are
  minor-version changes while the SDK is under `0.x`.
- Security fixes, documentation fixes, and backward-compatible bug fixes are
  patch-version changes.
- Removing a public method, changing a required input, changing a webhook
  meaning, or changing a documented error code is a breaking change.

## API Versioning

The current public endpoints are under `/v1/sdrp/direct-payments/...`.
Backward-compatible fields may be added to responses. Clients must ignore
unknown fields.

Breaking HTTP behavior should be introduced under a new versioned endpoint or a
documented migration period.

## Webhook Compatibility

Signed webhook event names and existing field meanings are compatibility
surfaces. New nullable fields may be added. Existing fields should not be
renamed or repurposed without a migration guide.

Merchants should treat `direct_payment.confirmed` as the durable payment signal
for Standard/Micro/Nano payment acceptance and use statement APIs for Micro/Nano
settlement reconciliation. The SDK does not define refund webhook events.

## Error Code Compatibility

Documented error codes are public contract. Clients may branch on codes such as
`HOSTED_CHECKOUT_READINESS_REQUIRED` and `HOSTED_CHECKOUT_NOT_ENABLED`.

New error codes may be added for new failure modes. Existing codes should not
change meaning during the same major API version.

## Deprecation

Public methods and endpoints should receive at least 90 days of deprecation
notice before removal unless a security issue requires faster action.

If an incorrectly published preview surface implies that SDRP provides a service
outside its responsibility boundary, Siglume may withdraw that preview surface
with a corrective migration notice instead of a 90-day deprecation period. The
notice must identify the affected versions, explain why the surface was outside
SDRP, and describe the current supported integration path. This exception is
for erroneous preview exposure only. Removing a valid public method remains a
breaking change and should use the deprecation period above.

Migration guides should include:

- old behavior
- new behavior
- affected endpoints or SDK methods
- webhook and error-code impact
- test commands

## Security Updates

Critical SDK security fixes should be released as patch updates and called out
in the changelog. Merchants should update promptly and keep webhook signature
verification enabled.
