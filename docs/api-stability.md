# SDRP API And SDK Stability

Status: public stability policy draft for Standard Hosted Checkout. It is not a
separate customer agreement.

## Scope

This policy applies to the public Express/FastAPI SDK helpers and HTTP endpoints
for Standard Hosted Checkout one-time payments on Polygon PoS for JPY/JPYC and
USD/USDC.

Micro Payment, Nano Payment, subscription, scheduled autopay, and custom
settlement flows remain Beta/out of this scope.

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

Standard Hosted Checkout merchants should treat `direct_payment.confirmed` as
the durable payment signal. The SDK does not define refund webhook events.

## Error Code Compatibility

Documented error codes are public contract. Clients may branch on codes such as
`HOSTED_CHECKOUT_READINESS_REQUIRED` and `HOSTED_CHECKOUT_NOT_ENABLED`.

New error codes may be added for new failure modes. Existing codes should not
change meaning during the same major API version.

## Deprecation

Public methods and endpoints should receive at least 90 days of deprecation
notice before removal unless a security issue requires faster action.

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
