#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildWebhookSignatureHeader,
  DirectRequestPaymentMerchantClient,
  HostedCheckoutNotAvailableError,
  SiglumeApiError,
} from "../dist/index.js";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

main().catch((error) => {
  console.error(`siglume-sdrp: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

async function main() {
  loadDotEnv();
  const [command = "help", ...args] = process.argv.slice(2);
  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }
  if (command === "readiness" || command === "verify" || command === "doctor") {
    await readiness(parseArgs(args), { requireProbe: true, label: command === "verify" ? "verify" : "readiness" });
    return;
  }
  if (command === "preflight") {
    const options = parseArgs(args);
    options.webhookDeliveryProbe = false;
    await readiness(options, { requireProbe: false, label: "preflight" });
    return;
  }
  if (command === "sandbox") {
    await sandbox(parseArgs(args));
    return;
  }
  if (command === "init") {
    await init(args);
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

function printHelp() {
  console.log(`Siglume SDRP integration CLI

Usage:
  siglume-check preflight --merchant <key> --origin <https://shop.example> --webhook-url <https://api.example/siglume/webhook>
  siglume-check readiness --merchant <key> --origin <https://shop.example> --webhook-url <https://api.example/siglume/webhook>
  siglume-check verify --merchant <key> --origin <https://shop.example> --webhook-url <https://api.example/siglume/webhook>
  siglume-sdrp sandbox --webhook-url <http://localhost:3000/payments/webhooks/siglume>
  siglume-sdrp init express --target src/siglume
  siglume-sdrp init fastapi --target app/siglume

Readiness options:
  --merchant <key>          Merchant key. Defaults to SIGLUME_DIRECT_PAYMENT_MERCHANT.
  --origin <origin>         Public shop origin. Defaults to SHOP_PUBLIC_ORIGIN.
  --webhook-url <url>       Public webhook URL. Defaults to SHOP_WEBHOOK_URL.
  --currency <JPY|USD>      Probe currency. Defaults to SIGLUME_DIRECT_PAYMENT_TEST_CURRENCY or JPY.
  --amount-minor <amount>   Standard-band probe amount. Defaults to 501 for JPY, 301 for USD.
  --base-url <url>          Siglume API base URL. Defaults to SIGLUME_API_BASE or production.
  --sandbox                 Use the local sandbox default API base (http://127.0.0.1:8787/v1).
  --no-api                  Validate local config only; do not call Siglume.
  --no-probe                Partial API check only; skips Hosted Checkout and webhook delivery probes.
  --json                    Print machine-readable JSON.

Sandbox options:
  --port <port>             Local sandbox port. Defaults to 8787.
  --merchant <key>          Sandbox merchant key. Defaults to sandbox_merchant.
  --origin <origin>         Shop origin allowed by the sandbox. Defaults to http://localhost:3000.
  --webhook-url <url>       Your local product webhook URL.
  --webhook-secret <secret> Sandbox webhook secret. Defaults to whsec_sandbox_local.
`);
}

function parseArgs(args) {
  const out = { api: true, probe: true, json: false };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--no-api") {
      out.api = false;
    } else if (arg === "--no-probe") {
      out.probe = false;
    } else if (arg === "--json") {
      out.json = true;
    } else if (arg === "--sandbox") {
      out.sandbox = true;
    } else if (arg === "--force") {
      out.force = true;
    } else if (arg.startsWith("--")) {
      const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      const value = args[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${arg} requires a value.`);
      }
      out[key] = value;
      i += 1;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }
  return out;
}

