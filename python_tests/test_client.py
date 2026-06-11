import json

import httpx
import pytest
import respx

from siglume_direct_request_payment import (
    DIRECT_REQUEST_PAYMENT_MODE,
    DirectRequestPaymentClient,
    DirectRequestPaymentMerchantClient,
    DirectRequestPaymentError,
    build_allowance_execution_payload,
    build_payment_execution_payload,
)


def requirement_payload() -> dict:
    return {
        "id": "dpr_test",
        "requirement_id": "dpr_test",
        "direct_payment_requirement_id": "dpr_test",
        "mode": "external_402",
        "buyer_user_id": "usr_buyer",
        "product_listing_id": "listing_123",
        "listing_id": "listing_123",
        "capability_key": "checkout",
        "requirement_hash": "sha256:req",
        "request_hash": "sha256:request",
        "siglume_signature": "sig_test",
        "token_symbol": "JPYC",
        "currency": "JPY",
        "amount_minor": 1000,
        "fee_bps": 180,
        "status": "requires_payment",
        "transaction_request": {"to": "0xhub", "data": "0xpay", "metadata_jsonb": {"source": "test"}},
        "approve_transaction_request": {"to": "0xhub", "data": "0xapprove"},
        "non_custodial": True,
    }


def test_requires_buyer_bearer_token(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SIGLUME_AUTH_TOKEN", raising=False)

    with pytest.raises(DirectRequestPaymentError, match="buyer Siglume bearer token"):
        DirectRequestPaymentClient()


@respx.mock
def test_creates_external_402_payment_requirement() -> None:
    route = respx.post("https://siglume.test/v1/market/api-store/direct-payments/requirements").mock(
        return_value=httpx.Response(200, json={"data": requirement_payload()})
    )
    client = DirectRequestPaymentClient(auth_token="buyer_jwt", base_url="https://siglume.test/v1")

    requirement = client.create_payment_requirement(
        merchant="Example_Merchant",
        amount_minor=1000,
        currency="jpy",
        challenge="siglume-external-402-v1:nonce:sig",
        metadata={"order_id": "order_123"},
    )

    assert requirement["requirement_id"] == "dpr_test"
    assert route.calls.last.request.headers["authorization"] == "Bearer buyer_jwt"
    request_body = json.loads(route.calls.last.request.content)
    assert request_body["mode"] == DIRECT_REQUEST_PAYMENT_MODE
    assert request_body["merchant"] == "example_merchant"


def test_builds_prepared_transaction_payloads() -> None:
    requirement = requirement_payload()

    payment = build_payment_execution_payload(requirement, await_finality=True, metadata={"order_id": "order_123"})
    allowance = build_allowance_execution_payload(requirement)

    assert payment["receipt_kind"] == "api_store_direct_payment"
    assert payment["reference_id"] == "dpr_test"
    assert payment["metadata"] == {"source": "test", "order_id": "order_123"}
    assert payment["await_finality"] is True
    assert allowance["receipt_kind"] == "api_store_direct_payment_allowance"


@respx.mock
def test_merchant_client_sets_up_checkout() -> None:
    merchant_account = {
        "merchant_account_id": "macc_test",
        "merchant": "example_merchant",
        "merchant_user_id": "usr_merchant",
        "billing_plan": "free",
        "billing_currency": "JPY",
        "token_symbol": "JPYC",
        "billing_status": "setup_required",
        "metadata_jsonb": {"self_service": True},
    }
    setup_route = respx.post("https://siglume.test/v1/market/api-store/direct-payments/merchants").mock(
        return_value=httpx.Response(
            201,
            json={
                "data": {
                    "merchant_account": merchant_account,
                    "challenge_secret": "edrp_secret",
                    "challenge_secret_created": True,
                    "created": True,
                    "listing_id": "listing_external_402",
                }
            },
        )
    )
    billing_route = respx.post(
        "https://siglume.test/v1/market/api-store/direct-payments/merchants/example_merchant/billing-mandate"
    ).mock(
        return_value=httpx.Response(
            201,
            json={
                "data": {
                    "merchant_account": {**merchant_account, "billing_mandate_id": "mandate_test"},
                    "mandate": {"mandate_id": "mandate_test", "status": "active"},
                    "created": True,
                }
            },
        )
    )
    webhook_route = respx.post("https://siglume.test/v1/market/webhooks/subscriptions").mock(
        return_value=httpx.Response(
            201,
            json={
                "data": {
                    "id": "whsub_test",
                    "callback_url": "https://merchant.example/webhooks/siglume",
                    "signing_secret": "whsec_test",
                    "status": "active",
                }
            },
        )
    )
    client = DirectRequestPaymentMerchantClient(auth_token="merchant_jwt", base_url="https://siglume.test/v1")

    result = client.setup_checkout(
        merchant="Example_Merchant",
        display_name="Example Merchant",
        billing_plan="launch",
        billing_currency="jpy",
        webhook_callback_url="https://merchant.example/webhooks/siglume",
        max_amount_minor=100000,
    )

    assert setup_route.calls.last.request.headers["authorization"] == "Bearer merchant_jwt"
    assert json.loads(setup_route.calls.last.request.content) == {
        "merchant": "example_merchant",
        "billing_plan": "launch",
        "billing_currency": "JPY",
        "display_name": "Example Merchant",
        "webhook_callback_url": "https://merchant.example/webhooks/siglume",
        "max_amount_minor": 100000,
    }
    assert json.loads(billing_route.calls.last.request.content) == {
        "billing_currency": "JPY",
        "max_amount_minor": 100000,
    }
    assert json.loads(webhook_route.calls.last.request.content) == {
        "callback_url": "https://merchant.example/webhooks/siglume",
        "event_types": ["direct_payment.confirmed", "direct_payment.spent"],
        "description": "example_merchant Direct Request Payment",
        "metadata": {"merchant": "example_merchant", "sdk": "siglume-direct-request-payment"},
    }
    assert result["env"] == {
        "SIGLUME_DIRECT_PAYMENT_MERCHANT": "example_merchant",
        "SIGLUME_DIRECT_PAYMENT_CHALLENGE_SECRET": "edrp_secret",
        "SIGLUME_WEBHOOK_SECRET": "whsec_test",
    }
