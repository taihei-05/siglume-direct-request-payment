import json

import httpx
import pytest
import respx

from siglume_direct_request_payment import (
    DIRECT_REQUEST_PAYMENT_MODE,
    DirectRequestPaymentClient,
    DirectRequestPaymentMerchantClient,
    DirectRequestPaymentError,
    HostedCheckoutNotAvailableError,
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

    with pytest.raises(DirectRequestPaymentError, match="buyer or provider Siglume user bearer token"):
        DirectRequestPaymentClient()


@respx.mock
def test_creates_external_402_payment_requirement() -> None:
    route = respx.post("https://siglume.test/v1/sdrp/direct-payments/requirements").mock(
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


def test_rejects_non_integer_payment_amounts_before_request() -> None:
    with pytest.raises(DirectRequestPaymentError, match="positive safe integer"):
        DirectRequestPaymentClient(auth_token="buyer_jwt").create_payment_requirement(
            merchant="example_merchant",
            amount_minor=1.9,  # type: ignore[arg-type]
            currency="JPY",
            challenge="siglume-external-402-v1:nonce:sig",
        )
    with pytest.raises(DirectRequestPaymentError, match="positive safe integer"):
        DirectRequestPaymentClient(auth_token="buyer_jwt").create_payment_requirement(
            merchant="example_merchant",
            amount_minor=True,  # type: ignore[arg-type]
            currency="JPY",
            challenge="siglume-external-402-v1:nonce:sig",
        )


@respx.mock
def test_named_metered_statement_methods() -> None:
    routes = [
        respx.get("https://siglume.test/v1/sdrp/metered/my-summary?plan_type=micro&token_symbol=JPYC").mock(
            return_value=httpx.Response(
                200,
                json={
                    "data": {
                        "role": "buyer",
                        "open_periods": [],
                        "settlement_batches": [],
                        "past_due_blocks": [],
                    }
                },
            )
        ),
        respx.get(
            "https://siglume.test/v1/sdrp/metered/my-usage-events?"
            "plan_type=micro&token_symbol=JPYC&status=pending_settlement&limit=10"
        ).mock(
            return_value=httpx.Response(
                200,
                json={"data": {"items": [{"metered_usage_id": "mu_1"}], "next_cursor": "cur_2"}},
            )
        ),
        respx.get("https://siglume.test/v1/sdrp/metered/my-usage-events?limit=10&cursor=cur_2").mock(
            return_value=httpx.Response(
                200,
                json={"data": {"items": [{"metered_usage_id": "mu_2"}], "next_cursor": None}},
            )
        ),
        respx.get("https://siglume.test/v1/sdrp/metered/my-settlement-batches?status=ready&limit=5").mock(
            return_value=httpx.Response(
                200,
                json={"data": {"items": [{"settlement_batch_id": "msb_1"}], "next_cursor": None}},
            )
        ),
        respx.get("https://siglume.test/v1/sdrp/metered/provider/settlement-batches?token_symbol=USDC&limit=2&cursor=cur_3").mock(
            return_value=httpx.Response(
                200,
                json={"data": {"items": [{"settlement_batch_id": "msb_2"}], "next_cursor": None}},
            )
        ),
        respx.get(
            "https://siglume.test/v1/sdrp/metered/provider/summary?"
            "plan_type=micro&listing_id=listing_1&capability_key=capability.alpha"
        ).mock(return_value=httpx.Response(200, json={"data": {"role": "provider", "open_periods": [], "periods": []}})),
        respx.get("https://siglume.test/v1/sdrp/metered/provider/settlement-batches?token_symbol=USDC&limit=2").mock(
            return_value=httpx.Response(
                200,
                json={"data": {"items": [{"settlement_batch_id": "msb_1"}], "next_cursor": "cur_3"}},
            )
        ),
        respx.get("https://siglume.test/v1/sdrp/metered/provider/settlement-batches/msb_1?listing_id=listing_1").mock(
            return_value=httpx.Response(200, json={"data": {"settlement_batch_id": "msb_1"}})
        ),
    ]
    client = DirectRequestPaymentClient(auth_token="buyer_or_provider_jwt", base_url="https://siglume.test/v1")

    assert client.get_buyer_metered_summary(plan_type="MICRO", token_symbol="jpyc")["role"] == "buyer"
    buyer_events = client.list_buyer_usage_events(
        plan_type="micro",
        token_symbol="JPYC",
        status="pending_settlement",
        limit=10,
    )
    assert buyer_events == {"items": [{"metered_usage_id": "mu_1"}], "next_cursor": "cur_2"}
    assert client.list_buyer_usage_events(cursor=buyer_events["next_cursor"], limit=10) == {
        "items": [{"metered_usage_id": "mu_2"}],
        "next_cursor": None,
    }
    assert client.list_buyer_settlement_batches(status="ready", limit=5) == {
        "items": [{"settlement_batch_id": "msb_1"}],
        "next_cursor": None,
    }
    assert client.get_provider_metered_summary(
        plan_type="micro",
        listing_id="listing_1",
        capability_key="capability.alpha",
    )["role"] == "provider"
    provider_batches = client.list_provider_settlement_batches(token_symbol="USDC", limit=2)
    assert provider_batches == {
        "items": [{"settlement_batch_id": "msb_1"}],
        "next_cursor": "cur_3",
    }
    assert client.list_provider_settlement_batches(token_symbol="USDC", cursor=provider_batches["next_cursor"], limit=2) == {
        "items": [{"settlement_batch_id": "msb_2"}],
        "next_cursor": None,
    }
    assert client.get_provider_settlement_batch("msb_1", listing_id="listing_1") == {"settlement_batch_id": "msb_1"}
    assert all(route.called for route in routes)


def test_builds_prepared_transaction_payloads() -> None:
    requirement = requirement_payload()

    payment = build_payment_execution_payload(requirement, await_finality=True, metadata={"order_id": "order_123"})
    allowance = build_allowance_execution_payload(requirement)

    assert payment["receipt_kind"] == "sdrp_direct_payment"
    assert payment["reference_id"] == "dpr_test"
    assert payment["metadata"] == {"source": "test", "order_id": "order_123"}
    assert payment["await_finality"] is True
    assert allowance["receipt_kind"] == "sdrp_direct_payment_allowance"


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
    setup_route = respx.post("https://siglume.test/v1/sdrp/direct-payments/merchants").mock(
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
        "https://siglume.test/v1/sdrp/direct-payments/merchants/example_merchant/billing-mandate"
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


@respx.mock
def test_merchant_client_registers_checkout_allowed_origins() -> None:
    route = respx.post("https://siglume.test/v1/sdrp/direct-payments/merchants").mock(
        return_value=httpx.Response(201, json={"data": {"merchant_account": {"merchant": "shop"}}})
    )
    client = DirectRequestPaymentMerchantClient(auth_token="merchant_jwt", base_url="https://siglume.test/v1")
    client.setup_merchant(
        merchant="Shop",
        checkout_allowed_origins=[
            "https://Shop.Example.com",
            "https://shop.example.com",
            "https://other.example.com:8443",
            "http://localhost:3000",
        ],
    )
    body = json.loads(route.calls.last.request.content)
    assert body["checkout_allowed_origins"] == [
        "https://shop.example.com",
        "https://other.example.com:8443",
        "http://localhost:3000",
    ]


@respx.mock
def test_merchant_client_creates_and_reads_checkout_session() -> None:
    create_route = respx.post("https://siglume.test/v1/sdrp/direct-payments/checkout-sessions").mock(
        return_value=httpx.Response(
            201,
            json={
                "data": {
                    "checkout_url": "https://siglume.test/pay/chk_abc",
                    "session_id": "chk_abc",
                    "challenge_hash": "sha256:deadbeef",
                    "status": "open",
                    "expires_at": "2026-06-18T01:00:00Z",
                }
            },
        )
    )
    get_route = respx.get("https://siglume.test/v1/sdrp/direct-payments/checkout-sessions/chk_abc").mock(
        return_value=httpx.Response(
            200,
            json={"data": {"session_id": "chk_abc", "status": "paid", "merchant": "shop"}},
        )
    )
    client = DirectRequestPaymentMerchantClient(auth_token="merchant_jwt", base_url="https://siglume.test/v1")

    created = client.create_checkout_session(
        merchant="Shop",
        amount_minor=500,
        currency="jpy",
        nonce="order-1",
        success_url="https://shop.example.com/thanks",
        cancel_url="https://shop.example.com/cart",
        metadata={"order_id": "order-1"},
    )
    assert created["checkout_url"] == "https://siglume.test/pay/chk_abc"
    assert created["session_id"] == "chk_abc"
    assert create_route.calls.last.request.headers["authorization"] == "Bearer merchant_jwt"
    assert json.loads(create_route.calls.last.request.content) == {
        "merchant": "shop",
        "amount_minor": 500,
        "currency": "JPY",
        "nonce": "order-1",
        "success_url": "https://shop.example.com/thanks",
        "cancel_url": "https://shop.example.com/cart",
        "metadata": {"order_id": "order-1"},
    }

    session = client.get_checkout_session("chk_abc")
    assert session["status"] == "paid"
    assert get_route.called


@respx.mock
def test_merchant_client_rejects_non_absolute_origin() -> None:
    client = DirectRequestPaymentMerchantClient(auth_token="merchant_jwt", base_url="https://siglume.test/v1")
    with pytest.raises(DirectRequestPaymentError):
        client.setup_merchant(merchant="shop", checkout_allowed_origins=["not-a-url"])


@respx.mock
def test_merchant_client_rejects_unsafe_origins() -> None:
    client = DirectRequestPaymentMerchantClient(auth_token="merchant_jwt", base_url="https://siglume.test/v1")
    with pytest.raises(DirectRequestPaymentError, match="must use https"):
        client.setup_merchant(merchant="shop", checkout_allowed_origins=["http://shop.example.com"])
    with pytest.raises(DirectRequestPaymentError, match="userinfo"):
        client.setup_merchant(merchant="shop", checkout_allowed_origins=["https://user@shop.example.com"])
    with pytest.raises(DirectRequestPaymentError, match="must use https"):
        client.setup_merchant(merchant="shop", checkout_allowed_origins=["ftp://shop.example.com"])


def test_merchant_client_rejects_checkout_nonce_separator() -> None:
    client = DirectRequestPaymentMerchantClient(auth_token="merchant_jwt", base_url="https://siglume.test/v1")
    with pytest.raises(DirectRequestPaymentError, match="nonce must not contain"):
        client.create_checkout_session(
            merchant="shop",
            amount_minor=500,
            currency="JPY",
            nonce="order:1",
            success_url="https://shop.example.com/thanks",
            cancel_url="https://shop.example.com/cart",
        )


@respx.mock
def test_merchant_client_maps_hosted_checkout_rollout_error() -> None:
    respx.post("https://siglume.test/v1/sdrp/direct-payments/checkout-sessions").mock(
        return_value=httpx.Response(
            409,
            json={
                "error": {
                    "code": "HOSTED_CHECKOUT_NOT_ENABLED",
                    "message": "Hosted Checkout is not enabled for this account yet.",
                }
            },
        )
    )
    client = DirectRequestPaymentMerchantClient(auth_token="merchant_jwt", base_url="https://siglume.test/v1")

    with pytest.raises(HostedCheckoutNotAvailableError) as excinfo:
        client.create_checkout_session(
            merchant="shop",
            amount_minor=500,
            currency="JPY",
            nonce="order-1",
            success_url="https://shop.example.com/thanks",
            cancel_url="https://shop.example.com/cart",
        )

    assert excinfo.value.status == 409
    assert excinfo.value.code == "HOSTED_CHECKOUT_NOT_ENABLED"


@respx.mock
def test_merchant_client_maps_missing_hosted_checkout_route() -> None:
    respx.get("https://siglume.test/v1/sdrp/direct-payments/checkout-sessions/chk_missing_backend").mock(
        return_value=httpx.Response(404, json={"error": {"code": "HTTP_404", "message": "Not Found"}})
    )
    client = DirectRequestPaymentMerchantClient(auth_token="merchant_jwt", base_url="https://siglume.test/v1")

    with pytest.raises(HostedCheckoutNotAvailableError):
        client.get_checkout_session("chk_missing_backend")
