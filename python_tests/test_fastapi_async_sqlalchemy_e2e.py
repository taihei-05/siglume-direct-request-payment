from __future__ import annotations

import asyncio
import json
import time
from datetime import datetime, timezone

import httpx
import pytest
import respx
from fastapi import FastAPI
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import async_sessionmaker

from siglume_direct_request_payment import build_webhook_signature_header
from siglume_direct_request_payment.templates.fastapi.siglume_order_store_sqlalchemy import (
    checkout_attempts,
    orders,
    webhook_events,
)
from siglume_direct_request_payment.templates.fastapi.siglume_order_store_sqlalchemy_async import (
    AsyncSQLAlchemySiglumeOrderStore,
    create_async_sqlalchemy_engine,
    create_async_sqlalchemy_siglume_schema,
    seed_async_sqlalchemy_order,
)
from siglume_direct_request_payment.templates.fastapi.siglume_sdrp_routes import create_siglume_sdrp_router


def _envelope(data: object) -> dict[str, object]:
    return {"data": data, "meta": {"request_id": "req_async_e2e", "trace_id": "trc_async_e2e"}}


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
async def test_fastapi_async_sqlalchemy_adapter_concurrency_and_webhooks(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("SIGLUME_DIRECT_PAYMENT_MERCHANT", "sandbox_merchant")
    monkeypatch.setenv("SIGLUME_MERCHANT_AUTH_TOKEN", "merchant_jwt")
    monkeypatch.setenv("SIGLUME_WEBHOOK_SECRET", "whsec_test")
    monkeypatch.setenv("SHOP_PUBLIC_ORIGIN", "https://shop.example.com")

    engine = create_async_sqlalchemy_engine(f"sqlite+aiosqlite:///{tmp_path / 'sdrp_async.sqlite3'}")
    await create_async_sqlalchemy_siglume_schema(engine, include_orders_table=True)
    SessionLocal = async_sessionmaker(engine, expire_on_commit=False)
    async with SessionLocal.begin() as session:
        await seed_async_sqlalchemy_order(session, order_id="order_async_parallel", amount_minor=1200, currency="JPY")
        await seed_async_sqlalchemy_order(session, order_id="order_async_expiring", amount_minor=1400, currency="JPY")

    store = AsyncSQLAlchemySiglumeOrderStore(SessionLocal)
    app = FastAPI()
    app.include_router(create_siglume_sdrp_router(store, allow_metered_payments=False), prefix="/payments")

    challenge_by_order: dict[str, str] = {}
    checkout_calls: list[dict[str, object]] = []

    def _checkout_session(request: httpx.Request) -> httpx.Response:
        time.sleep(0.2)
        body = json.loads(request.content.decode("utf-8"))
        checkout_calls.append(body)
        session_id = f"chk_async_{len(checkout_calls)}"
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
        starts = await asyncio.gather(*[
            client.post("/payments/checkout/siglume/start", json={"order_id": "order_async_parallel"})
            for _ in range(25)
        ])
        assert {response.status_code for response in starts} == {200}
        assert {response.json()["session_id"] for response in starts} == {"chk_async_1"}
        assert len(checkout_calls) == 1

        paid = await _post_webhook(client, _standard_event("evt_async_paid", challenge_by_order["order_async_parallel"]))
        assert paid.status_code == 204
        duplicate = await _post_webhook(client, _standard_event("evt_async_paid", challenge_by_order["order_async_parallel"]))
        assert duplicate.status_code == 204
        async with SessionLocal() as session:
            assert (
                await session.execute(select(orders.c.status).where(orders.c.id == "order_async_parallel"))
            ).scalar_one() == "paid"
            assert len(
                (
                    await session.execute(select(webhook_events).where(webhook_events.c.event_id == "evt_async_paid"))
                ).all()
            ) == 1

        expiring_start = await client.post("/payments/checkout/siglume/start", json={"order_id": "order_async_expiring"})
        assert expiring_start.status_code == 200
        assert expiring_start.json()["session_id"] == "chk_async_2"
        async with SessionLocal.begin() as session:
            await session.execute(
                update(checkout_attempts)
                .where(checkout_attempts.c.order_id == "order_async_expiring")
                .where(checkout_attempts.c.status == "pending")
                .values(expires_at=datetime(2000, 1, 1, tzinfo=timezone.utc))
            )
        retry_expired = await client.post("/payments/checkout/siglume/start", json={"order_id": "order_async_expiring"})
        assert retry_expired.status_code == 200
        assert retry_expired.json()["session_id"] == "chk_async_3"
        async with SessionLocal() as session:
            rows = (
                await session.execute(
                    select(checkout_attempts.c.attempt_number, checkout_attempts.c.status)
                    .where(checkout_attempts.c.order_id == "order_async_expiring")
                    .order_by(checkout_attempts.c.attempt_number)
                )
            ).all()
            assert rows == [(1, "expired"), (2, "pending")]

    await engine.dispose()
