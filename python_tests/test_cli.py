from __future__ import annotations

from argparse import Namespace

import httpx
import respx

from siglume_direct_request_payment._cli import _readiness


def _args(**overrides: object) -> Namespace:
    values = {
        "merchant": "example_merchant",
        "origin": "https://shop.example.com",
        "webhook_url": "https://api.example.com/payments/webhooks/siglume",
        "currency": "JPY",
        "amount_minor": 501,
        "base_url": "https://siglume.test/v1",
        "no_api": False,
        "no_probe": True,
        "json": True,
        "sandbox": False,
    }
    values.update(overrides)
    return Namespace(**values)


def test_readiness_fails_without_webhook_secret(monkeypatch) -> None:
    monkeypatch.setenv("SIGLUME_MERCHANT_AUTH_TOKEN", "merchant_jwt")
    monkeypatch.delenv("SIGLUME_WEBHOOK_SECRET", raising=False)

    assert _readiness(_args(no_api=True)) is False


def test_readiness_sandbox_allows_local_http(monkeypatch) -> None:
    monkeypatch.setenv("SIGLUME_MERCHANT_AUTH_TOKEN", "sandbox_merchant_token")
    monkeypatch.setenv("SIGLUME_WEBHOOK_SECRET", "whsec_sandbox_local")

    assert _readiness(_args(
        no_api=True,
        sandbox=True,
        origin="http://localhost:3000",
        webhook_url="http://localhost:3000/payments/webhooks/siglume",
    )) is True


def test_readiness_live_rejects_local_http(monkeypatch) -> None:
    monkeypatch.setenv("SIGLUME_MERCHANT_AUTH_TOKEN", "merchant_jwt")
    monkeypatch.setenv("SIGLUME_WEBHOOK_SECRET", "whsec_test_hint")

    assert _readiness(_args(
        no_api=True,
        sandbox=False,
        origin="http://localhost:3000",
        webhook_url="http://localhost:3000/payments/webhooks/siglume",
    )) is False


@respx.mock
def test_readiness_fails_past_due_billing_even_with_mandate(monkeypatch) -> None:
    monkeypatch.setenv("SIGLUME_MERCHANT_AUTH_TOKEN", "merchant_jwt")
    monkeypatch.setenv("SIGLUME_WEBHOOK_SECRET", "whsec_test_hint")
    respx.get("https://siglume.test/v1/sdrp/direct-payments/merchants/example_merchant").mock(
        return_value=httpx.Response(
            200,
            json={
                "data": {
                    "merchant_account": {
                        "merchant": "example_merchant",
                        "billing_mandate_id": "mandate_test",
                        "billing_status": "past_due",
                        "status": "active",
                    }
                }
            },
        )
    )

    assert _readiness(_args()) is False


@respx.mock
def test_readiness_fails_when_webhook_callback_does_not_match(monkeypatch) -> None:
    monkeypatch.setenv("SIGLUME_MERCHANT_AUTH_TOKEN", "merchant_jwt")
    monkeypatch.setenv("SIGLUME_WEBHOOK_SECRET", "whsec_test_hint")
    respx.get("https://siglume.test/v1/sdrp/direct-payments/merchants/example_merchant").mock(
        return_value=httpx.Response(
            200,
            json={
                "data": {
                    "merchant_account": {
                        "merchant": "example_merchant",
                        "billing_mandate_id": "mandate_test",
                        "billing_status": "active",
                        "status": "active",
                    }
                }
            },
        )
    )
    respx.get("https://siglume.test/v1/market/webhooks/subscriptions").mock(
        return_value=httpx.Response(
            200,
            json={
                "data": [
                    {
                        "id": "whsub_test",
                        "callback_url": "https://api.example.com/other",
                        "status": "active",
                        "event_types": ["direct_payment.confirmed"],
                        "signing_secret_hint": "hint",
                    }
                ]
            },
        )
    )

    assert _readiness(_args()) is False
