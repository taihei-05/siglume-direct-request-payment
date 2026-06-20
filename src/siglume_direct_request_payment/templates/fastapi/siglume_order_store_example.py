from __future__ import annotations

from typing import Any

from fastapi import Request

_orders: dict[str, dict[str, Any]] = {
    "order_123": {"id": "order_123", "amount_minor": 1200, "currency": "JPY", "status": "created"}
}
_processed_events: set[str] = set()


class ExampleSiglumeOrderStore:
    async def begin_checkout_attempt(self, order_id: str, request: Request) -> dict[str, Any] | None:
        order = _orders.get(order_id)
        if order is None:
            return None
        order.setdefault("attempt_id", f"{order['id']}_attempt_1")
        order.setdefault("stable_nonce", f"{order['id']}-attempt_1")
        return {
            **order,
            "order_id": order["id"],
            "attempt_id": order["attempt_id"],
            "stable_nonce": order["stable_nonce"],
        }

    async def mark_checkout_pending(
        self,
        *,
        order_id: str,
        attempt_id: str,
        stable_nonce: str,
        challenge_hash: str,
        checkout_session_id: str,
        checkout_url: str,
    ) -> None:
        order = _orders.get(order_id)
        if not order:
            return
        order["status"] = "pending"
        order["attempt_id"] = attempt_id
        order["stable_nonce"] = stable_nonce
        order["challenge_hash"] = challenge_hash
        order["checkout_session_id"] = checkout_session_id
        order["checkout_url"] = checkout_url

    async def process_webhook_event_once(self, event_id: str, handler) -> str:
        if event_id in _processed_events:
            return "duplicate"
        await handler()
        _processed_events.add(event_id)
        return "processed"

    async def find_order_by_challenge_hash(self, challenge_hash: str) -> dict[str, Any] | None:
        for order in _orders.values():
            if order.get("challenge_hash") == challenge_hash:
                return order
        return None

    async def mark_order_paid_once(self, *, order_id: str, requirement_id: str, chain_receipt_id: str) -> None:
        order = _orders.get(order_id)
        if not order or order.get("status") == "paid":
            return
        order["status"] = "paid"
        order["requirement_id"] = requirement_id
        order["chain_receipt_id"] = chain_receipt_id

    async def mark_order_fulfilled_unsettled_once(self, *, order_id: str, requirement_id: str, pricing_band: str) -> None:
        order = _orders.get(order_id)
        if not order or order.get("status") == "fulfilled_unsettled":
            return
        order["status"] = "fulfilled_unsettled"
        order["requirement_id"] = requirement_id
        order["pricing_band"] = pricing_band

    async def flag_payment_review(self, data: dict[str, Any]) -> None:
        print("payment review required", data)
