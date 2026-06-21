# Standard Hosted Checkout Status And SLA

This SDK page summarizes the public status and support surfaces for Standard
Hosted Checkout. The service boundary is governed by the published Siglume Terms
(`https://siglume.com/legal/terms`) and Direct Request Payment developer page
(`https://siglume.com/developers/direct-request-payment`).

## Scope

Applies to Standard Hosted Checkout one-time payments on Polygon PoS for
JPY/JPYC and USD/USDC.

Out of scope: Micro Payment, Nano Payment, subscription, scheduled autopay,
custom settlement wallets, cross-chain payment, and card payments.

## Status Surfaces

- Public status endpoint:
  `GET https://siglume.com/v1/sdrp/direct-payments/status`
- Private support: use the support channel or account contact in your merchant
  account for payment investigation.
- Public GitHub issues: documentation and SDK bugs only. Do not post request
  IDs, trace IDs, support references, buyer identifiers, wallet addresses,
  tokens, or transaction-specific data.

## SLO Targets

Operational targets for Standard Hosted Checkout:

| Area | Target |
| --- | --- |
| Checkout API availability | 99.9% monthly, excluding scheduled maintenance and upstream chain/provider outages |
| Webhook enqueue latency | 95% under 60 seconds after platform confirmation |
| Status/readiness API | 99.9% monthly |
| Incident acknowledgement | Severity 1: 1 hour; Severity 2: 4 business hours; Severity 3: 2 business days |

Free, sandbox, and Beta surfaces do not receive the same operational targets.

## Incident Severity

| Severity | Definition | Target response |
| --- | --- | --- |
| Sev 1 | Broad inability to create or settle Standard Hosted Checkout payments, or confirmed double-charge/double-refund risk | Acknowledge within 1 hour, publish/update incident report |
| Sev 2 | Material degradation, delayed webhooks, partial region/account impact, or reconciliation hold | Acknowledge within 4 business hours |
| Sev 3 | Isolated integration issue, documentation defect, or non-urgent support question | Acknowledge within 2 business days |

## Maintenance

Scheduled maintenance should be announced at least 3 business days in advance
when it may affect live checkout, webhook delivery, merchant refund workflow
records, or reconciliation. Emergency maintenance may be shorter.

## Incident Reports

For Severity 1 and material Severity 2 incidents, publish or privately deliver
an incident report covering:

- timeline
- affected endpoints or merchants
- customer impact
- mitigation
- reconciliation / merchant refund workflow actions
- prevention follow-up

## Refund And Reconciliation Holds

If reconciliation detects a ledger/on-chain/settlement mismatch, affected
settlement or protocol workflow actions should be held, an incident record
opened, and operator review required before release.
