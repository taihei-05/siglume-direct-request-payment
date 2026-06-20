# FastAPI Integration Files

Mount the router in your existing app:

```py
from fastapi import FastAPI

from .siglume.siglume_order_store_example import ExampleSiglumeOrderStore
from .siglume.siglume_sdrp_routes import create_siglume_sdrp_router

app = FastAPI()
app.include_router(
    create_siglume_sdrp_router(ExampleSiglumeOrderStore(), allow_metered_payments=False),
    prefix="/payments",
)
```

Replace `siglume_order_store_example.py` with your real order database adapter.
Keep `process_webhook_event_once()` transactional: record the webhook event as
processed only after the order update or review write succeeds. The generated
route defaults to Standard-only. Enable `allow_metered_payments` only after you
implement Micro / Nano settlement reconciliation and past-due handling.
