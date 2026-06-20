from __future__ import annotations

import os

from dotenv import load_dotenv
from flask import Flask, jsonify, request
from siglume_direct_request_payment import (
    DirectRequestPaymentMerchantClient,
    HostedCheckoutNotAvailableError,
    classify_direct_payment_confirmation,
    verify_direct_request_payment_webhook,
)

from order_store import (
    all_orders,
    begin_checkout_attempt,
    find_order_by_challenge_hash,
    process_webhook_event_once,
    save_order,
)

load_dotenv()

app = Flask(__name__)
merchant_key = os.environ.get("SIGLUME_DIRECT_PAYMENT_MERCHANT", "example_merchant")
shop_origin = os.environ.get("SHOP_PUBLIC_ORIGIN", "https://www.example.com")
siglume_merchant = DirectRequestPaymentMerchantClient(
    auth_token=os.environ.get("SIGLUME_MERCHANT_AUTH_TOKEN"),
)


@app.get("/orders")
def orders():
    return jsonify({"orders": all_orders()})


@app.post("/checkout/siglume/start")
def start_checkout():
    order_id = str((request.get_json(silent=True) or {}).get("order_id") or "")
    order = begin_checkout_attempt(order_id)
    if order is None:
        return jsonify({"error": "order_not_found"}), 404

    if order.get("siglume_checkout_url") and order.get("siglume_checkout_session_id"):
        return jsonify(
            {
                "order_id": order["id"],
                "amount_minor": order["amount_minor"],
                "currency": order["currency"],
                "checkout_url": order["siglume_checkout_url"],
                "session_id": order["siglume_checkout_session_id"],
            }
        )

    session = siglume_merchant.create_checkout_session(
        merchant=merchant_key,
        amount_minor=int(order["amount_minor"]),
        currency=str(order["currency"]),
        nonce=f"{order['id']}-attempt_{order['payment_attempt']}",
        success_url=f"{shop_origin}/thanks",
        cancel_url=f"{shop_origin}/cart",
        metadata={"order_id": order["id"]},
    )

    order["siglume_challenge_hash"] = session["challenge_hash"]
    order["siglume_checkout_url"] = session["checkout_url"]
    order["siglume_checkout_session_id"] = session["session_id"]
    order["siglume_payment_status"] = "pending"
    save_order(order)

    return jsonify(
        {
            "order_id": order["id"],
            "amount_minor": order["amount_minor"],
            "currency": order["currency"],
            "checkout_url": session["checkout_url"],
            "session_id": session["session_id"],
        }
    )


@app.post("/siglume/webhook")
def siglume_webhook():
    verified = verify_direct_request_payment_webhook(
        os.environ.get("SIGLUME_WEBHOOK_SECRET", ""),
        request.get_data(),
        request.headers.get("Siglume-Signature", ""),
    )
    event = verified["event"]

    def handler() -> None:
        if event["type"] == "direct_payment.confirmed":
            confirmation = classify_direct_payment_confirmation(event)

            if confirmation["kind"] == "standard_settled":
                order = find_order_by_challenge_hash(confirmation["challenge_hash"])
                if order is not None:
                    order["siglume_payment_status"] = "paid"
                    order["siglume_requirement_id"] = confirmation["requirement_id"]
                    order["siglume_chain_receipt_id"] = confirmation["chain_receipt_id"]
                    save_order(order)
            elif confirmation["kind"] == "metered_usage_accepted":
                app.logger.warning(
                    "Micro/Nano settlement integration is required before automatic fulfillment",
                    extra={
                        "event_id": event["id"],
                        "requirement_id": confirmation["requirement_id"],
                        "pricing_band": confirmation["pricing_band"],
                    },
                )
            else:
                app.logger.warning(
                    "manual payment review required",
                    extra={
                        "event_id": event["id"],
                        "reason": confirmation.get("reason"),
                        "requirement_id": confirmation.get("requirement_id"),
                    },
                )

    if process_webhook_event_once(str(event["id"]), handler) == "duplicate":
        return "", 204

    return "", 204


@app.errorhandler(HostedCheckoutNotAvailableError)
def hosted_checkout_not_available(_: HostedCheckoutNotAvailableError):
    return jsonify({"error": "hosted_checkout_not_enabled"}), 409


@app.errorhandler(Exception)
def internal_error(error: Exception):
    app.logger.error("checkout starter error", extra={"name": type(error).__name__})
    return jsonify({"error": "internal_error"}), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "3000")))
