from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import time
from importlib import resources
from pathlib import Path
from urllib.parse import urlsplit

from ._client import DirectRequestPaymentMerchantClient, HostedCheckoutNotAvailableError, SiglumeApiError


def main() -> None:
    _load_dotenv()
    parser = argparse.ArgumentParser(prog="siglume-sdrp")
    subparsers = parser.add_subparsers(dest="command")

    _add_readiness_args(subparsers.add_parser("preflight"))
    _add_readiness_args(subparsers.add_parser("readiness"))
    _add_readiness_args(subparsers.add_parser("verify"))

    init = subparsers.add_parser("init")
    init.add_argument("framework", choices=["fastapi"])
    init.add_argument("--target", required=True)
    init.add_argument("--force", action="store_true")

    args = parser.parse_args()
    if args.command in (None, "help"):
        parser.print_help()
        return
    if args.command in {"preflight", "readiness", "verify"}:
        args.probe_required = args.command != "preflight"
        if args.command == "preflight":
            args.webhook_delivery_probe = False
        ok = _readiness(args)
        raise SystemExit(0 if ok else 1)
    if args.command == "init":
        _init_fastapi(Path(args.target), force=bool(args.force))
        return


def _add_readiness_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--merchant", default=os.getenv("SIGLUME_DIRECT_PAYMENT_MERCHANT", ""))
    parser.add_argument("--origin", default=os.getenv("SHOP_PUBLIC_ORIGIN", ""))
    parser.add_argument("--webhook-url", default=os.getenv("SHOP_WEBHOOK_URL", ""))
    parser.add_argument("--currency", default=os.getenv("SIGLUME_DIRECT_PAYMENT_TEST_CURRENCY", "JPY"))
    parser.add_argument("--amount-minor", type=int, default=0)
    parser.add_argument("--base-url", default=os.getenv("SIGLUME_API_BASE"))
    parser.add_argument("--sandbox", action="store_true")
    parser.add_argument("--no-api", action="store_true")
    parser.add_argument("--no-probe", action="store_true")
    parser.add_argument("--json", action="store_true")


