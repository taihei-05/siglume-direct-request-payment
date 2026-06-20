from __future__ import annotations

import contextvars
import hashlib
import json
import time
from collections.abc import Awaitable, Callable
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
    Column("order_id", String(255), primary_key=True),
    Column("attempt_id", String(255), nullable=False, unique=True),
    Column("stable_nonce", String(255), nullable=False, unique=True),
    Column("status", String(32), nullable=False, default="created"),
    Column("challenge_hash", String(255), unique=True),
    Column("checkout_session_id", String(255)),
    Column("checkout_url", Text),
    Column("requirement_id", String(255)),
    Column("chain_receipt_id", String(255)),
    Column("pricing_band", String(32)),
    Column("paid_at", DateTime(timezone=True)),
    Column("fulfilled_unsettled_at", DateTime(timezone=True)),
    Column("created_at", DateTime(timezone=True), server_default=func.now(), nullable=False),
    Column("updated_at", DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False),
)

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


def create_sqlalchemy_siglume_schema(engine: Engine) -> None:
    metadata.create_all(engine)


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
        authorize_order: Callable[[dict[str, Any], Request], bool] | None = None,
    ) -> None:
        self._session_factory = session_factory
        self._authorize_order = authorize_order

    async def begin_checkout_attempt(self, order_id: str, request: Request) -> dict[str, Any] | None:
        clean_order_id = _require_text(order_id, "order_id")
        with self._session_factory.begin() as session:
            order = session.execute(select(orders).where(orders.c.id == clean_order_id)).mappings().first()
            if order is None:
                return None
            order_dict = dict(order)
            if self._authorize_order and not self._authorize_order(order_dict, request):
                return None

            attempt_id, stable_nonce = _stable_attempt(clean_order_id)
            existing = session.execute(
                select(checkout_attempts).where(checkout_attempts.c.order_id == clean_order_id)
            ).mappings().first()
            if existing is None:
                session.execute(
                    insert(checkout_attempts).values(
                        order_id=clean_order_id,
                        attempt_id=attempt_id,
                        stable_nonce=stable_nonce,
                        status="created",
                    )
                )
                existing = session.execute(
                    select(checkout_attempts).where(checkout_attempts.c.order_id == clean_order_id)
                ).mappings().first()
            state = dict(existing or {})
            return {
                "id": clean_order_id,
                "order_id": clean_order_id,
                "amount_minor": int(order_dict["amount_minor"]),
                "currency": str(order_dict["currency"]),
                "attempt_id": str(state.get("attempt_id") or attempt_id),
                "stable_nonce": str(state.get("stable_nonce") or stable_nonce),
                "checkout_session_id": state.get("checkout_session_id"),
                "checkout_url": state.get("checkout_url"),
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
        session = self._session()
        session.execute(
            update(checkout_attempts)
            .where(checkout_attempts.c.order_id == order_id)
            .values(
                status="pending",
                attempt_id=attempt_id,
                stable_nonce=stable_nonce,
                challenge_hash=challenge_hash,
                checkout_session_id=checkout_session_id,
                checkout_url=checkout_url,
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
            .where(checkout_attempts.c.status != "paid")
            .values(
                status="paid",
                requirement_id=requirement_id,
                chain_receipt_id=chain_receipt_id,
                paid_at=func.now(),
                updated_at=func.now(),
            )
        )
        if result.rowcount:
            session.execute(
                update(orders)
                .where(orders.c.id == order_id)
                .values(status="paid", updated_at=func.now())
            )
        self._commit_if_own_session(session)

    async def mark_order_fulfilled_unsettled_once(self, *, order_id: str, requirement_id: str, pricing_band: str) -> None:
        session = self._session()
        result = session.execute(
            update(checkout_attempts)
            .where(checkout_attempts.c.order_id == order_id)
            .where(checkout_attempts.c.status.notin_(["fulfilled_unsettled", "paid"]))
            .values(
                status="fulfilled_unsettled",
                requirement_id=requirement_id,
                pricing_band=pricing_band,
                fulfilled_unsettled_at=func.now(),
                updated_at=func.now(),
            )
        )
        if result.rowcount:
            session.execute(
                update(orders)
                .where(orders.c.id == order_id)
                .values(status="fulfilled_unsettled", updated_at=func.now())
            )
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


def _stable_attempt(order_id: str) -> tuple[str, str]:
    digest = _sha256(order_id)[:32]
    return f"sdrp_attempt_{digest}", f"sdrp-{digest}"


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _require_text(value: str, name: str) -> str:
    text = str(value or "").strip()
    if not text:
        raise ValueError(f"{name} is required")
    return text
