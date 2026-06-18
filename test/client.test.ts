import { describe, expect, it } from "vitest";

import {
  buildAllowanceExecutionPayload,
  buildPaymentExecutionPayload,
  DirectRequestPaymentClient,
  DirectRequestPaymentMerchantClient,
  type DirectPaymentRequirement,
  HostedCheckoutNotAvailableError,
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
    expect(requests[0]?.url).toBe("https://siglume.example/v1/sdrp/direct-payments/requirements");
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
      receipt_kind: "sdrp_direct_payment",
      reference_type: "sdrp_direct_payment_requirement",
      reference_id: "dpr_test",
      await_finality: true,
      metadata: {
        direct_payment_requirement_id: "dpr_test",
        fee_bps: 180,
      },
    });
    expect(buildAllowanceExecutionPayload(requirement)).toMatchObject({
      transaction_request: requirement.approve_transaction_request,
      receipt_kind: "sdrp_direct_payment_allowance",
      reference_type: "sdrp_direct_payment_requirement",
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

describe("DirectRequestPaymentMerchantClient", () => {
  it("sets up merchant checkout with billing mandate and webhook subscription", async () => {
    const calls: Array<{ url: string; init: RequestInit; body: any }> = [];
    const merchantAccount = {
      merchant_account_id: "macc_test",
      merchant: "example_merchant",
      merchant_user_id: "usr_merchant",
      billing_plan: "free",
      billing_currency: "JPY",
      token_symbol: "JPYC",
      billing_status: "setup_required",
      metadata_jsonb: { self_service: true },
    };
    const responses = [
      envelope({
        merchant_account: merchantAccount,
        challenge_secret: "edrp_secret",
        challenge_secret_created: true,
        created: true,
        listing_id: "listing_external_402",
      }),
      envelope({
        merchant_account: { ...merchantAccount, billing_mandate_id: "mandate_test" },
        mandate: { mandate_id: "mandate_test", status: "active" },
        created: true,
      }),
      envelope({
        id: "whsub_test",
        callback_url: "https://merchant.example/webhooks/siglume",
        signing_secret: "whsec_test",
        status: "active",
      }),
    ];
    const fetchImpl: typeof fetch = async (input, init = {}) => {
      const body = init.body ? JSON.parse(String(init.body)) : null;
      calls.push({ url: String(input), init, body });
      return new Response(JSON.stringify(responses.shift()), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    };
    const client = new DirectRequestPaymentMerchantClient({
      auth_token: "merchant_jwt",
      base_url: "https://siglume.example/v1",
      fetch: fetchImpl,
    });

    const result = await client.setupCheckout({
      merchant: "Example_Merchant",
      display_name: "Example Merchant",
      billing_plan: "launch",
      billing_currency: "jpy",
      webhook_callback_url: "https://merchant.example/webhooks/siglume",
      max_amount_minor: 100000,
    });

    expect(calls.map((call) => call.url)).toEqual([
      "https://siglume.example/v1/sdrp/direct-payments/merchants",
      "https://siglume.example/v1/sdrp/direct-payments/merchants/example_merchant/billing-mandate",
      "https://siglume.example/v1/market/webhooks/subscriptions",
    ]);
    expect((calls[0]?.init.headers as Record<string, string>).Authorization).toBe("Bearer merchant_jwt");
    expect(calls[0]?.body).toMatchObject({
      merchant: "example_merchant",
      display_name: "Example Merchant",
      billing_plan: "launch",
      billing_currency: "JPY",
      max_amount_minor: 100000,
    });
    expect(calls[1]?.body).toMatchObject({ billing_currency: "JPY", max_amount_minor: 100000 });
    expect(calls[2]?.body).toMatchObject({
      callback_url: "https://merchant.example/webhooks/siglume",
      event_types: ["direct_payment.confirmed", "direct_payment.spent"],
      metadata: { merchant: "example_merchant", sdk: "@siglume/direct-request-payment" },
    });
    expect(result.env).toEqual({
      SIGLUME_DIRECT_PAYMENT_MERCHANT: "example_merchant",
      SIGLUME_DIRECT_PAYMENT_CHALLENGE_SECRET: "edrp_secret",
      SIGLUME_WEBHOOK_SECRET: "whsec_test",
    });
  });

  it("registers checkout_allowed_origins (normalized) on setupMerchant", async () => {
    const calls: Array<{ url: string; body: any }> = [];
    const fetchImpl: typeof fetch = async (input, init = {}) => {
      calls.push({ url: String(input), body: init.body ? JSON.parse(String(init.body)) : null });
      return new Response(JSON.stringify(envelope({ merchant_account: { merchant: "m" } })), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    };
    const client = new DirectRequestPaymentMerchantClient({
      auth_token: "merchant_jwt",
      base_url: "https://siglume.example/v1",
      fetch: fetchImpl,
    });
    await client.setupMerchant({
      merchant: "Shop",
      checkout_allowed_origins: [
        "https://Shop.Example.com/checkout",
        "https://shop.example.com",
        "https://other.example.com:8443",
      ],
    });
    expect(calls[0]?.body.checkout_allowed_origins).toEqual([
      "https://shop.example.com",
      "https://other.example.com:8443",
    ]);
  });

  it("creates and reads a Hosted Checkout session", async () => {
    const calls: Array<{ url: string; method: string; body: any; auth?: string }> = [];
    const responses = [
      envelope({
        checkout_url: "https://siglume.example/pay/chk_abc",
        session_id: "chk_abc",
        challenge_hash: "sha256:deadbeef",
        status: "open",
        expires_at: "2026-06-18T01:00:00Z",
      }),
      envelope({
        session_id: "chk_abc",
        merchant: "shop",
        currency: "JPY",
        token_symbol: "JPYC",
        amount_minor: 500,
        status: "paid",
        challenge_hash: "sha256:deadbeef",
        success_url: "https://shop.example.com/thanks",
        cancel_url: "https://shop.example.com/cart",
      }),
    ];
    const fetchImpl: typeof fetch = async (input, init = {}) => {
      calls.push({
        url: String(input),
        method: String(init.method || "GET"),
        body: init.body ? JSON.parse(String(init.body)) : null,
        auth: (init.headers as Record<string, string> | undefined)?.Authorization,
      });
      return new Response(JSON.stringify(responses.shift()), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    };
    const client = new DirectRequestPaymentMerchantClient({
      auth_token: "merchant_jwt",
      base_url: "https://siglume.example/v1",
      fetch: fetchImpl,
    });

    const created = await client.createCheckoutSession({
      merchant: "Shop",
      amount_minor: 500,
      currency: "jpy",
      nonce: "order-1",
      success_url: "https://shop.example.com/thanks",
      cancel_url: "https://shop.example.com/cart",
      metadata: { order_id: "order-1" },
    });
    expect(created.checkout_url).toBe("https://siglume.example/pay/chk_abc");
    expect(created.session_id).toBe("chk_abc");
    expect(created.challenge_hash).toBe("sha256:deadbeef");
    expect(calls[0]?.url).toBe("https://siglume.example/v1/sdrp/direct-payments/checkout-sessions");
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.auth).toBe("Bearer merchant_jwt");
    expect(calls[0]?.body).toMatchObject({
      merchant: "shop",
      amount_minor: 500,
      currency: "JPY",
      nonce: "order-1",
      success_url: "https://shop.example.com/thanks",
      cancel_url: "https://shop.example.com/cart",
      metadata: { order_id: "order-1" },
    });

    const session = await client.getCheckoutSession("chk_abc");
    expect(session.status).toBe("paid");
    expect(calls[1]?.url).toBe("https://siglume.example/v1/sdrp/direct-payments/checkout-sessions/chk_abc");
    expect(calls[1]?.method).toBe("GET");
  });

  it("rejects a non-absolute checkout_allowed_origins entry", async () => {
    const client = new DirectRequestPaymentMerchantClient({
      auth_token: "merchant_jwt",
      fetch: (async () => new Response("{}")) as typeof fetch,
    });
    await expect(
      client.setupMerchant({ merchant: "shop", checkout_allowed_origins: ["not-a-url"] }),
    ).rejects.toThrow(/absolute origin/);
  });

  it("rejects a hosted checkout nonce containing the challenge separator", async () => {
    const client = new DirectRequestPaymentMerchantClient({
      auth_token: "merchant_jwt",
      fetch: (async () => new Response("{}")) as typeof fetch,
    });
    await expect(
      client.createCheckoutSession({
        merchant: "shop",
        amount_minor: 500,
        currency: "JPY",
        nonce: "order:1",
        success_url: "https://shop.example.com/thanks",
        cancel_url: "https://shop.example.com/cart",
      }),
    ).rejects.toThrow(/nonce must not contain/);
  });

  it("maps hosted checkout rollout errors to an explicit availability error", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          error: {
            code: "HOSTED_CHECKOUT_NOT_ENABLED",
            message: "Hosted Checkout is not enabled for this account yet.",
          },
        }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      );
    const client = new DirectRequestPaymentMerchantClient({
      auth_token: "merchant_jwt",
      base_url: "https://siglume.example/v1",
      fetch: fetchImpl,
    });

    await expect(
      client.createCheckoutSession({
        merchant: "shop",
        amount_minor: 500,
        currency: "JPY",
        nonce: "order-1",
        success_url: "https://shop.example.com/thanks",
        cancel_url: "https://shop.example.com/cart",
      }),
    ).rejects.toBeInstanceOf(HostedCheckoutNotAvailableError);
  });

  it("maps a missing hosted checkout route to an explicit availability error", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ error: { code: "HTTP_404", message: "Not Found" } }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    const client = new DirectRequestPaymentMerchantClient({
      auth_token: "merchant_jwt",
      base_url: "https://siglume.example/v1",
      fetch: fetchImpl,
    });

    await expect(client.getCheckoutSession("chk_missing_backend")).rejects.toMatchObject({
      name: "HostedCheckoutNotAvailableError",
      code: "HOSTED_CHECKOUT_NOT_ENABLED",
      status: 409,
    });
  });
});
