from __future__ import annotations

import contextvars
import hashlib
import json
import asyncio
import time
from collections.abc import Awaitable, Callable
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from fastapi import Request
from sqlalchemy import (
    BigInteger,
    Column,
    DateTime,
    MetaData,
    String,
    Table,
    Text,
    create_engine,
    insert,
    select,
    update,
)
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.sql import func


metadata = MetaData()

orders = Table(
    "orders",
    metadata,
    Column("id", String(255), primary_key=True),
    Column("amount_minor", BigInteger, nullable=False),
    Column("currency", String(8), nullable=False),
    Column("status", String(32), nullable=False, default="created"),
    Column("created_at", DateTime(timezone=True), server_default=func.now(), nullable=False),
    Column("updated_at", DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False),
)

checkout_attempts = Table(
    "siglume_checkout_attempts",
    metadata,
    Column("attempt_id", String(255), primary_key=True),
    Column("order_id", String(255), nullable=False),
    Column("attempt_number", BigInteger, nullable=False),
    Column("stable_nonce", String(255), nullable=False, unique=True),
    Column("active_key", String(255), unique=True),
    Column("status", String(32), nullable=False, default="created"),
    Column("challenge_hash", String(255), unique=True),
    Column("checkout_session_id", String(255)),
    Column("checkout_url", Text),
    Column("expires_at", DateTime(timezone=True)),
    Column("cancelled_at", DateTime(timezone=True)),
    Column("failed_at", DateTime(timezone=True)),
    Column("creation_owner_id", String(255)),
    Column("creation_lease_expires_at", DateTime(timezone=True)),
    Column("error_message", Text),
    Column("requirement_id", String(255)),
    Column("chain_receipt_id", String(255)),
    Column("pricing_band", String(32)),
    Column("paid_at", DateTime(timezone=True)),
    Column("fulfilled_unsettled_at", DateTime(timezone=True)),
    Column("created_at", DateTime(timezone=True), server_default=func.now(), nullable=False),
    Column("updated_at", DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False),
)

CHECKOUT_CREATION_LEASE_SECONDS = 30
CHECKOUT_CREATION_WAIT_SECONDS = 10
CHECKOUT_CREATION_POLL_SECONDS = 0.1

webhook_events = Table(
    "siglume_webhook_events",
    metadata,
    Column("event_id", String(255), primary_key=True),
    Column("status", String(32), nullable=False),
    Column("error_message", Text),
    Column("created_at", DateTime(timezone=True), server_default=func.now(), nullable=False),
    Column("processed_at", DateTime(timezone=True)),
)

payment_reviews = Table(
    "siglume_payment_reviews",
    metadata,
    Column("review_id", String(255), primary_key=True),
    Column("order_id", String(255)),
    Column("reason", String(128), nullable=False),
    Column("payload_json", Text, nullable=False),
    Column("created_at", DateTime(timezone=True), server_default=func.now(), nullable=False),
)

_current_session: contextvars.ContextVar[Session | None] = contextvars.ContextVar(
    "siglume_sdrp_sqlalchemy_session",
    default=None,
)


def create_sqlalchemy_engine(database_url: str) -> Engine:
    connect_args = {"check_same_thread": False} if database_url.startswith("sqlite") else {}
    return create_engine(database_url, future=True, connect_args=connect_args)


def create_sqlalchemy_siglume_schema(engine: Engine, *, include_orders_table: bool = False) -> None:
    tables = [checkout_attempts, webhook_events, payment_reviews]
    if include_orders_table:
        tables.insert(0, orders)
    metadata.create_all(engine, tables=tables)


def seed_sqlalchemy_order(
    session: Session,
    *,
    order_id: str,
    amount_minor: int,
    currency: str,
    status: str = "created",
) -> None:
    session.execute(
        insert(orders).values(
            id=order_id,
            amount_minor=amount_minor,
            currency=currency.upper(),
            status=status,
        )
    )


