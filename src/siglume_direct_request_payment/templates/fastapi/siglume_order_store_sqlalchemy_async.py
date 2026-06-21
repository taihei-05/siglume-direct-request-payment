from __future__ import annotations

import asyncio
import contextvars
import hashlib
import inspect
import json
import time
from collections.abc import Callable
from datetime import timedelta
from typing import Any, Awaitable, Literal

from fastapi import Request
from sqlalchemy import insert, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.sql import func

from .siglume_order_store_sqlalchemy import (
    CHECKOUT_CREATION_LEASE_SECONDS,
    CHECKOUT_CREATION_POLL_SECONDS,
    CHECKOUT_CREATION_WAIT_SECONDS,
    checkout_attempts,
    metadata,
    orders,
    payment_reviews,
    webhook_events,
)


_current_async_session: contextvars.ContextVar[AsyncSession | None] = contextvars.ContextVar(
    "siglume_sdrp_async_sqlalchemy_session",
    default=None,
)


def create_async_sqlalchemy_engine(database_url: str) -> AsyncEngine:
    return create_async_engine(database_url, future=True)


async def create_async_sqlalchemy_siglume_schema(engine: AsyncEngine, *, include_orders_table: bool = False) -> None:
    tables = [checkout_attempts, webhook_events, payment_reviews]
    if include_orders_table:
        tables.insert(0, orders)
    async with engine.begin() as connection:
        await connection.run_sync(lambda sync_connection: metadata.create_all(sync_connection, tables=tables))


async def seed_async_sqlalchemy_order(
    session: AsyncSession,
    *,
    order_id: str,
    amount_minor: int,
    currency: str,
    status: str = "created",
) -> None:
    await session.execute(
        insert(orders).values(
            id=order_id,
            amount_minor=amount_minor,
            currency=currency.upper(),
            status=status,
        )
    )


