from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import time
import uuid
from collections.abc import Mapping
from typing import Any, Literal, TypedDict
from urllib.parse import quote, urlencode, urlsplit

import httpx


DEFAULT_SIGLUME_API_BASE = "https://siglume.com/v1"
DEFAULT_SIGLUME_SANDBOX_API_BASE = "http://127.0.0.1:8787/v1"
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
DIRECT_REQUEST_PAYMENT_SDK_VERSION = "0.4.29"
DIRECT_REQUEST_PAYMENT_STANDARD_SETTLED_STATUS = "settled"
DIRECT_REQUEST_PAYMENT_METERED_ACCEPTED_STATUS = "pending_settlement"
DIRECT_REQUEST_PAYMENT_STANDARD_FINALITY = "per_payment_onchain"
DIRECT_REQUEST_PAYMENT_METERED_FINALITY = "aggregated_onchain_settlement"
MAX_SAFE_INTEGER = 9007199254740991
_DIRECT_REQUEST_PAYMENT_CONFIRMED_WEBHOOK_MODES = {DIRECT_REQUEST_PAYMENT_MODE, "metered_settlement_batch"}

_MERCHANT_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,95}$")

DirectRequestPaymentMinorAmount = str


class DirectRequestPaymentSettlementBatch(TypedDict, total=False):
    settlement_batch_id: str
    plan_type: str
    settlement_cadence: str
    status: str
    settlement_trigger: Literal["amount_threshold", "scheduled_close"] | str | None
    settlement_threshold_minor: DirectRequestPaymentMinorAmount | None
    threshold_reached_at: str | None
    total_unsettled_exposure_minor: DirectRequestPaymentMinorAmount | None
    period_start: str | None
    period_end: str | None
    close_at: str | None
    expected_scheduled_debit_at: str | None
    scheduled_debit_at: str | None
    not_before_attempt_at: str | None
    execution_status: str | None
    latest_execution_attempt_status: str | None
    attempt_count: int | None
    next_attempt_at: str | None
    chain_receipt_id: str | None
    usage_event_digest: str | None
    provider_gross_amount_minor: DirectRequestPaymentMinorAmount
    provider_usage_amount_minor: DirectRequestPaymentMinorAmount
    protocol_fee_minor: DirectRequestPaymentMinorAmount
    provider_receivable_minor: DirectRequestPaymentMinorAmount
    buyer_debit_minor: DirectRequestPaymentMinorAmount
    gross_buyer_debit_minor: DirectRequestPaymentMinorAmount
    rounding_delta_minor: DirectRequestPaymentMinorAmount
    settled_provider_receivable_minor: DirectRequestPaymentMinorAmount
    unsettled_provider_receivable_minor: DirectRequestPaymentMinorAmount
    past_due_provider_receivable_minor: DirectRequestPaymentMinorAmount
    terminal_provider_receivable_minor: DirectRequestPaymentMinorAmount
    uncollectible_provider_receivable_minor: DirectRequestPaymentMinorAmount
    written_off_provider_receivable_minor: DirectRequestPaymentMinorAmount
    terminal_status: Literal["uncollectible", "written_off"] | str | None
    terminal_marked_at: str | None
    terminal_reason_code: str | None
    failure_reason_code: str | None
    failure_reason_label: str | None
    failure_reason_help: str | None
    support_reference: str | None


class DirectRequestPaymentMeteredOpenPeriod(TypedDict, total=False):
    plan_type: Literal["micro", "nano"] | str
    settlement_cadence: Literal["weekly", "monthly"] | str
    currency: Literal["JPY", "USD"] | str
    token_symbol: Literal["JPYC", "USDC"] | str
    period_start: str | None
    period_end: str | None
    close_at: str | None
    settlement_trigger: Literal["amount_threshold", "scheduled_close"] | str | None
    settlement_threshold_minor: DirectRequestPaymentMinorAmount | None
    threshold_reached_at: str | None
    provider_gross_amount_minor: DirectRequestPaymentMinorAmount
    provider_usage_amount_minor: DirectRequestPaymentMinorAmount
    protocol_fee_minor: DirectRequestPaymentMinorAmount
    provider_receivable_minor: DirectRequestPaymentMinorAmount
    buyer_debit_minor: DirectRequestPaymentMinorAmount
    total_unsettled_exposure_minor: DirectRequestPaymentMinorAmount | None


