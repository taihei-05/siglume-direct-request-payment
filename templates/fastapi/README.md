# FastAPI Integration Files

Mount the router in your existing app:

```py
from fastapi import FastAPI

from .siglume.siglume_order_store_example import ExampleSiglumeOrderStore
from .siglume.siglume_sdrp_routes import create_siglume_sdrp_router

app = FastAPI()
app.include_router(
    create_siglume_sdrp_router(ExampleSiglumeOrderStore()),
    prefix="/payments",
)
```

Replace `siglume_order_store_example.py` with your real order database adapter.
The route paths become:

- `POST /payments/checkout/siglume/start`
- `POST /payments/webhooks/siglume`
