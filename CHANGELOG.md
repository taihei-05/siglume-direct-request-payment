# Changelog

## 0.2.0 - 2026-06-12

Merchant self-service setup release.

- Added TypeScript `DirectRequestPaymentMerchantClient` and Python
  `DirectRequestPaymentMerchantClient`.
- Added `setupCheckout` / `setup_checkout` to claim a merchant key, prepare a
  billing mandate, and create a webhook subscription from the SDK.
- Added challenge secret rotation, merchant status lookup, billing mandate
  preparation, and webhook subscription helpers.
- Updated docs to remove manual onboarding assumptions and clarify merchant JWT
  vs buyer JWT responsibilities.

## 0.1.0 - 2026-06-11

Initial public release.

- Published TypeScript/JavaScript SDK as `@siglume/direct-request-payment`.
- Published Python SDK as `siglume-direct-request-payment`.
- Added merchant challenge helpers, buyer-authenticated Direct Request Payment
  client methods, prepared transaction payload helpers, and webhook signature
  verification helpers.
- Documented Launch, Starter, Growth, and Pro trial pricing.
- Documented the distinction from `@siglume/api-sdk` and Developer Portal
  `cli_` API keys.
