# Hosted Checkout Python Starter

Minimal Flask starter for one Standard Payment test order.

```bash
cp .env.example .env
python -m pip install -e . siglume-direct-request-payment
python app.py
```

Then call:

```bash
curl -X POST http://localhost:3000/checkout/siglume/start \
  -H "content-type: application/json" \
  -d "{\"order_id\":\"order_123\"}"
```

This starter uses in-memory storage so it is easy to inspect. Replace it with a
database before production. Production systems must persist orders, processed
webhook event ids, and fulfillment state in one durable transaction.