def _readiness(args: argparse.Namespace) -> bool:
    checks: list[dict[str, str]] = []
    sandbox_mode = bool(getattr(args, "sandbox", False)) or str(os.getenv("SIGLUME_ENV") or "").lower() == "sandbox"
    token = os.getenv("SIGLUME_MERCHANT_AUTH_TOKEN") or os.getenv("SIGLUME_AUTH_TOKEN") or ""
    webhook_secret = os.getenv("SIGLUME_WEBHOOK_SECRET") or ""
    currency = str(args.currency).upper()
    amount_minor = int(args.amount_minor or os.getenv("SIGLUME_DIRECT_PAYMENT_TEST_AMOUNT_MINOR") or (301 if currency == "USD" else 501))
    base_url = args.base_url or os.getenv("SIGLUME_API_BASE")
    if not base_url and sandbox_mode:
        base_url = os.getenv("SIGLUME_SANDBOX_API_BASE") or "http://127.0.0.1:8787/v1"
    checkout_probe = not bool(args.no_probe)
    webhook_delivery_probe = checkout_probe and bool(getattr(args, "webhook_delivery_probe", True))

    _check(checks, "target_environment", True, "sandbox" if sandbox_mode else "live")
    _check(checks, "merchant_key", bool(args.merchant), "Set SIGLUME_DIRECT_PAYMENT_MERCHANT or pass --merchant.")
    _check(checks, "merchant_token", bool(token) and (sandbox_mode or not token.startswith("cli_")), "Set SIGLUME_MERCHANT_AUTH_TOKEN to a merchant Siglume bearer token, not a cli_ key.")
    _check(checks, "shop_origin", _is_allowed_origin(args.origin, sandbox_mode), "Set SHOP_PUBLIC_ORIGIN to a valid origin.")
    _check(checks, "webhook_url", _is_allowed_webhook_url(args.webhook_url, sandbox_mode), "Set SHOP_WEBHOOK_URL to a public https URL, or local http in sandbox.")
    _check(checks, "webhook_secret_present", bool(webhook_secret) and webhook_secret.startswith("whsec_"), "Set SIGLUME_WEBHOOK_SECRET to the webhook signing secret returned by setup_checkout.")
    _check(checks, "standard_probe_amount", _is_standard_amount(currency, amount_minor), "Use a Standard-band probe amount: JPY 501+ or USD 301+ minor units.")

    if not args.no_api and not _has_failures(checks):
        merchant = DirectRequestPaymentMerchantClient(auth_token=token, base_url=base_url)
        matching_subscription: dict[str, object] | None = None
        try:
            response = merchant.get_merchant(args.merchant)
            account = response.get("merchant_account") or {}
            _check(checks, "merchant_exists", bool(account.get("merchant")), "Run merchant setup before checkout.")
            _check(
                checks,
                "billing_mandate",
                bool(account.get("billing_mandate_id")),
                "Complete the merchant billing mandate wallet approval.",
            )
            _check(
                checks,
                "billing_status_active",
                _active_like(account.get("billing_status")),
                f"Billing status is {account.get('billing_status') or 'unknown'}; it must be active before accepting payments.",
            )
            _check(
                checks,
                "merchant_status_active",
                _merchant_status_allowed(account.get("status")),
                f"Merchant status is {account.get('status') or 'unknown'}; it must be active or ready before accepting payments.",
            )
        except Exception as exc:  # noqa: BLE001 - CLI must convert all failures to readiness output.
            _check(checks, "merchant_api", False, _api_error_message(exc, "Could not read the merchant account."))

        if not _has_failures(checks):
            try:
                subscriptions = merchant.list_webhook_subscriptions()
                active_subscriptions = [subscription for subscription in subscriptions if _active_like(subscription.get("status"))]
                for subscription in active_subscriptions:
                    if _urls_equal(str(subscription.get("callback_url") or ""), str(args.webhook_url)):
                        matching_subscription = subscription
                        break
                _check(checks, "webhook_subscription_exists", bool(active_subscriptions), "Create an active webhook subscription before checkout.")
                _check(checks, "webhook_callback_matches", matching_subscription is not None, f"No active webhook subscription points at {args.webhook_url}.")
                _check(
                    checks,
                    "direct_payment_confirmed_subscribed",
                    matching_subscription is not None and _includes_event_type(matching_subscription.get("event_types"), "direct_payment.confirmed"),
                    "The matching webhook subscription must include direct_payment.confirmed.",
                )
                hint = str((matching_subscription or {}).get("signing_secret_hint") or "")
                _check(
                    checks,
                    "webhook_secret_matches_subscription_hint",
                    bool(hint) and webhook_secret.endswith(hint),
                    "SIGLUME_WEBHOOK_SECRET does not match the signing_secret_hint for the matching subscription. Rotate or re-save the webhook secret.",
                )
            except Exception as exc:  # noqa: BLE001
                _check(checks, "webhook_subscription_api", False, _api_error_message(exc, "Could not read webhook subscriptions."))

        if not checkout_probe and getattr(args, "probe_required", True) and not _has_failures(checks):
            _check(checks, "hosted_checkout_probe", False, "--no-probe skips Hosted Checkout and webhook delivery probes. Remove --no-probe for readiness.")
        elif not webhook_delivery_probe and not getattr(args, "probe_required", True) and not _has_failures(checks):
            _check(checks, "webhook_delivery_probe_skipped", True, "preflight only; run siglume-check verify after mounting and starting the webhook route.")

        if checkout_probe and not _has_failures(checks):
            try:
                session = merchant.create_checkout_session(
                    merchant=args.merchant,
                    amount_minor=amount_minor,
                    currency=currency,
                    nonce=f"sdrp-readiness-{int(time.time() * 1000)}",
                    success_url=f"{args.origin}/siglume-readiness/success",
                    cancel_url=f"{args.origin}/siglume-readiness/cancel",
                    metadata={"source": "siglume-sdrp-readiness"},
                )
                _check(checks, "hosted_checkout_probe", bool(session.get("checkout_url") and session.get("challenge_hash")), "Hosted Checkout did not return a checkout_url.")
            except HostedCheckoutNotAvailableError:
                _check(checks, "hosted_checkout_probe", False, "Hosted Checkout is not enabled for this merchant account. Ask Siglume to enable it before coding the human checkout path.")
            except Exception as exc:  # noqa: BLE001
                _check(checks, "hosted_checkout_probe", False, _api_error_message(exc, "Hosted Checkout probe failed. Check checkout_allowed_origins, currency, amount, and billing mandate."))

        if webhook_delivery_probe and not _has_failures(checks):
            _check_webhook_delivery_probe(checks, merchant, merchant_key=args.merchant, subscription=matching_subscription)

    ok = not _has_failures(checks)
    if args.json:
        print(json.dumps({"ok": ok, "checks": checks}, indent=2))
    else:
        for item in checks:
            mark = "OK" if item["status"] == "pass" else "WARN" if item["status"] == "warn" else "FAIL"
            print(f"{mark} {item['name']}: {item['message']}")
        if ok and args.no_api:
            print("Local config checks passed. API, Hosted Checkout, and webhook delivery readiness were not verified.")
        elif ok and not webhook_delivery_probe and not getattr(args, "probe_required", True):
            print(f"Preflight passed ({'sandbox' if sandbox_mode else 'live'}). Mount the routes, start your app, then run siglume-check verify.")
        else:
            print(f"Ready for 10-minute SDRP integration ({'sandbox' if sandbox_mode else 'live'})." if ok else "Not ready. Fix the FAIL items before coding checkout.")
    return ok