class DirectRequestPaymentPastDueBlock(TypedDict, total=False):
    settlement_batch_id: str
    plan_type: Literal["micro", "nano"] | str
    currency: Literal["JPY", "USD"] | str
    token_symbol: Literal["JPYC", "USDC"] | str
    total_unsettled_exposure_minor: DirectRequestPaymentMinorAmount | None
    past_due_provider_receivable_minor: DirectRequestPaymentMinorAmount
    failure_reason_code: str | None
    support_reference: str | None


class DirectRequestPaymentProviderMeteredTotals(TypedDict, total=False):
    settled_provider_receivable_minor: DirectRequestPaymentMinorAmount
    unsettled_provider_receivable_minor: DirectRequestPaymentMinorAmount
    past_due_provider_receivable_minor: DirectRequestPaymentMinorAmount
    terminal_provider_receivable_minor: DirectRequestPaymentMinorAmount
    uncollectible_provider_receivable_minor: DirectRequestPaymentMinorAmount
    written_off_provider_receivable_minor: DirectRequestPaymentMinorAmount


class DirectRequestPaymentBuyerMeteredSummary(TypedDict, total=False):
    role: Literal["buyer"]
    open_periods: list[DirectRequestPaymentMeteredOpenPeriod]
    settlement_batches: list[DirectRequestPaymentSettlementBatch]
    past_due_blocks: list[DirectRequestPaymentPastDueBlock]
    balance_sufficiency: dict[str, Any]


class DirectRequestPaymentProviderMeteredSummary(TypedDict, total=False):
    role: Literal["provider"]
    timezone: str | None
    filters: dict[str, Any]
    open_periods: list[DirectRequestPaymentMeteredOpenPeriod]
    periods: list[DirectRequestPaymentSettlementBatch]
    totals: DirectRequestPaymentProviderMeteredTotals


class DirectRequestPaymentListResponse(TypedDict, total=False):
    items: list[dict[str, Any]]
    next_cursor: str | None


class HostedCheckoutSession(TypedDict, total=False):
    checkout_url: str
    session_id: str
    merchant: str
    amount_minor: int
    currency: Literal["JPY", "USD"] | str
    token_symbol: Literal["JPYC", "USDC"] | str
    status: Literal["open", "authenticated", "paid", "expired", "cancelled", "failed"] | str
    challenge_hash: str
    requirement_id: str | None
    pricing_band: Literal["standard", "micro", "nano"] | str | None
    settlement_cadence: Literal["per_payment", "weekly", "monthly"] | str | None
    finality: str | None
    protocol_fee_minor: DirectRequestPaymentMinorAmount | None
    settlement_status: str | None
    chain_receipt_id: str | None
    success_url: str
    cancel_url: str
    expires_at: str | None
    authenticated_at: str | None
    paid_at: str | None
    cancelled_at: str | None
    created_at: str | None
    metadata_jsonb: dict[str, Any]


class DirectRequestPaymentMerchantResponse(TypedDict, total=False):
    merchant_account: dict[str, Any]
    challenge_secret: str | None
    challenge_secret_created: bool
    created: bool | None
    listing_id: str | None
    mandate: dict[str, Any] | None
    next_steps: dict[str, Any]


class DirectRequestPaymentWebhookSubscription(TypedDict, total=False):
    webhook_subscription_id: str
    subscription_id: str
    id: str
    callback_url: str
    signing_secret: str
    signing_secret_hint: str
    status: str
    event_types: list[str]


class DirectRequestPaymentWebhookDelivery(TypedDict, total=False):
    id: str
    subscription_id: str
    event_id: str
    event_type: str
    delivery_status: str
    response_status: int | None
    delivered_at: str | None


class DirectRequestPaymentCheckoutSetupResult(TypedDict, total=False):
    merchant: dict[str, Any]
    billing_mandate: dict[str, Any]
    webhook_subscription: DirectRequestPaymentWebhookSubscription
    env: dict[str, str]


DirectRequestPaymentMerchantSetupResponse = DirectRequestPaymentCheckoutSetupResult


class DirectRequestPaymentWebhookVerification(TypedDict, total=False):
    event: dict[str, Any]
    verification: dict[str, Any]