class AsyncSQLAlchemySiglumeOrderStore:
    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession],
        *,
        orders_table: Any = orders,
        order_id_column: str = "id",
        amount_minor_column: str = "amount_minor",
        currency_column: str = "currency",
        order_status_column: str | None = "status",
        order_updated_at_column: str | None = "updated_at",
        authorize_order: Callable[[dict[str, Any], Request], bool | Awaitable[bool]] | None = None,
    ) -> None:
        self._session_factory = session_factory
        self._orders_table = orders_table
        self._order_id_column = orders_table.c[order_id_column]
        self._amount_minor_column = orders_table.c[amount_minor_column]
        self._currency_column = orders_table.c[currency_column]
        self._order_status_column = orders_table.c[order_status_column] if order_status_column else None
        self._order_updated_at_column = orders_table.c[order_updated_at_column] if order_updated_at_column else None
        self._authorize_order = authorize_order

    async def begin_checkout_attempt(self, order_id: str, request: Request) -> dict[str, Any] | None:
        clean_order_id = _require_text(order_id, "order_id")
        wait_until = time.monotonic() + CHECKOUT_CREATION_WAIT_SECONDS

        while True:
            wait_attempt: dict[str, Any] | None = None
            try:
                async with self._session_factory.begin() as session:
                    order = (
                        await session.execute(
                            select(self._orders_table).where(self._order_id_column == clean_order_id)
                        )
                    ).mappings().first()
                    if order is None:
                        return None
                    order_dict = self._canonical_order_dict(order)
                    if self._authorize_order and not await _resolve_authorize_order(self._authorize_order(order_dict, request)):
                        return None

                    active = (
                        await session.execute(
                            select(checkout_attempts).where(checkout_attempts.c.active_key == clean_order_id)
                        )
                    ).mappings().first()
                    if active is not None:
                        state = dict(active)
                        if _is_reusable_checkout_attempt(state):
                            return _checkout_attempt_dict(order_dict, state)
                        if state.get("status") == "creating" and not _timestamp_has_passed(state.get("creation_lease_expires_at")):
                            wait_attempt = _checkout_attempt_dict(order_dict, state)
                            wait_attempt["checkout_creation_pending"] = True
                        else:
                            status = "expired" if state.get("status") == "pending" else "failed"
                            await session.execute(
                                update(checkout_attempts)
                                .where(checkout_attempts.c.attempt_id == state["attempt_id"])
                                .values(
                                    status=status,
                                    active_key=None,
                                    failed_at=func.now() if status == "failed" else state.get("failed_at"),
                                    creation_owner_id=None,
                                    creation_lease_expires_at=None,
                                    updated_at=func.now(),
                                )
                            )

                    if wait_attempt is None:
                        max_attempt_number = (
                            await session.execute(
                                select(func.max(checkout_attempts.c.attempt_number)).where(
                                    checkout_attempts.c.order_id == clean_order_id
                                )
                            )
                        ).scalar_one_or_none()
                        attempt_number = int(max_attempt_number or 0) + 1
                        attempt_id, stable_nonce = _stable_attempt(clean_order_id, attempt_number)
                        await session.execute(
                            insert(checkout_attempts).values(
                                order_id=clean_order_id,
                                attempt_number=attempt_number,
                                attempt_id=attempt_id,
                                stable_nonce=stable_nonce,
                                active_key=clean_order_id,
                                status="creating",
                                creation_owner_id=f"sdrp_create_{_sha256(f'{time.time()}:{clean_order_id}')[:24]}",
                                creation_lease_expires_at=_now_utc() + timedelta(seconds=CHECKOUT_CREATION_LEASE_SECONDS),
                            )
                        )
                        return {
                            "id": clean_order_id,
                            "order_id": clean_order_id,
                            "amount_minor": int(order_dict["amount_minor"]),
                            "currency": str(order_dict["currency"]),
                            "attempt_number": attempt_number,
                            "attempt_id": attempt_id,
                            "stable_nonce": stable_nonce,
                            "status": "creating",
                        }
            except IntegrityError:
                wait_attempt = None

            if wait_attempt is not None and time.monotonic() >= wait_until:
                return wait_attempt
            await asyncio.sleep(CHECKOUT_CREATION_POLL_SECONDS)

    async def mark_checkout_pending(
        self,
        *,
        order_id: str,
        attempt_id: str,
        stable_nonce: str,
        challenge_hash: str,
        checkout_session_id: str,
        checkout_url: str,
        expires_at: str | None = None,
    ) -> None:
        session = _current_async_session.get()
        if session is not None:
            await self._mark_checkout_pending(
                session,
                order_id=order_id,
                attempt_id=attempt_id,
                stable_nonce=stable_nonce,
                challenge_hash=challenge_hash,
                checkout_session_id=checkout_session_id,
                checkout_url=checkout_url,
                expires_at=expires_at,
            )
            return
        async with self._session_factory.begin() as own_session:
            await self._mark_checkout_pending(
                own_session,
                order_id=order_id,
                attempt_id=attempt_id,
                stable_nonce=stable_nonce,
                challenge_hash=challenge_hash,
                checkout_session_id=checkout_session_id,
                checkout_url=checkout_url,
                expires_at=expires_at,
            )

    async def mark_checkout_failed(
        self,
        *,
        order_id: str,
        attempt_id: str,
        error_message: str | None = None,
    ) -> None:
        session = _current_async_session.get()
        if session is not None:
            await self._mark_checkout_failed(session, order_id=order_id, attempt_id=attempt_id, error_message=error_message)
            return
        async with self._session_factory.begin() as own_session:
            await self._mark_checkout_failed(own_session, order_id=order_id, attempt_id=attempt_id, error_message=error_message)

    async def process_webhook_event_once(
        self,
        event_id: str,
        handler: Callable[[], Awaitable[None]],
    ) -> Literal["processed", "duplicate"]:
        clean_event_id = _require_text(event_id, "event_id")
        async with self._session_factory.begin() as session:
            existing = (
                await session.execute(select(webhook_events.c.event_id).where(webhook_events.c.event_id == clean_event_id))
            ).first()
            if existing is not None:
                return "duplicate"
            try:
                await session.execute(insert(webhook_events).values(event_id=clean_event_id, status="processing"))
            except IntegrityError:
                return "duplicate"

            token = _current_async_session.set(session)
            try:
                await handler()
                await session.execute(
                    update(webhook_events)
                    .where(webhook_events.c.event_id == clean_event_id)
                    .values(status="processed", processed_at=func.now())
                )
                return "processed"
            finally:
                _current_async_session.reset(token)

    async def find_order_by_challenge_hash(self, challenge_hash: str) -> dict[str, Any] | None:
        session = _current_async_session.get()
        if session is not None:
            row = (
                await session.execute(
                    select(checkout_attempts.c.order_id).where(checkout_attempts.c.challenge_hash == challenge_hash)
                )
            ).first()
            return {"id": row[0]} if row else None
        async with self._session_factory() as own_session:
            row = (
                await own_session.execute(
                    select(checkout_attempts.c.order_id).where(checkout_attempts.c.challenge_hash == challenge_hash)
                )
            ).first()
            return {"id": row[0]} if row else None

    async def mark_order_paid_once(self, *, order_id: str, requirement_id: str, chain_receipt_id: str) -> None:
        session = _current_async_session.get()
        if session is not None:
            await self._mark_order_paid_once(session, order_id=order_id, requirement_id=requirement_id, chain_receipt_id=chain_receipt_id)
            return
        async with self._session_factory.begin() as own_session:
            await self._mark_order_paid_once(own_session, order_id=order_id, requirement_id=requirement_id, chain_receipt_id=chain_receipt_id)

    async def mark_order_fulfilled_unsettled_once(self, *, order_id: str, requirement_id: str, pricing_band: str) -> None:
        session = _current_async_session.get()
        if session is not None:
            await self._mark_order_fulfilled_unsettled_once(
                session,
                order_id=order_id,
                requirement_id=requirement_id,
                pricing_band=pricing_band,
            )
            return
        async with self._session_factory.begin() as own_session:
            await self._mark_order_fulfilled_unsettled_once(
                own_session,
                order_id=order_id,
                requirement_id=requirement_id,
                pricing_band=pricing_band,
            )

    async def flag_payment_review(self, data: dict[str, Any]) -> None:
        session = _current_async_session.get()
        if session is not None:
            await self._flag_payment_review(session, data)
            return
        async with self._session_factory.begin() as own_session:
            await self._flag_payment_review(own_session, data)

    async def _mark_checkout_pending(
        self,
        session: AsyncSession,
        *,
        order_id: str,
        attempt_id: str,
        stable_nonce: str,
        challenge_hash: str,
        checkout_session_id: str,
        checkout_url: str,
        expires_at: str | None,
    ) -> None:
        await session.execute(
            update(checkout_attempts)
            .where(checkout_attempts.c.order_id == order_id)
            .where(checkout_attempts.c.attempt_id == attempt_id)
            .where(checkout_attempts.c.status == "creating")
            .values(
                status="pending",
                stable_nonce=stable_nonce,
                challenge_hash=challenge_hash,
                checkout_session_id=checkout_session_id,
                checkout_url=checkout_url,
                expires_at=_parse_datetime(expires_at),
                creation_owner_id=None,
                creation_lease_expires_at=None,
                error_message=None,
                updated_at=func.now(),
            )
        )

    async def _mark_checkout_failed(
        self,
        session: AsyncSession,
        *,
        order_id: str,
        attempt_id: str,
        error_message: str | None,
    ) -> None:
        await session.execute(
            update(checkout_attempts)
            .where(checkout_attempts.c.order_id == order_id)
            .where(checkout_attempts.c.attempt_id == attempt_id)
            .where(checkout_attempts.c.status == "creating")
            .values(
                status="failed",
                active_key=None,
                failed_at=func.now(),
                creation_owner_id=None,
                creation_lease_expires_at=None,
                error_message=(error_message or "checkout session creation failed")[:1000],
                updated_at=func.now(),
            )
        )

    async def _mark_order_paid_once(
        self,
        session: AsyncSession,
        *,
        order_id: str,
        requirement_id: str,
        chain_receipt_id: str,
    ) -> None:
        result = await session.execute(
            update(checkout_attempts)
            .where(checkout_attempts.c.order_id == order_id)
            .where(checkout_attempts.c.status.notin_(["paid", "expired", "cancelled", "failed"]))
            .values(
                status="paid",
                active_key=None,
                requirement_id=requirement_id,
                chain_receipt_id=chain_receipt_id,
                paid_at=func.now(),
                updated_at=func.now(),
            )
        )
        if result.rowcount:
            await self._mark_product_order_status(session, order_id, "paid")

    async def _mark_order_fulfilled_unsettled_once(
        self,
        session: AsyncSession,
        *,
        order_id: str,
        requirement_id: str,
        pricing_band: str,
    ) -> None:
        result = await session.execute(
            update(checkout_attempts)
            .where(checkout_attempts.c.order_id == order_id)
            .where(checkout_attempts.c.status.notin_(["fulfilled_unsettled", "paid", "expired", "cancelled", "failed"]))
            .values(
                status="fulfilled_unsettled",
                active_key=None,
                requirement_id=requirement_id,
                pricing_band=pricing_band,
                fulfilled_unsettled_at=func.now(),
                updated_at=func.now(),
            )
        )
        if result.rowcount:
            await self._mark_product_order_status(session, order_id, "fulfilled_unsettled")

    async def _flag_payment_review(self, session: AsyncSession, data: dict[str, Any]) -> None:
        payload = json.dumps(data, separators=(",", ":"), sort_keys=True)
        await session.execute(
            insert(payment_reviews).values(
                review_id=f"sdrp_review_{_sha256(f'{time.time()}:{payload}')[:24]}",
                order_id=data.get("order_id") if isinstance(data.get("order_id"), str) else None,
                reason=str(data.get("reason") or "manual_review_required"),
                payload_json=payload,
            )
        )

    def _canonical_order_dict(self, row: Any) -> dict[str, Any]:
        return {
            "id": row[self._order_id_column],
            "amount_minor": row[self._amount_minor_column],
            "currency": row[self._currency_column],
        }

    async def _mark_product_order_status(self, session: AsyncSession, order_id: str, status: str) -> None:
        if self._order_status_column is None:
            return
        values: dict[Any, Any] = {self._order_status_column: status}
        if self._order_updated_at_column is not None:
            values[self._order_updated_at_column] = func.now()
        await session.execute(
            update(self._orders_table)
            .where(self._order_id_column == order_id)
            .values(values)
        )