async function readiness(options, mode = { requireProbe: true, label: "readiness" }) {
  const checks = [];
  const sandboxMode = Boolean(options.sandbox) || String(process.env.SIGLUME_ENV || "").toLowerCase() === "sandbox";
  const merchant = options.merchant || process.env.SIGLUME_DIRECT_PAYMENT_MERCHANT || "";
  const origin = options.origin || process.env.SHOP_PUBLIC_ORIGIN || "";
  const webhookUrl = options.webhookUrl || process.env.SHOP_WEBHOOK_URL || "";
  const webhookSecret = process.env.SIGLUME_WEBHOOK_SECRET || "";
  const token = process.env.SIGLUME_MERCHANT_AUTH_TOKEN || process.env.SIGLUME_AUTH_TOKEN || "";
  const currency = normalizeCurrency(options.currency || process.env.SIGLUME_DIRECT_PAYMENT_TEST_CURRENCY || "JPY");
  const amountMinor = Number(options.amountMinor || process.env.SIGLUME_DIRECT_PAYMENT_TEST_AMOUNT_MINOR || (currency === "USD" ? 301 : 501));
  const baseUrl = options.baseUrl || process.env.SIGLUME_API_BASE || (sandboxMode ? process.env.SIGLUME_SANDBOX_API_BASE || "http://127.0.0.1:8787/v1" : undefined);
  const checkoutProbe = options.probe !== false && options.checkoutProbe !== false;
  const webhookDeliveryProbe = options.probe !== false && options.webhookDeliveryProbe !== false;

  check(checks, "target_environment", true, sandboxMode ? "sandbox" : "live");
  check(checks, "merchant_key", Boolean(merchant), "Set SIGLUME_DIRECT_PAYMENT_MERCHANT or pass --merchant.");
  check(checks, "merchant_token", Boolean(token) && (sandboxMode || !token.startsWith("cli_")), "Set SIGLUME_MERCHANT_AUTH_TOKEN to a merchant Siglume bearer token, not a cli_ key.");
  check(checks, "shop_origin", isAllowedOrigin(origin, sandboxMode), sandboxMode ? "Set SHOP_PUBLIC_ORIGIN to your local product origin, for example http://localhost:3000." : "Set SHOP_PUBLIC_ORIGIN to an https origin, for example https://www.example.com.");
  check(checks, "webhook_url", isAllowedWebhookUrl(webhookUrl, sandboxMode), sandboxMode ? "Set SHOP_WEBHOOK_URL to your local webhook URL, for example http://localhost:3000/payments/webhooks/siglume." : "Set SHOP_WEBHOOK_URL to a public https webhook URL.");
  check(checks, "webhook_secret_present", Boolean(webhookSecret) && webhookSecret.startsWith("whsec_"), "Set SIGLUME_WEBHOOK_SECRET to the webhook signing secret returned by setupCheckout/setup_checkout.");
  check(checks, "standard_probe_amount", isStandardAmount(currency, amountMinor), "Use a Standard-band probe amount: JPY 501+ or USD 301+ minor units.");

  if (options.api && !hasFailures(checks)) {
    const merchantClient = new DirectRequestPaymentMerchantClient({
      auth_token: token,
      base_url: baseUrl,
    });
    let matchingWebhookSubscription = null;
    try {
      const merchantResponse = await merchantClient.getMerchant(merchant);
      const account = merchantResponse.merchant_account || {};
      check(checks, "merchant_exists", Boolean(account.merchant), "Run merchant setup before checkout.");
      check(checks, "billing_mandate", Boolean(account.billing_mandate_id), "Complete the merchant billing mandate wallet approval.");
      check(checks, "billing_status_active", activeLike(account.billing_status), `Billing status is ${account.billing_status || "unknown"}; it must be active before accepting payments.`);
      check(checks, "merchant_status_active", merchantStatusAllowed(account.status), `Merchant status is ${account.status || "unknown"}; it must be active or ready before accepting payments.`);
    } catch (error) {
      check(checks, "merchant_api", false, apiErrorMessage(error, "Could not read the merchant account."));
    }

    if (!hasFailures(checks)) {
      try {
        const subscriptions = await merchantClient.listWebhookSubscriptions();
        const activeSubscriptions = subscriptions.filter((subscription) => activeLike(subscription.status));
        matchingWebhookSubscription = activeSubscriptions.find((subscription) => urlsEqual(subscription.callback_url, webhookUrl)) || null;
        check(checks, "webhook_subscription_exists", activeSubscriptions.length > 0, "Create an active webhook subscription before checkout.");
        check(checks, "webhook_callback_matches", Boolean(matchingWebhookSubscription), `No active webhook subscription points at ${webhookUrl}.`);
        check(
          checks,
          "direct_payment_confirmed_subscribed",
          Boolean(matchingWebhookSubscription) && includesEventType(matchingWebhookSubscription.event_types, "direct_payment.confirmed"),
          "The matching webhook subscription must include direct_payment.confirmed.",
        );
        check(
          checks,
          "webhook_secret_matches_subscription_hint",
          Boolean(matchingWebhookSubscription?.signing_secret_hint) && webhookSecret.endsWith(String(matchingWebhookSubscription.signing_secret_hint)),
          "SIGLUME_WEBHOOK_SECRET does not match the signing_secret_hint for the matching subscription. Rotate or re-save the webhook secret.",
        );
      } catch (error) {
        check(checks, "webhook_subscription_api", false, apiErrorMessage(error, "Could not read webhook subscriptions."));
      }
    }

    if (!checkoutProbe && mode.requireProbe && !hasFailures(checks)) {
      check(checks, "hosted_checkout_probe", false, "--no-probe skips Hosted Checkout and webhook delivery probes. Remove --no-probe for readiness.");
    } else if (!webhookDeliveryProbe && !mode.requireProbe && !hasFailures(checks)) {
      check(checks, "webhook_delivery_probe_skipped", true, "preflight only; run siglume-check verify after mounting and starting the webhook route.");
    }

    if (checkoutProbe && !hasFailures(checks)) {
      try {
        const session = await merchantClient.createCheckoutSession({
          merchant,
          amount_minor: amountMinor,
          currency,
          nonce: `sdrp-readiness-${Date.now()}`,
          success_url: `${origin}/siglume-readiness/success`,
          cancel_url: `${origin}/siglume-readiness/cancel`,
          metadata: { source: "siglume-sdrp-readiness" },
        });
        check(checks, "hosted_checkout_probe", Boolean(session.checkout_url && session.challenge_hash), "Hosted Checkout did not return a checkout_url.");
      } catch (error) {
        const message = error instanceof HostedCheckoutNotAvailableError
          ? "Hosted Checkout is not enabled for this merchant account. Ask Siglume to enable it before coding the human checkout path."
          : apiErrorMessage(error, "Hosted Checkout probe failed. Check checkout_allowed_origins, currency, amount, and billing mandate.");
        check(checks, "hosted_checkout_probe", false, message);
      }
    }

    if (webhookDeliveryProbe && !hasFailures(checks)) {
      await checkWebhookDeliveryProbe(checks, merchantClient, {
        merchant,
        subscription: matchingWebhookSubscription,
      });
    }
  }

  const ok = !hasFailures(checks);
  if (options.json) {
    console.log(JSON.stringify({ ok, checks }, null, 2));
  } else {
    for (const item of checks) {
      const mark = item.status === "pass" ? "OK" : item.status === "warn" ? "WARN" : "FAIL";
      console.log(`${mark} ${item.name}: ${item.message}`);
    }
    if (ok && !options.api) {
      console.log("Local config checks passed. API, Hosted Checkout, and webhook delivery readiness were not verified.");
    } else {
      if (ok && !webhookDeliveryProbe && !mode.requireProbe) {
        console.log(`Preflight passed (${sandboxMode ? "sandbox" : "live"}). Mount the routes, start your app, then run siglume-check verify.`);
      } else {
        console.log(ok ? `Ready for 10-minute SDRP integration (${sandboxMode ? "sandbox" : "live"}).` : `Not ready. Fix the FAIL items before ${mode.label === "preflight" ? "mounting checkout" : "opening checkout"}.`);
      }
    }
  }
  if (!ok) {
    process.exitCode = 1;
  }
}

