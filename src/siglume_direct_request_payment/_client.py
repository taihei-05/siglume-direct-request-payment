from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import time
import uuid
from collections.abc import Mapping
from typing import Any
from urllib.parse import quote, urlencode, urlsplit

import httpx


DEFAULT_SIGLUME_API_BASE = "https://siglume.com/v1"
DIRECT_REQUEST_PAYMENT_CHALLENGE_SCHEME = "siglume-external-402-v1"
# Recurring (subscription / scheduled autopay) approval uses a DISTINCT scheme
# with cadence bound into the HMAC, so a one-time checkout challenge can never
# be replayed as a recurring authorization and vice versa.
DIRECT_REQUEST_PAYMENT_RECURRING_CHALLENGE_SCHEME = "siglume-external-402-recurring-v1"
DIRECT_REQUEST_PAYMENT_MODE = "external_402"
DIRECT_REQUEST_PAYMENT_RECEIPT_KIND = "sdrp_direct_payment"
DIRECT_REQUEST_PAYMENT_ALLOWANCE_RECEIPT_KIND = "sdrp_direct_payment_allowance"
DIRECT_REQUEST_PAYMENT_REFERENCE_TYPE = "sdrp_direct_payment_requirement"
DEFAULT_WEBHOOK_TOLERANCE_SECONDS = 300
DIRECT_REQUEST_PAYMENT_SDK_VERSION = "0.4.6"
MAX_SAFE_INTEGER = 9007199254740991
_DIRECT_REQUEST_PAYMENT_CONFIRMED_WEBHOOK_MODES = {DIRECT_REQUEST_PAYMENT_MODE, "metered_settlement_batch"}

_MERCHANT_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,95}$")


class DirectRequestPaymentError(Exception):
    """Base error for Siglume Direct Request Payment SDK failures."""


class SiglumeApiError(DirectRequestPaymentError):
    def __init__(self, message: str, *, status: int, code: str = "SIGLUME_API_ERROR", data: Any = None) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.data = data


class HostedCheckoutNotAvailableError(SiglumeApiError):
    def __init__(
        self,
        message: str = "Hosted Checkout is not enabled for this account yet (server rollout in progress).",
    ) -> None:
        super().__init__(message, status=409, code="HOSTED_CHECKOUT_NOT_ENABLED")


class SiglumeWebhookSignatureError(DirectRequestPaymentError):
    pass


class SiglumeWebhookPayloadError(DirectRequestPaymentError):
    pass


