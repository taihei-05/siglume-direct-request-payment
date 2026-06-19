import { describe, expect, it } from "vitest";

import {
  buildWebhookSignatureHeader,
  SiglumeWebhookPayloadError,
  SiglumeWebhookSignatureError,
  verifyDirectRequestPaymentWebhook,
  verifyWebhookSignature,
} from "../src/index";

describe("Direct Request Payment webhooks", () => {
  it("verifies signed direct_payment.confirmed webhooks", async () => {
    const event = {
      id: "evt_123",
      type: "direct_payment.confirmed",
      api_version: "2026-06-11",
      occurred_at: "2026-06-11T00:00:00Z",
      data: {
        mode: "external_402",
        merchant: "example_merchant",
        requirement_id: "dpr_test",
        challenge_hash: "sha256:challenge",
      },
    };
    const rawBody = JSON.stringify(event);
    const header = await buildWebhookSignatureHeader("whsec_test", rawBody, { timestamp: 1800000000 });

    const verified = await verifyDirectRequestPaymentWebhook("whsec_test", rawBody, header, {
      now: 1800000000,
    });

    expect(verified.verification.timestamp).toBe(1800000000);
    expect(verified.event.data.merchant).toBe("example_merchant");
  });

  it("rejects stale or mismatched webhook signatures", async () => {
    const rawBody = JSON.stringify({
      id: "evt_123",
      type: "direct_payment.confirmed",
      api_version: "2026-06-11",
      occurred_at: "2026-06-11T00:00:00Z",
      data: { mode: "external_402" },
    });
    const header = await buildWebhookSignatureHeader("whsec_test", rawBody, { timestamp: 1800000000 });

    await expect(verifyWebhookSignature("whsec_test", rawBody, header, { now: 1800001000 })).rejects.toBeInstanceOf(
      SiglumeWebhookSignatureError,
    );
    await expect(verifyWebhookSignature("wrong_secret", rawBody, header, { now: 1800000000 })).rejects.toBeInstanceOf(
      SiglumeWebhookSignatureError,
    );
  });

  it("accepts metered settlement confirmation machine fields", async () => {
    const event = {
      id: "evt_metered",
      type: "direct_payment.confirmed",
      api_version: "2026-06-11",
      occurred_at: "2026-06-11T00:00:00Z",
      data: {
        mode: "metered_settlement_batch",
        requirement_id: "dpr_metered",
        pricing_band: "micro",
        settlement_cadence: "weekly",
        finality: "aggregated_onchain_settlement",
        protocol_fee_minor: "1.6",
        settlement_status: "settled",
      },
    };
    const rawBody = JSON.stringify(event);
    const header = await buildWebhookSignatureHeader("whsec_test", rawBody, { timestamp: 1800000000 });

    const verified = await verifyDirectRequestPaymentWebhook("whsec_test", rawBody, header, {
      now: 1800000000,
    });

    expect(verified.event.data.pricing_band).toBe("micro");
    expect(verified.event.data.settlement_status).toBe("settled");
  });

  it("rejects direct payment events with the wrong mode", async () => {
    const rawBody = JSON.stringify({
      id: "evt_123",
      type: "direct_payment.confirmed",
      api_version: "2026-06-11",
      occurred_at: "2026-06-11T00:00:00Z",
      data: { mode: "wrong_mode" },
    });
    const header = await buildWebhookSignatureHeader("whsec_test", rawBody, { timestamp: 1800000000 });

    await expect(
      verifyDirectRequestPaymentWebhook("whsec_test", rawBody, header, { now: 1800000000 }),
    ).rejects.toBeInstanceOf(SiglumeWebhookPayloadError);
  });
});
