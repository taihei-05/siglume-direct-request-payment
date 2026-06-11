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


def test_rejects_direct_payment_events_with_wrong_mode() -> None:
    raw_body = json.dumps(
        {
            "id": "evt_123",
            "type": "direct_payment.confirmed",
            "api_version": "2026-06-11",
            "occurred_at": "2026-06-11T00:00:00Z",
            "data": {"mode": "api_store"},
        },
        separators=(",", ":"),
    )
    header = build_webhook_signature_header("whsec_test", raw_body, timestamp=1800000000)

    with pytest.raises(SiglumeWebhookPayloadError):
        verify_direct_request_payment_webhook("whsec_test", raw_body, header, now=1800000000)
