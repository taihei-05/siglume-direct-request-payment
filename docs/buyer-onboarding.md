# Buyer Account and Wallet Onboarding

SDRP always requires the buyer to pay from a Siglume account with a Siglume
wallet. The merchant SDK does not create buyer accounts, collect buyer Siglume
credentials, or charge a buyer wallet with a merchant token.

Treat "buyer has no Siglume account yet" as a normal first-use path.

## Human Web Shoppers

For human checkout, the integration contract is simple:

1. Your product authenticates its own user and creates the product order.
2. Your server calls `createCheckoutSession(...)` through the generated route.
3. Your frontend redirects the shopper to the returned `checkout_url`.
4. Siglume handles sign-in or account creation on the hosted page.
5. The shopper approves and pays from their Siglume wallet.
6. Your product fulfills only after the signed `direct_payment.confirmed`
   webhook classifies as `standard_settled`.

Your product should not build its own Siglume signup form or ask for Siglume
secrets. The button copy should make the first-use path explicit, for example:

```text
Pay with Siglume
You will sign in or create a Siglume wallet before approving payment.
```

If the hosted page returns to `cancel_url` because the shopper did not finish
signup, funding, or approval, keep the product order unpaid and let the shopper
retry the same checkout route. The official adapters reuse a still-open checkout
session and create a new attempt only after expiry or failure.

## AI Agent and MCP Buyers

Agent payment is different. An autonomous agent can pay only after it already
has a Siglume authentication context:

- an AI client connects to the Siglume MCP server through OAuth and a consent
  screen, then uses the Siglume marketplace payment tool; or
- a custom product holds the buyer's Siglume bearer token and uses
  `DirectRequestPaymentClient`.

If the agent is not connected to Siglume, fail closed and return an actionable
account-required response to the agent instead of attempting payment with a
merchant token:

The SDK exports the `SIGLUME_ACCOUNT_REQUIRED` constant in TypeScript and
Python so your product can return a stable application-level code without
hand-typing the string. This is a response your product returns before payment;
it is not a Siglume charge attempt.

```json
{
  "error": "SIGLUME_ACCOUNT_REQUIRED",
  "message": "Connect or create a Siglume account before payment.",
  "next_step": "Connect the Siglume MCP server, complete OAuth consent, then retry the payment."
}
```

When the MCP host exposes a Siglume account/onboarding or connection tool, call
that tool before payment and retry only after the OAuth consent flow succeeds.
Do not present that as a completed payment, and do not post the order as paid
until the signed merchant webhook arrives.

The public SDK intentionally does not expose an unattended buyer account
creation API. Account creation must stay user-authorized through Siglume's
hosted authentication or MCP OAuth consent flow.
