#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
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
  if (command === "readiness" || command === "doctor") {
    await readiness(parseArgs(args));
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
  siglume-check readiness --merchant <key> --origin <https://shop.example> --webhook-url <https://api.example/siglume/webhook>
  siglume-sdrp init express --target src/siglume
  siglume-sdrp init fastapi --target app/siglume

Readiness options:
  --merchant <key>          Merchant key. Defaults to SIGLUME_DIRECT_PAYMENT_MERCHANT.
  --origin <origin>         Public shop origin. Defaults to SHOP_PUBLIC_ORIGIN.
  --webhook-url <url>       Public webhook URL. Defaults to SHOP_WEBHOOK_URL.
  --currency <JPY|USD>      Probe currency. Defaults to SIGLUME_DIRECT_PAYMENT_TEST_CURRENCY or JPY.
  --amount-minor <amount>   Standard-band probe amount. Defaults to 501 for JPY, 301 for USD.
  --base-url <url>          Siglume API base URL. Defaults to SIGLUME_API_BASE or production.
  --no-api                  Validate local config only; do not call Siglume.
  --no-probe                Call getMerchant only; do not create an unpaid checkout session.
  --json                    Print machine-readable JSON.
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

async function readiness(options) {
  const checks = [];
  const merchant = options.merchant || process.env.SIGLUME_DIRECT_PAYMENT_MERCHANT || "";
  const origin = options.origin || process.env.SHOP_PUBLIC_ORIGIN || "";
  const webhookUrl = options.webhookUrl || process.env.SHOP_WEBHOOK_URL || "";
  const token = process.env.SIGLUME_MERCHANT_AUTH_TOKEN || process.env.SIGLUME_AUTH_TOKEN || "";
  const currency = normalizeCurrency(options.currency || process.env.SIGLUME_DIRECT_PAYMENT_TEST_CURRENCY || "JPY");
  const amountMinor = Number(options.amountMinor || process.env.SIGLUME_DIRECT_PAYMENT_TEST_AMOUNT_MINOR || (currency === "USD" ? 301 : 501));

  check(checks, "merchant_key", Boolean(merchant), "Set SIGLUME_DIRECT_PAYMENT_MERCHANT or pass --merchant.");
  check(checks, "merchant_token", Boolean(token) && !token.startsWith("cli_"), "Set SIGLUME_MERCHANT_AUTH_TOKEN to a merchant Siglume bearer token, not a cli_ key.");
  check(checks, "shop_origin", isHttpsOrigin(origin), "Set SHOP_PUBLIC_ORIGIN to an https origin, for example https://www.example.com.");
  check(checks, "webhook_url", isHttpsUrl(webhookUrl), "Set SHOP_WEBHOOK_URL to a public https webhook URL.");
  check(checks, "standard_probe_amount", isStandardAmount(currency, amountMinor), "Use a Standard-band probe amount: JPY 501+ or USD 301+ minor units.");

  if (options.api && !hasFailures(checks)) {
    const merchantClient = new DirectRequestPaymentMerchantClient({
      auth_token: token,
      base_url: options.baseUrl || process.env.SIGLUME_API_BASE,
    });
    try {
      const merchantResponse = await merchantClient.getMerchant(merchant);
      const account = merchantResponse.merchant_account || {};
      check(checks, "merchant_exists", Boolean(account.merchant), "Run merchant setup before checkout.");
      check(checks, "billing_mandate", Boolean(account.billing_mandate_id) || activeLike(account.billing_status), "Complete the merchant billing mandate wallet approval.");
      warnIf(checks, "merchant_status", account.status && !activeLike(account.status), `Merchant status is ${account.status}; confirm it is allowed to accept payments.`);
      warnIf(checks, "billing_status", account.billing_status && !activeLike(account.billing_status), `Billing status is ${account.billing_status}; confirm it is active before accepting payments.`);
    } catch (error) {
      check(checks, "merchant_api", false, apiErrorMessage(error, "Could not read the merchant account."));
    }

    if (options.probe && !hasFailures(checks)) {
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
        check(checks, "hosted_checkout", Boolean(session.checkout_url && session.challenge_hash), "Hosted Checkout did not return a checkout_url.");
      } catch (error) {
        const message = error instanceof HostedCheckoutNotAvailableError
          ? "Hosted Checkout is not enabled for this merchant account. Ask Siglume to enable it before coding the human checkout path."
          : apiErrorMessage(error, "Hosted Checkout probe failed. Check checkout_allowed_origins, currency, amount, and billing mandate.");
        check(checks, "hosted_checkout", false, message);
      }
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
    console.log(ok ? "Ready for 10-minute SDRP integration." : "Not ready. Fix the FAIL items before coding checkout.");
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
  await copyDir(from, to, Boolean(parsed.force));
  console.log(`Copied ${framework} SDRP integration files to ${to}`);
  console.log("Wire the exported router into your app, then run siglume-check readiness before opening checkout.");
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

function isHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeCurrency(value) {
  const currency = String(value || "").toUpperCase();
  if (currency !== "JPY" && currency !== "USD") {
    throw new Error("--currency must be JPY or USD.");
  }
  return currency;
}

function isStandardAmount(currency, amountMinor) {
  return Number.isSafeInteger(amountMinor) && amountMinor >= (currency === "USD" ? 301 : 501);
}

function activeLike(value) {
  return /^(active|ready|current|ok|enabled|paid|complete|completed)$/i.test(String(value || ""));
}

function apiErrorMessage(error, fallback) {
  if (error instanceof SiglumeApiError) {
    return `${fallback} ${error.code} (${error.status}).`;
  }
  return fallback;
}
