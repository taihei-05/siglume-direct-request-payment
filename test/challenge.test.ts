import { describe, expect, it } from "vitest";

import {
  createDirectRequestPaymentChallenge,
  createDirectRequestPaymentChallengeSignature,
  directRequestPaymentChallengeHash,
  directRequestPaymentRequestHash,
  parseDirectRequestPaymentChallenge,
  verifyDirectRequestPaymentChallenge,
} from "../src/index";

describe("Direct Request Payment challenges", () => {
  it("creates the server-compatible external_402 challenge", async () => {
    const challenge = await createDirectRequestPaymentChallenge({
      merchant: "Example_Merchant",
      amount_minor: 1200,
      currency: "jpy",
      secret: "siglume-external-402-test-secret",
      nonce: "nonce-123",
    });

    expect(challenge.merchant).toBe("example_merchant");
    expect(challenge.currency).toBe("JPY");
    expect(challenge.signature).toBe("bcf05e925a3f9ea73e75686c0da42fea894c3d10d6b4559d63cb327c0a2a74a5");
    expect(challenge.challenge).toBe(
      "siglume-external-402-v1:nonce-123:bcf05e925a3f9ea73e75686c0da42fea894c3d10d6b4559d63cb327c0a2a74a5",
    );
    expect(challenge.challenge_hash).toBe("sha256:1bcae8628e4a54178d132e7b7f85ff4b62a1c0fee79749833a23ca83a44616a2");
  });

  it("verifies and rejects challenges without exposing the secret", async () => {
    const signature = await createDirectRequestPaymentChallengeSignature("siglume-external-402-test-secret", {
      merchant: "example_merchant",
      amount_minor: 1200,
      currency: "JPY",
      nonce: "nonce-123",
    });
    const challenge = `siglume-external-402-v1:nonce-123:${signature}`;

    expect(parseDirectRequestPaymentChallenge(challenge)).toEqual({
      scheme: "siglume-external-402-v1",
      nonce: "nonce-123",
      signature,
    });
    await expect(
      verifyDirectRequestPaymentChallenge("siglume-external-402-test-secret", {
        merchant: "example_merchant",
        amount_minor: 1200,
        currency: "JPY",
        challenge,
      }),
    ).resolves.toBe(true);
    await expect(
      verifyDirectRequestPaymentChallenge("siglume-external-402-test-secret", {
        merchant: "example_merchant",
        amount_minor: 1300,
        currency: "JPY",
        challenge,
      }),
    ).resolves.toBe(false);
  });

  it("matches the backend challenge and request hash material", async () => {
    const challenge = "siglume-external-402-v1:nonce-123:bcf05e925a3f9ea73e75686c0da42fea894c3d10d6b4559d63cb327c0a2a74a5";

    await expect(directRequestPaymentChallengeHash(challenge)).resolves.toBe(
      "sha256:1bcae8628e4a54178d132e7b7f85ff4b62a1c0fee79749833a23ca83a44616a2",
    );
    await expect(
      directRequestPaymentRequestHash({
        merchant: "example_merchant",
        amount_minor: 1200,
        currency: "JPY",
        challenge,
      }),
    ).resolves.toBe("sha256:9c608440740079bc051b0ac820811738ffc497007b9ab7816aea5f29526d0003");
  });

  it("rejects colon-delimited nonces that the backend cannot parse", async () => {
    await expect(
      createDirectRequestPaymentChallenge({
        merchant: "example_merchant",
        amount_minor: 1200,
        currency: "JPY",
        secret: "siglume-external-402-test-secret",
        nonce: "order_123:attempt_1",
      }),
    ).rejects.toThrow("nonce must not contain ':'");
  });
});
