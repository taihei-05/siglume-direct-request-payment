# Standard Hosted Checkout Status And SLA

Status: public operating draft for Standard Hosted Checkout. This is not a
signed customer SLA until referenced by a merchant agreement or published status
page.

## Scope

Applies to Standard Hosted Checkout one-time payments on Polygon PoS for
JPY/JPYC and USD/USDC.

Out of scope: Micro Payment, Nano Payment, subscription, scheduled autopay,
custom settlement wallets, cross-chain payment, and card payments.

## Status Surfaces

- Public status document: this file until a dedicated public status page exists.
- Private support: use the support channel or account contact in your merchant
  agreement for payment investigation.
- Public GitHub issues: documentation and SDK bugs only. Do not post request
  IDs, trace IDs, support references, buyer identifiers, wallet addresses,
  tokens, or transaction-specific data.

GA blocker: a dedicated public status page is not wired in this SDK release.

## SLO Targets

Draft targets for paid Standard Hosted Checkout merchants:

| Area | Target |
| --- | --- |
| Checkout API availability | 99.9% monthly, excluding scheduled maintenance and upstream chain/provider outages |
| Webhook enqueue latency | 95% under 60 seconds after platform confirmation |
| Status/readiness API | 99.9% monthly |
| Incident acknowledgement | Severity 1: 1 hour; Severity 2: 4 business hours; Severity 3: 2 business days |

Free, sandbox, and Beta surfaces do not receive the same commitments unless a
merchant agreement says otherwise.

## Incident Severity

| Severity | Definition | Target response |
| --- | --- | --- |
| Sev 1 | Broad inability to create or settle Standard Hosted Checkout payments, or confirmed double-charge/double-refund risk | Acknowledge within 1 hour, publish/update incident report |
| Sev 2 | Material degradation, delayed webhooks, partial region/account impact, or reconciliation hold | Acknowledge within 4 business hours |
| Sev 3 | Isolated integration issue, documentation defect, or non-urgent support question | Acknowledge within 2 business days |

## Maintenance

Scheduled maintenance should be announced at least 3 business days in advance
when it may affect live checkout, webhook delivery, refund processing, or
reconciliation. Emergency maintenance may be shorter.

## Incident Reports

For Severity 1 and material Severity 2 incidents, publish or privately deliver
an incident report covering:

- timeline
- affected endpoints or merchants
- customer impact
- mitigation
- reconciliation/refund actions
- prevention follow-up

## Refund And Reconciliation Holds

If reconciliation detects a ledger/on-chain/provider payout mismatch, payouts
for the affected merchant or settlement group should be held, an incident record
opened, and operator review required before release.
