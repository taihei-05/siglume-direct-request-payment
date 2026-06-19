from __future__ import annotations

import os
import time
from typing import Any, Protocol

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response
from siglume_direct_request_payment import (
    DirectRequestPaymentMerchantClient,
    HostedCheckoutNotAvailableError,
    classify_direct_payment_confirmation,
    verify_direct_request_payment_webhook,
)


class SiglumeSdrpOrderStore(Protocol):
    async def get_order_for_checkout(self, order_id: str, request: Request) -> dict[str, Any] | None: ...
    async def mark_checkout_pending(self, *, order_id: str, challenge_hash: str, checkout_session_id: str) -> None: ...
    async def record_webhook_event_once(self, event_id: str) -> bool: ...
    async def find_order_by_challenge_hash(self, challenge_hash: str) -> dict[str, Any] | None: ...
    async def mark_order_paid_once(self, *, order_id: str, requirement_id: str, chain_receipt_id: str) -> None: ...
    async def mark_order_fulfilled_unsettled_once(self, *, order_id: str, requirement_id: str, pricing_band: str) -> None: ...
    async def flag_payment_review(self, data: dict[str, Any]) -> None: ...


def create_siglume_sdrp_router(order_store: SiglumeSdrpOrderStore) -> APIRouter:
    router = APIRouter()
    merchant_key = os.environ["SIGLUME_DIRECT_PAYMENT_MERCHANT"]
    shop_origin = os.environ["SHOP_PUBLIC_ORIGIN"]
    merchant = DirectRequestPaymentMerchantClient(auth_token=os.environ["SIGLUME_MERCHANT_AUTH_TOKEN"])

    @router.post("/checkout/siglume/start")
    async def start_checkout(request: Request) -> JSONResponse:
        body = await request.json()
        order_id = str(body.get("order_id") or "")
        order = await order_store.get_order_for_checkout(order_id, request)
        if not order:
            return JSONResponse({"error": "order_not_found"}, status_code=404)
        try:
            session = merchant.create_checkout_session(
                merchant=merchant_key,
                amount_minor=int(order["amount_minor"]),
                currency=str(order["currency"]),
                nonce=f"{order['id']}-attempt_{int(time.time() * 1000)}",
                success_url=f"{shop_origin}/checkout/siglume/success",
                cancel_url=f"{shop_origin}/checkout/siglume/cancel",
                metadata={"order_id": order["id"]},
            )
        except HostedCheckoutNotAvailableError:
            return JSONResponse({"error": "hosted_checkout_not_enabled"}, status_code=409)
        await order_store.mark_checkout_pending(
            order_id=str(order["id"]),
            challenge_hash=session["challenge_hash"],
            checkout_session_id=session["session_id"],
        )
        return JSONResponse({"checkout_url": session["checkout_url"], "session_id": session["session_id"]})

    @router.post("/webhooks/siglume")
    async def siglume_webhook(request: Request) -> Response:
        event = verify_direct_request_payment_webhook(
            os.environ["SIGLUME_WEBHOOK_SECRET"],
            await request.body(),
            request.headers.get("Siglume-Signature", ""),
        )["event"]
        if not await order_store.record_webhook_event_once(str(event["id"])):
            return Response(status_code=204)
        if event["type"] == "direct_payment.confirmed":
            confirmation = classify_direct_payment_confirmation(event)
            if confirmation["kind"] == "standard_settled":
                order = await order_store.find_order_by_challenge_hash(confirmation["challenge_hash"])
                if order:
                    await order_store.mark_order_paid_once(
                        order_id=str(order["id"]),
                        requirement_id=confirmation["requirement_id"],
                        chain_receipt_id=confirmation["chain_receipt_id"],
                    )
                else:
                    await order_store.flag_payment_review({"reason": "unknown_challenge_hash", "requirement_id": confirmation["requirement_id"]})
            elif confirmation["kind"] == "metered_usage_accepted":
                order = await order_store.find_order_by_challenge_hash(confirmation["challenge_hash"])
                if order:
                    await order_store.mark_order_fulfilled_unsettled_once(
                        order_id=str(order["id"]),
                        requirement_id=confirmation["requirement_id"],
                        pricing_band=confirmation["pricing_band"],
                    )
                else:
                    await order_store.flag_payment_review({"reason": "unknown_metered_challenge_hash", "requirement_id": confirmation["requirement_id"]})
            else:
                await order_store.flag_payment_review(dict(confirmation))
        return Response(status_code=204)

    return router
