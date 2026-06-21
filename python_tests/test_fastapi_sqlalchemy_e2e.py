from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone

import httpx
import pytest
import respx
from fastapi import FastAPI
from sqlalchemy import select, update
from sqlalchemy.orm import sessionmaker

from siglume_direct_request_payment import build_webhook_signature_header
from siglume_direct_request_payment.templates.fastapi.siglume_order_store_sqlalchemy import (
    SQLAlchemySiglumeOrderStore,
    checkout_attempts,
    create_sqlalchemy_engine,
    create_sqlalchemy_siglume_schema,
    orders,
    seed_sqlalchemy_order,
    webhook_events,
)
from siglume_direct_request_payment.templates.fastapi.siglume_sdrp_routes import create_siglume_sdrp_router


def _envelope(data: object) -> dict[str, object]:
    return {"data": data, "meta": {"request_id": "req_e2e", "trace_id": "trc_e2e"}}


def _standard_event(event_id: str, challenge_hash: str) -> dict[str, object]:
    return {
        "id": event_id,
        "type": "direct_payment.confirmed",
        "api_version": "2026-06-20",
        "occurred_at": "2026-06-20T00:00:00Z",
        "data": {
            "mode": "external_402",
            "merchant": "sandbox_merchant",
            "pricing_band": "standard",
            "settlement_cadence": "per_payment",
            "finality": "per_payment_onchain",
            "settlement_status": "settled",
            "requirement_id": f"dpr_{event_id}",
            "challenge_hash": challenge_hash,
            "chain_receipt_id": f"chain_{event_id}",
        },
    }


async def _post_webhook(client: httpx.AsyncClient, event: dict[str, object]) -> httpx.Response:
    raw = json.dumps(event, separators=(",", ":"))
    signature = build_webhook_signature_header("whsec_test", raw)
    return await client.post(
        "/payments/webhooks/siglume",
        content=raw,
        headers={"content-type": "application/json", "siglume-signature": signature},
    )


