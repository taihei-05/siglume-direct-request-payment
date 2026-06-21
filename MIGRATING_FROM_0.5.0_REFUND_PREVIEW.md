# Migrating From The Withdrawn 0.5.0 Refund Preview

Status: corrective migration notice for `0.5.0`, `0.5.1`, and `0.5.2`.

The refund SDK surface published in `0.5.0` through `0.5.2` was a preview API
that did not match the SDRP responsibility boundary. It was withdrawn in
`0.5.3`. SDRP is a non-custodial wallet-payment protocol and SDK. It is not a
merchant refund system.

## Affected Preview Surface

The withdrawn preview included TypeScript and Python refund helpers and refund
types. Do not build new integrations against those versions for refunds.

If your code referenced those preview helpers, remove that integration and keep
refund policy, buyer support, refund transfer, and accounting in your merchant
system.

## Current Behavior

Current SDK releases do not provide:

- merchant refund APIs
- refund webhook events
- refund receipt registration
- refund state machines

Use SDRP payment identifiers and signed payment evidence only as reconciliation
inputs for your own order and accounting systems.

## Recommended Actions

1. Upgrade to `0.5.5` or later.
2. Remove calls to withdrawn refund preview helpers.
3. Do not subscribe to refund webhook events from this SDK.
4. Keep merchant refund decisions, transfers, support, and accounting outside
   SDRP.
5. Re-run `npm run docs:check`, `npm test`, and the Python client tests after
   removing preview references.

## Versioning Note

Removing a public method is normally a breaking change. The `0.5.0` through
`0.5.2` refund surface was withdrawn because it incorrectly implied that SDRP
provided a merchant refund workflow. Future removals of valid public methods
should use a minor or major boundary with the deprecation period described in
the stability policy.
