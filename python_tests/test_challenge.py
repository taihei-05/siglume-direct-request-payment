import pytest

from siglume_direct_request_payment import (
    DirectRequestPaymentError,
    create_direct_request_payment_challenge,
    create_direct_request_payment_challenge_signature,
    direct_request_payment_challenge_hash,
    direct_request_payment_request_hash,
    parse_direct_request_payment_challenge,
    verify_direct_request_payment_challenge,
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


def test_rejects_colon_delimited_nonces_that_backend_cannot_parse() -> None:
    with pytest.raises(DirectRequestPaymentError, match="nonce must not contain ':'"):
        create_direct_request_payment_challenge(
            merchant="example_merchant",
            amount_minor=1200,
            currency="JPY",
            secret="siglume-external-402-test-secret",
            nonce="order_123:attempt_1",
        )
