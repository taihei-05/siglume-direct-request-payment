from __future__ import annotations

from typing import Any

Order = dict[str, Any]

_orders: dict[str, Order] = {
    "order_123": {
        "id": "order_123",
        "amount_minor": 1200,
        "currency": "JPY",
        "payment_attempt": 0,
        "siglume_payment_status": "created",
    }
}
_processed_webhook_events: set[str] = set()


def get_order(order_id: str) -> Order | None:
    return _orders.get(order_id)


def begin_checkout_attempt(order_id: str) -> Order | None:
    order = _orders.get(order_id)
    if order is None:
        return None
    if not int(order.get("payment_attempt") or 0):
        order["payment_attempt"] = 1
    return order


def all_orders() -> list[Order]:
    return list(_orders.values())


def save_order(order: Order) -> None:
    _orders[str(order["id"])] = order


def find_order_by_challenge_hash(challenge_hash: str) -> Order | None:
    for order in _orders.values():
        if order.get("siglume_challenge_hash") == challenge_hash:
            return order
    return None


def process_webhook_event_once(event_id: str, handler) -> str:
    if event_id in _processed_webhook_events:
        return "duplicate"
    handler()
    _processed_webhook_events.add(event_id)
    return "processed"