def _init_fastapi(target: Path, *, force: bool) -> None:
    target = target.resolve()
    target.mkdir(parents=True, exist_ok=True)
    source = resources.files("siglume_direct_request_payment").joinpath("templates/fastapi")
    items = list(source.iterdir())
    conflicts: list[Path] = []
    if not force:
        for item in items:
            destination = target / item.name
            if destination.exists():
                conflicts.append(destination)
        if conflicts:
            joined = "\n".join(str(path) for path in conflicts)
            raise SystemExit(f"Refusing to overwrite existing files. Re-run with --force to overwrite:\n{joined}")
    for item in items:
        destination = target / item.name
        with resources.as_file(item) as path:
            if path.is_file():
                shutil.copyfile(path, destination)
    print(f"Copied fastapi SDRP integration files to {target}")
    print("Wire the router into your app, start it, then run siglume-check verify before opening checkout.")


def _load_dotenv() -> None:
    path = Path.cwd() / ".env"
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key, value.strip("\"'"))


def _check(checks: list[dict[str, str]], name: str, passed: bool, message: str) -> None:
    checks.append({"name": name, "status": "pass" if passed else "fail", "message": "ready" if passed else message})


def _has_failures(checks: list[dict[str, str]]) -> bool:
    return any(item["status"] == "fail" for item in checks)


def _is_https_origin(value: str) -> bool:
    try:
        parsed = urlsplit(value)
        return parsed.scheme == "https" and value.rstrip("/") == f"{parsed.scheme}://{parsed.netloc}"
    except Exception:
        return False


def _is_allowed_origin(value: str, sandbox_mode: bool) -> bool:
    if _is_https_origin(value):
        return True
    if not sandbox_mode:
        return False
    try:
        parsed = urlsplit(value)
        return parsed.scheme == "http" and _is_localhost(parsed.hostname) and value.rstrip("/") == f"{parsed.scheme}://{parsed.netloc}"
    except Exception:
        return False


def _is_https_url(value: str) -> bool:
    try:
        return urlsplit(value).scheme == "https"
    except Exception:
        return False