class DirectRequestPaymentConfirmationClassification(TypedDict, total=False):
    kind: Literal["standard_settled", "metered_usage_accepted", "metered_batch_settled", "unknown"]
    reason: str
    requirement_id: str
    challenge_hash: str
    settlement_batch_id: str
    chain_receipt_id: str
    usage_event_digest: str
    settled_at: str | None
    pricing_band: Literal["standard", "micro", "nano"] | str


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
        self._auth_token = token
        self.base_url = _normalize_api_base_url(base_url or _default_api_base_url())
        self.timeout = max(float(timeout), 0.001)
        self.user_agent = user_agent
        self._client = client

    def __repr__(self) -> str:
        return f"{type(self).__name__}(base_url={self.base_url!r}, timeout={self.timeout!r})"

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
    ) -> DirectRequestPaymentBuyerMeteredSummary:
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
    ) -> DirectRequestPaymentListResponse:
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
    ) -> DirectRequestPaymentListResponse:
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
    ) -> DirectRequestPaymentProviderMeteredSummary:
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
    ) -> DirectRequestPaymentListResponse:
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
    ) -> DirectRequestPaymentListResponse:
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
    ) -> DirectRequestPaymentSettlementBatch:
        batch_id = quote(_require_non_empty(settlement_batch_id, "settlement_batch_id"), safe="")
        return self._request(
            "GET",
            _metered_query_path(
                f"/sdrp/metered/provider/settlement-batches/{batch_id}",
                listing_id=listing_id,
                capability_key=capability_key,
            ),
        )

    def _request(self, method: str, path: str, *, json_body: Any | None = None) -> Any:
        headers = {
            "Accept": "application/json",
            "Authorization": f"Bearer {self._auth_token}",
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
        self._auth_token = token
        self.base_url = _normalize_api_base_url(base_url or _default_api_base_url())
        self.timeout = max(float(timeout), 0.001)
        self.user_agent = user_agent
        self._client = client

    def __repr__(self) -> str:
        return f"{type(self).__name__}(base_url={self.base_url!r}, timeout={self.timeout!r})"

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
    ) -> DirectRequestPaymentMerchantResponse:
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
            payload["webhook_callback_url"] = _normalize_https_url(webhook_callback_url, "webhook_callback_url")
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
    ) -> HostedCheckoutSession:
        """Create a Hosted Checkout session for human web shoppers. Siglume
        authors the challenge server-side, persists a
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

    def get_checkout_session(self, session_id: str) -> HostedCheckoutSession:
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
    ) -> DirectRequestPaymentWebhookSubscription:
        payload: dict[str, Any] = {
            "callback_url": _normalize_https_url(callback_url, "callback_url"),
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

    def list_webhook_subscriptions(self) -> list[DirectRequestPaymentWebhookSubscription]:
        response = self._request("GET", "/market/webhooks/subscriptions")
        return response if isinstance(response, list) else []

    def queue_webhook_test_delivery(
        self,
        *,
        event_type: str,
        data: Mapping[str, Any] | None = None,
        subscription_ids: list[str] | tuple[str, ...] | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {"event_type": _require_non_empty(event_type, "event_type")}
        if data is not None:
            payload["data"] = _clone_json_object(data, "data")
        if subscription_ids is not None:
            payload["subscription_ids"] = [_require_non_empty(subscription_id, "subscription_id") for subscription_id in subscription_ids]
        return self._request("POST", "/market/webhooks/test-deliveries", json_body=payload)

    def list_webhook_deliveries(
        self,
        *,
        subscription_id: str | None = None,
        event_type: str | None = None,
        status: str | None = None,
        limit: int | None = None,
    ) -> list[DirectRequestPaymentWebhookDelivery]:
        params: dict[str, str] = {}
        if subscription_id is not None:
            params["subscription_id"] = _require_non_empty(subscription_id, "subscription_id")
        if event_type is not None:
            params["event_type"] = _require_non_empty(event_type, "event_type")
        if status is not None:
            params["status"] = _require_non_empty(status, "status")
        if limit is not None:
            params["limit"] = str(_positive_int(limit, "limit"))
        query = f"?{urlencode(params)}" if params else ""
        response = self._request("GET", f"/market/webhooks/deliveries{query}")
        return response if isinstance(response, list) else []

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
    ) -> DirectRequestPaymentCheckoutSetupResult:
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
            "Authorization": f"Bearer {self._auth_token}",
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
            return parsed["data"]
        return parsed

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
    ) -> DirectRequestPaymentListResponse:
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
    ) -> DirectRequestPaymentListResponse:
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
    # _external_402_recurring_challenge_signature  Eboth sides change together.
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
    ) -> DirectRequestPaymentSettlementBatch:
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
    body: bytes | str,
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
    expected = compute_webhook_signature(signing_secret, _raw_body_bytes(body), timestamp=timestamp)
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
    return event


def classify_direct_payment_confirmation(event: Mapping[str, Any]) -> DirectRequestPaymentConfirmationClassification:
    data_raw = event.get("data")
    data = data_raw if isinstance(data_raw, Mapping) else {}
    requirement_id = _non_empty_str(data.get("requirement_id")) or _non_empty_str(
        data.get("direct_payment_requirement_id")
    )
    challenge_hash = _non_empty_str(data.get("challenge_hash"))
    pricing_band = _non_empty_str(data.get("pricing_band"))
    settlement_cadence = _non_empty_str(data.get("settlement_cadence"))
    finality = _non_empty_str(data.get("finality"))
    settlement_status = _non_empty_str(data.get("settlement_status"))
    mode = _non_empty_str(data.get("mode"))

    if event.get("type") != "direct_payment.confirmed":
        return {
            "kind": "unknown",
            "event": event,
            "data": data,
            "reason": "not_direct_payment_confirmed",
            "requirement_id": requirement_id,
            "settlement_batch_id": _non_empty_str(data.get("settlement_batch_id")),
            "pricing_band": pricing_band,
            "settlement_cadence": settlement_cadence,
            "settlement_status": settlement_status,
            "finality": finality,
        }

    if mode not in _DIRECT_REQUEST_PAYMENT_CONFIRMED_WEBHOOK_MODES:
        return {
            "kind": "unknown",
            "event": event,
            "data": data,
            "reason": "unsupported_confirmation_mode",
            "requirement_id": requirement_id,
            "settlement_batch_id": _non_empty_str(data.get("settlement_batch_id")),
            "pricing_band": pricing_band,
            "settlement_cadence": settlement_cadence,
            "settlement_status": settlement_status,
            "finality": finality,
        }

    if mode == "metered_settlement_batch":
        settlement_batch_id = _non_empty_str(data.get("settlement_batch_id"))
        chain_receipt_id = _non_empty_str(data.get("chain_receipt_id"))
        usage_event_digest = _non_empty_str(data.get("usage_event_digest"))
        if (
            settlement_status == DIRECT_REQUEST_PAYMENT_STANDARD_SETTLED_STATUS
            and finality == DIRECT_REQUEST_PAYMENT_METERED_FINALITY
            and pricing_band in {"micro", "nano"}
            and settlement_cadence == ("weekly" if pricing_band == "micro" else "monthly")
            and settlement_batch_id
            and chain_receipt_id
            and usage_event_digest
        ):
            return {
                "kind": "metered_batch_settled",
                "event": event,
                "data": data,
                "pricing_band": pricing_band,
                "settlement_cadence": "weekly" if pricing_band == "micro" else "monthly",
                "settlement_batch_id": settlement_batch_id,
                "chain_receipt_id": chain_receipt_id,
                "usage_event_digest": usage_event_digest,
                "settled_at": _non_empty_str(data.get("settled_at")),
            }
        return {
            "kind": "unknown",
            "event": event,
            "data": data,
            "reason": "invalid_metered_settlement_confirmation",
            "requirement_id": requirement_id,
            "settlement_batch_id": settlement_batch_id,
            "pricing_band": pricing_band,
            "settlement_cadence": settlement_cadence,
            "settlement_status": settlement_status,
            "finality": finality,
        }

    if pricing_band == "standard":
        chain_receipt_id = _non_empty_str(data.get("chain_receipt_id"))
        if (
            finality == DIRECT_REQUEST_PAYMENT_STANDARD_FINALITY
            and settlement_status == DIRECT_REQUEST_PAYMENT_STANDARD_SETTLED_STATUS
            and requirement_id
            and challenge_hash
            and chain_receipt_id
        ):
            return {
                "kind": "standard_settled",
                "event": event,
                "data": data,
                "requirement_id": requirement_id,
                "challenge_hash": challenge_hash,
                "chain_receipt_id": chain_receipt_id,
                "request_hash_v2": _non_empty_str(data.get("request_hash_v2")),
            }
        return {
            "kind": "unknown",
            "event": event,
            "data": data,
            "reason": "missing_standard_settlement_fields",
            "requirement_id": requirement_id,
            "pricing_band": pricing_band,
            "settlement_cadence": settlement_cadence,
            "settlement_status": settlement_status,
            "finality": finality,
        }

    if pricing_band in {"micro", "nano"}:
        if (
            finality == DIRECT_REQUEST_PAYMENT_METERED_FINALITY
            and settlement_status == DIRECT_REQUEST_PAYMENT_METERED_ACCEPTED_STATUS
            and settlement_cadence == ("weekly" if pricing_band == "micro" else "monthly")
            and requirement_id
            and challenge_hash
        ):
            return {
                "kind": "metered_usage_accepted",
                "event": event,
                "data": data,
                "pricing_band": pricing_band,
                "settlement_cadence": "weekly" if pricing_band == "micro" else "monthly",
                "requirement_id": requirement_id,
                "challenge_hash": challenge_hash,
                "request_hash_v2": _non_empty_str(data.get("request_hash_v2")),
            }
        return {
            "kind": "unknown",
            "event": event,
            "data": data,
            "reason": "missing_metered_usage_fields",
            "requirement_id": requirement_id,
            "pricing_band": pricing_band,
            "settlement_cadence": settlement_cadence,
            "settlement_status": settlement_status,
            "finality": finality,
        }

    return {
        "kind": "unknown",
        "event": event,
        "data": data,
        "reason": "unknown_confirmation_shape",
        "requirement_id": requirement_id,
        "settlement_batch_id": _non_empty_str(data.get("settlement_batch_id")),
        "pricing_band": pricing_band,
        "settlement_cadence": settlement_cadence,
        "settlement_status": settlement_status,
        "finality": finality,
    }


def verify_direct_request_payment_webhook(
    signing_secret: str,
    body: bytes | str,
    signature_header: str,
    *,
    tolerance_seconds: int = DEFAULT_WEBHOOK_TOLERANCE_SECONDS,
    now: int | None = None,
) -> DirectRequestPaymentWebhookVerification:
    verification = verify_webhook_signature(
        signing_secret,
        body,
        signature_header,
        tolerance_seconds=tolerance_seconds,
        now=now,
    )
    raw = _raw_body_bytes(body).decode("utf-8")
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


def _normalize_api_base_url(value: str) -> str:
    raw = _require_non_empty(value, "base_url")
    parts = urlsplit(raw)
    scheme = parts.scheme.lower()
    hostname = (parts.hostname or "").lower()
    if not scheme or not parts.netloc:
        raise DirectRequestPaymentError("base_url must be an absolute URL such as https://siglume.com/v1.")
    if parts.username or parts.password:
        raise DirectRequestPaymentError("base_url must not include userinfo.")
    if not _is_allowed_url_scheme(scheme, hostname):
        raise DirectRequestPaymentError(
            "base_url must use https, except http is allowed for localhost, 127.0.0.1, or [::1]."
        )
    return raw.rstrip("/")


def _normalize_https_url(value: str, name: str) -> str:
    raw = _require_non_empty(value, name)
    parts = urlsplit(raw)
    if not parts.scheme or not parts.netloc:
        raise DirectRequestPaymentError(f"{name} must be an absolute https URL.")
    if parts.username or parts.password:
        raise DirectRequestPaymentError(f"{name} must not include userinfo.")
    if parts.scheme.lower() != "https" or not parts.hostname:
        raise DirectRequestPaymentError(f"{name} must use https.")
    return raw


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


def _non_empty_str(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    text = value.strip()
    return text or None


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
    return _is_allowed_url_scheme(scheme, hostname)


def _is_allowed_url_scheme(scheme: str, hostname: str) -> bool:
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


def _raw_body_bytes(body: Any) -> bytes:
    if isinstance(body, bytes):
        return body
    if isinstance(body, str):
        return body.encode("utf-8")
    raise SiglumeWebhookPayloadError(
        "Webhook verification requires the exact raw request body bytes or raw body string; JSON objects are only accepted by build_webhook_signature_header for tests."
    )


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


def _default_api_base_url() -> str:
    explicit = _env_value("SIGLUME_API_BASE")
    if explicit:
        return explicit
    if str(_env_value("SIGLUME_ENV") or "").lower() == "sandbox":
        return _env_value("SIGLUME_SANDBOX_API_BASE") or DEFAULT_SIGLUME_SANDBOX_API_BASE
    return DEFAULT_SIGLUME_API_BASE
