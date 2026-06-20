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
siglume_order_store = SQLAlchemySiglumeOrderStore(SessionLocal)

app.include_router(
    create_siglume_sdrp_router(siglume_order_store, allow_metered_payments=False),
    prefix="/payments",
)
```

Use `siglume_order_store_sqlalchemy.py` for a durable SQLAlchemy adapter. It
creates the required checkout attempt, webhook event, and payment review tables
and keeps webhook processing transactional.

Keep `process_webhook_event_once()` transactional: record the webhook event as
processed only after the order update or review write succeeds. The generated
route defaults to Standard-only. Enable `allow_metered_payments` only after you
implement Micro / Nano settlement reconciliation and past-due handling.
The route paths become:

- `POST /payments/checkout/siglume/start`
- `POST /payments/webhooks/siglume`
