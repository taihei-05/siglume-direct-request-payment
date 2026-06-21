# FastAPI Integration Files

Mount the router in your existing app:

```py
from contextlib import asynccontextmanager
from fastapi import FastAPI

import os
from sqlalchemy.ext.asyncio import async_sessionmaker

from .auth import current_user_id
from .database import async_user_can_pay_order
from .siglume.siglume_order_store_sqlalchemy_async import (
    AsyncSQLAlchemySiglumeOrderStore,
    create_async_sqlalchemy_engine,
)
from .siglume.siglume_sdrp_routes import create_siglume_sdrp_router

async def authorize_order(order: dict, request) -> bool:
    user_id = current_user_id(request)
    return bool(user_id and await async_user_can_pay_order(str(order["id"]), user_id))

engine = create_async_sqlalchemy_engine(os.environ["DATABASE_URL"])
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)
siglume_order_store = AsyncSQLAlchemySiglumeOrderStore(
    SessionLocal,
    authorize_order=authorize_order,
    # Optional: connect to an existing product orders table/columns.
    # orders_table=product_orders,
    # order_id_column="order_id",
    # amount_minor_column="total_cents",
    # currency_column="iso_currency",
    # order_status_column="payment_status",
)

@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    await engine.dispose()

app = FastAPI(lifespan=lifespan)
app.include_router(
    create_siglume_sdrp_router(siglume_order_store, allow_metered_payments=False),
    prefix="/payments",
)
```

Use `siglume_order_store_sqlalchemy.py` for a durable SQLAlchemy adapter. It
creates only the SDRP checkout attempt, webhook event, and payment review
tables by default and keeps webhook processing transactional. Run
`create_async_sqlalchemy_siglume_schema(engine)` or your equivalent migration
before checkout. Pass `include_orders_table=True` only for the sample `orders`
table; existing products should use their own order table.

For sync SQLAlchemy projects that cannot use `AsyncSession`, use
`siglume_order_store_sqlalchemy.py`:

```py
from sqlalchemy.orm import sessionmaker

from .siglume.siglume_order_store_sqlalchemy import (
    SQLAlchemySiglumeOrderStore,
    create_sqlalchemy_engine,
    create_sqlalchemy_siglume_schema,
)

engine = create_sqlalchemy_engine(os.environ["DATABASE_URL"])
create_sqlalchemy_siglume_schema(engine)
SessionLocal = sessionmaker(engine, future=True)
siglume_order_store = SQLAlchemySiglumeOrderStore(SessionLocal, authorize_order=authorize_order)
```

The sync adapter performs synchronous DB work; the async adapter above is the
recommended FastAPI request-path default.

Keep `process_webhook_event_once()` transactional: record the webhook event as
processed only after the order update or review write succeeds. The generated
route defaults to Standard-only. Enable `allow_metered_payments` only after you
implement Micro / Nano settlement reconciliation and past-due handling.

Do not run a production checkout route without `authorize_order`. It must
fail-closed unless the authenticated product user owns the order and the order is
still payable. Without this check, anyone who can guess an order id could start
checkout for someone else's order.
The route paths become:

- `POST /payments/checkout/siglume/start`
- `POST /payments/webhooks/siglume`
