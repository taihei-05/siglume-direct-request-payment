import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "..");
const binPath = resolve(repoRoot, "bin", "siglume-sdrp.mjs");

describe("sandbox CLI E2E", () => {
  let sandboxProcess: ChildProcessWithoutNullStreams | null = null;

  afterEach(async () => {
    if (sandboxProcess && !sandboxProcess.killed) {
      sandboxProcess.kill();
      await Promise.race([
        once(sandboxProcess, "exit"),
        new Promise((resolve) => setTimeout(resolve, 1000)),
      ]);
    }
    sandboxProcess = null;
  });

  it("rejects invalid checkout input and confirms a sandbox checkout idempotently", async () => {
    const deliveries: Array<{ body: string; signature: string | undefined }> = [];
    const webhookServer = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      deliveries.push({
        body: Buffer.concat(chunks).toString("utf8"),
        signature: req.headers["siglume-signature"] as string | undefined,
      });
      res.writeHead(204).end();
    });

    await listen(webhookServer);
    const webhookPort = serverPort(webhookServer);
    const sandboxPort = await reservePort();
    sandboxProcess = spawn(process.execPath, [
      binPath,
      "sandbox",
      "--port",
      String(sandboxPort),
      "--origin",
      "http://localhost:3000",
      "--webhook-url",
      `http://127.0.0.1:${webhookPort}/payments/webhooks/siglume`,
    ], {
      cwd: repoRoot,
      env: { ...process.env, SIGLUME_WEBHOOK_SECRET: "whsec_sandbox_local" },
    });

    try {
      await waitForStdout(sandboxProcess, "Siglume SDRP sandbox is running.");
      const baseUrl = `http://127.0.0.1:${sandboxPort}`;
      const invalidAmount = await postJson(`${baseUrl}/v1/sdrp/direct-payments/checkout-sessions`, {
        merchant: "sandbox_merchant",
        amount_minor: 0,
        currency: "JPY",
        success_url: "http://localhost:3000/success",
        cancel_url: "http://localhost:3000/cancel",
      });
      expect(invalidAmount.status).toBe(400);
      const invalidCurrency = await postJson(`${baseUrl}/v1/sdrp/direct-payments/checkout-sessions`, {
        merchant: "sandbox_merchant",
        amount_minor: 1200,
        currency: "EUR",
        success_url: "http://localhost:3000/success",
        cancel_url: "http://localhost:3000/cancel",
      });
      expect(invalidCurrency.status).toBe(400);

      const created = await postJson(`${baseUrl}/v1/sdrp/direct-payments/checkout-sessions`, {
        merchant: "sandbox_merchant",
        amount_minor: 1200,
        currency: "JPY",
        nonce: "nonce_e2e",
        success_url: "http://localhost:3000/success",
        cancel_url: "http://localhost:3000/cancel",
        metadata: { order_id: "order_sandbox_e2e" },
      });
      expect(created.status).toBe(201);
      const createdBody = await created.json() as { data: { session_id: string } };
      const confirmUrl = `${baseUrl}/v1/sandbox/checkout-sessions/${createdBody.data.session_id}/confirm`;

      const firstConfirm = await fetch(confirmUrl, { method: "POST" });
      expect(firstConfirm.status).toBe(200);
      const firstConfirmBody = await firstConfirm.json() as { data: { event: { id: string; type: string } } };
      expect(firstConfirmBody.data.event.type).toBe("direct_payment.confirmed");

      const secondConfirm = await fetch(confirmUrl, { method: "POST" });
      expect(secondConfirm.status).toBe(200);
      const secondConfirmBody = await secondConfirm.json() as { data: { event: { id: string } } };
      expect(secondConfirmBody.data.event.id).toBe(firstConfirmBody.data.event.id);
      expect(deliveries).toHaveLength(1);
      expect(deliveries[0]?.signature).toContain("v1=");

      const redeliver = await fetch(
        `${baseUrl}/v1/sandbox/checkout-sessions/${createdBody.data.session_id}/redeliver`,
        { method: "POST" },
      );
      expect(redeliver.status).toBe(200);
      const redeliverBody = await redeliver.json() as { data: { event: { id: string } } };
      expect(redeliverBody.data.event.id).toBe(firstConfirmBody.data.event.id);
      expect(deliveries).toHaveLength(2);
      expect(JSON.parse(deliveries[1]?.body || "{}").id).toBe(firstConfirmBody.data.event.id);

      const microCreated = await postJson(`${baseUrl}/v1/sdrp/direct-payments/checkout-sessions`, {
        merchant: "sandbox_merchant",
        amount_minor: 100,
        currency: "JPY",
        nonce: "nonce_micro_e2e",
        success_url: "http://localhost:3000/success",
        cancel_url: "http://localhost:3000/cancel",
        metadata: { order_id: "order_micro_sandbox_e2e" },
      });
      expect(microCreated.status).toBe(201);
      const microCreatedBody = await microCreated.json() as { data: { session_id: string } };
      const microConfirm = await fetch(`${baseUrl}/v1/sandbox/checkout-sessions/${microCreatedBody.data.session_id}/confirm`, { method: "POST" });
      expect(microConfirm.status).toBe(200);
      expect(deliveries).toHaveLength(3);
      const microEvent = JSON.parse(deliveries[2]?.body || "{}") as {
        data: {
          pricing_band: string;
          buyer_debit_minor: string;
          provider_gross_amount_minor: string;
          protocol_fee_minor: string;
          provider_receivable_minor: string;
          settlement_threshold_minor: string;
        };
      };
      expect(microEvent.data.pricing_band).toBe("micro");
      expect(microEvent.data.buyer_debit_minor).toBe("100");
      expect(microEvent.data.provider_gross_amount_minor).toBe("100");
      expect(microEvent.data.protocol_fee_minor).toBe("2");
      expect(microEvent.data.provider_receivable_minor).toBe("98");
      expect(microEvent.data.settlement_threshold_minor).toBe("10000");

      const providerSummary = await fetch(`${baseUrl}/v1/sdrp/metered/provider/summary?plan_type=micro&token_symbol=JPYC`);
      expect(providerSummary.status).toBe(200);
      const providerSummaryBody = await providerSummary.json() as {
        data: {
          open_periods: Array<{
            buyer_debit_minor: string;
            provider_gross_amount_minor: string;
            protocol_fee_minor: string;
            provider_receivable_minor: string;
            total_unsettled_exposure_minor: string;
          }>;
          totals: { unsettled_provider_receivable_minor: string };
        };
      };
      expect(providerSummaryBody.data.open_periods[0]?.buyer_debit_minor).toBe("100");
      expect(providerSummaryBody.data.open_periods[0]?.provider_gross_amount_minor).toBe("100");
      expect(providerSummaryBody.data.open_periods[0]?.protocol_fee_minor).toBe("2");
      expect(providerSummaryBody.data.open_periods[0]?.provider_receivable_minor).toBe("98");
      expect(providerSummaryBody.data.open_periods[0]?.total_unsettled_exposure_minor).toBe("100");
      expect(providerSummaryBody.data.totals.unsettled_provider_receivable_minor).toBe("98");
    } finally {
      await closeServer(webhookServer);
    }
  }, 20000);
});