async function init(args) {
  const framework = args[0];
  const parsed = parseArgs(args.slice(1));
  const target = parsed.target;
  if (!["express", "fastapi"].includes(framework)) {
    throw new Error("init requires framework: express or fastapi.");
  }
  if (!target) {
    throw new Error("init requires --target <directory>.");
  }
  const from = join(rootDir, "templates", framework);
  const to = resolve(process.cwd(), target);
  if (!Boolean(parsed.force)) {
    const conflicts = await findCopyConflicts(from, to);
    if (conflicts.length) {
      throw new Error(`Refusing to overwrite existing files. Re-run with --force to overwrite:\n${conflicts.join("\n")}`);
    }
  }
  await copyDir(from, to, Boolean(parsed.force));
  console.log(`Copied ${framework} SDRP integration files to ${to}`);
  console.log("Wire the exported router into your app, start it, then run siglume-check verify before opening checkout.");
}

async function sandbox(options) {
  const port = Number(options.port || process.env.SIGLUME_SANDBOX_PORT || 8787);
  const merchant = options.merchant || process.env.SIGLUME_DIRECT_PAYMENT_MERCHANT || "sandbox_merchant";
  const origin = options.origin || process.env.SHOP_PUBLIC_ORIGIN || "http://localhost:3000";
  const webhookUrl = options.webhookUrl || process.env.SHOP_WEBHOOK_URL || "";
  const webhookSecret = options.webhookSecret || process.env.SIGLUME_WEBHOOK_SECRET || "whsec_sandbox_local";
  if (!Number.isSafeInteger(port) || port <= 0) {
    throw new Error("--port must be a positive integer.");
  }
  if (!webhookUrl) {
    throw new Error("sandbox requires --webhook-url <your local product webhook URL>.");
  }
  if (!isAllowedWebhookUrl(webhookUrl, true)) {
    throw new Error("--webhook-url must be https or local http.");
  }

  const state = {
    merchant,
    origin,
    webhookUrl,
    webhookSecret,
    subscriptionId: "whsub_sandbox_local",
    sessions: new Map(),
    deliveries: [],
    meteredUsageEvents: [],
  };

  const server = createServer(async (req, res) => {
    try {
      await handleSandboxRequest(req, res, state, port);
    } catch (error) {
      sendJson(res, 500, {
        error: {
          code: "SANDBOX_INTERNAL_ERROR",
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  });

  await new Promise((resolveServer) => server.listen(port, "127.0.0.1", resolveServer));
  const apiBase = `http://127.0.0.1:${port}/v1`;
  if (options.json) {
    console.log(JSON.stringify({
      api_base: apiBase,
      merchant,
      webhook_url: webhookUrl,
      webhook_secret: webhookSecret,
    }, null, 2));
  } else {
    console.log("Siglume SDRP sandbox is running.");
    console.log(`SIGLUME_ENV=sandbox`);
    console.log(`SIGLUME_API_BASE=${apiBase}`);
    console.log(`SIGLUME_DIRECT_PAYMENT_MERCHANT=${merchant}`);
    console.log(`SIGLUME_MERCHANT_AUTH_TOKEN=sandbox_merchant_token`);
    console.log(`SIGLUME_WEBHOOK_SECRET=${webhookSecret}`);
    console.log(`SHOP_PUBLIC_ORIGIN=${origin}`);
    console.log(`SHOP_WEBHOOK_URL=${webhookUrl}`);
    console.log("");
    console.log(`Then run after your app is running: siglume-check verify --sandbox`);
  }
}

async function handleSandboxRequest(req, res, state, port) {
  const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
  if (req.method === "GET" && url.pathname === "/favicon.ico") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === `/v1/sdrp/direct-payments/merchants/${state.merchant}`) {
    sendEnvelope(res, 200, {
      merchant_account: {
        merchant_account_id: "macc_sandbox_local",
        merchant: state.merchant,
        merchant_user_id: "usr_sandbox_merchant",
        billing_mandate_id: "mandate_sandbox_active",
        status: "active",
        billing_status: "active",
        billing_plan: "launch",
        billing_currency: "JPY",
        token_symbol: "JPYC",
        metadata_jsonb: {
          environment: "sandbox",
          checkout_allowed_origins: [state.origin],
          webhook_callback_url: state.webhookUrl,
        },
      },
      challenge_secret_created: true,
      mandate: { mandate_id: "mandate_sandbox_active", status: "active" },
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/v1/market/webhooks/subscriptions") {
    sendEnvelope(res, 200, [sandboxSubscription(state)]);
    return;
  }

  if (req.method === "POST" && url.pathname === "/v1/sdrp/direct-payments/checkout-sessions") {
    const body = await readJson(req);
    if (String(body.merchant || "") !== state.merchant) {
      sendJson(res, 404, { error: { code: "EXTERNAL_402_MERCHANT_NOT_FOUND", message: "sandbox merchant not found" } });
      return;
    }
    let currency;
    let amountMinor;
    let successUrl;
    let cancelUrl;
    try {
      currency = normalizeCurrency(body.currency || "JPY");
      amountMinor = normalizePositiveAmountMinor(body.amount_minor);
      successUrl = normalizeSandboxReturnUrl(body.success_url, "success_url");
      cancelUrl = normalizeSandboxReturnUrl(body.cancel_url, "cancel_url");
    } catch (error) {
      sendJson(res, 400, {
        error: {
          code: "INVALID_CHECKOUT_SESSION_REQUEST",
          message: error instanceof Error ? error.message : "invalid checkout session request",
        },
      });
      return;
    }
    const sessionId = `chk_sandbox_${state.sessions.size + 1}`;
    const challengeHash = `sha256:sandbox_${hashString(`${sessionId}:${body.nonce || ""}`).slice(0, 32)}`;
    const session = {
      session_id: sessionId,
      merchant: state.merchant,
      amount_minor: amountMinor,
      currency,
      token_symbol: currency === "USD" ? "USDC" : "JPYC",
      status: "open",
      challenge_hash: challengeHash,
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata_jsonb: body.metadata && typeof body.metadata === "object" ? body.metadata : {},
      checkout_url: `http://127.0.0.1:${port}/pay/${sessionId}`,
      expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    };
    state.sessions.set(sessionId, session);
    sendEnvelope(res, 201, {
      checkout_url: session.checkout_url,
      session_id: sessionId,
      challenge_hash: challengeHash,
      status: "open",
      expires_at: session.expires_at,
    });
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/v1/sdrp/direct-payments/checkout-sessions/")) {
    const sessionId = decodeURIComponent(url.pathname.split("/").pop() || "");
    const session = state.sessions.get(sessionId);
    if (!session) {
      sendJson(res, 404, { error: { code: "CHECKOUT_SESSION_NOT_FOUND", message: "sandbox session not found" } });
      return;
    }
    sendEnvelope(res, 200, session);
    return;
  }

  if (req.method === "POST" && url.pathname === "/v1/market/webhooks/test-deliveries") {
    const body = await readJson(req);
    const event = sandboxEvent({
      event_type: String(body.event_type || "direct_payment.confirmed"),
      data: body.data && typeof body.data === "object" ? body.data : {},
    });
    await deliverSandboxWebhook(state, event);
    sendEnvelope(res, 201, { queued: true, event: { id: event.id, type: event.type } });
    return;
  }

  if (req.method === "GET" && url.pathname === "/v1/market/webhooks/deliveries") {
    let deliveries = [...state.deliveries];
    const eventType = url.searchParams.get("event_type");
    if (eventType) deliveries = deliveries.filter((delivery) => delivery.event_type === eventType);
    const limit = Number(url.searchParams.get("limit") || 50);
    sendEnvelope(res, 200, deliveries.slice(0, Math.max(1, Math.min(limit, 100))));
    return;
  }

  if (req.method === "GET" && url.pathname === "/v1/sdrp/metered/my-summary") {
    sendEnvelope(res, 200, sandboxBuyerMeteredSummary(state, url));
    return;
  }

  if (req.method === "GET" && url.pathname === "/v1/sdrp/metered/provider/summary") {
    sendEnvelope(res, 200, sandboxProviderMeteredSummary(state, url));
    return;
  }

  if (req.method === "GET" && (
    url.pathname === "/v1/sdrp/metered/my-usage-events"
    || url.pathname === "/v1/sdrp/metered/provider/usage-events"
  )) {
    sendEnvelope(res, 200, {
      items: filterSandboxMeteredUsage(state, url),
      next_cursor: null,
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/v1/sdrp/metered/provider/settlement-batches") {
    sendEnvelope(res, 200, {
      items: sandboxSettlementBatches(state, url),
      next_cursor: null,
    });
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/pay/")) {
    const sessionId = decodeURIComponent(url.pathname.split("/").pop() || "");
    const session = state.sessions.get(sessionId);
    if (!session) {
      sendHtml(res, 404, "<h1>Sandbox checkout session not found</h1>");
      return;
    }
    sendHtml(res, 200, sandboxCheckoutHtml(session));
    return;
  }

  if (req.method === "POST" && url.pathname.startsWith("/v1/sandbox/checkout-sessions/") && url.pathname.endsWith("/confirm")) {
    const parts = url.pathname.split("/");
    const sessionId = decodeURIComponent(parts[4] || "");
    const session = state.sessions.get(sessionId);
    if (!session) {
      sendJson(res, 404, { error: { code: "CHECKOUT_SESSION_NOT_FOUND", message: "sandbox session not found" } });
      return;
    }
    if (session.status === "paid" && session.confirmation_event) {
      sendEnvelope(res, 200, sandboxConfirmResponse(session, session.confirmation_event));
      return;
    }
    session.status = "paid";
    session.requirement_id = `dpr_sandbox_${sessionId}`;
    const event = sandboxPaymentConfirmedEvent(session);
    session.confirmation_event = event;
    const usageEvent = sandboxMeteredUsageEvent(session, event);
    if (usageEvent) {
      state.meteredUsageEvents.unshift(usageEvent);
    }
    await deliverSandboxWebhook(state, event);
    sendEnvelope(res, 200, sandboxConfirmResponse(session, event));
    return;
  }

  sendJson(res, 404, { error: { code: "SANDBOX_ROUTE_NOT_FOUND", message: "sandbox route not found" } });
}

function sandboxSubscription(state) {
  return {
    id: state.subscriptionId,
    webhook_subscription_id: state.subscriptionId,
    callback_url: state.webhookUrl,
    status: "active",
    event_types: ["direct_payment.confirmed"],
    signing_secret_hint: state.webhookSecret.slice(-4),
    metadata: { environment: "sandbox" },
  };
}

function sandboxEvent({ event_type, data }) {
  return {
    id: `evt_sandbox_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    type: event_type,
    api_version: "2026-06-20",
    occurred_at: new Date().toISOString(),
    data: {
      mode: "external_402",
      pricing_band: "standard",
      finality: "per_payment_onchain",
      settlement_status: "settled",
      requirement_id: `dpr_sandbox_${Date.now()}`,
      challenge_hash: "sha256:sandbox_readiness",
      chain_receipt_id: `chain_sandbox_${Date.now()}`,
      environment: "sandbox",
      ...data,
    },
  };
}

function sandboxPaymentConfirmedEvent(session) {
  const pricingBand = classifySandboxAmount(session.currency, Number(session.amount_minor));
  const metered = pricingBand === "micro" || pricingBand === "nano";
  const accounting = metered ? sandboxMeteredAccounting(session, pricingBand) : null;
  return sandboxEvent({
    event_type: "direct_payment.confirmed",
    data: {
      merchant: session.merchant,
      requirement_id: session.requirement_id,
      direct_payment_requirement_id: session.requirement_id,
      challenge_hash: session.challenge_hash,
      amount_minor: session.amount_minor,
      currency: session.currency,
      token_symbol: session.token_symbol,
      pricing_band: pricingBand,
      settlement_cadence: pricingBand === "micro" ? "weekly" : pricingBand === "nano" ? "monthly" : "per_payment",
      finality: metered ? "aggregated_onchain_settlement" : "per_payment_onchain",
      settlement_status: metered ? "pending_settlement" : "settled",
      chain_receipt_id: metered ? undefined : `chain_sandbox_${session.session_id}`,
      environment: "sandbox",
      ...(accounting ? {
        provider_gross_amount_minor: accounting.provider_gross_amount_minor,
        provider_usage_amount_minor: accounting.provider_usage_amount_minor,
        protocol_fee_minor: accounting.protocol_fee_minor,
        provider_receivable_minor: accounting.provider_receivable_minor,
        gross_buyer_debit_minor: accounting.gross_buyer_debit_minor,
        buyer_debit_minor: accounting.buyer_debit_minor,
        rounding_delta_minor: accounting.rounding_delta_minor,
        settlement_threshold_minor: accounting.settlement_threshold_minor,
      } : {}),
    },
  });
}

function sandboxMeteredUsageEvent(session, event) {
  const pricingBand = classifySandboxAmount(session.currency, Number(session.amount_minor));
  if (pricingBand !== "micro" && pricingBand !== "nano") return null;
  const accounting = sandboxMeteredAccounting(session, pricingBand);
  return {
    metered_usage_id: `mu_sandbox_${session.session_id}`,
    created_at: new Date().toISOString(),
    plan_type: pricingBand,
    pricing_band: pricingBand,
    settlement_cadence: pricingBand === "micro" ? "weekly" : "monthly",
    period_start: new Date().toISOString(),
    period_end: null,
    listing_id: session.metadata_jsonb?.listing_id || "sandbox_listing",
    capability_key: session.metadata_jsonb?.capability_key || "sandbox_checkout",
    operation_key: session.metadata_jsonb?.operation_key || "checkout.confirm",
    currency: session.currency,
    token_symbol: session.token_symbol,
    status: "open",
    settlement_batch_id: null,
    buyer_period_ref: `buyer_sandbox:${session.merchant}:${session.token_symbol}:${pricingBand}`,
    requirement_id: session.requirement_id,
    challenge_hash: session.challenge_hash,
    event_id: event.id,
    ...accounting,
  };
}

function sandboxMeteredAccounting(session, pricingBand) {
  const currency = String(session.currency || "").toUpperCase();
  const providerGrossTenths = Number(session.amount_minor) * 10;
  const protocolFeeTenths = sandboxProtocolFeeTenths(currency, pricingBand);
  const providerReceivableTenths = providerGrossTenths - protocolFeeTenths;
  return {
    provider_gross_amount_minor: formatTenths(providerGrossTenths),
    provider_usage_amount_minor: formatTenths(providerGrossTenths),
    protocol_fee_minor: formatTenths(protocolFeeTenths),
    provider_receivable_minor: formatTenths(providerReceivableTenths),
    gross_buyer_debit_minor: formatTenths(providerGrossTenths),
    buyer_debit_minor: formatTenths(providerGrossTenths),
    rounding_delta_minor: "0",
    settlement_threshold_minor: "10000",
  };
}

function sandboxProtocolFeeTenths(currency, pricingBand) {
  if (pricingBand === "micro") return currency === "USD" ? 10 : 20;
  return currency === "USD" ? 1 : 2;
}

function sandboxBuyerMeteredSummary(state, url) {
  const events = filterSandboxMeteredUsage(state, url);
  const batches = sandboxSettlementBatches(state, url);
  return {
    role: "buyer",
    open_periods: sandboxOpenPeriods(events),
    settlement_batches: batches,
    past_due_blocks: [],
    balance_sufficiency: { sufficient: true },
  };
}

function sandboxProviderMeteredSummary(state, url) {
  const events = filterSandboxMeteredUsage(state, url);
  const totals = sandboxProviderTotals(events);
  return {
    role: "provider",
    timezone: "UTC",
    filters: Object.fromEntries(url.searchParams.entries()),
    open_periods: sandboxOpenPeriods(events),
    periods: sandboxSettlementBatches(state, url),
    totals,
  };
}

function filterSandboxMeteredUsage(state, url) {
  const planType = url.searchParams.get("plan_type");
  const tokenSymbol = url.searchParams.get("token_symbol");
  const status = url.searchParams.get("status");
  return state.meteredUsageEvents.filter((event) => {
    if (planType && event.plan_type !== planType) return false;
    if (tokenSymbol && event.token_symbol !== tokenSymbol) return false;
    if (status && event.status !== status) return false;
    return true;
  });
}

function sandboxOpenPeriods(events) {
  return Object.values(groupSandboxMeteredEvents(events)).map((group) => {
    const grossTenths = sumTenths(group.events, "provider_gross_amount_minor");
    const protocolFeeTenths = sumTenths(group.events, "protocol_fee_minor");
    const receivableTenths = sumTenths(group.events, "provider_receivable_minor");
    const buyerDebitTenths = sumTenths(group.events, "buyer_debit_minor");
    const thresholdTenths = 10000 * 10;
    const thresholdReached = grossTenths >= thresholdTenths;
    return {
      plan_type: group.plan_type,
      settlement_cadence: group.plan_type === "micro" ? "weekly" : "monthly",
      currency: group.currency,
      token_symbol: group.token_symbol,
      period_start: group.events[group.events.length - 1]?.created_at ?? null,
      period_end: null,
      close_at: null,
      settlement_trigger: thresholdReached ? "amount_threshold" : null,
      settlement_threshold_minor: "10000",
      threshold_reached_at: thresholdReached ? group.events[0]?.created_at ?? null : null,
      provider_gross_amount_minor: formatTenths(grossTenths),
      provider_usage_amount_minor: formatTenths(grossTenths),
      protocol_fee_minor: formatTenths(protocolFeeTenths),
      provider_receivable_minor: formatTenths(receivableTenths),
      buyer_debit_minor: formatTenths(buyerDebitTenths),
      total_unsettled_exposure_minor: formatTenths(grossTenths),
    };
  });
}

function sandboxSettlementBatches(state, url) {
  const events = filterSandboxMeteredUsage(state, url);
  return sandboxOpenPeriods(events)
    .filter((period) => period.settlement_trigger === "amount_threshold")
    .map((period) => ({
      settlement_batch_id: `batch_sandbox_${period.plan_type}_${period.currency}_${period.token_symbol}`,
      status: "notice_pending",
      notice_status: "pending",
      not_before_attempt_at: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
      expected_scheduled_debit_at: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
      ...period,
    }));
}

function sandboxProviderTotals(events) {
  return {
    settled_provider_receivable_minor: "0",
    unsettled_provider_receivable_minor: formatTenths(sumTenths(events, "provider_receivable_minor")),
    past_due_provider_receivable_minor: "0",
    terminal_provider_receivable_minor: "0",
    uncollectible_provider_receivable_minor: "0",
    written_off_provider_receivable_minor: "0",
  };
}

function groupSandboxMeteredEvents(events) {
  const groups = {};
  for (const event of events) {
    const key = `${event.plan_type}:${event.currency}:${event.token_symbol}`;
    groups[key] ||= {
      plan_type: event.plan_type,
      currency: event.currency,
      token_symbol: event.token_symbol,
      events: [],
    };
    groups[key].events.push(event);
  }
  return groups;
}

function sumTenths(items, field) {
  return items.reduce((total, item) => total + parseTenths(item[field]), 0);
}

function parseTenths(value) {
  return Math.round(Number(value || 0) * 10);
}

function formatTenths(value) {
  if (value % 10 === 0) return String(value / 10);
  return (value / 10).toFixed(1);
}

function sandboxConfirmResponse(session, event) {
  return {
    status: "paid",
    redirect_url: `${session.success_url}${session.success_url.includes("?") ? "&" : "?"}session_id=${encodeURIComponent(session.session_id)}`,
    event: { id: event.id, type: event.type },
  };
}

async function deliverSandboxWebhook(state, event) {
  const rawBody = JSON.stringify(event);
  const signature = await buildWebhookSignatureHeader(state.webhookSecret, rawBody);
  let status = "failed";
  let responseStatus = null;
  try {
    const response = await fetch(state.webhookUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "siglume-signature": signature,
        "x-siglume-environment": "sandbox",
      },
      body: rawBody,
    });
    responseStatus = response.status;
    status = response.ok ? "delivered" : "failed";
  } catch {
    status = "failed";
  }
  state.deliveries.unshift({
    id: `whdel_sandbox_${state.deliveries.length + 1}`,
    subscription_id: state.subscriptionId,
    event_id: event.id,
    event_type: event.type,
    delivery_status: status,
    response_status: responseStatus,
    delivered_at: status === "delivered" ? new Date().toISOString() : null,
  });
}

function sandboxCheckoutHtml(session) {
  return `<!doctype html>
<meta charset="utf-8">
<title>Siglume SDRP Sandbox Checkout</title>
<body style="font-family: system-ui, sans-serif; max-width: 680px; margin: 48px auto; line-height: 1.5;">
  <h1>Siglume SDRP Sandbox Checkout</h1>
  <p>This is a local sandbox page. No real wallet, token, or on-chain settlement is used.</p>
  <dl>
    <dt>Session</dt><dd>${escapeHtml(session.session_id)}</dd>
    <dt>Merchant</dt><dd>${escapeHtml(session.merchant)}</dd>
    <dt>Amount</dt><dd>${escapeHtml(String(session.amount_minor))} ${escapeHtml(session.currency)}</dd>
    <dt>Status</dt><dd id="status">${escapeHtml(session.status)}</dd>
  </dl>
  <button id="confirm" style="font: inherit; padding: 10px 14px;">Confirm sandbox payment</button>
  <pre id="output"></pre>
  <script>
    document.getElementById("confirm").addEventListener("click", async () => {
      const response = await fetch("/v1/sandbox/checkout-sessions/${encodeURIComponent(session.session_id)}/confirm", { method: "POST" });
      const body = await response.json();
      document.getElementById("status").textContent = body.data?.status || "failed";
      document.getElementById("output").textContent = JSON.stringify(body, null, 2);
      if (body.data?.redirect_url) {
        window.setTimeout(() => window.location.assign(body.data.redirect_url), 400);
      }
    });
  </script>
</body>`;
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  return JSON.parse(text);
}

function sendEnvelope(res, status, data) {
  sendJson(res, status, { data, meta: { request_id: "req_sandbox", trace_id: "trc_sandbox" } });
}

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function sendHtml(res, status, body) {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  res.end(body);
}

function hashString(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}

function classifySandboxAmount(currency, amountMinor) {
  const normalizedCurrency = String(currency || "").toUpperCase();
  if (normalizedCurrency === "JPY") {
    if (amountMinor >= 501) return "standard";
    if (amountMinor >= 50) return "micro";
    return "nano";
  }
  if (normalizedCurrency === "USD") {
    if (amountMinor >= 301) return "standard";
    if (amountMinor >= 31) return "micro";
    return "nano";
  }
  return "standard";
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[char]));
}

async function findCopyConflicts(from, to) {
  const conflicts = [];
  for (const entry of await readdir(from)) {
    const src = join(from, entry);
    const dst = join(to, entry);
    const info = await stat(src);
    if (info.isDirectory()) {
      conflicts.push(...await findCopyConflicts(src, dst));
    } else if (await exists(dst)) {
      conflicts.push(dst);
    }
  }
  return conflicts;
}

async function copyDir(from, to, force) {
  await mkdir(to, { recursive: true });
  for (const entry of await readdir(from)) {
    const src = join(from, entry);
    const dst = join(to, entry);
    const info = await stat(src);
    if (info.isDirectory()) {
      await copyDir(src, dst, force);
    } else {
      if (!force && await exists(dst)) {
        throw new Error(`${dst} already exists. Re-run with --force to overwrite.`);
      }
      await mkdir(dirname(dst), { recursive: true });
      await writeFile(dst, await readFile(src));
    }
  }
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function loadDotEnv() {
  try {
    const text = readFileSync(resolve(process.cwd(), ".env"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const [key, ...rest] = trimmed.split("=");
      if (key && !process.env[key]) {
        process.env[key] = rest.join("=").replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    // .env is optional.
  }
}

function check(checks, name, passed, message) {
  checks.push({ name, status: passed ? "pass" : "fail", message: passed ? "ready" : message });
}

function warnIf(checks, name, condition, message) {
  if (condition) {
    checks.push({ name, status: "warn", message });
  }
}

function hasFailures(checks) {
  return checks.some((item) => item.status === "fail");
}

function isHttpsOrigin(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === value.replace(/\/$/, "");
  } catch {
    return false;
  }
}

function isAllowedOrigin(value, sandboxMode) {
  if (isHttpsOrigin(value)) return true;
  if (!sandboxMode) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" && isLocalhost(url.hostname) && url.origin === value.replace(/\/$/, "");
  } catch {
    return false;
  }
}

function isHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

function isAllowedWebhookUrl(value, sandboxMode) {
  if (isHttpsUrl(value)) return true;
  if (!sandboxMode) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" && isLocalhost(url.hostname);
  } catch {
    return false;
  }
}

function isLocalhost(hostname) {
  const host = String(hostname || "").toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}

function normalizeCurrency(value) {
  const currency = String(value || "").toUpperCase();
  if (currency !== "JPY" && currency !== "USD") {
    throw new Error("--currency must be JPY or USD.");
  }
  return currency;
}

function normalizePositiveAmountMinor(value) {
  const amountMinor = Number(value);
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    throw new Error("amount_minor must be a positive integer.");
  }
  return amountMinor;
}

function normalizeSandboxReturnUrl(value, name) {
  const text = String(value || "").trim();
  try {
    const url = new URL(text);
    if (url.protocol === "https:" || (url.protocol === "http:" && isLocalhost(url.hostname))) {
      return url.href;
    }
  } catch {
    // Fall through to a consistent validation error.
  }
  throw new Error(`${name} must be an https URL, or a local http URL in sandbox.`);
}

function isStandardAmount(currency, amountMinor) {
  return Number.isSafeInteger(amountMinor) && amountMinor >= (currency === "USD" ? 301 : 501);
}

function activeLike(value) {
  return /^(active|ready|current|ok|enabled|paid|complete|completed)$/i.test(String(value || ""));
}

function merchantStatusAllowed(value) {
  return /^(active|ready)$/i.test(String(value || ""));
}

function includesEventType(eventTypes, eventType) {
  if (!Array.isArray(eventTypes) || eventTypes.length === 0) return true;
  return eventTypes.map((item) => String(item)).includes(eventType);
}

function urlsEqual(left, right) {
  try {
    const leftUrl = new URL(String(left || ""));
    const rightUrl = new URL(String(right || ""));
    return leftUrl.href === rightUrl.href;
  } catch {
    return false;
  }
}

function subscriptionId(subscription) {
  return String(subscription?.id || subscription?.webhook_subscription_id || subscription?.subscription_id || "");
}

async function checkWebhookDeliveryProbe(checks, merchantClient, { merchant, subscription }) {
  const id = subscriptionId(subscription);
  if (!id) {
    check(checks, "webhook_delivery_probe_passed", false, "Cannot run webhook delivery probe without a matching subscription id.");
    return;
  }
  try {
    const queued = await merchantClient.queueWebhookTestDelivery({
      event_type: "direct_payment.confirmed",
      subscription_ids: [id],
      data: {
        mode: "readiness_probe",
        readiness_probe: true,
        merchant,
        direct_payment_requirement_id: `dpr_readiness_${Date.now()}`,
        requirement_id: `dpr_readiness_${Date.now()}`,
        challenge_hash: "sha256:readiness_probe",
        pricing_band: "standard",
        settlement_status: "readiness_probe",
      },
    });
    const eventId = String(queued?.event?.id || "");
    const deadline = Date.now() + 10000;
    while (eventId && Date.now() < deadline) {
      const deliveries = await merchantClient.listWebhookDeliveries({
        subscription_id: id,
        event_type: "direct_payment.confirmed",
        limit: 10,
      });
      const delivery = deliveries.find((item) => String(item.event_id || "") === eventId);
      if (delivery?.delivery_status === "delivered") {
        check(checks, "webhook_delivery_probe_passed", true, "ready");
        return;
      }
      if (delivery?.delivery_status === "failed") {
        check(checks, "webhook_delivery_probe_passed", false, `Webhook delivery failed with response_status=${delivery.response_status ?? "unknown"}.`);
        return;
      }
      await sleep(1000);
    }
    check(checks, "webhook_delivery_probe_passed", false, "Webhook test delivery was queued but did not report delivered before timeout. Check callback reachability and delivery logs.");
  } catch (error) {
    check(checks, "webhook_delivery_probe_passed", false, apiErrorMessage(error, "Webhook delivery probe failed."));
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function apiErrorMessage(error, fallback) {
  if (error instanceof SiglumeApiError) {
    return `${fallback} ${error.code} (${error.status}).`;
  }
  return fallback;
}
