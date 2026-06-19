import pytest

from siglume_direct_request_payment import (
    DirectRequestPaymentError,
    create_direct_request_payment_challenge,
    create_direct_request_payment_challenge_signature,
    create_direct_request_payment_recurring_challenge,
    direct_request_payment_challenge_hash,
    direct_request_payment_request_hash,
    direct_request_payment_request_hash_v2,
    parse_direct_request_payment_challenge,
    verify_direct_request_payment_challenge,
    verify_direct_request_payment_recurring_challenge,
)


def test_creates_server_compatible_external_402_challenge() -> None:
    challenge = create_direct_request_payment_challenge(
        merchant="Example_Merchant",
        amount_minor=1200,
        currency="jpy",
        secret="siglume-external-402-test-secret",
        nonce="nonce-123",
    )

    assert challenge["merchant"] == "example_merchant"
    assert challenge["currency"] == "JPY"
    assert challenge["signature"] == "bcf05e925a3f9ea73e75686c0da42fea894c3d10d6b4559d63cb327c0a2a74a5"
    assert (
        challenge["challenge"]
        == "siglume-external-402-v1:nonce-123:bcf05e925a3f9ea73e75686c0da42fea894c3d10d6b4559d63cb327c0a2a74a5"
    )
    assert challenge["challenge_hash"] == "sha256:1bcae8628e4a54178d132e7b7f85ff4b62a1c0fee79749833a23ca83a44616a2"


def test_verifies_and_rejects_challenges_without_exposing_secret() -> None:
    signature = create_direct_request_payment_challenge_signature(
        secret="siglume-external-402-test-secret",
        merchant="example_merchant",
        amount_minor=1200,
        currency="JPY",
        nonce="nonce-123",
    )
    challenge = f"siglume-external-402-v1:nonce-123:{signature}"

    assert parse_direct_request_payment_challenge(challenge) == {
        "scheme": "siglume-external-402-v1",
        "nonce": "nonce-123",
        "signature": signature,
    }
    assert verify_direct_request_payment_challenge(
        secret="siglume-external-402-test-secret",
        merchant="example_merchant",
        amount_minor=1200,
        currency="JPY",
        challenge=challenge,
    )
    assert not verify_direct_request_payment_challenge(
        secret="siglume-external-402-test-secret",
        merchant="example_merchant",
        amount_minor=1300,
        currency="JPY",
        challenge=challenge,
    )


def test_matches_backend_challenge_and_request_hash_material() -> None:
    challenge = "siglume-external-402-v1:nonce-123:bcf05e925a3f9ea73e75686c0da42fea894c3d10d6b4559d63cb327c0a2a74a5"

    assert direct_request_payment_challenge_hash(challenge) == (
        "sha256:1bcae8628e4a54178d132e7b7f85ff4b62a1c0fee79749833a23ca83a44616a2"
    )
    assert direct_request_payment_request_hash(
        merchant="example_merchant",
        amount_minor=1200,
        currency="JPY",
        challenge=challenge,
    ) == "sha256:9c608440740079bc051b0ac820811738ffc497007b9ab7816aea5f29526d0003"
    assert direct_request_payment_request_hash_v2(
        merchant="example_merchant",
        amount_minor=1200,
        currency="JPY",
        challenge=challenge,
    ) == "sha256:fcf0aedc6668bb136e40964547692f09ff5426e62fba7533f0f2c2018b1def8b"


def test_rejects_colon_delimited_nonces_that_backend_cannot_parse() -> None:
    with pytest.raises(DirectRequestPaymentError, match="nonce must not contain ':'"):
        create_direct_request_payment_challenge(
            merchant="example_merchant",
            amount_minor=1200,
            currency="JPY",
            secret="siglume-external-402-test-secret",
            nonce="order_123:attempt_1",
        )


def test_creates_server_compatible_recurring_challenge() -> None:
    recurring = create_direct_request_payment_recurring_challenge(
        merchant="Example_Merchant",
        amount_minor=1200,
        currency="jpy",
        cadence="monthly",
        secret="siglume-external-402-test-secret",
        nonce="nonce-123",
    )

    assert recurring["merchant"] == "example_merchant"
    assert recurring["currency"] == "JPY"
    assert recurring["cadence"] == "monthly"
    # Expected values computed with the server implementation
    # (_external_402_recurring_challenge_signature) and asserted in the TS suite
    # too, so TS, Python, and the server stay in lockstep.
    assert recurring["signature"] == "00fdcb18fa104f9f5ea755f143d8eb720dcd0387df1d5ffab8493e725da207b2"
    assert (
        recurring["challenge"]
        == "siglume-external-402-recurring-v1:nonce-123:00fdcb18fa104f9f5ea755f143d8eb720dcd0387df1d5ffab8493e725da207b2"
    )
    assert recurring["challenge_hash"] == "sha256:97aaf6df0479e73d2ec70f532b157659516c3fa79fd4c5658d7e4208acfc8f93"


def test_verifies_cadence_bound_recurring_challenges_and_keeps_schemes_separate() -> None:
    recurring = create_direct_request_payment_recurring_challenge(
        merchant="example_merchant",
        amount_minor=1200,
        currency="JPY",
        cadence="daily",
        secret="siglume-external-402-test-secret",
        nonce="autopay-1",
    )

    assert verify_direct_request_payment_recurring_challenge(
        secret="siglume-external-402-test-secret",
        merchant="example_merchant",
        amount_minor=1200,
        currency="JPY",
        cadence="daily",
        challenge=recurring["challenge"],
    )
    # cadence is part of the signed material.
    assert not verify_direct_request_payment_recurring_challenge(
        secret="siglume-external-402-test-secret",
        merchant="example_merchant",
        amount_minor=1200,
        currency="JPY",
        cadence="monthly",
        challenge=recurring["challenge"],
    )
    # A one-time checkout challenge never verifies as a recurring approval...
    one_time = create_direct_request_payment_challenge(
        merchant="example_merchant",
        amount_minor=1200,
        currency="JPY",
        secret="siglume-external-402-test-secret",
        nonce="one-time-1",
    )
    assert not verify_direct_request_payment_recurring_challenge(
        secret="siglume-external-402-test-secret",
        merchant="example_merchant",
        amount_minor=1200,
        currency="JPY",
        cadence="daily",
        challenge=one_time["challenge"],
    )
    # ...and a recurring approval never verifies as a one-time challenge.
    assert not verify_direct_request_payment_challenge(
        secret="siglume-external-402-test-secret",
        merchant="example_merchant",
        amount_minor=1200,
        currency="JPY",
        challenge=recurring["challenge"],
    )


def test_rejects_unsupported_recurring_cadences() -> None:
    with pytest.raises(DirectRequestPaymentError, match="cadence must be"):
        create_direct_request_payment_recurring_challenge(
            merchant="example_merchant",
            amount_minor=1200,
            currency="JPY",
            cadence="weekly",
            secret="siglume-external-402-test-secret",
        )
