from __future__ import annotations

import os
from typing import Any, Awaitable, Callable, Literal, Protocol

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response
from starlette.concurrency import run_in_threadpool
from siglume_direct_request_payment import (
    DirectRequestPaymentMerchantClient,
    HostedCheckoutNotAvailableError,
    classify_direct_payment_confirmation,
    verify_direct_request_payment_webhook,
)


class SiglumeSdrpOrderStore(Protocol):
    async def begin_checkout_attempt(self, order_id: str, request: Request) -> dict[str, Any] | None: ...
    async def mark_checkout_pending(
        self,
        *,
        order_id: str,
        attempt_id: str,
        stable_nonce: str,
        challenge_hash: str,
        checkout_session_id: str,
        checkout_url: str,
    ) -> None: ...
    async def process_webhook_event_once(
        self,
        event_id: str,
        handler: Callable[[], Awaitable[None]],
    ) -> Literal["processed", "duplicate"]: ...
    async def find_order_by_challenge_hash(self, challenge_hash: str) -> dict[str, Any] | None: ...
    async def mark_order_paid_once(self, *, order_id: str, requirement_id: str, chain_receipt_id: str) -> None: ...
    async def mark_order_fulfilled_unsettled_once(self, *, order_id: str, requirement_id: str, pricing_band: str) -> None: ...
    async def flag_payment_review(self, data: dict[str, Any]) -> None: ...


def create_siglume_sdrp_router(
    order_store: SiglumeSdrpOrderStore,
    *,
    allow_metered_payments: bool = False,
) -> APIRouter:
    router = APIRouter()
    merchant_key = os.environ["SIGLUME_DIRECT_PAYMENT_MERCHANT"]
    shop_origin = os.environ["SHOP_PUBLIC_ORIGIN"]
    merchant = DirectRequestPaymentMerchantClient(
        auth_token=os.environ["SIGLUME_MERCHANT_AUTH_TOKEN"],
    )

    @router.post("/checkout/siglume/start")
    async def start_checkout(request: Request) -> JSONResponse:
        body = await request.json()
        order_id = str(body.get("order_id") or "")
        attempt = await order_store.begin_checkout_attempt(order_id, request)
        if not attempt:
            return JSONResponse({"error": "order_not_found"}, status_code=404)

        if not allow_metered_payments and not _is_standard_checkout_amount(str(attempt["currency"]), int(attempt["amount_minor"])):
            return JSONResponse({"error": "METERED_INTEGRATION_REQUIRED"}, status_code=409)

        if attempt.get("checkout_url") and attempt.get("checkout_session_id"):
            return JSONResponse({
                "checkout_url": attempt["checkout_url"],
                "session_id": attempt["checkout_session_id"],
            })

        try:
            session = await run_in_threadpool(
                lambda: merchant.create_checkout_session(
                    merchant=merchant_key,
                    amount_minor=int(attempt["amount_minor"]),
                    currency=str(attempt["currency"]),
                    nonce=str(attempt["stable_nonce"]),
                    success_url=f"{shop_origin}/checkout/siglume/success",
                    cancel_url=f"{shop_origin}/checkout/siglume/cancel",
                    metadata={"order_id": attempt["order_id"], "attempt_id": attempt["attempt_id"]},
                )
            )
        except HostedCheckoutNotAvailableError:
            return JSONResponse({"error": "hosted_checkout_not_enabled"}, status_code=409)

        await order_store.mark_checkout_pending(
            order_id=str(attempt["order_id"]),
            attempt_id=str(attempt["attempt_id"]),
            stable_nonce=str(attempt["stable_nonce"]),
            challenge_hash=session["challenge_hash"],
            checkout_session_id=session["session_id"],
            checkout_url=session["checkout_url"],
        )
        return JSONResponse({"checkout_url": session["checkout_url"], "session_id": session["session_id"]})

    @router.post("/webhooks/siglume")
    async def siglume_webhook(request: Request) -> Response:
        event = verify_direct_request_payment_webhook(
            os.environ["SIGLUME_WEBHOOK_SECRET"],
            await request.body(),
            request.headers.get("Siglume-Signature", ""),
        )["event"]

        async def handler() -> None:
            await _process_siglume_webhook_event(
                order_store,
                event,
                allow_metered_payments=allow_metered_payments,
            )

        if await order_store.process_webhook_event_once(str(event["id"]), handler) == "duplicate":
            return Response(status_code=204)

        return Response(status_code=204)

    return router


async def _process_siglume_webhook_event(
    order_store: SiglumeSdrpOrderStore,
    event: dict[str, Any],
    *,
    allow_metered_payments: bool,
) -> None:
    if event["type"] != "direct_payment.confirmed":
        return

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
            await order_store.flag_payment_review({
                "reason": "unknown_challenge_hash",
                "requirement_id": confirmation["requirement_id"],
            })
    elif confirmation["kind"] == "metered_usage_accepted":
        if not allow_metered_payments:
            await order_store.flag_payment_review({
                "reason": "metered_integration_required",
                "requirement_id": confirmation["requirement_id"],
                "pricing_band": confirmation["pricing_band"],
            })
            return
        order = await order_store.find_order_by_challenge_hash(confirmation["challenge_hash"])
        if order:
            await order_store.mark_order_fulfilled_unsettled_once(
                order_id=str(order["id"]),
                requirement_id=confirmation["requirement_id"],
                pricing_band=confirmation["pricing_band"],
            )
        else:
            await order_store.flag_payment_review({
                "reason": "unknown_metered_challenge_hash",
                "requirement_id": confirmation["requirement_id"],
            })
    else:
        await order_store.flag_payment_review(dict(confirmation))


def _is_standard_checkout_amount(currency: str, amount_minor: int) -> bool:
    normalized_currency = currency.upper()
    if normalized_currency == "JPY":
        return amount_minor >= 501
    if normalized_currency == "USD":
        return amount_minor >= 301
    return False
