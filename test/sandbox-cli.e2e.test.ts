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
    } finally {
      await closeServer(webhookServer);
    }
  }, 20000);
});

async function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
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
