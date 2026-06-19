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


def all_orders() -> list[Order]:
    return list(_orders.values())


def save_order(order: Order) -> None:
    _orders[str(order["id"])] = order


def find_order_by_challenge_hash(challenge_hash: str) -> Order | None:
    for order in _orders.values():
        if order.get("siglume_challenge_hash") == challenge_hash:
            return order
    return None


def mark_webhook_event_processed_once(event_id: str) -> bool:
    if event_id in _processed_webhook_events:
        return False
    _processed_webhook_events.add(event_id)
    return True
