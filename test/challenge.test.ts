import { describe, expect, it } from "vitest";

import {
  createDirectRequestPaymentChallenge,
  createDirectRequestPaymentChallengeSignature,
  createDirectRequestPaymentRecurringChallenge,
  directRequestPaymentChallengeHash,
  directRequestPaymentRequestHash,
  parseDirectRequestPaymentChallenge,
  verifyDirectRequestPaymentChallenge,
  verifyDirectRequestPaymentRecurringChallenge,
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

describe("Direct Request Payment recurring challenges", () => {
  it("creates the server-compatible recurring challenge (cadence bound into the HMAC)", async () => {
    const recurring = await createDirectRequestPaymentRecurringChallenge({
      merchant: "Example_Merchant",
      amount_minor: 1200,
      currency: "jpy",
      cadence: "monthly",
      secret: "siglume-external-402-test-secret",
      nonce: "nonce-123",
    });

    expect(recurring.merchant).toBe("example_merchant");
    expect(recurring.currency).toBe("JPY");
    expect(recurring.cadence).toBe("monthly");
    // Expected values computed with the server implementation
    // (_external_402_recurring_challenge_signature) so both sides stay in lockstep.
    expect(recurring.signature).toBe("00fdcb18fa104f9f5ea755f143d8eb720dcd0387df1d5ffab8493e725da207b2");
    expect(recurring.challenge).toBe(
      "siglume-external-402-recurring-v1:nonce-123:00fdcb18fa104f9f5ea755f143d8eb720dcd0387df1d5ffab8493e725da207b2",
    );
    expect(recurring.challenge_hash).toBe(
      "sha256:97aaf6df0479e73d2ec70f532b157659516c3fa79fd4c5658d7e4208acfc8f93",
    );
  });

  it("verifies cadence-bound recurring challenges and keeps schemes separate", async () => {
    const recurring = await createDirectRequestPaymentRecurringChallenge({
      merchant: "example_merchant",
      amount_minor: 1200,
      currency: "JPY",
      cadence: "daily",
      secret: "siglume-external-402-test-secret",
      nonce: "autopay-1",
    });

    await expect(
      verifyDirectRequestPaymentRecurringChallenge("siglume-external-402-test-secret", {
        merchant: "example_merchant",
        amount_minor: 1200,
        currency: "JPY",
        cadence: "daily",
        challenge: recurring.challenge,
      }),
    ).resolves.toBe(true);
    // cadence is part of the signed material.
    await expect(
      verifyDirectRequestPaymentRecurringChallenge("siglume-external-402-test-secret", {
        merchant: "example_merchant",
        amount_minor: 1200,
        currency: "JPY",
        cadence: "monthly",
        challenge: recurring.challenge,
      }),
    ).resolves.toBe(false);
    // A one-time checkout challenge never verifies as a recurring approval...
    const oneTime = await createDirectRequestPaymentChallenge({
      merchant: "example_merchant",
      amount_minor: 1200,
      currency: "JPY",
      secret: "siglume-external-402-test-secret",
      nonce: "one-time-1",
    });
    await expect(
      verifyDirectRequestPaymentRecurringChallenge("siglume-external-402-test-secret", {
        merchant: "example_merchant",
        amount_minor: 1200,
        currency: "JPY",
        cadence: "daily",
        challenge: oneTime.challenge,
      }),
    ).resolves.toBe(false);
    // ...and a recurring approval never verifies as a one-time challenge.
    await expect(
      verifyDirectRequestPaymentChallenge("siglume-external-402-test-secret", {
        merchant: "example_merchant",
        amount_minor: 1200,
        currency: "JPY",
        challenge: recurring.challenge,
      }),
    ).resolves.toBe(false);
  });

  it("rejects unsupported cadences", async () => {
    await expect(
      createDirectRequestPaymentRecurringChallenge({
        merchant: "example_merchant",
        amount_minor: 1200,
        currency: "JPY",
        cadence: "weekly",
        secret: "siglume-external-402-test-secret",
      }),
    ).rejects.toThrow('cadence must be "monthly" (subscription) or "daily" (scheduled autopay).');
  });
});
