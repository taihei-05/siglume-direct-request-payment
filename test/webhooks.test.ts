import { describe, expect, it } from "vitest";

import {
  buildWebhookSignatureHeader,
  classifyDirectPaymentConfirmation,
  DIRECT_REQUEST_PAYMENT_METERED_ACCEPTED_STATUS,
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

  it("rejects JSON objects for webhook verification even though the test header builder accepts them", async () => {
    const event = {
      id: "evt_123",
      type: "direct_payment.confirmed",
      api_version: "2026-06-11",
      occurred_at: "2026-06-11T00:00:00Z",
      data: { mode: "external_402" },
    };
    const header = await buildWebhookSignatureHeader("whsec_test", event, { timestamp: 1800000000 });

    await expect(
      verifyWebhookSignature("whsec_test", event as unknown as string, header, { now: 1800000000 }),
    ).rejects.toBeInstanceOf(SiglumeWebhookPayloadError);
    await expect(
      verifyDirectRequestPaymentWebhook("whsec_test", event as unknown as string, header, { now: 1800000000 }),
    ).rejects.toBeInstanceOf(SiglumeWebhookPayloadError);
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
        protocol_fee_minor: "2",
        settlement_status: "settled",
        settlement_batch_id: "msb_123",
        chain_receipt_id: "chain_123",
        usage_event_digest: "sha256:usage",
        settled_at: "2026-06-19T00:00:00Z",
      },
    };
    const rawBody = JSON.stringify(event);
    const header = await buildWebhookSignatureHeader("whsec_test", rawBody, { timestamp: 1800000000 });

    const verified = await verifyDirectRequestPaymentWebhook("whsec_test", rawBody, header, {
      now: 1800000000,
    });

    expect(verified.event.data.pricing_band).toBe("micro");
    expect(verified.event.data.settlement_status).toBe("settled");
    expect(verified.event.data.challenge_hash).toBeUndefined();
    expect(verified.event.data.settlement_batch_id).toBe("msb_123");
    expect(verified.event.data.chain_receipt_id).toBe("chain_123");
    expect(verified.event.data.usage_event_digest).toBe("sha256:usage");
    expect(verified.event.data.settled_at).toBe("2026-06-19T00:00:00Z");
  });

  it("classifies standard settled confirmations only with finality and a receipt", () => {
    const result = classifyDirectPaymentConfirmation({
      id: "evt_standard",
      type: "direct_payment.confirmed",
      api_version: "2026-06-11",
      occurred_at: "2026-06-11T00:00:00Z",
      data: {
        mode: "external_402",
        pricing_band: "standard",
        finality: "per_payment_onchain",
        settlement_status: "settled",
        requirement_id: "dpr_standard",
        challenge_hash: "sha256:challenge",
        chain_receipt_id: "chain_standard",
      },
    });

    expect(result.kind).toBe("standard_settled");
    if (result.kind === "standard_settled") {
      expect(result.requirement_id).toBe("dpr_standard");
      expect(result.challenge_hash).toBe("sha256:challenge");
      expect(result.chain_receipt_id).toBe("chain_standard");
    }
  });

  it("classifies metered usage only when finality and pending settlement match", () => {
    const result = classifyDirectPaymentConfirmation({
      id: "evt_micro",
      type: "direct_payment.confirmed",
      api_version: "2026-06-11",
      occurred_at: "2026-06-11T00:00:00Z",
      data: {
        mode: "external_402",
        pricing_band: "micro",
        settlement_cadence: "weekly",
        finality: "aggregated_onchain_settlement",
        settlement_status: DIRECT_REQUEST_PAYMENT_METERED_ACCEPTED_STATUS,
        requirement_id: "dpr_micro",
        challenge_hash: "sha256:micro",
      },
    });

    expect(result.kind).toBe("metered_usage_accepted");
    if (result.kind === "metered_usage_accepted") {
      expect(result.pricing_band).toBe("micro");
      expect(result.settlement_cadence).toBe("weekly");
      expect(result.requirement_id).toBe("dpr_micro");
      expect(result.challenge_hash).toBe("sha256:micro");
    }

    const missingStatus = classifyDirectPaymentConfirmation({
      id: "evt_micro_bad",
      type: "direct_payment.confirmed",
      api_version: "2026-06-11",
      occurred_at: "2026-06-11T00:00:00Z",
      data: {
        mode: "external_402",
        pricing_band: "micro",
        settlement_cadence: "weekly",
        finality: "aggregated_onchain_settlement",
        settlement_status: "settled",
        requirement_id: "dpr_micro",
        challenge_hash: "sha256:micro",
      },
    });

    expect(missingStatus.kind).toBe("unknown");
    if (missingStatus.kind === "unknown") {
      expect(missingStatus.reason).toBe("missing_metered_usage_fields");
    }
  });

  it("requires metered usage cadence to match the pricing band", () => {
    const validData = {
      mode: "external_402",
      pricing_band: "micro",
      settlement_cadence: "weekly",
      finality: "aggregated_onchain_settlement",
      settlement_status: DIRECT_REQUEST_PAYMENT_METERED_ACCEPTED_STATUS,
      requirement_id: "dpr_micro",
      challenge_hash: "sha256:micro",
    };
    const invalidCases: Array<[string, Record<string, unknown>]> = [
      ["missing cadence", { settlement_cadence: undefined }],
      ["micro monthly cadence", { settlement_cadence: "monthly" }],
      ["nano weekly cadence", { pricing_band: "nano", settlement_cadence: "weekly" }],
    ];

    for (const [name, override] of invalidCases) {
      const data = { ...validData, ...override };
      for (const key of Object.keys(data)) {
        if (data[key as keyof typeof data] === undefined) {
          delete data[key as keyof typeof data];
        }
      }
      const result = classifyDirectPaymentConfirmation({
        id: `evt_usage_${name.replace(/\s+/g, "_")}`,
        type: "direct_payment.confirmed",
        api_version: "2026-06-11",
        occurred_at: "2026-06-11T00:00:00Z",
        data,
      });

      expect(result.kind, name).toBe("unknown");
      if (result.kind === "unknown") {
        expect(result.reason, name).toBe("missing_metered_usage_fields");
      }
    }
  });

  it("requires settlement batch identifiers before classifying a metered batch settled", () => {
    const result = classifyDirectPaymentConfirmation({
      id: "evt_batch",
      type: "direct_payment.confirmed",
      api_version: "2026-06-11",
      occurred_at: "2026-06-11T00:00:00Z",
      data: {
        mode: "metered_settlement_batch",
        pricing_band: "micro",
        settlement_cadence: "weekly",
        finality: "aggregated_onchain_settlement",
        settlement_status: "settled",
        settlement_batch_id: "msb_123",
        chain_receipt_id: "chain_123",
        usage_event_digest: "sha256:usage",
      },
    });

    expect(result.kind).toBe("metered_batch_settled");
    if (result.kind === "metered_batch_settled") {
      expect(result.pricing_band).toBe("micro");
      expect(result.settlement_cadence).toBe("weekly");
      expect(result.settlement_batch_id).toBe("msb_123");
      expect(result.chain_receipt_id).toBe("chain_123");
      expect(result.usage_event_digest).toBe("sha256:usage");
    }

    const missingReceipt = classifyDirectPaymentConfirmation({
      id: "evt_batch_bad",
      type: "direct_payment.confirmed",
      api_version: "2026-06-11",
      occurred_at: "2026-06-11T00:00:00Z",
      data: {
        mode: "metered_settlement_batch",
        pricing_band: "micro",
        settlement_cadence: "weekly",
        finality: "aggregated_onchain_settlement",
        settlement_status: "settled",
        settlement_batch_id: "msb_123",
        usage_event_digest: "sha256:usage",
      },
    });

    expect(missingReceipt.kind).toBe("unknown");
    if (missingReceipt.kind === "unknown") {
      expect(missingReceipt.reason).toBe("invalid_metered_settlement_confirmation");
    }
  });

  it("requires metered batch finality, band, and cadence before classifying settled", () => {
    const validData = {
      mode: "metered_settlement_batch",
      pricing_band: "micro",
      settlement_cadence: "weekly",
      finality: "aggregated_onchain_settlement",
      settlement_status: "settled",
      settlement_batch_id: "msb_123",
      chain_receipt_id: "chain_123",
      usage_event_digest: "sha256:usage",
    };
    const invalidCases: Array<[string, Record<string, unknown>]> = [
      ["missing finality", { finality: undefined }],
      ["standard finality", { finality: "per_payment_onchain" }],
      ["missing pricing band", { pricing_band: undefined }],
      ["micro monthly cadence", { settlement_cadence: "monthly" }],
      ["nano weekly cadence", { pricing_band: "nano", settlement_cadence: "weekly" }],
    ];

    for (const [name, override] of invalidCases) {
      const data = { ...validData, ...override };
      for (const key of Object.keys(data)) {
        if (data[key as keyof typeof data] === undefined) {
          delete data[key as keyof typeof data];
        }
      }
      const result = classifyDirectPaymentConfirmation({
        id: `evt_batch_${name.replace(/\s+/g, "_")}`,
        type: "direct_payment.confirmed",
        api_version: "2026-06-11",
        occurred_at: "2026-06-11T00:00:00Z",
        data,
      });

      expect(result.kind, name).toBe("unknown");
      if (result.kind === "unknown") {
        expect(result.reason, name).toBe("invalid_metered_settlement_confirmation");
      }
    }
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
