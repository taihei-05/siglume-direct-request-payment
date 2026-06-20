# FastAPI Integration Files

Mount the router in your existing app:

```py
from fastapi import FastAPI

import os
from sqlalchemy.orm import sessionmaker

from .siglume.siglume_order_store_sqlalchemy import (
    SQLAlchemySiglumeOrderStore,
    create_sqlalchemy_engine,
    create_sqlalchemy_siglume_schema,
)
from .siglume.siglume_sdrp_routes import create_siglume_sdrp_router

app = FastAPI()
engine = create_sqlalchemy_engine(os.environ["DATABASE_URL"])
create_sqlalchemy_siglume_schema(engine)
SessionLocal = sessionmaker(engine, future=True)
siglume_order_store = SQLAlchemySiglumeOrderStore(
    SessionLocal,
    # Optional: connect to an existing product orders table/columns.
    # orders_table=product_orders,
    # order_id_column="order_id",
    # amount_minor_column="total_cents",
    # currency_column="iso_currency",
    # order_status_column="payment_status",
)

app.include_router(
    create_siglume_sdrp_router(siglume_order_store, allow_metered_payments=False),
    prefix="/payments",
)
```

Use `siglume_order_store_sqlalchemy.py` for a durable SQLAlchemy adapter. It
creates only the SDRP checkout attempt, webhook event, and payment review
tables by default and keeps webhook processing transactional. Pass
`include_orders_table=True` to `create_sqlalchemy_siglume_schema()` only for the
sample `orders` table; existing products should use their own order table.

For async SQLAlchemy projects, use `siglume_order_store_sqlalchemy_async.py`
instead:

```py
from sqlalchemy.ext.asyncio import async_sessionmaker

from .siglume.siglume_order_store_sqlalchemy_async import (
    AsyncSQLAlchemySiglumeOrderStore,
    create_async_sqlalchemy_engine,
    create_async_sqlalchemy_siglume_schema,
)

engine = create_async_sqlalchemy_engine(os.environ["DATABASE_URL"])
# Run this during your FastAPI startup/lifespan initialization.
await create_async_sqlalchemy_siglume_schema(engine)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)
siglume_order_store = AsyncSQLAlchemySiglumeOrderStore(SessionLocal)
```

Keep `process_webhook_event_once()` transactional: record the webhook event as
processed only after the order update or review write succeeds. The generated
route defaults to Standard-only. Enable `allow_metered_payments` only after you
implement Micro / Nano settlement reconciliation and past-due handling.
The route paths become:

- `POST /payments/checkout/siglume/start`
- `POST /payments/webhooks/siglume`
