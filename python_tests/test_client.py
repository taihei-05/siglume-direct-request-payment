import json

import httpx
import pytest
import respx

from siglume_direct_request_payment import (
    DIRECT_REQUEST_PAYMENT_MODE,
    DirectRequestPaymentClient,
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