class SQLAlchemySiglumeOrderStore:
    def __init__(
        self,
        session_factory: sessionmaker[Session],
        *,
        orders_table: Table = orders,
        order_id_column: str = "id",
        amount_minor_column: str = "amount_minor",
        currency_column: str = "currency",
        order_status_column: str | None = "status",
        order_updated_at_column: str | None = "updated_at",
        authorize_order: Callable[[dict[str, Any], Request], bool] | None = None,
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
            with self._session_factory.begin() as session:
                order = session.execute(
                    select(self._orders_table).where(self._order_id_column == clean_order_id)
                ).mappings().first()
                if order is None:
                    return None
                order_dict = self._canonical_order_dict(order)
                if self._authorize_order and not self._authorize_order(order_dict, request):
                    return None

                active = session.execute(
                    select(checkout_attempts).where(checkout_attempts.c.active_key == clean_order_id)
                ).mappings().first()
                if active is not None:
                    state = dict(active)
                    if _is_reusable_checkout_attempt(state):
                        return _checkout_attempt_dict(order_dict, state)
                    if state.get("status") == "creating" and not _timestamp_has_passed(state.get("creation_lease_expires_at")):
                        pending = _checkout_attempt_dict(order_dict, state)
                        pending["checkout_creation_pending"] = True
                        wait_attempt = pending
                    else:
                        status = "expired" if state.get("status") == "pending" else "failed"
                        session.execute(
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
                    if wait_attempt is not None:
                        pass
                    else:
                        active = None
                if wait_attempt is not None:
                    if time.monotonic() >= wait_until:
                        return wait_attempt
                    should_wait = True
                else:
                    should_wait = False

                if should_wait:
                    # Leave the transaction before sleeping so the creator can commit.
                    pass
                else:
                    max_attempt_number = session.execute(
                        select(func.max(checkout_attempts.c.attempt_number)).where(checkout_attempts.c.order_id == clean_order_id)
                    ).scalar_one_or_none()
                    attempt_number = int(max_attempt_number or 0) + 1
                    attempt_id, stable_nonce = _stable_attempt(clean_order_id, attempt_number)
                    try:
                        session.execute(
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
                    except IntegrityError:
                        pending = _checkout_attempt_dict(order_dict, {
                            "order_id": clean_order_id,
                            "attempt_number": attempt_number,
                            "attempt_id": attempt_id,
                            "stable_nonce": stable_nonce,
                            "status": "creating",
                        })
                        pending["checkout_creation_pending"] = True
                        if time.monotonic() >= wait_until:
                            return pending
                        wait_attempt = pending
                    else:
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
        session = self._session()
        session.execute(
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
        self._commit_if_own_session(session)

    async def mark_checkout_failed(
        self,
        *,
        order_id: str,
        attempt_id: str,
        error_message: str | None = None,
    ) -> None:
        session = self._session()
        session.execute(
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
        self._commit_if_own_session(session)

    async def process_webhook_event_once(
        self,
        event_id: str,
        handler: Callable[[], Awaitable[None]],
    ) -> Literal["processed", "duplicate"]:
        clean_event_id = _require_text(event_id, "event_id")
        with self._session_factory.begin() as session:
            existing = session.execute(
                select(webhook_events.c.event_id).where(webhook_events.c.event_id == clean_event_id)
            ).first()
            if existing is not None:
                return "duplicate"
            try:
                session.execute(insert(webhook_events).values(event_id=clean_event_id, status="processing"))
            except IntegrityError:
                return "duplicate"
            token = _current_session.set(session)
            try:
                await handler()
                session.execute(
                    update(webhook_events)
                    .where(webhook_events.c.event_id == clean_event_id)
                    .values(status="processed", processed_at=func.now())
                )
                return "processed"
            finally:
                _current_session.reset(token)

    async def find_order_by_challenge_hash(self, challenge_hash: str) -> dict[str, Any] | None:
        session = self._session()
        row = session.execute(
            select(checkout_attempts.c.order_id).where(checkout_attempts.c.challenge_hash == challenge_hash)
        ).first()
        self._close_if_own_session(session)
        return {"id": row[0]} if row else None

    async def mark_order_paid_once(self, *, order_id: str, requirement_id: str, chain_receipt_id: str) -> None:
        session = self._session()
        result = session.execute(
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
            self._mark_product_order_status(session, order_id, "paid")
        self._commit_if_own_session(session)

    async def mark_order_fulfilled_unsettled_once(self, *, order_id: str, requirement_id: str, pricing_band: str) -> None:
        session = self._session()
        result = session.execute(
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
            self._mark_product_order_status(session, order_id, "fulfilled_unsettled")
        self._commit_if_own_session(session)

    async def flag_payment_review(self, data: dict[str, Any]) -> None:
        session = self._session()
        payload = json.dumps(data, separators=(",", ":"), sort_keys=True)
        session.execute(
            insert(payment_reviews).values(
                review_id=f"sdrp_review_{_sha256(f'{time.time()}:{payload}')[:24]}",
                order_id=data.get("order_id") if isinstance(data.get("order_id"), str) else None,
                reason=str(data.get("reason") or "manual_review_required"),
                payload_json=payload,
            )
        )
        self._commit_if_own_session(session)

    def _session(self) -> Session:
        current = _current_session.get()
        if current is not None:
            return current
        return self._session_factory()

    def _commit_if_own_session(self, session: Session) -> None:
        if _current_session.get() is not session:
            try:
                session.commit()
            finally:
                session.close()

    def _close_if_own_session(self, session: Session) -> None:
        if _current_session.get() is not session:
            session.close()

    def _canonical_order_dict(self, row: Any) -> dict[str, Any]:
        return {
            "id": row[self._order_id_column],
            "amount_minor": row[self._amount_minor_column],
            "currency": row[self._currency_column],
        }

    def _mark_product_order_status(self, session: Session, order_id: str, status: str) -> None:
        if self._order_status_column is None:
            return
        values: dict[Any, Any] = {self._order_status_column: status}
        if self._order_updated_at_column is not None:
            values[self._order_updated_at_column] = func.now()
        session.execute(
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


def _parse_datetime(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    text = str(value).strip()
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _require_text(value: str, name: str) -> str:
    text = str(value or "").strip()
    if not text:
        raise ValueError(f"{name} is required")
    return text