describe("readiness CLI", () => {
  it("preflight creates a Hosted Checkout probe session and skips webhook delivery", async () => {
    const calls: string[] = [];
    const apiServer = createServer(async (req, res) => {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      calls.push(`${req.method} ${url.pathname}`);
      if (req.method === "GET" && url.pathname === "/v1/sdrp/direct-payments/merchants/example_merchant") {
        sendJson(res, 200, envelope({
          merchant_account: {
            merchant: "example_merchant",
            billing_mandate_id: "mandate_test",
            billing_status: "active",
            status: "active",
          },
        }));
        return;
      }
      if (req.method === "GET" && url.pathname === "/v1/market/webhooks/subscriptions") {
        sendJson(res, 200, envelope([{
          id: "whsub_test",
          callback_url: "https://api.example.com/payments/webhooks/siglume",
          status: "active",
          event_types: ["direct_payment.confirmed"],
          signing_secret_hint: "test",
        }]));
        return;
      }
      if (req.method === "POST" && url.pathname === "/v1/sdrp/direct-payments/checkout-sessions") {
        sendJson(res, 201, envelope({
          checkout_url: "https://siglume.test/pay/chk_readiness",
          session_id: "chk_readiness",
          challenge_hash: "sha256:readiness",
          status: "open",
          expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        }));
        return;
      }
      if (req.method === "POST" && url.pathname === "/v1/market/webhooks/test-deliveries") {
        sendJson(res, 500, { error: { code: "unexpected_delivery_probe" } });
        return;
      }
      sendJson(res, 404, { error: { code: "not_found" } });
    });

    await listen(apiServer);
    try {
      const result = await runCli([
        "preflight",
        "--base-url",
        `http://127.0.0.1:${serverPort(apiServer)}/v1`,
        "--merchant",
        "example_merchant",
        "--origin",
        "https://shop.example.com",
        "--webhook-url",
        "https://api.example.com/payments/webhooks/siglume",
        "--json",
      ], {
        SIGLUME_MERCHANT_AUTH_TOKEN: "merchant_jwt",
        SIGLUME_WEBHOOK_SECRET: "whsec_test",
      });
      expect(result.status).toBe(0);
      const body = JSON.parse(result.stdout) as { ok: boolean; checks: Array<{ name: string; status: string }> };
      expect(body.ok).toBe(true);
      expect(body.checks).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: "hosted_checkout_probe", status: "pass" }),
        expect.objectContaining({ name: "webhook_delivery_probe_skipped", status: "pass" }),
      ]));
      expect(calls).toContain("POST /v1/sdrp/direct-payments/checkout-sessions");
      expect(calls).not.toContain("POST /v1/market/webhooks/test-deliveries");
    } finally {
      await closeServer(apiServer);
    }
  }, 10000);
});

function envelope(data: unknown) {
  return { data, meta: { request_id: "req_cli_test", trace_id: "trc_cli_test" } };
}

async function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function sendJson(res: import("node:http").ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
}

async function runCli(args: string[], env: Record<string, string>): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, [binPath, ...args], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  const [status] = await once(child, "exit") as [number | null];
  return { status, stdout, stderr };
}

async function listen(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function reservePort(): Promise<number> {
  const server = createServer();
  await listen(server);
  const port = serverPort(server);
  await closeServer(server);
  return port;
}

function serverPort(server: Server): number {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server did not bind to a TCP port");
  return address.port;
}

async function waitForStdout(child: ChildProcessWithoutNullStreams, needle: string): Promise<void> {
  let output = "";
  let stderr = "";
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for sandbox stdout. stderr=${stderr}`)), 10000);
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (output.includes(needle)) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Sandbox exited before ready with code=${code}. stderr=${stderr}`));
    });
  });
}