def _is_allowed_webhook_url(value: str, sandbox_mode: bool) -> bool:
    if _is_https_url(value):
        return True
    if not sandbox_mode:
        return False
    try:
        parsed = urlsplit(value)
        return parsed.scheme == "http" and _is_localhost(parsed.hostname)
    except Exception:
        return False


def _is_localhost(hostname: str | None) -> bool:
    return str(hostname or "").lower() in {"localhost", "127.0.0.1", "::1"}


def _is_standard_amount(currency: str, amount_minor: int) -> bool:
    return currency in {"JPY", "USD"} and amount_minor >= (301 if currency == "USD" else 501)


def _active_like(value: object) -> bool:
    return str(value or "").lower() in {"active", "ready", "current", "ok", "enabled", "paid", "complete", "completed"}


def _merchant_status_allowed(value: object) -> bool:
    return str(value or "").lower() in {"active", "ready"}


def _includes_event_type(event_types: object, event_type: str) -> bool:
    if not isinstance(event_types, list) or not event_types:
        return True
    return event_type in {str(item) for item in event_types}


def _urls_equal(left: str, right: str) -> bool:
    try:
        return urlsplit(left).geturl() == urlsplit(right).geturl()
    except Exception:
        return False


def _subscription_id(subscription: dict[str, object] | None) -> str:
    if not subscription:
        return ""
    return str(subscription.get("id") or subscription.get("webhook_subscription_id") or subscription.get("subscription_id") or "")


def _check_webhook_delivery_probe(
    checks: list[dict[str, str]],
    merchant: DirectRequestPaymentMerchantClient,
    *,
    merchant_key: str,
    subscription: dict[str, object] | None,
) -> None:
    subscription_id = _subscription_id(subscription)
    if not subscription_id:
        _check(checks, "webhook_delivery_probe_passed", False, "Cannot run webhook delivery probe without a matching subscription id.")
        return
    try:
        nonce = int(time.time() * 1000)
        queued = merchant.queue_webhook_test_delivery(
            event_type="direct_payment.confirmed",
            subscription_ids=[subscription_id],
            data={
                "mode": "readiness_probe",
                "readiness_probe": True,
                "merchant": merchant_key,
                "direct_payment_requirement_id": f"dpr_readiness_{nonce}",
                "requirement_id": f"dpr_readiness_{nonce}",
                "challenge_hash": "sha256:readiness_probe",
                "pricing_band": "standard",
                "settlement_status": "readiness_probe",
            },
        )
        event = queued.get("event") if isinstance(queued.get("event"), dict) else {}
        event_id = str(event.get("id") or "")
        deadline = time.time() + 10
        while event_id and time.time() < deadline:
            deliveries = merchant.list_webhook_deliveries(
                subscription_id=subscription_id,
                event_type="direct_payment.confirmed",
                limit=10,
            )
            for delivery in deliveries:
                if str(delivery.get("event_id") or "") != event_id:
                    continue
                if delivery.get("delivery_status") == "delivered":
                    _check(checks, "webhook_delivery_probe_passed", True, "ready")
                    return
                if delivery.get("delivery_status") == "failed":
                    _check(
                        checks,
                        "webhook_delivery_probe_passed",
                        False,
                        f"Webhook delivery failed with response_status={delivery.get('response_status') or 'unknown'}.",
                    )
                    return
            time.sleep(1)
        _check(checks, "webhook_delivery_probe_passed", False, "Webhook test delivery was queued but did not report delivered before timeout. Check callback reachability and delivery logs.")
    except Exception as exc:  # noqa: BLE001
        _check(checks, "webhook_delivery_probe_passed", False, _api_error_message(exc, "Webhook delivery probe failed."))


def _api_error_message(error: object, fallback: str) -> str:
    if isinstance(error, SiglumeApiError):
        return f"{fallback} {error.code} ({error.status})."
    return fallback


if __name__ == "__main__":
    main()