def _stable_attempt(order_id: str, attempt_number: int) -> tuple[str, str]:
    digest = _sha256(f"{order_id}:{attempt_number}")[:32]
    return f"sdrp_attempt_{digest}", f"sdrp-{digest}"


def _checkout_attempt_dict(order: dict[str, Any], state: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(order["id"]),
        "order_id": str(order["id"]),
        "amount_minor": int(order["amount_minor"]),
        "currency": str(order["currency"]),
        "attempt_number": int(state.get("attempt_number") or 1),
        "attempt_id": str(state["attempt_id"]),
        "stable_nonce": str(state["stable_nonce"]),
        "status": str(state.get("status") or ""),
        "checkout_session_id": state.get("checkout_session_id"),
        "checkout_url": state.get("checkout_url"),
        "expires_at": state.get("expires_at"),
    }


def _is_reusable_checkout_attempt(state: dict[str, Any]) -> bool:
    return (
        state.get("status") == "pending"
        and bool(state.get("checkout_session_id"))
        and bool(state.get("checkout_url"))
        and not _timestamp_has_passed(state.get("expires_at"))
    )


def _timestamp_has_passed(value: Any) -> bool:
    if value is None:
        return False
    parsed = _parse_datetime(value)
    if parsed is None:
        return False
    return parsed <= _now_utc()


def _parse_datetime(value: Any) -> Any:
    from .siglume_order_store_sqlalchemy import _parse_datetime as parse_datetime

    return parse_datetime(value)


def _now_utc() -> Any:
    from .siglume_order_store_sqlalchemy import _now_utc as now_utc

    return now_utc()


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _require_text(value: str, name: str) -> str:
    text = str(value or "").strip()
    if not text:
        raise ValueError(f"{name} is required")
    return text


async def _resolve_authorize_order(result: bool | Awaitable[bool]) -> bool:
    if inspect.isawaitable(result):
        return bool(await result)
    return bool(result)
