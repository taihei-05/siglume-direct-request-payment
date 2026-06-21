# Public SDRP GA Evidence Map

This document defines the review scope for the public Siglume Direct Request
Payment (SDRP) protocol/API/SDK surface. It is an evidence map, not a merchant
service agreement and not a refund/merchant-of-record process.

## GA Scope

The public SDRP GA surface is:

| Capability | Public surface | Primary evidence |
| --- | --- | --- |
| Standard Hosted Checkout | `DirectRequestPaymentMerchantClient.createCheckoutSession(...)` / `create_checkout_session(...)`, `POST /v1/sdrp/direct-payments/checkout-sessions` | `test_hosted_checkout_self_service_standard_e2e`, `express-template.e2e.test.ts`, `test_fastapi_sqlalchemy_e2e.py`, `test_fastapi_async_sqlalchemy_e2e.py` |
| Micro Payment | amount-banded `createPaymentRequirement(...)` / `create_payment_requirement(...)`, Micro statement APIs | `test_sdrp_metered_plan_classification_boundaries`, `test_metered_success_records_pending_settlement_without_direct_requirement`, `test_metered_micro_statement_amounts_are_seller_borne`, `test_named_metered_statement_methods` |
| Nano Payment | amount-banded `createPaymentRequirement(...)` / `create_payment_requirement(...)`, Nano statement APIs | `test_nano_fractional_yen_usage_records_pending_settlement`, `test_sdrp_metered_plan_classification_boundaries`, `test_named_metered_statement_methods` |
| Subscription | recurring challenge helpers, `createSubscription(...)` / `create_subscription(...)`, `POST /v1/sdrp/direct-payments/subscriptions` | `test_sdk_publish_to_subscription_and_direct_payment_billing_e2e`, `test_creates_buyer_side_subscription_with_recurring_challenge`, `client.test.ts creates buyer-side subscriptions with recurring challenges` |
| Scheduled autopay | recurring challenge helpers, `createScheduledAutoPayAuthorization(...)`, `executeScheduledAutoPay(...)`, `revokeScheduledAutoPayAuthorization(...)` and Python equivalents | `test_scheduled_auto_spend_token_uses_buyer_approved_scope`, `test_scheduled_auto_spend_token_enforces_max_runs_before_requirement`, `test_scheduled_auto_pay_methods_use_schedule_token_for_execute`, `client.test.ts creates, executes, and revokes scheduled autopay...` |

## Non-SDRP Scope

These are intentionally outside the public SDRP GA surface:

- merchant refund API, refund receipt registry, refund webhook, or refund state
  machine
- card payments
- cross-chain payments
- custom settlement wallets or split/multi-wallet charging
- merchant-of-record service, merchant underwriting/KYC, merchant refund policy,
  buyer support, taxes, and merchant internal accounting systems

For refunds, SDRP exposes original payment identifiers and signed payment
evidence. Any refund policy, support workflow, transfer, and accounting are
merchant-owned outside SDRP.

## Review Rule

Reviewers should fail the SDK/API if a listed public SDRP method, endpoint,
webhook classification, statement field, idempotency guard, or responsibility
boundary is broken or undocumented. Reviewers should not require Siglume SDK
features for merchant refund execution, merchant internal accounting, card
acquiring, or merchant-of-record/KYC duties because those are outside the SDRP
service boundary.
