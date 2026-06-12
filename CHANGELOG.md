# Changelog

## Unreleased

- Docs: scheduled autopay (`cadence: "daily"`) is documented as an approval
  tag, not a once-per-day run limit. Siglume no longer caps scheduled autopay
  at one charge per day; occurrences are bounded by the buyer's per-run,
  daily, and monthly auto-pay budget plus the authorization's `max_runs` /
  expiry. No code or wire-format changes — challenges signed by 0.3.0 verify
  unchanged.

## 0.3.0 - 2026-06-12

Recurring payment approval release.

- Added recurring (subscription / scheduled autopay) merchant approval helpers
  in TypeScript (`createDirectRequestPaymentRecurringChallenge`,
  `createDirectRequestPaymentRecurringChallengeSignature`,
  `verifyDirectRequestPaymentRecurringChallenge`) and Python
  (`create_direct_request_payment_recurring_challenge`,
  `create_direct_request_payment_recurring_challenge_signature`,
  `verify_direct_request_payment_recurring_challenge`).
- Recurring approvals use a new single-use challenge scheme
  (`siglume-external-402-recurring-v1`) with the cadence (`monthly` for
  subscriptions, `daily` for scheduled autopay) bound into the HMAC, so
  one-time checkout challenges and recurring approvals can never be replayed
  as each other.
- Documented the recurring payment flow (subscription and scheduled autopay)
  in the README.
- Updated pricing docs: the Launch plan's free monthly allowance of 100
  payments is retired — Launch is now a flat 1.8% payment fee; the per-payment
  minimum fee is JPY 30 (USD merchants: USD 0.20); JPY/JPYC and USD/USDC
  settlement are both documented as first-class.

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