class DirectRequestPaymentClient:
    def __init__(
        self,
        *,
        auth_token: str | None = None,
        base_url: str | None = None,
        timeout: float = 15.0,
        client: httpx.Client | None = None,
        user_agent: str = f"siglume-direct-request-payment/{DIRECT_REQUEST_PAYMENT_SDK_VERSION}",
    ) -> None:
        token = auth_token or _env_value("SIGLUME_AUTH_TOKEN")
        if not token:
            raise DirectRequestPaymentError(
                "A buyer or provider Siglume user bearer token is required for Direct Request Payment API calls. "
                "Developer Portal API keys are not accepted."
            )
        self.auth_token = token
        self.base_url = (base_url or _env_value("SIGLUME_API_BASE") or DEFAULT_SIGLUME_API_BASE).rstrip("/")
        self.timeout = max(float(timeout), 0.001)
        self.user_agent = user_agent
        self._client = client

    def create_payment_requirement(
        self,
        *,
        merchant: str,
        amount_minor: int,
        currency: str,
        challenge: str,
        token_symbol: str | None = None,
        allowance_amount_minor: int | None = None,
        metadata: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "mode": DIRECT_REQUEST_PAYMENT_MODE,
            "merchant": _normalize_merchant(merchant),
            "amount_minor": _positive_int(amount_minor, "amount_minor"),
            "currency": _normalize_currency(currency),
            "challenge": _require_non_empty(challenge, "challenge"),
        }
        if token_symbol is not None:
            payload["token_symbol"] = _normalize_token(token_symbol)
        if allowance_amount_minor is not None:
            payload["allowance_amount_minor"] = _positive_int(allowance_amount_minor, "allowance_amount_minor")
        if metadata is not None:
            payload["metadata"] = _clone_json_object(metadata, "metadata")
        return self._request("POST", "/sdrp/direct-payments/requirements", json_body=payload)

    def get_payment_requirement(self, requirement_id: str) -> dict[str, Any]:
        requirement_id = _require_non_empty(requirement_id, "requirement_id")
        return self._request("GET", f"/sdrp/direct-payments/requirements/{requirement_id}")

    def verify_payment_requirement(
        self,
        requirement_id: str,
        *,
        receipt_id: str | None = None,
        chain_receipt_id: str | None = None,
        await_finality: bool | None = None,
        await_required_status: str | None = None,
        await_timeout_seconds: int | None = None,
        await_poll_seconds: int | None = None,
    ) -> dict[str, Any]:
        payload = {
            "receipt_id": receipt_id,
            "chain_receipt_id": chain_receipt_id,
            "await_finality": await_finality,
            "await_required_status": await_required_status,
            "await_timeout_seconds": await_timeout_seconds,
            "await_poll_seconds": await_poll_seconds,
        }
        body = {key: value for key, value in payload.items() if value is not None}
        requirement_id = _require_non_empty(requirement_id, "requirement_id")
        return self._request("POST", f"/sdrp/direct-payments/requirements/{requirement_id}/verify", json_body=body)

    def execute_prepared_transaction(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/market/web3/transactions/execute-prepared", json_body=dict(payload))

    def execute_payment_transaction(
        self,
        requirement: Mapping[str, Any],
        *,
        await_finality: bool = False,
        metadata: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        payload = build_payment_execution_payload(requirement, await_finality=await_finality, metadata=metadata)
        return self.execute_prepared_transaction(payload)

    def execute_allowance_transaction(
        self,
        requirement: Mapping[str, Any],
        *,
        await_finality: bool = False,
        metadata: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        payload = build_allowance_execution_payload(requirement, await_finality=await_finality, metadata=metadata)
        return self.execute_prepared_transaction(payload)

    def get_buyer_metered_summary(
        self,
        *,
        plan_type: str | None = None,
        token_symbol: str | None = None,
    ) -> dict[str, Any]:
        return self._request(
            "GET",
            _metered_query_path("/sdrp/metered/my-summary", plan_type=plan_type, token_symbol=token_symbol),
        )

    def list_buyer_usage_events(
        self,
        *,
        plan_type: str | None = None,
        token_symbol: str | None = None,
        status: str | None = None,
        cursor: str | None = None,
        limit: int | None = None,
    ) -> dict[str, Any]:
        return self._request(
            "GET",
            _metered_query_path(
                "/sdrp/metered/my-usage-events",
                plan_type=plan_type,
                token_symbol=token_symbol,
                status=status,
                cursor=cursor,
                limit=limit,
            ),
        )

    def list_buyer_settlement_batches(
        self,
        *,
        plan_type: str | None = None,
        token_symbol: str | None = None,
        status: str | None = None,
        cursor: str | None = None,
        limit: int | None = None,
    ) -> dict[str, Any]:
        return self._request(
            "GET",
            _metered_query_path(
                "/sdrp/metered/my-settlement-batches",
                plan_type=plan_type,
                token_symbol=token_symbol,
                status=status,
                cursor=cursor,
                limit=limit,
            ),
        )

    def get_provider_metered_summary(
        self,
        *,
        plan_type: str | None = None,
        token_symbol: str | None = None,
        listing_id: str | None = None,
        capability_key: str | None = None,
    ) -> dict[str, Any]:
        return self._request(
            "GET",
            _metered_query_path(
                "/sdrp/metered/provider/summary",
                plan_type=plan_type,
                token_symbol=token_symbol,
                listing_id=listing_id,
                capability_key=capability_key,
            ),
        )

    def list_provider_usage_events(
        self,
        *,
        plan_type: str | None = None,
        token_symbol: str | None = None,
        status: str | None = None,
        listing_id: str | None = None,
        capability_key: str | None = None,
        cursor: str | None = None,
        limit: int | None = None,
    ) -> dict[str, Any]:
        return self._request(
            "GET",
            _metered_query_path(
                "/sdrp/metered/provider/usage-events",
                plan_type=plan_type,
                token_symbol=token_symbol,
                status=status,
                listing_id=listing_id,
                capability_key=capability_key,
                cursor=cursor,
                limit=limit,
            ),
        )

    def list_provider_settlement_batches(
        self,
        *,
        plan_type: str | None = None,
        token_symbol: str | None = None,
        status: str | None = None,
        listing_id: str | None = None,
        capability_key: str | None = None,
        cursor: str | None = None,
        limit: int | None = None,
    ) -> dict[str, Any]:
        return self._request(
            "GET",
            _metered_query_path(
                "/sdrp/metered/provider/settlement-batches",
                plan_type=plan_type,
                token_symbol=token_symbol,
                status=status,
                listing_id=listing_id,
                capability_key=capability_key,
                cursor=cursor,
                limit=limit,
            ),
        )

    def get_provider_settlement_batch(
        self,
        settlement_batch_id: str,
        *,
        listing_id: str | None = None,
        capability_key: str | None = None,
    ) -> dict[str, Any]:
        batch_id = quote(_require_non_empty(settlement_batch_id, "settlement_batch_id"), safe="")
        return self._request(
            "GET",
            _metered_query_path(
                f"/sdrp/metered/provider/settlement-batches/{batch_id}",
                listing_id=listing_id,
                capability_key=capability_key,
            ),
        )

    def _request(self, method: str, path: str, *, json_body: Any | None = None) -> dict[str, Any]:
        headers = {
            "Accept": "application/json",
            "Authorization": f"Bearer {self.auth_token}",
            "User-Agent": self.user_agent,
        }
        close_client = self._client is None
        client = self._client or httpx.Client(timeout=self.timeout)
        try:
            response = client.request(
                method,
                f"{self.base_url}{path}",
                headers=headers,
                json=json_body,
                timeout=self.timeout,
            )
        finally:
            if close_client:
                client.close()

        raw_text = response.text
        parsed: Any = {}
        if raw_text:
            try:
                parsed = response.json()
            except ValueError as exc:
                raise SiglumeApiError(
                    "Siglume API returned invalid JSON.",
                    status=502,
                    code="INVALID_JSON_RESPONSE",
                    data=raw_text,
                ) from exc
        if response.is_error:
            error = parsed.get("error", {}) if isinstance(parsed, dict) else {}
            code = error.get("code") or (parsed.get("code") if isinstance(parsed, dict) else None) or f"HTTP_{response.status_code}"
            message = error.get("message") or (parsed.get("message") if isinstance(parsed, dict) else None) or response.reason_phrase
            raise SiglumeApiError(str(message), status=response.status_code, code=str(code), data=parsed)
        if isinstance(parsed, dict) and "data" in parsed:
            data = parsed["data"]
            return data if isinstance(data, dict) else {"data": data}
        return parsed if isinstance(parsed, dict) else {"data": parsed}

class DirectRequestPaymentMerchantClient:
    def __init__(
        self,
        *,
        auth_token: str | None = None,
        base_url: str | None = None,
        timeout: float = 15.0,
        client: httpx.Client | None = None,
        user_agent: str = f"siglume-direct-request-payment/{DIRECT_REQUEST_PAYMENT_SDK_VERSION}",
    ) -> None:
        token = auth_token or _env_value("SIGLUME_MERCHANT_AUTH_TOKEN") or _env_value("SIGLUME_AUTH_TOKEN")
        if not token:
            raise DirectRequestPaymentError(
                "A merchant Siglume bearer token is required for Direct Request Payment merchant setup. "
                "Developer Portal API keys are not accepted."
            )
        self.auth_token = token
        self.base_url = (base_url or _env_value("SIGLUME_API_BASE") or DEFAULT_SIGLUME_API_BASE).rstrip("/")
        self.timeout = max(float(timeout), 0.001)
        self.user_agent = user_agent
        self._client = client

    def setup_merchant(
        self,
        *,
        merchant: str,
        display_name: str | None = None,
        billing_plan: str = "launch",
        billing_currency: str = "JPY",
        allowed_currencies: Mapping[str, str] | list[str] | tuple[str, ...] | None = None,
        webhook_callback_url: str | None = None,
        billing_mandate_cap_minor: int | None = None,
        max_amount_minor: int | None = None,
        checkout_allowed_origins: list[str] | tuple[str, ...] | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "merchant": _normalize_self_service_merchant(merchant),
            "billing_plan": _normalize_billing_plan(billing_plan),
            "billing_currency": _normalize_currency(billing_currency),
        }
        if display_name is not None:
            payload["display_name"] = _require_non_empty(display_name, "display_name")
        if allowed_currencies is not None:
            payload["allowed_currencies"] = _normalize_allowed_currencies(allowed_currencies)
        if webhook_callback_url is not None:
            payload["webhook_callback_url"] = _require_non_empty(webhook_callback_url, "webhook_callback_url")
        if billing_mandate_cap_minor is not None:
            payload["billing_mandate_cap_minor"] = _positive_int(billing_mandate_cap_minor, "billing_mandate_cap_minor")
        if max_amount_minor is not None:
            payload["max_amount_minor"] = _positive_int(max_amount_minor, "max_amount_minor")
        if checkout_allowed_origins is not None:
            payload["checkout_allowed_origins"] = _normalize_origin_list(checkout_allowed_origins)
        return self._request("POST", "/sdrp/direct-payments/merchants", json_body=payload)

    def create_checkout_session(
        self,
        *,
        merchant: str,
        amount_minor: int,
        currency: str,
        nonce: str,
        success_url: str,
        cancel_url: str,
        metadata: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Create a Hosted Checkout session (Stripe-Checkout-equivalent for human
        web shoppers). Siglume authors the challenge server-side, persists a
        single-use expiring session, and returns ``checkout_url``. Redirect the
        shopper there; they log into Siglume, approve, and pay from their own
        wallet, then return to ``success_url``. Fulfill on the
        ``direct_payment.confirmed`` webhook (the source of truth).

        ``success_url``/``cancel_url`` must be on an origin you registered via
        ``checkout_allowed_origins`` (or your ``webhook_callback_url`` origin).
        """
        payload: dict[str, Any] = {
            "merchant": _normalize_self_service_merchant(merchant),
            "amount_minor": _positive_int(amount_minor, "amount_minor"),
            "currency": _normalize_currency(currency),
            "nonce": _normalize_challenge_nonce(nonce),
            "success_url": _require_non_empty(success_url, "success_url"),
            "cancel_url": _require_non_empty(cancel_url, "cancel_url"),
        }
        if metadata is not None:
            payload["metadata"] = _clone_json_object(metadata, "metadata")
        return self._request_hosted_checkout("POST", "/sdrp/direct-payments/checkout-sessions", json_body=payload)

    def get_checkout_session(self, session_id: str) -> dict[str, Any]:
        """Read a Hosted Checkout session's status (open / authenticated / paid /
        expired / cancelled / failed)."""
        sid = _require_non_empty(session_id, "session_id")
        return self._request_hosted_checkout("GET", f"/sdrp/direct-payments/checkout-sessions/{quote(sid, safe='')}")

    def get_merchant(self, merchant: str) -> dict[str, Any]:
        merchant_key = _normalize_self_service_merchant(merchant)
        return self._request("GET", f"/sdrp/direct-payments/merchants/{merchant_key}")

    def rotate_challenge_secret(self, merchant: str) -> dict[str, Any]:
        merchant_key = _normalize_self_service_merchant(merchant)
        return self._request("POST", f"/sdrp/direct-payments/merchants/{merchant_key}/challenge-secret/rotate")

    def prepare_billing_mandate(
        self,
        merchant: str,
        *,
        currency: str | None = None,
        billing_currency: str | None = None,
        max_amount_minor: int | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {}
        if currency is not None:
            payload["currency"] = _normalize_currency(currency)
        if billing_currency is not None:
            payload["billing_currency"] = _normalize_currency(billing_currency)
        if max_amount_minor is not None:
            payload["max_amount_minor"] = _positive_int(max_amount_minor, "max_amount_minor")
        merchant_key = _normalize_self_service_merchant(merchant)
        return self._request(
            "POST",
            f"/sdrp/direct-payments/merchants/{merchant_key}/billing-mandate",
            json_body=payload,
        )

    def create_webhook_subscription(
        self,
        *,
        callback_url: str,
        description: str | None = None,
        event_types: list[str] | tuple[str, ...] | None = None,
        metadata: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "callback_url": _require_non_empty(callback_url, "callback_url"),
            "event_types": [
                _require_non_empty(event_type, "event_type")
                for event_type in (event_types or ("direct_payment.confirmed", "direct_payment.spent"))
            ],
        }
        if description is not None:
            payload["description"] = _require_non_empty(description, "description")
        if metadata is not None:
            payload["metadata"] = _clone_json_object(metadata, "metadata")
        return self._request("POST", "/market/webhooks/subscriptions", json_body=payload)

    def setup_checkout(
        self,
        *,
        merchant: str,
        display_name: str | None = None,
        billing_plan: str = "launch",
        billing_currency: str = "JPY",
        allowed_currencies: Mapping[str, str] | list[str] | tuple[str, ...] | None = None,
        webhook_callback_url: str | None = None,
        billing_mandate_cap_minor: int | None = None,
        max_amount_minor: int | None = None,
        checkout_allowed_origins: list[str] | tuple[str, ...] | None = None,
        create_webhook_subscription: bool | None = None,
        prepare_billing_mandate: bool = True,
        webhook_event_types: list[str] | tuple[str, ...] | None = None,
        webhook_description: str | None = None,
    ) -> dict[str, Any]:
        merchant_setup = self.setup_merchant(
            merchant=merchant,
            display_name=display_name,
            billing_plan=billing_plan,
            billing_currency=billing_currency,
            allowed_currencies=allowed_currencies,
            webhook_callback_url=webhook_callback_url,
            billing_mandate_cap_minor=billing_mandate_cap_minor,
            max_amount_minor=max_amount_minor,
            checkout_allowed_origins=checkout_allowed_origins,
        )
        merchant_key = str((merchant_setup.get("merchant_account") or {}).get("merchant") or merchant)
        billing = None
        if prepare_billing_mandate:
            billing = self.prepare_billing_mandate(
                merchant_key,
                billing_currency=str((merchant_setup.get("merchant_account") or {}).get("billing_currency") or billing_currency),
                max_amount_minor=max_amount_minor or billing_mandate_cap_minor,
            )
        should_create_webhook = create_webhook_subscription if create_webhook_subscription is not None else bool(webhook_callback_url)
        webhook = None
        if should_create_webhook and webhook_callback_url:
            webhook = self.create_webhook_subscription(
                callback_url=webhook_callback_url,
                description=webhook_description or f"{merchant_key} Direct Request Payment",
                event_types=webhook_event_types,
                metadata={"merchant": merchant_key, "sdk": "siglume-direct-request-payment"},
            )
        env = {"SIGLUME_DIRECT_PAYMENT_MERCHANT": merchant_key}
        challenge_secret = merchant_setup.get("challenge_secret")
        if challenge_secret:
            env["SIGLUME_DIRECT_PAYMENT_CHALLENGE_SECRET"] = str(challenge_secret)
        webhook_secret = (webhook or {}).get("signing_secret") if isinstance(webhook, Mapping) else None
        if webhook_secret:
            env["SIGLUME_WEBHOOK_SECRET"] = str(webhook_secret)
        return {
            "merchant": merchant_setup,
            "billing_mandate": billing,
            "webhook_subscription": webhook,
            "env": env,
        }

    def _request(self, method: str, path: str, *, json_body: Any | None = None) -> dict[str, Any]:
        headers = {
            "Accept": "application/json",
            "Authorization": f"Bearer {self.auth_token}",
            "User-Agent": self.user_agent,
        }
        close_client = self._client is None
        client = self._client or httpx.Client(timeout=self.timeout)
        try:
            response = client.request(
                method,
                f"{self.base_url}{path}",
                headers=headers,
                json=json_body,
                timeout=self.timeout,
            )
        finally:
            if close_client:
                client.close()

        raw_text = response.text
        parsed: Any = {}
        if raw_text:
            try:
                parsed = response.json()
            except ValueError as exc:
                raise SiglumeApiError(
                    "Siglume API returned invalid JSON.",
                    status=502,
                    code="INVALID_JSON_RESPONSE",
                    data=raw_text,
                ) from exc
        if response.is_error:
            error = parsed.get("error", {}) if isinstance(parsed, dict) else {}
            code = error.get("code") or (parsed.get("code") if isinstance(parsed, dict) else None) or f"HTTP_{response.status_code}"
            message = error.get("message") or (parsed.get("message") if isinstance(parsed, dict) else None) or response.reason_phrase
            raise SiglumeApiError(str(message), status=response.status_code, code=str(code), data=parsed)
        if isinstance(parsed, dict) and "data" in parsed:
            data = parsed["data"]
            return data if isinstance(data, dict) else {"data": data}
        return parsed if isinstance(parsed, dict) else {"data": parsed}

    def _request_hosted_checkout(self, method: str, path: str, *, json_body: Any | None = None) -> dict[str, Any]:
        try:
            return self._request(method, path, json_body=json_body)
        except SiglumeApiError as exc:
            if _is_hosted_checkout_unavailable(exc):
                raise HostedCheckoutNotAvailableError() from exc
            raise


def create_direct_request_payment_challenge(
    *,
    merchant: str,
    amount_minor: int,
    currency: str,
    secret: str,
    nonce: str | None = None,
) -> dict[str, Any]:
    normalized_merchant = _normalize_merchant(merchant)
    normalized_amount = _positive_int(amount_minor, "amount_minor")
    normalized_currency = _normalize_currency(currency)
    normalized_nonce = _normalize_challenge_nonce(nonce) if nonce is not None else str(uuid.uuid4())
    signature = create_direct_request_payment_challenge_signature(
        secret=secret,
        merchant=normalized_merchant,
        amount_minor=normalized_amount,
        currency=normalized_currency,
        nonce=normalized_nonce,
    )
    challenge = f"{DIRECT_REQUEST_PAYMENT_CHALLENGE_SCHEME}:{normalized_nonce}:{signature}"
    return {
        "scheme": DIRECT_REQUEST_PAYMENT_CHALLENGE_SCHEME,
        "merchant": normalized_merchant,
        "amount_minor": normalized_amount,
        "currency": normalized_currency,
        "nonce": normalized_nonce,
        "signature": signature,
        "challenge": challenge,
        "challenge_hash": _sha256_prefixed(challenge),
    }


def create_direct_request_payment_challenge_signature(
    *,
    secret: str,
    merchant: str,
    amount_minor: int,
    currency: str,
    nonce: str,
) -> str:
    normalized_secret = _require_non_empty(secret, "secret")
    material = (
        f"{_normalize_merchant(merchant)}:"
        f"{_positive_int(amount_minor, 'amount_minor')}:"
        f"{_normalize_currency(currency)}:"
        f"{_normalize_challenge_nonce(nonce)}"
    )
    return hmac.new(normalized_secret.encode("utf-8"), material.encode("utf-8"), hashlib.sha256).hexdigest()


def parse_direct_request_payment_challenge(challenge: str) -> dict[str, str]:
    parts = _require_non_empty(challenge, "challenge").split(":")
    if len(parts) != 3:
        raise DirectRequestPaymentError("Direct Request Payment challenge must be scheme:nonce:signature.")
    scheme, nonce, signature = parts
    if not scheme or not nonce or not signature:
        raise DirectRequestPaymentError("Direct Request Payment challenge is incomplete.")
    return {"scheme": scheme, "nonce": nonce, "signature": signature}


def create_direct_request_payment_recurring_challenge(
    *,
    merchant: str,
    amount_minor: int,
    currency: str,
    cadence: str,
    secret: str,
    nonce: str | None = None,
) -> dict[str, Any]:
    """Merchant-side, ONE-TIME approval of a recurring authorization: amount +
    currency + cadence are bound into the HMAC. Recurring charges afterwards
    are deliberately challenge-free; the recurring authorization and the
    buyer's mandate/budget caps are the per-charge integrity checks. Cadence
    "monthly" = subscription, "daily" = scheduled autopay approval tag."""
    normalized_merchant = _normalize_merchant(merchant)
    normalized_amount = _positive_int(amount_minor, "amount_minor")
    normalized_currency = _normalize_currency(currency)
    normalized_cadence = _normalize_recurring_cadence(cadence)
    normalized_nonce = _normalize_challenge_nonce(nonce) if nonce is not None else str(uuid.uuid4())
    signature = create_direct_request_payment_recurring_challenge_signature(
        secret=secret,
        merchant=normalized_merchant,
        amount_minor=normalized_amount,
        currency=normalized_currency,
        cadence=normalized_cadence,
        nonce=normalized_nonce,
    )
    challenge = f"{DIRECT_REQUEST_PAYMENT_RECURRING_CHALLENGE_SCHEME}:{normalized_nonce}:{signature}"
    return {
        "scheme": DIRECT_REQUEST_PAYMENT_RECURRING_CHALLENGE_SCHEME,
        "merchant": normalized_merchant,
        "amount_minor": normalized_amount,
        "currency": normalized_currency,
        "cadence": normalized_cadence,
        "nonce": normalized_nonce,
        "signature": signature,
        "challenge": challenge,
        "challenge_hash": _sha256_prefixed(challenge),
    }


def create_direct_request_payment_recurring_challenge_signature(
    *,
    secret: str,
    merchant: str,
    amount_minor: int,
    currency: str,
    cadence: str,
    nonce: str,
) -> str:
    normalized_secret = _require_non_empty(secret, "secret")
    # MUST stay byte-identical to the server's
    # _external_402_recurring_challenge_signature — both sides change together.
    material = (
        f"{_normalize_merchant(merchant)}:"
        f"{_positive_int(amount_minor, 'amount_minor')}:"
        f"{_normalize_currency(currency)}:"
        f"{_normalize_recurring_cadence(cadence)}:"
        f"{_normalize_challenge_nonce(nonce)}"
    )
    return hmac.new(normalized_secret.encode("utf-8"), material.encode("utf-8"), hashlib.sha256).hexdigest()


def verify_direct_request_payment_recurring_challenge(
    *,
    secret: str,
    merchant: str,
    amount_minor: int,
    currency: str,
    cadence: str,
    challenge: str,
) -> bool:
    parsed = parse_direct_request_payment_challenge(challenge)
    if parsed["scheme"] != DIRECT_REQUEST_PAYMENT_RECURRING_CHALLENGE_SCHEME:
        return False
    expected = create_direct_request_payment_recurring_challenge_signature(
        secret=secret,
        merchant=merchant,
        amount_minor=amount_minor,
        currency=currency,
        cadence=cadence,
        nonce=parsed["nonce"],
    )
    return hmac.compare_digest(expected, parsed["signature"])


def verify_direct_request_payment_challenge(
    *,
    secret: str,
    merchant: str,
    amount_minor: int,
    currency: str,
    challenge: str,
) -> bool:
    parsed = parse_direct_request_payment_challenge(challenge)
    if parsed["scheme"] != DIRECT_REQUEST_PAYMENT_CHALLENGE_SCHEME:
        return False
    expected = create_direct_request_payment_challenge_signature(
        secret=secret,
        merchant=merchant,
        amount_minor=amount_minor,
        currency=currency,
        nonce=parsed["nonce"],
    )
    return hmac.compare_digest(expected, parsed["signature"])


def direct_request_payment_challenge_hash(challenge: str) -> str:
    return _sha256_prefixed(_require_non_empty(challenge, "challenge"))


def direct_request_payment_request_hash(*, merchant: str, amount_minor: int, currency: str, challenge: str) -> str:
    material = (
        f"{_normalize_merchant(merchant)}"
        f"{_positive_int(amount_minor, 'amount_minor')}"
        f"{_normalize_currency(currency)}"
        f"{_require_non_empty(challenge, 'challenge')}"
    )
    return _sha256_prefixed(material)


def direct_request_payment_request_hash_v2(*, merchant: str, amount_minor: int, currency: str, challenge: str) -> str:
    material = {
        "amount_minor": _positive_int(amount_minor, "amount_minor"),
        "challenge": _require_non_empty(challenge, "challenge"),
        "currency": _normalize_currency(currency),
        "merchant": _normalize_merchant(merchant),
        "version": 2,
    }
    encoded = json.dumps(material, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return _sha256_prefixed(encoded)


def build_payment_execution_payload(
    requirement: Mapping[str, Any],
    *,
    await_finality: bool = False,
    metadata: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    return build_prepared_transaction_execution_payload(
        requirement,
        requirement.get("transaction_request"),
        receipt_kind=DIRECT_REQUEST_PAYMENT_RECEIPT_KIND,
        await_finality=await_finality,
        metadata=metadata,
    )


def build_allowance_execution_payload(
    requirement: Mapping[str, Any],
    *,
    await_finality: bool = False,
    metadata: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    approve_request = requirement.get("approve_transaction_request")
    if not isinstance(approve_request, Mapping) or not approve_request:
        raise DirectRequestPaymentError("This payment requirement does not include an allowance approval transaction.")
    return build_prepared_transaction_execution_payload(
        requirement,
        approve_request,
        receipt_kind=DIRECT_REQUEST_PAYMENT_ALLOWANCE_RECEIPT_KIND,
        await_finality=await_finality,
        metadata=metadata,
    )


def build_prepared_transaction_execution_payload(
    requirement: Mapping[str, Any],
    transaction_request: Any,
    *,
    receipt_kind: str,
    await_finality: bool = False,
    metadata: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    if not isinstance(transaction_request, Mapping):
        raise DirectRequestPaymentError("transaction_request must be an object.")
    request_metadata = transaction_request.get("metadata_jsonb")
    merged_metadata: dict[str, Any] = dict(request_metadata) if isinstance(request_metadata, Mapping) else {}
    if metadata is not None:
        merged_metadata.update(dict(metadata))
    return {
        "transaction_request": dict(transaction_request),
        "receipt_kind": _require_non_empty(receipt_kind, "receipt_kind"),
        "reference_type": DIRECT_REQUEST_PAYMENT_REFERENCE_TYPE,
        "reference_id": _require_non_empty(str(requirement.get("requirement_id") or ""), "requirement_id"),
        "metadata": merged_metadata,
        "await_finality": bool(await_finality),
    }


def compute_webhook_signature(signing_secret: str, body: bytes | str | Mapping[str, Any], *, timestamp: int) -> str:
    secret = _require_non_empty(signing_secret, "signing_secret")
    payload = f"{int(timestamp)}.".encode("utf-8") + _body_bytes(body)
    return hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).hexdigest()


def build_webhook_signature_header(
    signing_secret: str,
    body: bytes | str | Mapping[str, Any],
    *,
    timestamp: int | None = None,
) -> str:
    ts = int(timestamp if timestamp is not None else time.time())
    signature = compute_webhook_signature(signing_secret, body, timestamp=ts)
    return f"t={ts},v1={signature}"


def verify_webhook_signature(
    signing_secret: str,
    body: bytes | str | Mapping[str, Any],
    signature_header: str,
    *,
    tolerance_seconds: int = DEFAULT_WEBHOOK_TOLERANCE_SECONDS,
    now: int | None = None,
) -> dict[str, Any]:
    parsed = _parse_signature_header(signature_header)
    timestamp = int(parsed["timestamp"])
    tolerance = max(int(tolerance_seconds), 1)
    now_seconds = int(now if now is not None else time.time())
    if abs(now_seconds - timestamp) > tolerance:
        raise SiglumeWebhookSignatureError("Webhook timestamp is outside the allowed tolerance window.")
    expected = compute_webhook_signature(signing_secret, body, timestamp=timestamp)
    signature = str(parsed["signature"])
    if not hmac.compare_digest(expected, signature):
        raise SiglumeWebhookSignatureError("Webhook signature did not match.")
    return {"timestamp": timestamp, "signature": signature}


def parse_direct_request_payment_webhook_event(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, Mapping):
        raise SiglumeWebhookPayloadError("webhook event must be an object.")
    data = payload.get("data")
    if not isinstance(data, Mapping):
        raise SiglumeWebhookPayloadError("webhook event data must be an object.")
    event = dict(payload)
    event["id"] = _require_non_empty(str(payload.get("id") or ""), "webhook event id")
    event["type"] = _require_non_empty(str(payload.get("type") or ""), "webhook event type")
    event["api_version"] = _require_non_empty(str(payload.get("api_version") or ""), "webhook api_version")
    event["occurred_at"] = _require_non_empty(str(payload.get("occurred_at") or ""), "webhook occurred_at")
    event["data"] = dict(data)
    if (
        event["type"] == "direct_payment.confirmed"
        and str(event["data"].get("mode") or "") not in _DIRECT_REQUEST_PAYMENT_CONFIRMED_WEBHOOK_MODES
    ):
        raise SiglumeWebhookPayloadError(
            "direct_payment.confirmed webhook must carry a supported Direct Request Payment mode."
        )
    return event


def verify_direct_request_payment_webhook(
    signing_secret: str,
    body: bytes | str | Mapping[str, Any],
    signature_header: str,
    *,
    tolerance_seconds: int = DEFAULT_WEBHOOK_TOLERANCE_SECONDS,
    now: int | None = None,
) -> dict[str, Any]:
    verification = verify_webhook_signature(
        signing_secret,
        body,
        signature_header,
        tolerance_seconds=tolerance_seconds,
        now=now,
    )
    raw = _body_bytes(body).decode("utf-8")
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise SiglumeWebhookPayloadError("Webhook body must contain valid JSON.") from exc
    return {"event": parse_direct_request_payment_webhook_event(payload), "verification": verification}


def _normalize_merchant(value: str) -> str:
    merchant = _require_non_empty(value, "merchant").lower()
    if not _MERCHANT_RE.match(merchant):
        raise DirectRequestPaymentError("merchant must be a lowercase key using letters, numbers, dot, underscore, or hyphen.")
    return merchant


def _normalize_self_service_merchant(value: str) -> str:
    merchant = _require_non_empty(value, "merchant").lower()
    if not re.match(r"^[a-z0-9][a-z0-9_-]{2,63}$", merchant):
        raise DirectRequestPaymentError("merchant must be 3-64 chars using lowercase letters, numbers, underscore, or hyphen.")
    return merchant


def _normalize_billing_plan(value: str) -> str:
    plan = _require_non_empty(value, "billing_plan").lower()
    if plan in {"launch", "free", "starter", "growth", "pro"}:
        return plan
    raise DirectRequestPaymentError("billing_plan must be launch, starter, growth, or pro.")


def _normalize_currency(value: str) -> str:
    currency = _require_non_empty(value, "currency").upper()
    if currency not in {"JPY", "USD"}:
        raise DirectRequestPaymentError("currency must be JPY or USD.")
    return currency


def _normalize_token(value: str) -> str:
    token = _require_non_empty(value, "token_symbol").upper()
    if token not in {"JPYC", "USDC"}:
        raise DirectRequestPaymentError("token_symbol must be JPYC or USDC.")
    return token


def _normalize_metered_plan_type(value: str) -> str:
    plan_type = _require_non_empty(value, "plan_type").lower()
    if plan_type in {"micro", "nano"}:
        return plan_type
    raise DirectRequestPaymentError("plan_type must be micro or nano.")


def _normalize_allowed_currencies(value: Mapping[str, str] | list[str] | tuple[str, ...]) -> dict[str, str]:
    normalized: dict[str, str] = {}
    if isinstance(value, Mapping):
        for raw_currency, raw_token in value.items():
            normalized[_normalize_currency(str(raw_currency))] = _normalize_token(str(raw_token))
    elif isinstance(value, (list, tuple)):
        for item in value:
            currency = _normalize_currency(str(item))
            normalized[currency] = _default_token_for_currency(currency)
    else:
        raise DirectRequestPaymentError("allowed_currencies must be an array or a currency-to-token mapping.")
    if not normalized:
        raise DirectRequestPaymentError("allowed_currencies must include at least one currency.")
    return normalized


def _default_token_for_currency(currency: str) -> str:
    return "JPYC" if currency == "JPY" else "USDC"


def _positive_int(value: int, name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise DirectRequestPaymentError(f"{name} must be a positive safe integer.")
    parsed = value
    if parsed <= 0 or parsed > MAX_SAFE_INTEGER:
        raise DirectRequestPaymentError(f"{name} must be a positive safe integer.")
    return parsed


def _require_non_empty(value: Any, name: str) -> str:
    text = str(value or "").strip()
    if not text:
        raise DirectRequestPaymentError(f"{name} is required.")
    return text


def _is_hosted_checkout_unavailable(exc: SiglumeApiError) -> bool:
    code = str(exc.code or "").upper()
    if exc.status == 409 and code in {"HOSTED_CHECKOUT_NOT_ENABLED", "FEATURE_DISABLED"}:
        return True
    return exc.status == 404 and code in {"HTTP_404", "NOT_FOUND", "ROUTE_NOT_FOUND", "FEATURE_DISABLED"}


def _normalize_origin_list(value: list[str] | tuple[str, ...]) -> list[str]:
    if not isinstance(value, (list, tuple)):
        raise DirectRequestPaymentError("checkout_allowed_origins must be a list of origin URLs.")
    origins: list[str] = []
    seen: set[str] = set()
    for item in value:
        parts = urlsplit(str(item or "").strip())
        if not parts.scheme or not parts.netloc:
            raise DirectRequestPaymentError(
                "each checkout_allowed_origins entry must be an absolute origin such as https://shop.example.com."
            )
        if parts.username or parts.password:
            raise DirectRequestPaymentError("checkout_allowed_origins entries must not include userinfo.")
        scheme = parts.scheme.lower()
        try:
            port = parts.port
        except ValueError as exc:
            raise DirectRequestPaymentError("checkout_allowed_origins entries must include a valid port.") from exc
        hostname = (parts.hostname or "").lower()
        if not _is_allowed_checkout_origin_scheme(scheme, hostname):
            raise DirectRequestPaymentError(
                "checkout_allowed_origins entries must use https, except http is allowed for localhost, "
                "127.0.0.1, or [::1]."
            )
        host = f"[{hostname}]" if ":" in hostname and not hostname.startswith("[") else hostname
        if port is not None and not ((scheme == "https" and port == 443) or (scheme == "http" and port == 80)):
            host = f"{host}:{port}"
        origin = f"{scheme}://{host}"
        if origin not in seen:
            seen.add(origin)
            origins.append(origin)
    return origins


def _is_allowed_checkout_origin_scheme(scheme: str, hostname: str) -> bool:
    if scheme == "https":
        return bool(hostname)
    if scheme != "http":
        return False
    return hostname in {"localhost", "127.0.0.1", "::1"}


def _metered_query_path(
    path: str,
    *,
    plan_type: str | None = None,
    token_symbol: str | None = None,
    status: str | None = None,
    listing_id: str | None = None,
    capability_key: str | None = None,
    cursor: str | None = None,
    limit: int | None = None,
) -> str:
    params: dict[str, str] = {}
    if plan_type is not None:
        params["plan_type"] = _normalize_metered_plan_type(plan_type)
    if token_symbol is not None:
        params["token_symbol"] = _normalize_token(token_symbol)
    if status is not None:
        params["status"] = _require_non_empty(status, "status")
    if listing_id is not None:
        params["listing_id"] = _require_non_empty(listing_id, "listing_id")
    if capability_key is not None:
        params["capability_key"] = _require_non_empty(capability_key, "capability_key")
    if limit is not None:
        params["limit"] = str(_positive_int(limit, "limit"))
    if cursor is not None:
        params["cursor"] = _require_non_empty(cursor, "cursor")
    query = urlencode(params)
    return f"{path}?{query}" if query else path


def _normalize_challenge_nonce(value: str) -> str:
    nonce = _require_non_empty(value, "nonce")
    if ":" in nonce:
        raise DirectRequestPaymentError("nonce must not contain ':'.")
    return nonce


def _normalize_recurring_cadence(value: str) -> str:
    cadence = _require_non_empty(value, "cadence").lower()
    if cadence not in {"monthly", "daily"}:
        raise DirectRequestPaymentError(
            'cadence must be "monthly" (subscription) or "daily" (scheduled autopay).'
        )
    return cadence


def _clone_json_object(value: Mapping[str, Any], name: str) -> dict[str, Any]:
    try:
        cloned = json.loads(json.dumps(dict(value), separators=(",", ":")))
    except (TypeError, ValueError) as exc:
        raise DirectRequestPaymentError(f"{name} must be a JSON-serializable object.") from exc
    if not isinstance(cloned, dict):
        raise DirectRequestPaymentError(f"{name} must be a JSON-serializable object.")
    return cloned


def _body_bytes(body: bytes | str | Mapping[str, Any]) -> bytes:
    if isinstance(body, bytes):
        return body
    if isinstance(body, str):
        return body.encode("utf-8")
    if isinstance(body, Mapping):
        return json.dumps(dict(body), separators=(",", ":")).encode("utf-8")
    raise SiglumeWebhookPayloadError("Webhook body must be raw bytes, a string, or a JSON object.")


def _parse_signature_header(signature_header: str) -> dict[str, Any]:
    timestamp: int | None = None
    signature: str | None = None
    for item in str(signature_header or "").split(","):
        key, sep, value = item.strip().partition("=")
        if not sep:
            continue
        if key == "t":
            try:
                timestamp = int(value)
            except ValueError as exc:
                raise SiglumeWebhookSignatureError("Webhook signature timestamp is invalid.") from exc
        if key == "v1":
            signature = value.strip()
    if timestamp is None or not signature:
        raise SiglumeWebhookSignatureError("Webhook signature header is incomplete.")
    return {"timestamp": timestamp, "signature": signature}


def _sha256_prefixed(material: str) -> str:
    digest = hashlib.sha256(material.encode("utf-8")).hexdigest()
    return f"sha256:{digest}"


def _env_value(name: str) -> str | None:
    value = os.getenv(name)
    if value and value.strip():
        return value.strip()
    return None
