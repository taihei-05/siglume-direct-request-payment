import json

import pytest

from siglume_direct_request_payment import (
    SiglumeWebhookPayloadError,
    SiglumeWebhookSignatureError,
    build_webhook_signature_header,
    verify_direct_request_payment_webhook,
    verify_webhook_signature,
)


def test_verifies_signed_direct_payment_confirmed_webhooks() -> None:
    event = {
        "id": "evt_123",
        "type": "direct_payment.confirmed",
        "api_version": "2026-06-11",
        "occurred_at": "2026-06-11T00:00:00Z",
        "data": {
            "mode": "external_402",
            "merchant": "example_merchant",
            "requirement_id": "dpr_test",
            "challenge_hash": "sha256:challenge",
        },
    }
    raw_body = json.dumps(event, separators=(",", ":"))
    header = build_webhook_signature_header("whsec_test", raw_body, timestamp=1800000000)

    verified = verify_direct_request_payment_webhook("whsec_test", raw_body, header, now=1800000000)

    assert verified["verification"]["timestamp"] == 1800000000
    assert verified["event"]["data"]["merchant"] == "example_merchant"


def test_rejects_stale_or_mismatched_webhook_signatures() -> None:
    raw_body = json.dumps(
        {
            "id": "evt_123",
            "type": "direct_payment.confirmed",
            "api_version": "2026-06-11",
            "occurred_at": "2026-06-11T00:00:00Z",
            "data": {"mode": "external_402"},
        },
        separators=(",", ":"),
    )
    header = build_webhook_signature_header("whsec_test", raw_body, timestamp=1800000000)

    with pytest.raises(SiglumeWebhookSignatureError):
        verify_webhook_signature("whsec_test", raw_body, header, now=1800001000)
    with pytest.raises(SiglumeWebhookSignatureError):
        verify_webhook_signature("wrong_secret", raw_body, header, now=1800000000)


def test_accepts_metered_settlement_confirmation_machine_fields() -> None:
    event = {
        "id": "evt_metered",
        "type": "direct_payment.confirmed",
        "api_version": "2026-06-11",
        "occurred_at": "2026-06-11T00:00:00Z",
        "data": {
            "mode": "metered_settlement_batch",
            "requirement_id": "dpr_metered",
            "pricing_band": "micro",
            "settlement_cadence": "weekly",
            "finality": "aggregated_onchain_settlement",
            "protocol_fee_minor": "1.6",
            "settlement_status": "settled",
            "settlement_batch_id": "msb_123",
            "chain_receipt_id": "chain_123",
            "usage_event_digest": "sha256:usage",
            "settled_at": "2026-06-19T00:00:00Z",
        },
    }
    raw_body = json.dumps(event, separators=(",", ":"))
    header = build_webhook_signature_header("whsec_test", raw_body, timestamp=1800000000)

    verified = verify_direct_request_payment_webhook("whsec_test", raw_body, header, now=1800000000)

    assert verified["event"]["data"]["pricing_band"] == "micro"
    assert verified["event"]["data"]["settlement_status"] == "settled"
    assert "challenge_hash" not in verified["event"]["data"]
    assert verified["event"]["data"]["settlement_batch_id"] == "msb_123"
    assert verified["event"]["data"]["chain_receipt_id"] == "chain_123"
    assert verified["event"]["data"]["usage_event_digest"] == "sha256:usage"
    assert verified["event"]["data"]["settled_at"] == "2026-06-19T00:00:00Z"


def test_rejects_direct_payment_events_with_wrong_mode() -> None:
    raw_body = json.dumps(
        {
            "id": "evt_123",
            "type": "direct_payment.confirmed",
            "api_version": "2026-06-11",
            "occurred_at": "2026-06-11T00:00:00Z",
            "data": {"mode": "wrong_mode"},
        },
        separators=(",", ":"),
    )
    header = build_webhook_signature_header("whsec_test", raw_body, timestamp=1800000000)

    with pytest.raises(SiglumeWebhookPayloadError):
        verify_direct_request_payment_webhook("whsec_test", raw_body, header, now=1800000000)