@pytest.mark.asyncio
@respx.mock
async def test_fastapi_sqlalchemy_template_e2e(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("SIGLUME_DIRECT_PAYMENT_MERCHANT", "sandbox_merchant")
    monkeypatch.setenv("SIGLUME_MERCHANT_AUTH_TOKEN", "merchant_jwt")
    monkeypatch.setenv("SIGLUME_WEBHOOK_SECRET", "whsec_test")
    monkeypatch.setenv("SHOP_PUBLIC_ORIGIN", "https://shop.example.com")

    engine = create_sqlalchemy_engine(f"sqlite:///{tmp_path / 'sdrp.sqlite3'}")
    create_sqlalchemy_siglume_schema(engine, include_orders_table=True)
    SessionLocal = sessionmaker(engine, future=True)
    with SessionLocal.begin() as session:
        seed_sqlalchemy_order(session, order_id="order_123", amount_minor=1200, currency="JPY")
        seed_sqlalchemy_order(session, order_id="order_retry", amount_minor=1300, currency="JPY")
        seed_sqlalchemy_order(session, order_id="order_micro", amount_minor=100, currency="JPY")
        seed_sqlalchemy_order(session, order_id="order_expiring", amount_minor=1400, currency="JPY")

    async def authorize_order(order: dict[str, object], request) -> bool:
        await asyncio.sleep(0)
        return request.headers.get("authorization") == "Bearer user_sync" and str(order["id"]).startswith("order_")

    store = SQLAlchemySiglumeOrderStore(SessionLocal, authorize_order=authorize_order)
    app = FastAPI()
    app.include_router(create_siglume_sdrp_router(store, allow_metered_payments=False), prefix="/payments")

    challenge_by_order: dict[str, str] = {}
    checkout_calls: list[dict[str, object]] = []

    def _checkout_session(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content.decode("utf-8"))
        checkout_calls.append(body)
        session_id = f"chk_py_{len(checkout_calls)}"
        challenge_hash = f"sha256:{body['nonce']}"
        metadata = body.get("metadata") if isinstance(body.get("metadata"), dict) else {}
        if isinstance(metadata.get("order_id"), str):
            challenge_by_order[metadata["order_id"]] = challenge_hash
        return httpx.Response(
            201,
            json=_envelope({
                "checkout_url": f"https://siglume.test/pay/{session_id}",
                "session_id": session_id,
                "challenge_hash": challenge_hash,
                "status": "open",
                "expires_at": "2099-01-01T00:00:00Z",
            }),
        )

    respx.post("https://siglume.com/v1/sdrp/direct-payments/checkout-sessions").mock(side_effect=_checkout_session)

    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        unauthenticated = await client.post("/payments/checkout/siglume/start", json={"order_id": "order_123"})
        assert unauthenticated.status_code == 404

        first_start = await client.post(
            "/payments/checkout/siglume/start",
            json={"order_id": "order_123"},
            headers={"authorization": "Bearer user_sync"},
        )
        assert first_start.status_code == 200
        assert first_start.json()["checkout_url"] == "https://siglume.test/pay/chk_py_1"

        replay_start = await client.post(
            "/payments/checkout/siglume/start",
            json={"order_id": "order_123"},
            headers={"authorization": "Bearer user_sync"},
        )
        assert replay_start.status_code == 200
        assert replay_start.json() == first_start.json()
        assert len(checkout_calls) == 1

        paid = await _post_webhook(client, _standard_event("evt_paid_py", challenge_by_order["order_123"]))
        assert paid.status_code == 204
        with SessionLocal() as session:
            assert session.execute(select(orders.c.status).where(orders.c.id == "order_123")).scalar_one() == "paid"

        duplicate = await _post_webhook(client, _standard_event("evt_paid_py", challenge_by_order["order_123"]))
        assert duplicate.status_code == 204
        with SessionLocal() as session:
            assert len(session.execute(select(webhook_events).where(webhook_events.c.event_id == "evt_paid_py")).all()) == 1

        retry_start = await client.post(
            "/payments/checkout/siglume/start",
            json={"order_id": "order_retry"},
            headers={"authorization": "Bearer user_sync"},
        )
        assert retry_start.status_code == 200
        fail_once = True
        real_mark_paid = store.mark_order_paid_once

        async def _fail_once(*, order_id: str, requirement_id: str, chain_receipt_id: str) -> None:
            nonlocal fail_once
            if order_id == "order_retry" and fail_once:
                fail_once = False
                raise RuntimeError("simulated database outage")
            await real_mark_paid(
                order_id=order_id,
                requirement_id=requirement_id,
                chain_receipt_id=chain_receipt_id,
            )

        store.mark_order_paid_once = _fail_once  # type: ignore[method-assign]
        retry_event = _standard_event("evt_retry_py", challenge_by_order["order_retry"])
        failed_delivery = await _post_webhook(client, retry_event)
        assert failed_delivery.status_code == 500
        with SessionLocal() as session:
            assert len(session.execute(select(webhook_events).where(webhook_events.c.event_id == "evt_retry_py")).all()) == 0

        retried_delivery = await _post_webhook(client, retry_event)
        assert retried_delivery.status_code == 204
        with SessionLocal() as session:
            assert session.execute(select(orders.c.status).where(orders.c.id == "order_retry")).scalar_one() == "paid"
            assert len(session.execute(select(webhook_events).where(webhook_events.c.event_id == "evt_retry_py")).all()) == 1

        micro_start = await client.post(
            "/payments/checkout/siglume/start",
            json={"order_id": "order_micro"},
            headers={"authorization": "Bearer user_sync"},
        )
        assert micro_start.status_code == 409
        assert micro_start.json() == {"error": "METERED_INTEGRATION_REQUIRED"}
        assert len(checkout_calls) == 2

        expiring_start = await client.post(
            "/payments/checkout/siglume/start",
            json={"order_id": "order_expiring"},
            headers={"authorization": "Bearer user_sync"},
        )
        assert expiring_start.status_code == 200
        assert expiring_start.json()["session_id"] == "chk_py_3"
        with SessionLocal.begin() as session:
            session.execute(
                update(checkout_attempts)
                .where(checkout_attempts.c.order_id == "order_expiring")
                .where(checkout_attempts.c.status == "pending")
                .values(expires_at=datetime(2000, 1, 1, tzinfo=timezone.utc))
            )
        retry_expired = await client.post(
            "/payments/checkout/siglume/start",
            json={"order_id": "order_expiring"},
            headers={"authorization": "Bearer user_sync"},
        )
        assert retry_expired.status_code == 200
        assert retry_expired.json()["session_id"] == "chk_py_4"
        with SessionLocal() as session:
            rows = session.execute(
                select(checkout_attempts.c.attempt_number, checkout_attempts.c.status)
                .where(checkout_attempts.c.order_id == "order_expiring")
                .order_by(checkout_attempts.c.attempt_number)
            ).all()
            assert rows == [(1, "expired"), (2, "pending")]

    with SessionLocal() as session:
        assert session.execute(
            select(checkout_attempts.c.checkout_session_id).where(checkout_attempts.c.order_id == "order_123")
        ).scalar_one() == "chk_py_1"


@pytest.mark.asyncio
async def test_fastapi_sqlalchemy_fails_closed_without_authorize_order(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("SIGLUME_DIRECT_PAYMENT_MERCHANT", "sandbox_merchant")
    monkeypatch.setenv("SIGLUME_MERCHANT_AUTH_TOKEN", "merchant_jwt")
    monkeypatch.setenv("SIGLUME_WEBHOOK_SECRET", "whsec_test")
    monkeypatch.setenv("SHOP_PUBLIC_ORIGIN", "https://shop.example.com")

    engine = create_sqlalchemy_engine(f"sqlite:///{tmp_path / 'sdrp_auth_required.sqlite3'}")
    create_sqlalchemy_siglume_schema(engine, include_orders_table=True)
    SessionLocal = sessionmaker(engine, future=True)
    with SessionLocal.begin() as session:
        seed_sqlalchemy_order(session, order_id="order_auth_required", amount_minor=1200, currency="JPY")

    store = SQLAlchemySiglumeOrderStore(SessionLocal)
    app = FastAPI()
    app.include_router(create_siglume_sdrp_router(store), prefix="/payments")

    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.post("/payments/checkout/siglume/start", json={"order_id": "order_auth_required"})
        assert response.status_code == 500
        assert response.json()["error"] == "ORDER_AUTHORIZATION_REQUIRED"

    with SessionLocal() as session:
        assert session.execute(
            select(checkout_attempts.c.attempt_id).where(checkout_attempts.c.order_id == "order_auth_required")
        ).all() == []
