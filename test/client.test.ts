import { describe, expect, it } from "vitest";

import {
  buildAllowanceExecutionPayload,
  buildPaymentExecutionPayload,
  DirectRequestPaymentClient,
  type DirectPaymentRequirement,
  SiglumeApiError,
} from "../src/index";

function envelope(data: unknown) {
  return { data, meta: { request_id: "req_test", trace_id: "trc_test" } };
}

function fixtureRequirement(): DirectPaymentRequirement {
  return {
    direct_payment_requirement_id: "dpr_test",
    requirement_id: "dpr_test",
    id: "row_test",
    mode: "external_402",
    merchant: "example_merchant",
    challenge_hash: "sha256:challenge",
    buyer_user_id: "user_buyer",
    product_listing_id: "listing_test",
    listing_id: "listing_test",
    access_grant_id: null,
    capability_key: "external_402.example_merchant",
    requirement_hash: "sha256:req",
    request_hash: "sha256:request",
    siglume_signature: "sig",
    token_symbol: "JPYC",
    currency: "JPY",
    amount_minor: 1200,
    fee_bps: 180,
    status: "transaction_prepared",
    transaction_request: {
      to: "0xDirectPaymentHub",
      metadata_jsonb: {
        direct_payment_requirement_id: "dpr_test",
        fee_bps: 180,
      },
    },
    approve_transaction_request: {
      to: "0xJPYC",
      metadata_jsonb: {
        direct_payment_requirement_id: "dpr_test",
      },
    },
    buyer_confirmation: "Pay 1200 JPYC?",
    non_custodial: true,
    metadata_jsonb: {
      mode: "external_402",
      merchant: "example_merchant",
    },
  };
}

describe("DirectRequestPaymentClient", () => {
  it("creates external_402 requirements with normalized payloads", async () => {
    const requests: Array<{ url: string; init: RequestInit; body: any }> = [];
    const fetchImpl: typeof fetch = async (input, init = {}) => {
      const body = init.body ? JSON.parse(String(init.body)) : null;
      requests.push({ url: String(input), init, body });
      return new Response(JSON.stringify(envelope(fixtureRequirement())), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    };
    const client = new DirectRequestPaymentClient({
      auth_token: "buyer_token",
      base_url: "https://siglume.example/v1",
      fetch: fetchImpl,
    });

    const result = await client.createPaymentRequirement({
      merchant: "Example_Merchant",
      amount_minor: 1200,
      currency: "jpy",
      challenge: "siglume-external-402-v1:nonce:sig",
      metadata: { order_id: "order_123" },
    });

    expect(result.requirement_id).toBe("dpr_test");
    expect(requests[0]?.url).toBe("https://siglume.example/v1/market/api-store/direct-payments/requirements");
    expect(requests[0]?.init.method).toBe("POST");
    expect((requests[0]?.init.headers as Record<string, string>).Authorization).toBe("Bearer buyer_token");
    expect(requests[0]?.body).toMatchObject({
      mode: "external_402",
      merchant: "example_merchant",
      amount_minor: 1200,
      currency: "JPY",
      challenge: "siglume-external-402-v1:nonce:sig",
      metadata: { order_id: "order_123" },
    });
  });

  it("builds payment and allowance execution payloads", () => {
    const requirement = fixtureRequirement();

    expect(buildPaymentExecutionPayload(requirement, { await_finality: true })).toMatchObject({
      transaction_request: requirement.transaction_request,
      receipt_kind: "api_store_direct_payment",
      reference_type: "api_store_direct_payment_requirement",
      reference_id: "dpr_test",
      await_finality: true,
      metadata: {
        direct_payment_requirement_id: "dpr_test",
        fee_bps: 180,
      },
    });
    expect(buildAllowanceExecutionPayload(requirement)).toMatchObject({
      transaction_request: requirement.approve_transaction_request,
      receipt_kind: "api_store_direct_payment_allowance",
      reference_type: "api_store_direct_payment_requirement",
      reference_id: "dpr_test",
    });
  });

  it("raises typed API errors", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ error: { code: "EXTERNAL_402_MERCHANT_NOT_FOUND", message: "merchant missing" } }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    const client = new DirectRequestPaymentClient({ auth_token: "buyer_token", base_url: "https://siglume.example/v1", fetch: fetchImpl });

    await expect(client.getPaymentRequirement("dpr_missing")).rejects.toMatchObject({
      name: "SiglumeApiError",
      code: "EXTERNAL_402_MERCHANT_NOT_FOUND",
      status: 404,
    } satisfies Partial<SiglumeApiError>);
  });
});
