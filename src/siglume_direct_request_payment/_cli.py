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

    readiness = subparsers.add_parser("readiness")
    readiness.add_argument("--merchant", default=os.getenv("SIGLUME_DIRECT_PAYMENT_MERCHANT", ""))
    readiness.add_argument("--origin", default=os.getenv("SHOP_PUBLIC_ORIGIN", ""))
    readiness.add_argument("--webhook-url", default=os.getenv("SHOP_WEBHOOK_URL", ""))
    readiness.add_argument("--currency", default=os.getenv("SIGLUME_DIRECT_PAYMENT_TEST_CURRENCY", "JPY"))
    readiness.add_argument("--amount-minor", type=int, default=0)
    readiness.add_argument("--base-url", default=os.getenv("SIGLUME_API_BASE"))
    readiness.add_argument("--no-api", action="store_true")
    readiness.add_argument("--no-probe", action="store_true")
    readiness.add_argument("--json", action="store_true")

    init = subparsers.add_parser("init")
    init.add_argument("framework", choices=["fastapi"])
    init.add_argument("--target", required=True)
    init.add_argument("--force", action="store_true")

    args = parser.parse_args()
    if args.command in (None, "help"):
        parser.print_help()
        return
    if args.command == "readiness":
        ok = _readiness(args)
        raise SystemExit(0 if ok else 1)
    if args.command == "init":
        _init_fastapi(Path(args.target), force=bool(args.force))
        return


def _readiness(args: argparse.Namespace) -> bool:
    checks: list[dict[str, str]] = []
    token = os.getenv("SIGLUME_MERCHANT_AUTH_TOKEN") or os.getenv("SIGLUME_AUTH_TOKEN") or ""
    currency = str(args.currency).upper()
    amount_minor = int(args.amount_minor or os.getenv("SIGLUME_DIRECT_PAYMENT_TEST_AMOUNT_MINOR") or (301 if currency == "USD" else 501))

    _check(checks, "merchant_key", bool(args.merchant), "Set SIGLUME_DIRECT_PAYMENT_MERCHANT or pass --merchant.")
    _check(checks, "merchant_token", bool(token) and not token.startswith("cli_"), "Set SIGLUME_MERCHANT_AUTH_TOKEN to a merchant Siglume bearer token, not a cli_ key.")
    _check(checks, "shop_origin", _is_https_origin(args.origin), "Set SHOP_PUBLIC_ORIGIN to an https origin, for example https://www.example.com.")
    _check(checks, "webhook_url", _is_https_url(args.webhook_url), "Set SHOP_WEBHOOK_URL to a public https webhook URL.")
    _check(checks, "standard_probe_amount", _is_standard_amount(currency, amount_minor), "Use a Standard-band probe amount: JPY 501+ or USD 301+ minor units.")

    if not args.no_api and not _has_failures(checks):
        merchant = DirectRequestPaymentMerchantClient(auth_token=token, base_url=args.base_url)
        try:
            response = merchant.get_merchant(args.merchant)
            account = response.get("merchant_account") or {}
            _check(checks, "merchant_exists", bool(account.get("merchant")), "Run merchant setup before checkout.")
            _check(
                checks,
                "billing_mandate",
                bool(account.get("billing_mandate_id")) or _active_like(account.get("billing_status")),
                "Complete the merchant billing mandate wallet approval.",
            )
            if account.get("status") and not _active_like(account.get("status")):
                checks.append({"name": "merchant_status", "status": "warn", "message": f"Merchant status is {account.get('status')}; confirm it is allowed to accept payments."})
            if account.get("billing_status") and not _active_like(account.get("billing_status")):
                checks.append({"name": "billing_status", "status": "warn", "message": f"Billing status is {account.get('billing_status')}; confirm it is active before accepting payments."})
        except Exception as exc:  # noqa: BLE001 - CLI must convert all failures to readiness output.
            _check(checks, "merchant_api", False, _api_error_message(exc, "Could not read the merchant account."))

        if not args.no_probe and not _has_failures(checks):
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
                _check(checks, "hosted_checkout", bool(session.get("checkout_url") and session.get("challenge_hash")), "Hosted Checkout did not return a checkout_url.")
            except HostedCheckoutNotAvailableError:
                _check(checks, "hosted_checkout", False, "Hosted Checkout is not enabled for this merchant account. Ask Siglume to enable it before coding the human checkout path.")
            except Exception as exc:  # noqa: BLE001
                _check(checks, "hosted_checkout", False, _api_error_message(exc, "Hosted Checkout probe failed. Check checkout_allowed_origins, currency, amount, and billing mandate."))

    ok = not _has_failures(checks)
    if args.json:
        print(json.dumps({"ok": ok, "checks": checks}, indent=2))
    else:
        for item in checks:
            mark = "OK" if item["status"] == "pass" else "WARN" if item["status"] == "warn" else "FAIL"
            print(f"{mark} {item['name']}: {item['message']}")
        print("Ready for 10-minute SDRP integration." if ok else "Not ready. Fix the FAIL items before coding checkout.")
    return ok


def _init_fastapi(target: Path, *, force: bool) -> None:
    target = target.resolve()
    target.mkdir(parents=True, exist_ok=True)
    source = resources.files("siglume_direct_request_payment").joinpath("templates/fastapi")
    for item in source.iterdir():
        destination = target / item.name
        if destination.exists() and not force:
            raise SystemExit(f"{destination} already exists. Re-run with --force to overwrite.")
        with resources.as_file(item) as path:
            if path.is_file():
                shutil.copyfile(path, destination)
    print(f"Copied fastapi SDRP integration files to {target}")
    print("Wire the router into your app, then run siglume-check readiness before opening checkout.")


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


def _is_https_url(value: str) -> bool:
    try:
        return urlsplit(value).scheme == "https"
    except Exception:
        return False


def _is_standard_amount(currency: str, amount_minor: int) -> bool:
    return currency in {"JPY", "USD"} and amount_minor >= (301 if currency == "USD" else 501)


def _active_like(value: object) -> bool:
    return str(value or "").lower() in {"active", "ready", "current", "ok", "enabled", "paid", "complete", "completed"}


def _api_error_message(error: object, fallback: str) -> str:
    if isinstance(error, SiglumeApiError):
        return f"{fallback} {error.code} ({error.status})."
    return fallback


if __name__ == "__main__":
    main()
